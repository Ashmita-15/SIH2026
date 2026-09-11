import React from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import Button from '../../ui/Button'

/**
 * How soon to be seen, and what to do about it.
 *
 * Deliberately not phrased as a finding. It says when to go, never what is
 * wrong — the level came from a rule table, and a rule table is entitled to
 * schedule, not to diagnose. The disclaimer is not fine print for that reason.
 */

const LOOK = {
  EMERGENCY:        { border: 'border-danger-300',  bg: 'bg-danger-50',  dot: 'bg-danger-500' },
  URGENT_24H:       { border: 'border-warning-300', bg: 'bg-warning-50', dot: 'bg-warning-500' },
  URGENT_72H:       { border: 'border-primary-300', bg: 'bg-primary-50', dot: 'bg-primary-500' },
  ROUTINE:          { border: 'border-line',        bg: 'bg-surface-2',  dot: 'bg-muted' },
  NEEDS_ASSESSMENT: { border: 'border-line',        bg: 'bg-surface-2',  dot: 'bg-muted' }
}

export default function TriageCard({ triage }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  if (!triage?.level) return null

  const look = LOOK[triage.level] || LOOK.ROUTINE
  // Emergency has its own flow already; this never offers to book one.
  const canBook = ['URGENT_24H', 'URGENT_72H', 'ROUTINE'].includes(triage.level)

  return (
    <div className={`rounded-card border ${look.border} ${look.bg} p-3.5 flex flex-col gap-2`}>
      <div className="flex items-center gap-2">
        <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${look.dot}`} aria-hidden="true" />
        <p className="text-small font-semibold text-ink">{t(`triage.level.${triage.level}`)}</p>
      </div>

      <p className="text-small text-body">{t(`triage.action.${triage.level}`)}</p>

      {/* Nothing is booked here — this opens the ordinary booking screen. */}
      {canBook && (
        <Button size="sm" variant="secondary" className="self-start"
          onClick={() => navigate('/patient/care/book')}>
          {t('triage.book')}
        </Button>
      )}

      <p className="text-caption text-muted">{t('triage.disclaimer')}</p>
    </div>
  )
}
