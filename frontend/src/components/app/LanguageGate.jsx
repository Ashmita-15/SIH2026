import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { GATE_LANGUAGES, hasChosenLanguage, markLanguageChosen } from '../../translations/i18n'

/**
 * The first thing a new visitor sees.
 *
 * Blocking rather than a banner, because the language is not a preference to
 * adjust later — it decides what every other word on the screen says, and for
 * somebody who reads only Marathi an English app is not a slightly worse
 * experience, it is an unusable one.
 *
 * Deliberately renders no translated strings for the *choices*: each option is
 * written in its own script, so it is legible before anything is selected. The
 * heading is translated and follows whatever the browser was guessed to be,
 * which is a reasonable first guess and never the final word.
 *
 * Once dismissed it never returns on its own. The switcher in the navbar is
 * the way back.
 */
export default function LanguageGate() {
  // useTranslation, not the bare i18n instance: the heading has to re-render as
  // they tap, so they can see the language change before committing to it.
  const { t, i18n } = useTranslation()
  const [needed, setNeeded] = useState(() => !hasChosenLanguage())
  const [preview, setPreview] = useState(i18n.language)

  if (!needed) return null

  const choose = (code) => {
    setPreview(code)
    i18n.changeLanguage(code)
  }

  const confirm = () => {
    // changeLanguage has already persisted the code; this records that a person
    // picked it rather than the browser being sniffed.
    markLanguageChosen()
    setNeeded(false)
  }

  return (
    <div
      className="fixed inset-0 z-[100] bg-ground flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="lang-gate-title"
    >
      <div className="w-full max-w-md card">
        <div className="card-body space-y-5">
          <div className="text-center space-y-1">
            <h1 id="lang-gate-title" className="text-h3 text-ink">
              {t('language.gateTitle')}
            </h1>
            <p className="text-small text-muted">{t('language.gateHint')}</p>
          </div>

          <div className="grid gap-2">
            {GATE_LANGUAGES.map(l => (
              <button
                key={l.code}
                type="button"
                lang={l.code}
                onClick={() => choose(l.code)}
                aria-pressed={preview === l.code}
                className={`w-full px-4 py-3 rounded-control text-left border transition
                  ${preview === l.code
                    ? 'border-primary-500 bg-primary-50 text-ink'
                    : 'border-line bg-surface hover:bg-surface-2 text-ink'}`}
              >
                <span className="text-body font-semibold">{l.native}</span>
                {l.native !== l.label && (
                  <span className="text-caption text-muted ml-2">{l.label}</span>
                )}
              </button>
            ))}
          </div>

          <button type="button" onClick={confirm} className="btn btn-primary btn-block">
            {t('language.gateContinue')}
          </button>
        </div>
      </div>
    </div>
  )
}
