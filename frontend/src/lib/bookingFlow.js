import api from '../services/api'
import { toISODate, slotLabel } from './slots'

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
  'book it', 'book kar do', 'kar do', 'haan book kar do',
  'हाँ', 'हां', 'जी', 'जी हाँ', 'ठीक है', 'बिल्कुल', 'हाँ कर दीजिए', 'बुक कर दीजिए', 'बुक कर दो',
  'ਹਾਂ', 'ਜੀ', 'ਠੀਕ ਹੈ', 'ਬਿਲਕੁਲ', 'ਬੁੱਕ ਕਰ ਦਿਓ']

const CANCEL = ['nahi', 'nahin', 'nai', 'rehne do', 'rahne do', 'nahi chahiye', 'cancel', 'stop', 'no', 'nope',
  'book mat karo', 'mat karo',
  'नहीं', 'नही', 'रहने दो', 'नहीं चाहिए', 'बंद करो', 'बुक मत करो', 'मत करो',
  'ਨਹੀਂ', 'ਨਹੀ', 'ਰਹਿਣ ਦਿਓ', 'ਬੰਦ ਕਰੋ', 'ਬੁੱਕ ਨਾ ਕਰੋ']

const strip = (s) => String(s || '').toLowerCase().replace(/[.!?,।]/g, ' ').replace(/\s+/g, ' ').trim()
const shortMatch = (text, words) => {
  const t = strip(text)
  return Boolean(t) && t.length <= 24 && words.includes(t)
}

export const isAffirm = (text) => shortMatch(text, AFFIRM)
export const isCancel = (text) => shortMatch(text, CANCEL)

export const emptyDraft = () => ({
  doctorId: null,
  doctorName: null,
  requestedDate: null,
  timeSlot: null,
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
  d.timeSlot || '',
  d.sessionId || '',
  d.consultationType || '',
  strip(d.symptoms)
].join('|')

/** Either a session or an hour is enough; a doctor never offers both at once. */
export const isComplete = (d) => Boolean(d?.doctorId && d?.requestedDate && (d?.sessionId || d?.timeSlot))

/** Real doctors, from the endpoint the doctors page already uses. */
export async function fetchDoctors() {
  const { data } = await api.get('/users/doctors/specialization')
  return Object.values(data || {}).flat().filter(d => d?._id)
}

/** Real availability. The only source of a slot this file will ever accept. */
export async function fetchAvailability(doctorId, date) {
  const { data } = await api.get(`/appointments/doctor/${doctorId}/availability`, { params: { date } })
  return (data?.slots || []).filter(s => s.available).map(s => s.slot)
}

/**
 * What this doctor is actually offering on this date.
 *
 * Sessions win when the doctor runs them, because that is what the manual form
 * shows too — the two paths must never disagree about what can be booked. A
 * doctor with no sessions configured still gets the hourly grid, so nothing
 * breaks while clinics adopt sessions.
 *
 * Only bookable sessions are returned: the backend has already applied
 * capacity and the four-hour cutoff, and this does not second-guess it.
 */
export async function fetchOfferings(doctorId, date) {
  try {
    const { data } = await api.get(`/sessions/doctor/${doctorId}`, { params: { date } })
    // `configured` answers "does this doctor run sessions?" independently of
    // the date; `sessions` is only those running on it. Using the latter would
    // silently fall back to hourly slots on a doctor's non-clinic days.
    if (Number(data?.configured) > 0) {
      return { mode: 'session', sessions: (data?.sessions || []).filter(s => s.bookable), slots: [] }
    }
  } catch {
    /* fall through to the hourly grid */
  }
  return { mode: 'slot', sessions: [], slots: await fetchAvailability(doctorId, date).catch(() => []) }
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

  const q = strip(text)
  if (q) {
    const named = sessions.filter(s => q.includes(strip(s.name)))
    if (named.length === 1) return named[0]
  }

  return null
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
 * Returns the doctor only on an unambiguous match. Two doctors called Sharma is
 * a question to ask, not a coin to flip, and a name we cannot place at all is
 * never quietly resolved to the nearest thing.
 */
export function resolveDoctor(hint, doctors) {
  const q = strip(hint)
  if (!q || !doctors?.length) return { doctor: null, candidates: [] }

  const exact = doctors.filter(d => strip(d.name) === q)
  if (exact.length === 1) return { doctor: exact[0], candidates: [] }

  // "Meera", "Dr Meera", "Meera Sharma" all reach the same person.
  const parts = q.split(' ').filter(w => w.length > 2 && !['dr', 'doctor', 'डॉ', 'डॉक्टर', 'ਡਾ'].includes(w))
  const loose = doctors.filter(d => {
    const name = strip(d.name)
    return parts.length > 0 && parts.every(p => name.includes(p))
  })
  if (loose.length === 1) return { doctor: loose[0], candidates: [] }
  return { doctor: null, candidates: loose }
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
 * An hour, matched only against slots this doctor genuinely has free today.
 *
 * "5 बजे" is 5 or 17 — so both are tried, but only against the free list. If
 * five o'clock is taken it simply does not match, which is the point: a slot
 * cannot be selected by asking for it, only by it actually being available.
 */
export function resolveSlot(hour, availableSlots) {
  if (!Number.isInteger(hour) || !availableSlots?.length) return null
  const wanted = [hour, hour < 12 ? hour + 12 : hour - 12]
  const hits = availableSlots.filter(s => wanted.includes(Number(s.split(':')[0])))
  return hits.length === 1 ? hits[0] : null
}

export const listSlots = (slots, lang) => slots.map(s => slotLabel(s, lang)).join(', ')

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
  // A session booking and an hourly one are the same request to the same
  // endpoint; only which field is present differs.
  if (draft.sessionId) form.append('sessionId', draft.sessionId)
  else form.append('timeSlot', draft.timeSlot)
  form.append('symptoms', draft.symptoms || '')
  form.append('consultationType', draft.consultationType || 'video')
  const { data } = await api.post('/appointments/book', form)
  return data
}
