import { useState, useRef, useEffect, useCallback } from 'react'
import {
  startRecording, transcribe, isRecordingSupported, isSecureContextForMic, stopSpeaking
} from '../../../lib/voice'

/**
 * VoiceSathi: hands-free conversation.
 *
 * The one-shot mic is a hold-to-talk gesture — press, speak, release, and press
 * again for the next sentence. For somebody who cannot read, every one of those
 * presses is a thing to find on a screen they cannot navigate. Voice Mode asks
 * for that gesture once and then keeps the turn-taking going by itself.
 *
 * This is orchestration only. Recording, transcription and speech are the same
 * primitives the one-shot mic uses; the assistant turn is the same `run()`.
 * Nothing here decides anything clinical, and nothing here can navigate — the
 * server's allowlist still owns that.
 */

export const VOICE = {
  OFF: 'off',
  STARTING: 'starting',   // waiting on the microphone (permission prompt lives here)
  LISTENING: 'listening',
  PROCESSING: 'processing',
  SPEAKING: 'speaking'
}

/** Below this it is a cough or a door, not a sentence. Matches the one-shot mic. */
const MIN_UTTERANCE_MS = 400

/**
 * The loudest the microphone got during a recording, below which nobody spoke.
 *
 * Without this, an idle Voice Mode is a silence detector feeding an upload:
 * the recorder auto-stops on the silence, the empty clip is sent for
 * transcription, transcription returns nothing, and the loop immediately does
 * it again. Measured at roughly one call every three seconds — on a rural data
 * plan and a phone battery, that is the difference between a feature and a
 * liability. The hold-to-talk mic never needed this because holding the button
 * is itself the statement that somebody is talking.
 */
const SPEECH_LEVEL = 0.02

/**
 * The pause before listening resumes.
 *
 * Two jobs: it keeps the tail of our own speech out of the next recording, and
 * it stops a failing microphone from becoming a busy loop.
 */
const RESUME_DELAY_MS = 700

/** Denial and missing hardware are permanent for this page load; retrying only nags. */
const FATAL = ['permission_denied', 'unsupported', 'insecure_context']

/**
 * @param busy      the assistant is mid-turn (streaming)
 * @param speaking  the assistant is talking out loud
 *
 * Both are passed in rather than tracked here, because AssistantChat already
 * owns them. Deriving the phase from the real state instead of a second copy is
 * what keeps the two from drifting apart.
 */
export function useVoiceMode({ lang, busy, speaking, onTranscript, onError }) {
  const [active, setActive] = useState(false)
  const [capturing, setCapturing] = useState(false)
  const [transcribing, setTranscribing] = useState(false)

  const handleRef = useRef(null)
  const peakRef = useRef(0)
  // The loop awaits in three places, and Stop can land during any of them.
  // A ref is read at the moment of resumption; `active` would be a stale
  // closure from before the await.
  const activeRef = useRef(false)
  const langRef = useRef(lang)
  langRef.current = lang

  const release = useCallback(() => {
    handleRef.current?.cancel()
    handleRef.current = null
    setCapturing(false)
  }, [])

  const stop = useCallback(() => {
    activeRef.current = false
    setActive(false)
    setTranscribing(false)
    release()
    // Cutting our own sentence short is the point: Stop should be immediate,
    // not "after it finishes telling you about pharmacies".
    stopSpeaking()
  }, [release])

  /** One finished utterance: close the mic, transcribe, hand the words over. */
  const finish = useCallback(async () => {
    const handle = handleRef.current
    if (!handle) return
    handleRef.current = null
    setCapturing(false)

    // Nothing was said. Discard it here rather than paying to be told so.
    if (handle.durationMs() < MIN_UTTERANCE_MS || peakRef.current < SPEECH_LEVEL) {
      handle.cancel()
      return
    }

    setTranscribing(true)
    try {
      const blob = await handle.stop()
      if (!blob || blob.size < 800) return

      const result = await transcribe(blob, langRef.current)
      // Silence is not a failure. Saying "I didn't catch that" after every
      // pause would make the assistant unbearable to sit next to.
      if (!result.text) return
      if (!activeRef.current) return // stopped while we were transcribing

      onTranscript({ ...result, blob })
    } catch (err) {
      // Transient by nature — the loop returns to listening below.
      onError?.(err?.code || 'transcription_failed', { fatal: false })
    } finally {
      setTranscribing(false)
    }
  }, [onTranscript, onError])

  const listen = useCallback(async () => {
    if (handleRef.current) return // never two microphones

    if (!isSecureContextForMic()) { onError?.('insecure_context', { fatal: true }); stop(); return }
    if (!isRecordingSupported()) { onError?.('unsupported', { fatal: true }); stop(); return }

    peakRef.current = 0
    try {
      const handle = await startRecording({
        onLevel: (l) => { if (l > peakRef.current) peakRef.current = l },
        onAutoStop: () => finish()
      })
      // The permission prompt can sit open for a long time; Stop may already
      // have been pressed behind it.
      if (!activeRef.current) { handle.cancel(); return }
      handleRef.current = handle
      setCapturing(true)
    } catch (err) {
      const code = err?.name === 'NotAllowedError' ? 'permission_denied' : 'mic_failed'
      onError?.(code, { fatal: FATAL.includes(code) })
      // A denied microphone will be denied again. Voice Mode ends rather than
      // asking the browser over and over.
      if (FATAL.includes(code)) stop()
    }
  }, [finish, onError, stop])

  /**
   * The loop, in one place.
   *
   * Every transition falls out of this: whenever Voice Mode is on and nothing
   * else is happening — not recording, not transcribing, not answering, not
   * talking — it listens again. Speaking and processing are read from the
   * chat's own state, so the microphone cannot open while the assistant is
   * still talking and hear itself.
   */
  useEffect(() => {
    if (!active) return
    if (capturing || transcribing || busy || speaking) return
    const timer = setTimeout(() => { if (activeRef.current) listen() }, RESUME_DELAY_MS)
    return () => clearTimeout(timer)
  }, [active, capturing, transcribing, busy, speaking, listen])

  const start = useCallback(() => {
    activeRef.current = true
    setActive(true)
  }, [])

  useEffect(() => () => { activeRef.current = false; handleRef.current?.cancel() }, [])

  /**
   * Speaking outranks processing on purpose. The spoken summary is sent ahead
   * of the written answer, so the assistant is usually still streaming text
   * while it is already talking — and "Thinking…" next to a voice that is
   * plainly mid-sentence reads as a bug.
   */
  const phase = !active ? VOICE.OFF
    : speaking ? VOICE.SPEAKING
    : (transcribing || busy) ? VOICE.PROCESSING
    : capturing ? VOICE.LISTENING
    : VOICE.STARTING

  return { phase, active, start, stop, toggle: () => (activeRef.current ? stop() : start()) }
}
