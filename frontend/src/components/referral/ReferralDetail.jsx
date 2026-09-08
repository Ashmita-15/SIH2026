import React, { useState } from 'react'
import api, { friendlyError } from '../../services/api'
import { Button, Card, CardBody, Field, Input, Textarea, Select, Badge, Alert, Modal, useToast } from '../ui'

/**
 * One referral, seen from either end.
 *
 * The same component serves the facility that sent it and the facility that
 * received it, because the document is the same document — what differs is
 * which moves are available, and that answer comes from the server. The
 * buttons below are rendered from `allowedTransitions`; this file contains no
 * copy of the state machine, so the two can never drift apart.
 */

export const STATUS_TONE = {
  created: 'neutral', acknowledged: 'info', scheduled: 'info',
  attended: 'info', completed: 'success',
  missed: 'warning', declined: 'danger', redirected: 'warning', lapsed: 'danger'
}

const PRIORITY_TONE = {
  emergency: 'danger', urgent_24h: 'danger', urgent_72h: 'warning',
  routine_7d: 'neutral', routine_30d: 'neutral'
}

const MISSED_REASONS = [
  ['no_transport', 'No transport'],
  ['no_money', 'Could not afford it'],
  ['family_refused', 'Family refused'],
  ['felt_better', 'Felt better'],
  ['went_elsewhere', 'Went somewhere else'],
  ['other', 'Other']
]

const label = (s) => String(s || '').replace(/_/g, ' ')
const when = (d) => d ? new Date(d).toLocaleString('en-IN', {
  day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
}) : null

export default function ReferralDetail({ referral, allowedTransitions = [], onChanged }) {
  const toast = useToast()
  const [action, setAction] = useState(null)
  const [busy, setBusy] = useState(false)

  const overdue = referral.status !== 'completed' &&
    !['declined', 'lapsed', 'redirected'].includes(referral.status) &&
    new Date(referral.dueBy) < new Date()

  const run = async (status, payload) => {
    setBusy(true)
    try {
      if (status === 'completed') {
        await api.post(`/referrals/${referral._id}/complete`, payload)
      } else {
        await api.patch(`/referrals/${referral._id}/status`, { status, ...payload })
      }
      toast.success(`Referral marked ${label(status)}`)
      setAction(null)
      onChanged?.()
    } catch (e) {
      toast.error(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardBody>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-caption text-muted tabular">{referral.referralId}</p>
              <p className="text-ink font-medium mt-0.5">{referral.patientId?.name}</p>
              <p className="text-small text-muted mt-0.5">
                {referral.fromFacilityId?.name} → {referral.toFacilityId?.name}
              </p>
            </div>
            <div className="flex flex-wrap gap-2 shrink-0">
              <Badge tone={PRIORITY_TONE[referral.priority]}>{label(referral.priority)}</Badge>
              <Badge tone={STATUS_TONE[referral.status]}>{label(referral.status)}</Badge>
            </div>
          </div>

          {/* The deadline is the promise made to the patient, so a breach is
              shown as a fact rather than left for someone to work out. */}
          {overdue && (
            <Alert tone="warning" className="mt-3">
              Overdue — was due {when(referral.dueBy)}
            </Alert>
          )}

          <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-2 mt-4 text-small">
            <Row label="Reason" value={referral.reason} />
            <Row label="Due by" value={when(referral.dueBy)} />
            {referral.clinicalSummary && <Row label="Clinical summary" value={referral.clinicalSummary} wide />}
            {referral.requiredTests?.length > 0 && (
              <Row label="Tests needed before the visit" value={referral.requiredTests.join(', ')} wide />
            )}
            <Row label="Transport" value={label(referral.transportNeed)} />
            <Row label="Raised by" value={referral.createdBy?.name} />
            {referral.acknowledgedAt && <Row label="Acknowledged" value={when(referral.acknowledgedAt)} />}
            {referral.scheduledFor && <Row label="Appointment" value={when(referral.scheduledFor)} />}
            {referral.attendedAt && <Row label="Attended" value={when(referral.attendedAt)} />}
            {referral.completedAt && <Row label="Completed" value={when(referral.completedAt)} />}
            {referral.missedReason && <Row label="Reason not attended" value={label(referral.missedReason)} />}
          </dl>
        </CardBody>
      </Card>

      {/* The loop closing. This is what the referring facility never gets on
          paper, so it is given its own card rather than a line in a list. */}
      {referral.counterReferral && (
        <Card>
          <CardBody>
            <p className="text-caption text-muted mb-2">Counter-referral — from {referral.toFacilityId?.name}</p>
            <p className="text-small text-ink">{referral.counterReferral.summary}</p>
            {referral.counterReferral.medications && (
              <p className="text-small text-body mt-2">
                <span className="text-muted">Medications: </span>{referral.counterReferral.medications}
              </p>
            )}
            {referral.counterReferral.followUpInstructions && (
              <p className="text-small text-body mt-1">
                <span className="text-muted">Follow-up: </span>{referral.counterReferral.followUpInstructions}
              </p>
            )}
          </CardBody>
        </Card>
      )}

      {allowedTransitions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {allowedTransitions.map(s => (
            <Button
              key={s}
              size="sm"
              variant={s === 'completed' ? 'primary' : 'secondary'}
              onClick={() => setAction(s)}
            >
              Mark {label(s)}
            </Button>
          ))}
        </div>
      )}

      <Card>
        <CardBody>
          <p className="text-caption text-muted mb-2">History</p>
          <ol className="space-y-2">
            {referral.statusHistory?.map((h, i) => (
              <li key={i} className="flex items-baseline gap-3 text-small">
                <Badge tone={STATUS_TONE[h.status]}>{label(h.status)}</Badge>
                <span className="text-muted tabular shrink-0">{when(h.timestamp)}</span>
                {h.note && <span className="text-body min-w-0">{h.note}</span>}
              </li>
            ))}
          </ol>
        </CardBody>
      </Card>

      {action && (
        <TransitionForm
          status={action}
          busy={busy}
          onClose={() => setAction(null)}
          onSubmit={(payload) => run(action, payload)}
        />
      )}
    </div>
  )
}

const Row = ({ label: l, value, wide }) => value ? (
  <div className={wide ? 'sm:col-span-2' : ''}>
    <dt className="text-caption text-muted">{l}</dt>
    <dd className="text-body">{value}</dd>
  </div>
) : null

/**
 * Each move asks for exactly what the server requires for it, and nothing
 * more. The required fields mirror the service's own rules — a decline that
 * does not say why, or a completion with no summary, is refused there too.
 */
function TransitionForm({ status, busy, onClose, onSubmit }) {
  const [form, setForm] = useState({
    note: '', scheduledFor: '', missedReason: 'no_transport',
    summary: '', medications: '', followUpInstructions: ''
  })
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))

  const submit = (e) => {
    e.preventDefault()
    if (status === 'completed') {
      return onSubmit({
        counterReferral: {
          summary: form.summary,
          medications: form.medications,
          followUpInstructions: form.followUpInstructions
        },
        note: form.note
      })
    }
    const payload = { note: form.note }
    if (status === 'scheduled') payload.scheduledFor = new Date(form.scheduledFor).toISOString()
    if (status === 'missed') payload.missedReason = form.missedReason
    onSubmit(payload)
  }

  const needsNote = ['declined', 'redirected', 'lapsed'].includes(status)

  return (
    <Modal open onClose={onClose} title={`Mark ${label(status)}`} size={status === 'completed' ? 'lg' : 'md'}>
      <form onSubmit={submit} className="space-y-4">
        {status === 'scheduled' && (
          <Field label="Appointment date and time" required>
            {(p) => <Input {...p} type="datetime-local" value={form.scheduledFor} onChange={set('scheduledFor')} required />}
          </Field>
        )}

        {status === 'missed' && (
          <Field label="Why did they not attend?" required
                 hint="This is the most useful thing recorded here — it is what a district officer can act on.">
            {(p) => (
              <Select {...p} value={form.missedReason} onChange={set('missedReason')}>
                {MISSED_REASONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </Select>
            )}
          </Field>
        )}

        {status === 'completed' && (
          <>
            <Field label="What happened" required
                   hint="The referring facility sees only this — it is how they learn the outcome.">
              {(p) => <Textarea {...p} rows={3} value={form.summary} onChange={set('summary')} required />}
            </Field>
            <Field label="Medications started">
              {(p) => <Input {...p} value={form.medications} onChange={set('medications')} />}
            </Field>
            <Field label="Follow-up instructions" hint="This becomes a task for the health worker.">
              {(p) => <Textarea {...p} rows={2} value={form.followUpInstructions} onChange={set('followUpInstructions')} />}
            </Field>
          </>
        )}

        <Field label="Note" required={needsNote}>
          {(p) => <Textarea {...p} rows={2} value={form.note} onChange={set('note')} required={needsNote} />}
        </Field>

        <div className="flex gap-2 justify-end">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Confirm'}</Button>
        </div>
      </form>
    </Modal>
  )
}
