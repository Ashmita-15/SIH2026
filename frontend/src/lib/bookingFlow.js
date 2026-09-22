import api from '../services/api'
import { toISODate } from './slots'
import { matchDoctor, parseChoice } from './doctorMatch'

/**
 * The deterministic half of voice booking.
 *
 * Everything here is plain code on purpose. The model contributes three pieces
 * of language — a name the patient said, a relative day, a clock hour — and
 * nothing in this file trusts them further than that: a name is matched against
 * doctors the server actually returned, an hour against slots the availability
 * API actually reported free, a day against a fixed offset. Nothing that reaches
 * the booking endpoint was invented by a model.
 *
 * No Gemini, no Appointment model, no authorization decisions. Identity is the
 * server's business — `patientId` is deliberately never sent.
 */

export const BOOKING = {
  IDLE: 'idle',
  COLLECTING_DOCTOR: 'collecting_doctor',
  COLLECTING_DATE: 'collecting_date',
  /** Session or hour, depending on what the doctor runs. */
  COLLECTING_SLOT: 'collecting_slot',
  AWAITING_CONFIRMATION: 'awaiting_confirmation',
  BOOKING: 'booking',
  BOOKED: 'booked'
}

/**
 * Yes and no, without a model — the same words the backend's guidance matches.
 *
 * Duplicated rather than shared because the two run in different processes, and
 * a booking must not depend on a network round trip to decide that "रहने दो"
 * means stop. Matched as whole short answers so "no" inside a sentence is not
 * mistaken for a refusal.
 */
const AFFIRM = ['haan', 'han', 'ha', 'ji', 'ji haan', 'theek hai', 'thik hai', 'ok', 'okay', 'yes', 'yeah', 'yep', 'sure',
  'book it', 'book kar do', 'kar do', 'haan book kar do', 'confirm', 'go ahead', 'do it',
  'yes please', 'yes book', 'book this', 'book this appointment', 'yes book this',
  'yes book this appointment', 'yes confirm', 'please book', 'please confirm',
  'हाँ', 'हां', 'जी', 'जी हाँ', 'ठीक है', 'बिल्कुल', 'हाँ कर दीजिए', 'बुक कर दीजिए', 'बुक कर दो', 'कन्फर्म करें', 'पक्का करें',
  'हो', 'होय', 'नक्की', 'हो करा', 'बुक करा', 'करा', 'हो बुक करा',
  'হ্যাঁ', 'হ্যা', 'ঠিক আছে', 'অবশ্যই', 'বুক করুন', 'করুন', 'হ্যাঁ বুক করুন']

const CANCEL = ['nahi', 'nahin', 'nai', 'rehne do', 'rahne do', 'nahi chahiye', 'cancel', 'stop', 'no', 'nope',
  'book mat karo', 'mat karo',
  'नहीं', 'नही', 'रहने दो', 'नहीं चाहिए', 'बंद करो', 'बुक मत करो', 'मत करो',
  'नाही', 'नको', 'रद्द करा', 'थांबा', 'नको आहे', 'बंद करा', 'बुक करू नका',
  'না', 'নয়', 'বাতিল', 'থাক', 'দরকার নেই', 'বুক করবেন না', 'বন্ধ করুন']

const strip = (s) => String(s || '').toLowerCase().replace(/[.!?,।]/g, ' ').replace(/\s+/g, ' ').trim()
const shortMatch = (text, words) => {
  const t = strip(text)
  if (!t || t.length > 60) return false
  return words.some(w => t === w || t.startsWith(`${w} `) || t.endsWith(` ${w}`))
}

export const isAffirm = (text) => shortMatch(text, AFFIRM)
export const isCancel = (text) => shortMatch(text, CANCEL)

export const emptyDraft = () => ({
  doctorId: null,
  doctorName: null,
  requestedDate: null,
  sessionId: null,
  sessionName: null,
  sessionLabel: null,
  symptoms: '',
  consultationType: 'video' // the API's own default; never asked for
})

/**
 * A draft's identity, as a canonical string.
 *
 * Its whole job is answering "does the yes I just heard still describe the
 * appointment I read out?". Any field change produces a different string, so a
 * confirmation cannot survive the patient changing their mind — which is the
 * one property that matters. Deliberately not a hash: this compares local state
 * rather than guarding it, and a readable value makes a stale confirmation
 * obvious instead of mysterious.
 */
export const fingerprintOf = (d) => !d ? '' : [
  d.doctorId || '',
  d.requestedDate || '',
  d.sessionId || '',
  d.consultationType || '',
  strip(d.symptoms)
].join('|')

/** A doctor, a day and one of that doctor's sessions. Nothing else books. */
export const isComplete = (d) => Boolean(d?.doctorId && d?.requestedDate && d?.sessionId)

/** Real doctors a patient can book now, from the endpoint the doctors page already uses. */
export async function fetchDoctors() {
  const { data } = await api.get('/users/doctors/specialization', { params: { bookable: true } })
  return Object.values(data || {}).flat().filter(d => d?._id)
}

/**
 * What this doctor is offering on this date.
 *
 * Sessions, or nothing. There is no hourly fallback any more: a failure or an
 * empty day returns no sessions, and the conversation asks for a different day
 * rather than quietly offering hours the doctor never agreed to work.
 *
 * Only bookable sessions are returned — the backend has already applied
 * capacity and the four-hour cutoff, and this does not second-guess it.
 */
export async function fetchOfferings(doctorId, date) {
  try {
    const { data } = await api.get(`/sessions/doctor/${doctorId}`, { params: { date } })
    return { mode: 'session', sessions: (data?.sessions || []).filter(s => s.bookable) }
  } catch {
    // An unreachable session list is "nothing bookable today", never "try an
    // hour instead".
    return { mode: 'session', sessions: [] }
  }
}

/** Which part of the day a session starts in, from its real start time. */
const bandOf = (session) => {
  const h = Number(String(session.startTime || '').split(':')[0])
  if (!Number.isFinite(h)) return null
  return h < 12 ? 'morning' : h < 16 ? 'afternoon' : 'evening'
}

/**
 * A session the patient referred to, matched only against real ones.
 *
 * Three ways in, all resolved here rather than by the model: the part of the
 * day they named, an hour that falls inside a session, or the session's own
 * name. Two matches is a question, not a guess — and a session that is full or
 * past its cutoff was never in this list to begin with.
 */
export function resolveSession({ bandHint, hourHint, text }, sessions) {
  if (!sessions?.length) return null

  if (bandHint) {
    const hits = sessions.filter(s => bandOf(s) === bandHint)
    if (hits.length === 1) return hits[0]
  }

  if (Number.isInteger(hourHint)) {
    for (const hour of [hourHint, hourHint < 12 ? hourHint + 12 : hourHint - 12]) {
      const hits = sessions.filter(s => {
        const from = Number(String(s.startTime).split(':')[0])
        const to = Number(String(s.endTime).split(':')[0])
        return hour >= from && hour < to
      })
      if (hits.length === 1) return hits[0]
    }
  }

  /**
   * What the patient actually says, rather than the session's exact title.
   *
   * The old rule was `transcript.includes(session.name)`, which accepted
   * "Morning OPD" and rejected every natural answer: "one", "the first one",
   * "morning", "पहला", "सकाळी". Spoken answers are short, so this is the
   * common case, not the edge case.
   */
  return resolveSessionChoice(text, sessions)
}

/**
 * Which session a spoken answer means.
 *
 * Four ways in, tried strongest first, and all of them resolved against the
 * sessions the availability API returned:
 *
 * 1. A position — "1", "one", "पहला", "दुसरा". Only while a list is on offer,
 *    which is the only moment this function is called.
 * 2. The part of the day, matched against each session's real start time, so
 *    "morning" works without the model having produced a bandHint.
 * 3. The session's own name, by word overlap rather than containment — "OPD"
 *    and "morning clinic" both reach "Morning OPD".
 * 4. Nothing. A question, never a guess.
 */
export function resolveSessionChoice(text, sessions) {
  if (!sessions?.length) return null

  const pick = parseChoice(text, sessions.length)
  if (pick) return sessions[pick - 1]

  const q = strip(text)
  if (!q) return null

  // "morning" / "सुबह" / "सकाळी" against the clock the doctor typed.
  for (const [band, words] of Object.entries(BAND_WORDS)) {
    if (words.some(w => q.split(' ').includes(w))) {
      const hits = sessions.filter(s => bandOf(s) === band)
      if (hits.length === 1) return hits[0]
    }
  }

  // Word overlap, so a partly-remembered name still lands.
  const said = new Set(q.split(' ').filter(w => w.length > 2))
  if (said.size) {
    const scored = sessions
      .map(s => ({
        s,
        hits: strip(s.name).split(' ').filter(w => w.length > 2 && said.has(w)).length
      }))
      .filter(r => r.hits > 0)
      .sort((a, b) => b.hits - a.hits)
    if (scored.length === 1 || (scored.length > 1 && scored[0].hits > scored[1].hits)) {
      return scored[0].s
    }
  }

  return null
}

/**
 * Parts of the day, in the three languages the app speaks.
 *
 * Matched as whole words against the transcript so that this works when the
 * model's `bandHint` extraction fails or is skipped — a one-word answer is
 * exactly the turn most likely to produce no hints at all.
 */
const BAND_WORDS = {
  morning: ['morning', 'am', 'subah', 'savere', 'सुबह', 'सवेरे', 'सकाळ', 'सकाळी'],
  afternoon: ['afternoon', 'noon', 'dopahar', 'दोपहर', 'दुपार', 'दुपारी'],
  evening: ['evening', 'night', 'pm', 'shaam', 'sham', 'raat', 'शाम', 'रात', 'संध्याकाळ', 'संध्याकाळी', 'रात्री']
}

/**
 * Sessions read aloud by name and clock, so the choice is sayable.
 *
 * Uses the doctor's own startTime/endTime rather than the derived instants:
 * those are UTC, and converting them would read a 9 AM clinic out as 2:30 PM.
 */
const spokenClock = (hhmm) => {
  const [h, m] = String(hhmm || '').split(':').map(Number)
  if (!Number.isFinite(h)) return ''
  const suffix = h < 12 ? 'AM' : 'PM'
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m || 0).padStart(2, '0')} ${suffix}`
}
export const listSessions = (sessions) =>
  sessions.map(s => `${s.name} (${spokenClock(s.startTime)} – ${spokenClock(s.endTime)})`).join(', ')

/**
 * A name the patient said, matched against doctors that exist.
 *
 * Scoring lives in `doctorMatch` — accents make exact and substring matching
 * useless for speech. Two ways in, tried in order: the name the model isolated
 * from the sentence, then the raw sentence itself, because a failed extraction
 * should not lose a name the patient clearly said.
 *
 * Still returns the doctor only on an unambiguous match. Two doctors who sound
 * alike is a question to ask, not a coin to flip.
 */
export function resolveDoctor(hint, doctors, rawText = '') {
  if (!doctors?.length) return { doctor: null, candidates: [], confidence: 0 }

  const fromHint = matchDoctor(hint, doctors)
  if (fromHint.doctor || fromHint.candidates.length) return fromHint

  // The extractor found no name, or found one that matches nobody. The
  // sentence may still contain it.
  return matchDoctor(rawText, doctors)
}

/**
 * Relative days only, resolved by code.
 *
 * The model never produces a date. It says "tomorrow" and this adds one day, in
 * the local calendar the patient and the slot picker both use — `toISODate`
 * takes local parts, which is what stops a booking made late in the evening at
 * +05:30 from landing on the wrong day.
 */
const DAY_OFFSET = { today: 0, tomorrow: 1, day_after: 2 }

export function resolveDate(hint) {
  const offset = DAY_OFFSET[hint]
  if (offset === undefined) return null
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + offset)
  return toISODate(d)
}

/**
 * The only write in the voice path, and it goes through the same endpoint the
 * manual form uses — same JWT, same role check, same slot pre-check, same
 * unique index. `patientId` is not sent: the server takes identity from the
 * token and ignores anything the client claims about who this is for.
 */
export async function submitBooking(draft) {
  const form = new FormData()
  form.append('doctorId', draft.doctorId)
  form.append('requestedDate', draft.requestedDate)
  form.append('sessionId', draft.sessionId)
  form.append('symptoms', draft.symptoms || '')
  form.append('consultationType', draft.consultationType || 'video')
  const { data } = await api.post('/appointments/book', form)
  return data
}
