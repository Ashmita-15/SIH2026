import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../../context/AuthContext'
import api from '../../../services/api'
import { hasRedFlag } from '../../../lib/aiSafety'
import { streamAssistant, fetchAssistantConfig, fileToInline, cachedOfflineAnswer } from '../../../lib/assistantClient'
import { loadThread, saveThread, clearThread } from '../../../lib/assistantStore'
import { compressImage } from '../../../lib/compressImage'
import { enqueue, resolve as resolveOutbox, takePending, clear as clearOutbox, SEND_STATE } from '../../../lib/outbox'
import Alert from '../../ui/Alert'
import Button from '../../ui/Button'
import { useToast } from '../../ui/Toast'
import StarterCards from './StarterCards'
import MessageBubble from './MessageBubble'
import Composer from './Composer'
import MicButton from './MicButton'
import VoiceModeBar from './VoiceModeBar'
import { useVoiceMode, VOICE } from './useVoiceMode'
import { speak, stopSpeaking, primeVoices, canSpeak } from '../../../lib/voice'
import {
  BOOKING, emptyDraft, fingerprintOf, isComplete, isAffirm, isCancel,
  fetchDoctors, fetchAvailability, resolveDoctor, resolveDate, resolveSlot,
  listSlots, submitBooking
} from '../../../lib/bookingFlow'
import { slotLabel } from '../../../lib/slots'

const MAX_FILES = 3
const newId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

/** Only what the server contract needs — previews and local status stay here. */
const forWire = (messages) => messages
  .filter(m => m.status !== 'error')
  .map(m => ({ role: m.role, text: m.text, files: m.files?.map(f => ({ mimeType: f.mimeType, data: f.data })) }))

/**
 * @param voiceStartSignal a counter the host increments to ask for Voice Mode.
 *   A counter rather than a boolean so that starting, stopping and starting
 *   again is distinguishable from the prop simply still being true.
 * @param voiceChannel names whoever owns this instance's voice session.
 *   `assistant:voice` is a window event and the assistant's own page mounts a
 *   second chat of its own, so without a name on each message a host cannot
 *   tell another instance's state from its own — and reading someone else's
 *   "off" ends a live session.
 */
export default function AssistantChat({ compact = false, voiceStartSignal = 0, voiceChannel = null }) {
  const { t, i18n } = useTranslation()
  const { userId } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()

  const [messages, setMessages] = useState([])
  const [draft, setDraft] = useState('')
  const [files, setFiles] = useState([])
  const [helpType, setHelpType] = useState('medical_assistance')
  const [streaming, setStreaming] = useState(false)
  const [greeting, setGreeting] = useState('')
  const [ready, setReady] = useState(false)
  const [speakingId, setSpeakingId] = useState(null)
  const [voiceReady, setVoiceReady] = useState(false)
  const [recording, setRecording] = useState(false)
  const [handingOver, setHandingOver] = useState(false)

  /**
   * The appointment being arranged out loud.
   *
   * Conversational state, not authorization: it says what the patient has
   * chosen so far, and every field in it came from real doctor data, a real
   * availability response, or a fixed day offset. The server still decides who
   * the appointment is for and whether the slot is really free.
   *
   * `confirmedFp` is the draft as it stood when the confirmation question was
   * read out. If any field moves, the fingerprint moves with it and the old
   * yes no longer describes anything.
   */
  const [booking, setBooking] = useState({
    status: BOOKING.IDLE,
    draft: emptyDraft(),
    confirmedFp: null,
    dateWord: null,
    doctors: [],
    slots: []
  })
  const bookingRef = useRef(booking)
  const setBookingState = useCallback((next) => {
    bookingRef.current = typeof next === 'function' ? next(bookingRef.current) : next
    setBooking(bookingRef.current)
  }, [])
  // One booking request at a time, however many times "haan" arrives.
  const bookingInFlight = useRef(false)

  const abortRef = useRef(null)
  // Held outside state: these are only ever read when handing over to a
  // booking, and re-rendering the transcript for them buys nothing.
  const voiceNotesRef = useRef([])
  const bottomRef = useRef(null)
  const scrollRef = useRef(null)

  // Restore the transcript before first paint of the list, so a returning
  // user does not watch their own history appear a beat later.
  useEffect(() => {
    let cancelled = false
    loadThread(userId).then(saved => {
      if (cancelled) return
      const interrupted = takePending(userId)
      // Anything still queued never got an answer — the tab closed mid-send.
      // Marking it failed gives the user a Retry instead of a message that
      // looks sent and simply never came back.
      const restored = saved.map(m =>
        interrupted.some(e => e.id === m.id) ? { ...m, sendState: SEND_STATE.FAILED } : m
      )
      setMessages(restored)
      setReady(true)
    })
    return () => { cancelled = true }
  }, [userId])

  useEffect(() => {
    fetchAssistantConfig(i18n.language)
      .then(cfg => setGreeting(cfg.greeting))
      .catch(() => setGreeting(t('assistant.greeting')))
  }, [i18n.language, t])

  useEffect(() => {
    if (ready) saveThread(userId, messages)
  }, [userId, messages, ready])

  // Only follow the stream when the user is already at the bottom; yanking
  // the view while they are reading an earlier answer is worse than a
  // slightly stale scroll position.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120
    if (nearBottom) bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages])

  useEffect(() => {
    primeVoices().then(() => setVoiceReady(canSpeak(i18n.language)))
  }, [i18n.language])

  useEffect(() => () => { abortRef.current?.abort(); stopSpeaking() }, [])

  /**
   * Mirrors the modality: a spoken question gets a spoken answer.
   *
   * Speech is best-effort and must never be able to take the turn down with
   * it. `readAloud` is called from inside `run`, before the stream is opened,
   * so a throwing speech engine used to abort the whole turn and strand
   * `streaming` at true — which in Voice Mode wedges the loop in PROCESSING
   * and stops it listening again, with nothing on screen to say why.
   */
  const readAloud = useCallback((id, text) => {
    if (!text) return
    try {
      const spoken = speak(text, i18n.language, { onEnd: () => setSpeakingId(null) })
      if (spoken) setSpeakingId(id)
    } catch {
      setSpeakingId(null) // silence is a fine outcome; a dead turn is not
    }
  }, [i18n.language])

  const toggleSpeech = useCallback((message) => {
    if (speakingId === message.id) { stopSpeaking(); setSpeakingId(null); return }
    readAloud(message.id, message.spoken || message.text)
  }, [speakingId, readAloud])

  /** Appends a reply this component wrote itself, and says it if we are talking. */
  const pushAssistant = useCallback((text, viaVoice) => {
    const id = newId()
    setMessages(prev => [...prev, { id, role: 'assistant', text, spoken: text, status: 'done' }])
    if (viaVoice) readAloud(id, text)
    return id
  }, [readAloud])

  /** Completes the streamed turn with text the booking flow decided. */
  const finishReply = useCallback((id, text, viaVoice) => {
    setMessages(prev => prev.map(m => (m.id === id ? { ...m, text, spoken: text, status: 'done' } : m)))
    if (viaVoice) readAloud(id, text)
  }, [readAloud])

  const resetBooking = useCallback(() => setBookingState(b => ({
    status: BOOKING.IDLE, draft: emptyDraft(), confirmedFp: null, dateWord: null, doctors: b.doctors, slots: []
  })), [setBookingState])

  /**
   * One step of the booking conversation.
   *
   * Reads three hints and resolves each against something real: a name against
   * the doctors the server returned, a day against a fixed offset, an hour
   * against the slots the availability API just said were free. Anything that
   * fails to resolve becomes a question rather than a guess.
   *
   * Changing an earlier answer invalidates the later ones — a new day drops the
   * slot, because a slot only means anything on the day it was free.
   */
  const applyHints = useCallback(async (hints, replyId, viaVoice) => {
    const b = bookingRef.current
    const lang = i18n.language
    const draft = { ...b.draft }
    let { doctors, slots, dateWord } = b
    const say = (text, next) => { setBookingState({ ...b, ...next, draft }); finishReply(replyId, text, viaVoice) }

    // ── doctor ──────────────────────────────────────────────────────────
    if (!draft.doctorId || hints.doctorHint) {
      if (!doctors.length) { try { doctors = await fetchDoctors() } catch { doctors = [] } }
      const { doctor, candidates } = resolveDoctor(hints.doctorHint, doctors)
      if (doctor) {
        if (doctor._id !== draft.doctorId) { draft.timeSlot = null; slots = [] }
        draft.doctorId = doctor._id
        draft.doctorName = doctor.name
      } else if (!draft.doctorId) {
        const list = (candidates.length ? candidates : doctors).map(d => d.name).join(', ')
        return say(
          t(candidates.length ? 'booking.doctorAmbiguous' : 'booking.doctorUnknown', { list }),
          { doctors, confirmedFp: null, status: BOOKING.COLLECTING_DOCTOR }
        )
      }
    }

    // ── day ─────────────────────────────────────────────────────────────
    if (hints.dateHint) {
      const iso = resolveDate(hints.dateHint)
      if (iso && iso !== draft.requestedDate) {
        draft.requestedDate = iso
        dateWord = hints.dateHint
        draft.timeSlot = null // a free hour on one day says nothing about another
        slots = []
      }
    }
    if (!draft.requestedDate) {
      return say(
        t(draft.doctorName ? 'booking.askDate' : 'booking.dateUnknown', { doctor: draft.doctorName }),
        { doctors, slots: [], confirmedFp: null, status: BOOKING.COLLECTING_DATE }
      )
    }

    // ── real availability ───────────────────────────────────────────────
    if (!slots.length) {
      try { slots = await fetchAvailability(draft.doctorId, draft.requestedDate) } catch { slots = [] }
    }
    const dateLabel = dateWord ? t(`booking.${dateWord}`) : draft.requestedDate
    if (!slots.length) {
      draft.requestedDate = null
      return say(
        t('booking.noSlots', { doctor: draft.doctorName, date: dateLabel }),
        { doctors, slots: [], dateWord: null, confirmedFp: null, status: BOOKING.COLLECTING_DATE }
      )
    }

    // ── hour ────────────────────────────────────────────────────────────
    if (hints.hourHint) {
      const slot = resolveSlot(hints.hourHint, slots)
      if (!slot) {
        draft.timeSlot = null
        return say(
          t('booking.slotUnknown', { slots: listSlots(slots, lang) }),
          { doctors, slots, dateWord, confirmedFp: null, status: BOOKING.COLLECTING_SLOT }
        )
      }
      draft.timeSlot = slot
    }
    if (!draft.timeSlot) {
      return say(
        t('booking.askSlot', { date: dateLabel, slots: listSlots(slots, lang) }),
        { doctors, slots, dateWord, confirmedFp: null, status: BOOKING.COLLECTING_SLOT }
      )
    }

    // ── read it back and wait to be told yes ────────────────────────────
    const fp = fingerprintOf(draft)
    const shown = { doctor: draft.doctorName, date: dateLabel, slot: slotLabel(draft.timeSlot, lang), symptoms: draft.symptoms }
    say(
      t(draft.symptoms ? 'booking.summary' : 'booking.summaryNoSymptoms', shown),
      { doctors, slots, dateWord, confirmedFp: fp, status: BOOKING.AWAITING_CONFIRMATION }
    )
  }, [i18n.language, t, finishReply, setBookingState])

  /**
   * The only write in this file, and only from here.
   *
   * Three things must all hold: the conversation is actually waiting on a
   * confirmation, the draft is complete, and it still fingerprints to what was
   * read aloud. A "haan" that arrives at any other moment falls through every
   * one of these and books nothing.
   */
  const confirmAndBook = useCallback(async (viaVoice) => {
    const b = bookingRef.current
    const draft = b.draft
    if (bookingInFlight.current) return
    if (b.status !== BOOKING.AWAITING_CONFIRMATION) return
    if (!isComplete(draft) || fingerprintOf(draft) !== b.confirmedFp) return

    bookingInFlight.current = true
    setBookingState({ ...b, status: BOOKING.BOOKING })
    const lang = i18n.language
    const dateLabel = b.dateWord ? t(`booking.${b.dateWord}`) : draft.requestedDate

    try {
      await submitBooking(draft)
      setBookingState({ status: BOOKING.BOOKED, draft: emptyDraft(), confirmedFp: null, dateWord: null, doctors: b.doctors, slots: [] })
      pushAssistant(t('booking.booked', { doctor: draft.doctorName, date: dateLabel, slot: slotLabel(draft.timeSlot, lang) }), viaVoice)
      window.dispatchEvent(new CustomEvent('appointments:changed'))
    } catch (err) {
      const code = err?.response?.status
      if (code === 409) {
        /**
         * Somebody else took it between reading the summary and hearing yes.
         * Nothing was booked, so nothing is claimed — the real availability is
         * fetched again and the patient chooses from what is actually left.
         */
        let fresh = []
        try { fresh = await fetchAvailability(draft.doctorId, draft.requestedDate) } catch { fresh = [] }
        const next = { ...draft, timeSlot: null }
        if (!fresh.length) next.requestedDate = null
        setBookingState({
          ...b, draft: next, slots: fresh, confirmedFp: null,
          dateWord: fresh.length ? b.dateWord : null,
          status: fresh.length ? BOOKING.COLLECTING_SLOT : BOOKING.COLLECTING_DATE
        })
        pushAssistant(fresh.length
          ? t('booking.conflict', { slots: listSlots(fresh, lang) })
          : t('booking.conflictNoSlots', { date: dateLabel }), viaVoice)
      } else {
        // Anything else — validation, auth, a dead network. The draft is kept
        // so they can try again, and no success is implied.
        setBookingState({ ...b, status: BOOKING.AWAITING_CONFIRMATION })
        pushAssistant(t('booking.failed'), viaVoice)
      }
    } finally {
      bookingInFlight.current = false
    }
  }, [i18n.language, t, pushAssistant, setBookingState])

  const run = useCallback(async (history, { viaVoice = false } = {}) => {
    const replyId = newId()
    // The banner is driven by the patient's own words, so it can appear
    // before the model has produced a single token.
    const latest = [...history].reverse().find(m => m.role === 'user')
    const urgent = hasRedFlag(latest?.text)

    const pendingUser = [...history].reverse().find(m => m.role === 'user')
    if (pendingUser) enqueue(userId, pendingUser)

    const withSendState = history.map(m =>
      m.id === pendingUser?.id ? { ...m, sendState: SEND_STATE.SENDING } : m
    )

    setMessages([...withSendState, { id: replyId, role: 'assistant', text: '', status: 'streaming', urgent }])
    setStreaming(true)

    // Anything the assistant is still saying is now stale.
    stopSpeaking()
    setSpeakingId(null)

    // The escalation is spoken before the model answers, because someone who
    // cannot type often cannot read the banner either.
    if (urgent && viaVoice) readAloud(replyId, t('symptomChecker.urgent'))

    const controller = new AbortController()
    abortRef.current = controller

    const patch = (fn) => setMessages(prev => prev.map(m => (m.id === replyId ? fn(m) : m)))

    /**
     * Whatever happens in here, the turn has to end.
     *
     * `streaming` gates the composer, the microphone and now the Voice Mode
     * loop, so leaking it as true does not just look wrong — it takes away
     * every way the patient had of asking again.
     */
    // Whatever this turn decides, it is decided once, after the stream closes.
    let hints = null

    try {
    await streamAssistant({
      helpType,
      lang: i18n.language,
      messages: forWire(history),
      // Mid-booking turns are answered with hints instead of prose.
      booking: bookingRef.current.status !== BOOKING.IDLE && bookingRef.current.status !== BOOKING.BOOKED
        ? { active: true }
        : undefined,
      signal: controller.signal,
      onEvent: (event) => {
        if (event.type === 'delta') patch(m => ({ ...m, text: m.text + event.text }))
        else if (event.type === 'booking_hints') hints = event.hints
        else if (event.type === 'redflag') {
          patch(m => ({ ...m, urgent: true }))
          /**
           * Escalation outranks everything. Somebody describing chest pain is
           * not choosing an appointment time, so the half-finished booking is
           * dropped outright — including any confirmation it was waiting on.
           */
          resetBooking()
          hints = null
        }
        else if (event.type === 'citations') patch(m => ({ ...m, citations: event.items }))
        else if (event.type === 'spoken') {
          patch(m => ({ ...m, spoken: event.text }))
          // Start talking now rather than after the written answer lands —
          // the summary arrives first exactly so this can happen early.
          if (viaVoice && !urgent) readAloud(replyId, event.text)
        }
        /**
         * VoiceSathi navigation. The route was chosen by the server's
         * allowlist, so it is used as given; the client's only job is to move
         * without reloading, which keeps the transcript and the stream alive.
         *
         * The spoken confirmation is read immediately rather than waiting for
         * the written answer, because somebody who navigated by voice is
         * probably not reading the screen.
         */
        else if (event.type === 'navigate' && event.route) {
          patch(m => ({ ...m, navigatedTo: event.route, intent: event.intent }))
          /**
           * Reaching the doctor list is where arranging an appointment starts;
           * going anywhere else is the patient changing the subject, and an
           * unfinished booking does not survive that.
           */
          if (event.intent === 'FIND_DOCTOR') {
            setBookingState(b => ({
              ...b,
              status: BOOKING.COLLECTING_DOCTOR,
              draft: { ...emptyDraft(), symptoms: event.context?.symptom || '' },
              confirmedFp: null, dateWord: null, slots: []
            }))
            fetchDoctors().then(list => setBookingState(b => ({ ...b, doctors: list }))).catch(() => {})
          } else {
            resetBooking()
          }
          if (viaVoice && !urgent && event.spoken) readAloud(replyId, event.spoken)
          /**
           * What the patient told us travels on this one history entry and no
           * further. Going somewhere else later creates a fresh entry with no
           * state, so a preference given while looking for a doctor cannot
           * reappear on the records or pharmacy screens.
           */
          navigate(event.route, event.context ? { state: { voiceContext: event.context } } : undefined)
          /**
           * The assistant is often open as a sheet over the page. It owns its
           * own visibility, so this announces the move and lets whatever is
           * hosting the chat decide whether to step out of the way.
           */
          window.dispatchEvent(new CustomEvent('assistant:navigated', { detail: { route: event.route } }))
        }
        else if (event.type === 'done') patch(m => ({
          ...m,
          text: event.text || m.text,
          spoken: event.spoken || m.spoken,
          citations: event.citations || m.citations,
          followUps: event.followUps || [],
          truncated: Boolean(event.truncated),
          status: 'done'
        }))
        else if (event.type === 'error') {
          /**
           * Any failure that leaves us with nothing still gets a real answer
           * where one is written down, rather than only an apology. That now
           * includes a busy or quota-exhausted model, not just a dead
           * network — from the patient's side those are the same event, and
           * the stored first-aid guidance is just as correct either way.
           */
          const NO_ANSWER = ['network', 'busy', 'rate_limit', 'not_configured']
          const offline = NO_ANSWER.includes(event.code) && !event.partial
            ? cachedOfflineAnswer(latest?.text, i18n.language)
            : null
          patch(m => ({
            ...m,
            text: event.partial || offline || m.text,
            offline: Boolean(offline),
            // Which of the two it was, so the badge does not tell someone
            // with four bars of signal that they are offline.
            offlineReason: offline ? (event.code === 'network' ? 'network' : 'busy') : undefined,
            status: offline ? 'done' : 'error',
            errorCode: event.code
          }))
        }
      }
    })

    // The booking step runs after the stream because it may need a round trip
    // of its own for real availability.
    if (hints) await applyHints(hints, replyId, viaVoice)

    // Aborting resolves normally, so a stopped stream keeps whatever text
    // arrived and simply stops being "streaming".
    patch(m => (m.status === 'streaming' ? { ...m, status: 'done' } : m))

    // The user's message is settled by whether their words reached the
    // server, which is not the same as whether the answer was any good.
    setMessages(prev => {
      const reply = prev.find(m => m.id === replyId)
      // An offline answer is a stored one — the server never saw the
      // question, so the message is not delivered and must stay retryable.
      // Without this the fallback quietly masks every failed send.
      const delivered = reply?.status !== 'error' && !reply?.offline
      if (delivered && pendingUser) resolveOutbox(userId, pendingUser.id)
      return prev.map(m => m.id === pendingUser?.id
        ? { ...m, sendState: delivered ? SEND_STATE.SENT : SEND_STATE.FAILED }
        : m)
    })
    } catch (err) {
      console.error('Assistant turn failed:', err)
      patch(m => (m.status === 'streaming' ? { ...m, status: 'error', errorCode: 'unknown' } : m))
    } finally {
      setStreaming(false)
      abortRef.current = null
    }
  }, [helpType, i18n.language, readAloud, t, userId, navigate, applyHints, resetBooking, setBookingState])

  const send = useCallback(async (options = {}) => {
    const text = (options.text ?? draft).trim()
    if (!text && !files.length) return

    const userMessage = { id: newId(), role: 'user', text, files, status: 'done', viaVoice: options.viaVoice }
    setDraft('')
    setFiles([])
    const viaVoice = Boolean(options.viaVoice)

    /**
     * Yes and no, answered here and nowhere else.
     *
     * Deterministic and local: no model sees this decision, and no round trip
     * stands between the patient saying "रहने दो" and it being obeyed. The
     * whole gate is the `status` check — outside a confirmation this branch is
     * never entered, so "haan" in ordinary conversation is just a word that
     * goes to the assistant like any other.
     */
    const b = bookingRef.current
    if (b.status === BOOKING.AWAITING_CONFIRMATION && !files.length) {
      if (isCancel(text)) {
        setMessages(prev => [...prev, userMessage])
        resetBooking()
        pushAssistant(t('booking.cancelled'), viaVoice)
        return
      }
      if (isAffirm(text)) {
        setMessages(prev => [...prev, userMessage])
        await confirmAndBook(viaVoice)
        return
      }
      // Anything else is a change of mind about the details — it goes to the
      // assistant, comes back as hints, and re-fingerprints the draft.
    }

    await run([...messages, userMessage], { viaVoice })
  }, [draft, files, messages, run, t, resetBooking, pushAssistant, confirmAndBook])

  /**
   * A finished recording. The transcript goes straight out rather than
   * waiting for the user to press send — holding the mic and releasing is
   * already the whole gesture, and asking a non-reader to confirm written
   * text before it sends would defeat the point.
   *
   * The language detected from the audio wins over the app setting: someone
   * who cannot read is not going to find the language dropdown.
   */
  const onTranscript = useCallback(({ text, lang, blob }) => {
    if (lang && lang !== i18n.language) i18n.changeLanguage(lang)
    if (blob) {
      const ext = (blob.type.split('/')[1] || 'webm').split(';')[0]
      voiceNotesRef.current.push(new File([blob], `voice-${Date.now()}.${ext}`, { type: blob.type }))
    }
    send({ text, viaVoice: true })
  }, [send, i18n])

  const onVoiceError = useCallback((code, { fatal = false } = {}) => {
    const message = t(`assistant.voiceErrors.${code}`, t('assistant.voiceErrors.mic_failed'))
    // A fatal fault has already ended Voice Mode, so say so — otherwise the
    // user is left watching a bar that has silently stopped listening.
    toast.error(fatal ? `${message} ${t('assistant.voice.ended')}` : message)
  }, [toast, t])

  /**
   * Hands-free mode. It drives the same `onTranscript` the hold-to-talk mic
   * does, so a spoken turn is indistinguishable from a held one by the time it
   * reaches `send` — same red-flag check, same stream, same navigation.
   */
  const voice = useVoiceMode({
    lang: i18n.language,
    busy: streaming,
    speaking: speakingId !== null,
    onTranscript,
    onError: onVoiceError
  })

  /**
   * The sheet hosting this chat needs to know, so it can stay out of the way
   * after a navigation without unmounting us and killing the microphone.
   * An event rather than a prop: the chat is rendered by more than one parent.
   */
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('assistant:voice', {
      detail: { phase: voice.phase, active: voice.active, channel: voiceChannel }
    }))
  }, [voice.phase, voice.active, voiceChannel])

  /**
   * Started from outside — the floating microphone, which is the only entry
   * point most patients will ever use. It reaches the same `voice.start` the
   * in-sheet button calls, so there is one loop however it was asked for.
   */
  const startVoice = voice.start
  const lastSignalRef = useRef(0)
  useEffect(() => {
    if (voiceStartSignal > lastSignalRef.current) {
      lastSignalRef.current = voiceStartSignal
      startVoice()
    }
  }, [voiceStartSignal, startVoice])

  // Stop has to be reachable from the collapsed bar, which lives outside this
  // component's tree.
  /**
   * Somebody else is already listening.
   *
   * Two chats can be on screen at once — the assistant's own page mounts one
   * while the launcher keeps a voice session running in another — and each has
   * its own microphone. Offering a second "start" there would open a second
   * microphone onto the same conversation, so the idle instance simply does
   * not offer one while a session is live elsewhere.
   */
  const [foreignVoice, setForeignVoice] = useState(false)
  useEffect(() => {
    const onVoice = (e) => {
      if (e.detail?.channel === voiceChannel) return
      setForeignVoice(Boolean(e.detail?.active))
    }
    window.addEventListener('assistant:voice', onVoice)
    return () => window.removeEventListener('assistant:voice', onVoice)
  }, [voiceChannel])

  const stopVoice = voice.stop
  useEffect(() => {
    // Only our own host's Stop, for the same reason the reports are named.
    const onStop = (e) => { if (e.detail?.channel === voiceChannel) stopVoice() }
    window.addEventListener('assistant:voice-stop', onStop)
    return () => window.removeEventListener('assistant:voice-stop', onStop)
  }, [stopVoice, voiceChannel])

  // Leaving the assistant entirely must not leave the microphone open, and
  // must not leave a status bar advertising a session that no longer exists.
  useEffect(() => () => {
    voice.stop()
    window.dispatchEvent(new CustomEvent('assistant:voice', {
      detail: { phase: VOICE.OFF, active: false, channel: voiceChannel }
    }))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  /** Drops the failed reply and replays the turn that produced it. */
  const retry = useCallback(() => {
    const history = messages.filter(m => m.status !== 'error')
    if (!history.length) return
    run(history)
  }, [messages, run])

  const stop = useCallback(() => abortRef.current?.abort(), [])

  const attach = useCallback(async (fileList) => {
    const room = MAX_FILES - files.length
    const incoming = Array.from(fileList || []).filter(f => f.type.startsWith('image/')).slice(0, room)
    if (!incoming.length) return
    const inlined = await Promise.all(incoming.map(async f => fileToInline(await compressImage(f))))
    setFiles(prev => [...prev, ...inlined])
  }, [files.length])

  const reset = useCallback(() => {
    if (messages.length && !window.confirm(t('assistant.newChatConfirm'))) return
    abortRef.current?.abort()
    setMessages([])
    setDraft('')
    setFiles([])
    clearThread(userId)
    clearOutbox(userId)
    toast.info(t('assistant.cleared'))
  }, [messages.length, t, toast, userId])

  /**
   * Handing over to a doctor. The complaint is summarised first so the
   * consultation opens with the story already written down, and any voice
   * notes travel with it.
   */
  const talkToDoctor = useCallback(async () => {
    const spoken = messages.filter(m => m.role === 'user').map(m => m.text).filter(Boolean).join('\n')
    let summary = ''
    setHandingOver(true)
    try {
      const { data } = await api.post('/assistant/summarise', {
        messages: messages.map(m => ({ role: m.role, text: m.text })),
        lang: i18n.language
      })
      summary = data?.summary || ''
    } catch {
      /* the raw words are a fine fallback; never block the booking */
    } finally {
      setHandingOver(false)
    }
    navigate('/patient/care/book', {
      state: { symptoms: summary || spoken, media: voiceNotesRef.current.slice(-3) }
    })
  }, [messages, i18n.language, navigate])

  const pickStarter = (value, seed) => {
    setHelpType(value)
    setDraft(seed)
  }

  const empty = messages.length === 0
  const anyUrgent = messages.some(m => m.urgent)
  // Only the newest answer's suggestions; older ones are stale by now.
  const followUps = messages[messages.length - 1]?.followUps || []

  return (
    <div className={`flex flex-col min-h-0 ${compact ? 'h-full' : 'h-[calc(100dvh-13rem)] min-h-[26rem]'}`}>
      {!empty && (
        <div className="flex justify-end pb-2">
          <Button variant="ghost" size="sm" onClick={reset}>{t('assistant.newChat')}</Button>
        </div>
      )}

      <div ref={scrollRef} className="flex-1 overflow-y-auto min-h-0 pr-0.5">
        {empty ? (
          <StarterCards
          onPick={pickStarter}
          greeting={greeting}
          canSpeak={voiceReady}
          onSpeak={(text) => readAloud('greeting', text)}
        />
        ) : (
          <ul className="flex flex-col gap-4 pb-2">
            {messages.map((m, i) => (
              <MessageBubble
                key={m.id}
                message={m}
                onRetry={retry}
                isLast={i === messages.length - 1}
                canSpeak={voiceReady}
                speaking={speakingId === m.id}
                onToggleSpeech={() => toggleSpeech(m)}
              />
            ))}
          </ul>
        )}
        <div ref={bottomRef} />
      </div>

      {/* On the full page, bottom padding reserves the corner the Emergency
          button floats in — without it the send control sits underneath the
          FAB, and the one screen where someone may be describing an
          emergency is the worst place to make either button hard to hit.
          Inside the sheet the FAB is behind the overlay, so the same padding
          would only push the composer up and leave dead space. */}
      <div className={`pt-3 mt-1 border-t border-line flex flex-col gap-2.5 ${compact ? '' : 'pb-16 lg:pb-20'}`}>
        {/* Tapping beats typing, and beats speaking again: the follow-ups a
            patient actually has are predictable, and offering them costs one
            tap instead of a whole sentence. */}
        {!streaming && followUps.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-caption text-muted">{t('assistant.askNext')}</span>
            {followUps.map((q, i) => (
              <button
                key={i}
                type="button"
                onClick={() => send({ text: q })}
                className="px-2.5 py-1 rounded-full border border-line bg-surface text-caption text-body
                           hover:border-primary-300 hover:bg-primary-50 transition-colors"
              >
                {q}
              </button>
            ))}
          </div>
        )}

        {/* Talking to a real doctor stays the primary escape hatch, and it
            surfaces as soon as anything urgent has been said. */}
        {anyUrgent && (
          <Button variant="danger" block loading={handingOver} onClick={talkToDoctor}>
            {handingOver ? t('assistant.preparingSummary') : t('symptomChecker.findDoctor')}
          </Button>
        )}

        {/* Hands-free. Sits directly above the composer rather than in a menu:
            the people who need it most are the least able to go looking. */}
        {!foreignVoice && (
          <VoiceModeBar phase={voice.phase} onStart={voice.start} onStop={voice.stop} />
        )}

        <Composer
          value={draft}
          onChange={setDraft}
          onSend={send}
          onStop={stop}
          streaming={streaming}
          files={files}
          onAttach={attach}
          onRemoveFile={(i) => setFiles(prev => prev.filter((_, idx) => idx !== i))}
          hint={empty && !draft ? t('assistant.micHint') : null}
          mic={
            <MicButton
              lang={i18n.language}
              // Hold-to-talk while the loop is already listening would open a
              // second microphone onto the same conversation.
              disabled={streaming || voice.active}
              onTranscript={onTranscript}
              onError={onVoiceError}
              onRecordingChange={setRecording}
            />
          }
        />

        {/* One pinned disclaimer. Repeating it under every answer trains
            people to skip it, which is worse than showing it once. Hidden
            while recording, where the sheet already occupies this space. */}
        {!recording && (
          <p className="text-caption text-muted leading-snug">{t('symptomChecker.disclaimer')}</p>
        )}
      </div>
    </div>
  )
}
