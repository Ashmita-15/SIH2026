import React, { useState, useEffect, useRef, lazy, Suspense, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { subscribeBooking, bookingIsActive } from '../../../lib/bookingStore'
import { useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../../context/AuthContext'
import { Loading } from '../../ui/States'
import VoiceModeBar from './VoiceModeBar'
import { VOICE } from './useVoiceMode'

// Only paid for when someone actually opens the assistant, or asks to speak.
const AssistantChat = lazy(() => import('./AssistantChat'))

/** Names the voice session this component owns. See AssistantChat's prop. */
const VOICE_CHANNEL = 'launcher'

/**
 * The assistant, reachable from anywhere.
 *
 * The natural moment to ask "can I take this with my BP tablet?" is while
 * looking at the pharmacy shelf, not after navigating to a separate page.
 * The role nav is capped at four destinations, so a floating button — the
 * pattern EmergencyButton already establishes — is how this gets everywhere
 * without displacing something.
 *
 * It sits above the Emergency button rather than beside it: in a real
 * emergency the red one must stay exactly where muscle memory expects.
 */
export default function AssistantLauncher() {
  const { user } = useAuth()
  const { t } = useTranslation()
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const [voicePhase, setVoicePhase] = useState(VOICE.OFF)
  const [voiceActive, setVoiceActive] = useState(false)
  // Bridges the gap between the tap and the chat mounting and reporting back.
  const [voiceWanted, setVoiceWanted] = useState(false)
  const [voiceSignal, setVoiceSignal] = useState(0)

  /**
   * The chat is mounted for as long as either surface needs it, and hidden
   * rather than unmounted when only Voice Mode does.
   *
   * This is the whole of Milestone 2.5. The chat owns the transcript, the
   * assistant turn and the open microphone, so tying its lifetime to whether a
   * sheet happens to be on screen meant closing the sheet killed the
   * conversation. Mounting now follows use, not visibility — which is also why
   * the previous "minimise instead of close" workaround could be deleted.
   */
  /**
   * …and while an appointment is being arranged.
   *
   * The first booking turn navigates, which closes the sheet. Without this the
   * chat unmounts mid-conversation and the in-flight stream dies with it — the
   * state now survives in the store, but the turn that was still running does
   * not.
   */
  const bookingLive = useSyncExternalStore(subscribeBooking, bookingIsActive)
  const mounted = open || voiceActive || voiceWanted || bookingLive

  // The assistant's own page renders its own chat; ours stays out of its way,
  // but a live voice session still has to survive being taken there.
  const onAssistantPage = location.pathname.startsWith('/patient/care/symptoms')

  useEffect(() => {
    if (!open) return
    const { overflow } = document.body.style
    document.body.style.overflow = 'hidden'
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = overflow
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  /**
   * A freshly mounted chat reports OFF before it has been asked for anything,
   * so "not active" cannot by itself mean "finished" — reading it that way
   * unmounted the chat in the same breath as mounting it, and the microphone
   * never opened. The request is only considered over once the session has
   * actually been seen alive and has since gone quiet, which covers both a
   * normal Stop and a microphone that was refused.
   */
  const sawLiveRef = useRef(false)

  useEffect(() => {
    const onVoice = (e) => {
      // The assistant's own page mounts its own chat; its state is not ours.
      if (e.detail?.channel !== VOICE_CHANNEL) return
      const phase = e.detail?.phase ?? VOICE.OFF
      setVoicePhase(phase)
      setVoiceActive(Boolean(e.detail?.active))
      if (phase !== VOICE.OFF) sawLiveRef.current = true
      else if (sawLiveRef.current) { sawLiveRef.current = false; setVoiceWanted(false) }
    }
    window.addEventListener('assistant:voice', onVoice)
    return () => window.removeEventListener('assistant:voice', onVoice)
  }, [])

  /**
   * VoiceSathi has moved the app. Standing over the page the patient just
   * asked for defeats the point of taking them there, so the sheet closes —
   * and, now that mounting is independent of it, closing costs nothing.
   */
  useEffect(() => {
    const onNavigated = () => setOpen(false)
    window.addEventListener('assistant:navigated', onNavigated)
    return () => window.removeEventListener('assistant:navigated', onNavigated)
  }, [])

  const startVoice = () => {
    if (voiceActive) return // one loop, however many times this is tapped
    sawLiveRef.current = false
    setVoiceWanted(true)
    setVoiceSignal(n => n + 1)
  }
  const stopVoice = () => window.dispatchEvent(
    new CustomEvent('assistant:voice-stop', { detail: { channel: VOICE_CHANNEL } })
  )

  if (!user || user.role !== 'patient') return null
  // Nothing of ours belongs on the assistant's own page unless a voice session
  // is running through it.
  if (onAssistantPage && !mounted) return null

  return (
    <>
      {/* The chrome belongs to the page, not the sheet, and never to the
          assistant's own page — which has both of these built in already. */}
      {!open && !onAssistantPage && (
        <>
          {/* Typing stays one tap away, just no longer the only way in. It sits
              above the microphone because voice is the primary path now. */}
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label={t('assistant.launcher')}
            className="fixed left-4 lg:left-5 z-40 h-11 lg:h-12 px-4 rounded-full
                       bottom-[calc(env(safe-area-inset-bottom)+1rem)] lg:bottom-5
                       bg-surface text-primary-700 border-2 border-primary-200 font-semibold
                       shadow-lifted hover:bg-primary-50 transition-colors flex items-center gap-2"
          >
            <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.9" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h8M8 8h8M8 16h5" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-3.5-7.1L21 4v5h-5" />
            </svg>
            <span className="hidden sm:inline">{t('assistant.launcher')}</span>
          </button>

          {/* One tap from anywhere: the entry point when off, the status and
              Stop when running. Same component, so there is no second widget
              to keep in step. */}
          <VoiceModeBar
            floating
            phase={voicePhase}
            onStart={startVoice}
            onStop={stopVoice}
            onExpand={() => setOpen(true)}
          />
        </>
      )}

      {/* On the assistant's own page we show nothing but a way to stop a
          session that followed the patient there. */}
      {!open && onAssistantPage && voiceActive && (
        <VoiceModeBar floating phase={voicePhase} onStop={stopVoice} />
      )}

      {mounted && createPortal(
        /**
         * Hidden, never unmounted while Voice Mode is running. `display: none`
         * would suspend the media stream's rendering path in some browsers and
         * discards layout the chat measures on restore, so the sheet is pushed
         * off-screen and made inert instead — the chat, its stream and its open
         * microphone all carry on untouched.
         */
        <div
          aria-hidden={!open}
          className={`fixed inset-0 z-50 flex items-end sm:items-center justify-center
                      ${open
                        ? 'bg-ink/50 animate-fade-in'
                        : 'pointer-events-none opacity-0 translate-y-full'}`}
          onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false) }}
        >
          <div
            role="dialog"
            aria-modal={open}
            aria-label={t('assistant.title')}
            className={`w-full sm:max-w-2xl bg-surface rounded-t-sheet sm:rounded-sheet shadow-sheet
                       flex flex-col h-[88dvh] sm:h-[80dvh] max-h-[88dvh]
                       ${open ? 'animate-sheet-up sm:animate-rise-in' : ''}`}
          >
            <div className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3.5 border-b border-line shrink-0">
              <div className="min-w-0">
                <h2 className="card-title truncate">{t('assistant.title')}</h2>
                <p className="text-caption text-muted truncate">{t('assistant.subtitle')}</p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={t('common.close', 'Close')}
                className="btn btn-icon btn-ghost shrink-0"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="flex-1 min-h-0 px-4 sm:px-5 py-4">
              <Suspense fallback={<Loading className="py-16" />}>
                {/* Same conversation as the full page — one transcript,
                    whichever way it was opened. */}
                <AssistantChat compact voiceStartSignal={voiceSignal} voiceChannel={VOICE_CHANNEL} />
              </Suspense>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
