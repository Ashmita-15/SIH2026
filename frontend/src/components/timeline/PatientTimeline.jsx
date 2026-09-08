import React, { useEffect, useState, useCallback } from 'react'
import api, { friendlyError } from '../../services/api'
import { Card, CardBody, Badge, EmptyState, ErrorState, Loading } from '../ui'

/**
 * One patient's care, in order.
 *
 * Deliberately a list and not a feed: the value is being able to read down a
 * column and see that a referral was raised on the 4th and nothing happened
 * after it. Grouping by day and putting the day on the left is what makes a
 * gap visible; a stream of cards hides exactly that.
 */

const ICON = {
  registration: '👤',
  home_visit: '🩺',
  doctor_record: '📋',
  consultation: '📞',
  referral_created: '➡️',
  referral_acknowledged: '✅',
  referral_scheduled: '📅',
  referral_attended: '🏥',
  referral_completed: '🎯',
  referral_missed: '⚠️',
  referral_declined: '🚫',
  referral_redirected: '↪️',
  referral_lapsed: '🚫',
  counter_referral: '↩️',
  care_plan: '📗',
  task: '🗒️'
}

/** Events that mean something went wrong get a visible tone, not a quiet one. */
const TONE = {
  referral_missed: 'warning',
  referral_declined: 'danger',
  referral_lapsed: 'danger',
  referral_completed: 'success',
  counter_referral: 'success'
}

const SIGN_LABELS = {
  severe_hypertension: 'Very high blood pressure',
  raised_blood_pressure: 'Raised blood pressure',
  severe_hypoxia: 'Very low oxygen',
  low_oxygen: 'Low oxygen',
  high_fever: 'High fever',
  hypothermia: 'Body temperature too low',
  hypoglycaemia: 'Very low blood sugar',
  very_high_glucose: 'Very high blood sugar',
  severe_anaemia: 'Severe anaemia',
  fast_pulse: 'Fast pulse'
}
const CRITICAL = new Set(['severe_hypertension', 'severe_hypoxia', 'hypothermia', 'hypoglycaemia', 'severe_anaemia'])

const VITALS = [
  ['systolic', (v, a) => `BP ${v}/${a.diastolic ?? '?'}`],
  ['pulse', v => `Pulse ${v}`],
  ['temperature', v => `${v}°C`],
  ['spo2', v => `SpO₂ ${v}%`],
  ['hemoglobin', v => `Hb ${v}`],
  ['bloodSugar', v => `Glucose ${v}`],
  ['weight', v => `${v} kg`]
]

const nice = (v) => String(v || '').replace(/_/g, ' ')

function dayLabel(date) {
  const d = new Date(date)
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const that = new Date(d); that.setHours(0, 0, 0, 0)
  const diff = Math.round((today - that) / 86400000)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' })
}

const time = (d) => new Date(d).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })

export default function PatientTimeline({ patientId, showHeader = true }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  const load = useCallback(() => {
    api.get(`/patients/${patientId}/timeline`)
      .then(({ data }) => setData(data))
      .catch(e => setError(friendlyError(e)))
  }, [patientId])

  useEffect(() => { load() }, [load])

  if (error) return <ErrorState message={error} />
  if (!data) return <Loading />
  if (!data.events.length && !data.upcoming?.length) {
    return <EmptyState title="Nothing recorded yet" message="Visits, consultations and referrals will appear here." />
  }

  // Grouped by day so that a gap between two entries is something you can see.
  const groups = []
  for (const ev of data.events) {
    const key = dayLabel(ev.occurredAt)
    const last = groups[groups.length - 1]
    if (last && last.key === key) last.events.push(ev)
    else groups.push({ key, events: [ev] })
  }

  return (
    <div>
      {showHeader && <TimelineSummary summary={data.summary} />}

      {/* Kept above the history and clearly labelled: these have not happened
          yet, and reading them as if they had is the mistake to prevent. */}
      {data.upcoming?.length > 0 && (
        <section className="mb-8">
          <p className="text-caption font-semibold text-muted uppercase tracking-wide mb-2">
            Coming up ({data.upcoming.length})
          </p>
          <div className="space-y-2">
            {data.upcoming.map((ev, i) => (
              <Event key={`up-${ev.type}-${ev.sourceId}-${i}`} event={ev} upcoming />
            ))}
          </div>
        </section>
      )}

      <p className="text-caption font-semibold text-muted uppercase tracking-wide mb-2">History</p>

      <div className="space-y-6">
        {groups.map(group => (
          <section key={group.key}>
            <p className="text-caption font-semibold text-muted uppercase tracking-wide mb-2">{group.key}</p>
            <div className="space-y-2">
              {group.events.map((ev, i) => <Event key={`${ev.type}-${ev.sourceId}-${i}`} event={ev} />)}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}

function TimelineSummary({ summary }) {
  const items = [
    ['Visits', summary.visits],
    ['Consultations', summary.consultations],
    ['Referrals', summary.referrals],
    ['Open referrals', summary.openReferrals]
  ]
  return (
    <div className="flex flex-wrap gap-2 mb-6">
      {items.map(([label, value]) => (
        <div key={label} className="px-3 py-2 rounded-control bg-surface-2">
          <span className="text-body font-semibold text-ink tabular">{value}</span>
          <span className="text-caption text-muted ml-1.5">{label}</span>
        </div>
      ))}
      {summary.highRisk && <Badge tone="danger" className="self-center">High-risk care plan</Badge>}
    </div>
  )
}

function Event({ event, upcoming = false }) {
  const [open, setOpen] = useState(false)
  const s = event.summary || {}
  const tone = TONE[event.type]

  const vitals = s.vitals
    ? VITALS.filter(([k]) => s.vitals[k] !== undefined && s.vitals[k] !== null)
        .map(([k, fmt]) => fmt(s.vitals[k], s.vitals)).join('   ·   ')
    : ''

  // Only offer to expand where there is genuinely more to read.
  const detail = [s.notes, s.diagnosis, s.prescription, s.summaryText, s.description, s.note, s.clinicalSummary]
    .filter(Boolean).length > 0 || (s.requiredTests?.length > 0)

  return (
    <Card>
      <CardBody className="py-3">
        <div className="flex items-start gap-3">
          <span className="text-body leading-none mt-0.5" aria-hidden="true">{ICON[event.type] || '•'}</span>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <p className={`text-small font-medium ${tone === 'danger' ? 'text-danger-500' : 'text-ink'}`}>
                {event.title}
              </p>
              <span className="text-caption text-muted tabular shrink-0">
                {upcoming
                  ? new Date(event.occurredAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
                  : time(event.occurredAt)}
              </span>
            </div>

            <p className="text-caption text-muted mt-0.5">
              {[
                s.author && `${s.author}${s.authorRole ? ` (${nice(s.authorRole)})` : ''}`,
                s.facility,
                s.doctor && `Dr ${s.doctor}`,
                s.assistedBy && `assisted by ${s.assistedBy}`,
                s.to && event.type === 'referral_created' && s.to,
                s.code
              ].filter(Boolean).join(' · ')}
            </p>

            {vitals && <p className="text-small text-body mt-1.5 tabular">{vitals}</p>}

            {/* The clinically important part, never behind a click. */}
            {s.dangerSigns?.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {s.dangerSigns.map(code => (
                  <Badge key={code} tone={CRITICAL.has(code) ? 'danger' : 'warning'}>
                    {SIGN_LABELS[code] || nice(code)}
                  </Badge>
                ))}
              </div>
            )}

            <div className="flex flex-wrap gap-1.5 mt-2">
              {s.priority && event.type === 'referral_created' && (
                <Badge tone={s.priority?.startsWith('urgent') || s.priority === 'emergency' ? 'danger' : 'neutral'}>
                  {nice(s.priority)}
                </Badge>
              )}
              {s.missedReason && <Badge tone="warning">{nice(s.missedReason)}</Badge>}
              {s.status && event.type === 'consultation' && <Badge>{nice(s.status)}</Badge>}
              {s.riskLevel && (
                <Badge tone={s.riskLevel === 'high' ? 'danger' : 'neutral'}>
                  {s.riskLevel === 'high' ? 'High risk' : 'Normal risk'}
                </Badge>
              )}
              {s.riskFlags?.map(f => <Badge key={f}>{nice(f)}</Badge>)}
            </div>

            {detail && (
              <>
                <button
                  type="button"
                  onClick={() => setOpen(o => !o)}
                  className="text-caption text-primary-600 mt-2 hover:underline"
                >
                  {open ? 'Hide details' : 'Details'}
                </button>

                {open && (
                  <div className="mt-2 space-y-1.5 text-small">
                    <Detail label="Reason" value={s.reason} />
                    <Detail label="Clinical summary" value={s.clinicalSummary} />
                    <Detail label="Tests needed" value={s.requiredTests?.join(', ')} />
                    <Detail label="Diagnosis" value={s.diagnosis} />
                    <Detail label="Prescription" value={s.prescription} />
                    <Detail label="Notes" value={s.notes} />
                    <Detail label="What happened" value={s.summaryText} />
                    <Detail label="Medications" value={s.medications} />
                    <Detail label="Follow-up" value={s.followUpInstructions} />
                    <Detail label="Note" value={s.note} />
                    <Detail label="Description" value={s.description} />
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </CardBody>
    </Card>
  )
}

const Detail = ({ label, value }) => value ? (
  <p className="text-body"><span className="text-muted">{label}: </span>{value}</p>
) : null
