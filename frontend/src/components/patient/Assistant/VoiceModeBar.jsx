import React from 'react'
import { useTranslation } from 'react-i18next'
import { VOICE } from './useVoiceMode'

/**
 * What VoiceSathi is doing, and how to make it stop.
 *
 * Deliberately one line. Somebody using this is not reading the screen — the
 * text is for the person helping them, and the colour and motion are for
 * everyone else. The only thing that has to be unmissable is Stop.
 */

const LOOK = {
  [VOICE.STARTING]:   { dot: 'bg-muted',       ring: 'border-line',        key: 'starting',   animate: 'animate-pulse' },
  [VOICE.LISTENING]:  { dot: 'bg-danger-500',  ring: 'border-danger-300',  key: 'listening',  animate: 'animate-pulse' },
  [VOICE.PROCESSING]: { dot: 'bg-warning-500', ring: 'border-warning-300', key: 'processing', animate: 'animate-pulse' },
  [VOICE.SPEAKING]:   { dot: 'bg-primary-600', ring: 'border-primary-300', key: 'speaking',   animate: '' }
}

/** The floating corner the launcher and the Emergency button share. */
const CORNER = `fixed right-4 lg:right-5 z-40
                bottom-[calc(env(safe-area-inset-bottom)+9.5rem)] lg:bottom-[5.5rem]`

const MicIcon = ({ className }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.9" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 15a3 3 0 003-3V6a3 3 0 10-6 0v6a3 3 0 003 3z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-14 0M12 18.5V22" />
  </svg>
)

export default function VoiceModeBar({ phase, onStart, onStop, floating = false, onExpand }) {
  const { t } = useTranslation()

  if (phase === VOICE.OFF) {
    /**
     * The one-tap way in.
     *
     * Floating, it is the whole point of VoiceSathi: somebody who cannot read
     * the screen should not first have to find a chat, open it, and read a
     * second button. Inside the sheet it is the same control in the same
     * words, so the two entry points do not have to be learned separately.
     */
    return (
      <button
        type="button"
        onClick={onStart}
        className={floating
          ? `${CORNER} h-12 lg:h-14 px-4 lg:px-5 rounded-full bg-primary-600 text-white
             font-semibold shadow-lifted transition-colors hover:bg-primary-500
             flex items-center gap-2 focus-visible:outline-none focus-visible:ring-2
             focus-visible:ring-primary-500 focus-visible:ring-offset-2`
          : `w-full min-h-[3rem] rounded-xl border-2 border-primary-200 bg-primary-50
             text-primary-700 font-semibold flex items-center justify-center gap-2
             px-4 py-2.5 transition-colors active:bg-primary-100
             focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500`}
      >
        <MicIcon className="w-5 h-5 shrink-0" />
        <span>{t('assistant.voice.start')}</span>
      </button>
    )
  }

  const look = LOOK[phase] || LOOK[VOICE.STARTING]

  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex items-center gap-3 rounded-xl border-2 bg-surface px-3 py-2.5 ${look.ring}
                  ${floating ? `${CORNER} left-4 sm:left-auto sm:w-80 shadow-lifted` : ''}`}
    >
      <span className={`relative flex h-3 w-3 shrink-0 ${look.animate}`} aria-hidden="true">
        <span className={`absolute inline-flex h-full w-full rounded-full opacity-60 ${look.dot}`} />
        <span className={`relative inline-flex rounded-full h-3 w-3 ${look.dot}`} />
      </span>

      {/* Tapping the status brings the transcript back; the label is the target
          because it is the biggest thing that is not the Stop button. */}
      <button
        type="button"
        onClick={onExpand}
        disabled={!onExpand}
        className="flex-1 min-w-0 text-left text-small font-medium text-body truncate
                   disabled:cursor-default focus-visible:outline-none focus-visible:ring-2
                   focus-visible:ring-primary-500 rounded"
      >
        {t(`assistant.voice.${look.key}`)}
      </button>

      <button
        type="button"
        onClick={onStop}
        className="shrink-0 min-h-[2.25rem] px-3 rounded-lg bg-danger-500 text-white text-small
                   font-semibold transition-colors active:bg-danger-600
                   focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger-500"
      >
        {t('assistant.voice.stop')}
      </button>
    </div>
  )
}
