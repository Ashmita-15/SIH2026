import React, { useState, useEffect, useCallback } from 'react'
import api, { friendlyError } from '../../services/api'
import {
  Button, Card, CardBody, Badge, Modal, Textarea, Field,
  EmptyState, ErrorState, Loading, Alert, useToast
} from '../ui'

/**
 * Where a person decides what an agent may actually do.
 *
 * The screen is deliberately built around the review, not around the agent.
 * What matters here is that somebody reads the reasoning and agrees or does
 * not — running the agent is a small button at the top, and approving is the
 * thing the layout gives space to.
 */

const CONCERN_TONE = { high: 'danger', medium: 'warning', low: 'neutral' }

const PROBLEM_LABEL = {
  // Referral coordination
  not_acknowledged: 'Never acknowledged',
  not_scheduled: 'No appointment set',
  not_attended: 'Attendance not recorded',
  missed_referral: 'Patient did not attend',
  // Patient coordination
  critical_sign_no_followup: 'Concerning visit, no follow-up',
  repeated_warning_signs: 'Repeated observation',
  care_plan_visit_overdue: 'Scheduled visit overdue',
  high_risk_plan_no_contact: 'High-risk plan, no recent contact'
}

/**
 * The agents a facility can run from here.
 *
 * Listed rather than fetched: the panel only knows how to render these two,
 * and a registry entry appearing in a dropdown the screen cannot display would
 * be worse than not offering it.
 */
const AGENTS = [
  {
    id: 'referral_followup_agent',
    name: 'Referral Follow-up',
    description: 'Finds referrals that have stalled and suggests who should chase them.'
  },
  {
    id: 'high_risk_patient_followup_agent',
    name: 'High-Risk Patient Follow-up',
    description: 'Reviews visits, danger signs, care plans and tasks together to find patients whose care has gone quiet.'
  }
]

const AGENT_LABEL = Object.fromEntries(AGENTS.map(a => [a.id, a.name]))

const STATUS_TONE = {
  pending: 'warning', approved: 'info', executed: 'success',
  rejected: 'neutral', failed: 'danger'
}

const nice = (v) => String(v || '').replace(/_/g, ' ')

export default function CoordinationPanel() {
  const toast = useToast()
  const [recommendations, setRecommendations] = useState(null)
  const [error, setError] = useState('')
  const [running, setRunning] = useState(false)
  const [preview, setPreview] = useState(null)
  const [reviewing, setReviewing] = useState(null)   // { rec, decision }
  const [showAll, setShowAll] = useState(false)
  const [agentId, setAgentId] = useState(AGENTS[0].id)

  const agent = AGENTS.find(a => a.id === agentId)

  const load = useCallback(() => {
    api.get('/agent-recommendations', { params: showAll ? { status: 'pending,executed,rejected' } : {} })
      .then(({ data }) => setRecommendations(data))
      .catch(e => { setError(friendlyError(e)); setRecommendations([]) })
  }, [showAll])

  useEffect(() => { load() }, [load])

  /**
   * Dry run shows what the agent would propose without saving anything; a real
   * run files the proposals for review. Neither creates a task — that is what
   * the buttons on each card are for.
   */
  const run = async (dryRun) => {
    setRunning(true)
    try {
      const { data } = await api.post(`/agents/${agentId}/run`, { dryRun })
      if (dryRun) {
        setPreview(data.result)
      } else {
        toast.success(data.summary)
        load()
      }
    } catch (e) {
      toast.error(friendlyError(e))
    } finally {
      setRunning(false)
    }
  }

  const decide = async (rec, decision, note) => {
    try {
      const { data } = await api.post(`/agent-recommendations/${rec._id}/${decision}`, { note })
      toast.success(decision === 'approve'
        ? `Task created for ${data.task?.assignedTo ? rec.recommendedAction.ownerName : rec.recommendedAction.ownerName}`
        : 'Recommendation rejected')
      setReviewing(null)
      load()
    } catch (e) {
      toast.error(friendlyError(e))
    }
  }

  if (error) return <ErrorState message={error} />

  return (
    <div className="space-y-6">
      <Card>
        <CardBody>
          {/* Which agent to run. Both propose; neither creates work. */}
          <div className="flex flex-wrap gap-2 mb-3">
            {AGENTS.map(a => (
              <button
                key={a.id}
                type="button"
                onClick={() => { setAgentId(a.id); setPreview(null) }}
                className={`px-3 py-1.5 rounded-control text-small font-medium transition-colors ${
                  a.id === agentId ? 'bg-primary-600 text-white' : 'bg-surface-2 text-body hover:bg-line-soft'
                }`}
              >
                {a.name}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-caption text-muted mt-0.5">
              {agent.description} It never creates work on its own.
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            <Button variant="secondary" size="sm" disabled={running} onClick={() => run(true)}>
              {running ? 'Running…' : 'Preview'}
            </Button>
            <Button size="sm" disabled={running} onClick={() => run(false)}>
              Run agent
            </Button>
          </div>
          </div>
        </CardBody>
      </Card>

      {/* A dry run is shown and thrown away — nothing here has been saved. */}
      {preview && (
        <Card>
          <CardBody>
            <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
              <div>
                <p className="text-small font-medium text-ink">Preview</p>
                <p className="text-caption text-muted mt-0.5">{preview.summary}</p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setPreview(null)}>Dismiss</Button>
            </div>
            <Alert tone="info">{preview.note}</Alert>
            {/* The referral agent returns `recommendations`, the patient agent
                `findings`; both carry a patient, a problem and reasoning. */}
            <div className="mt-3 space-y-2">
              {(preview.recommendations || preview.findings || []).map((p, i) => (
                <div key={p.referralId || p.patientId || i} className="text-small">
                  <span className="text-ink font-medium">{p.patient}</span>
                  <span className="text-muted">
                    {' · '}{PROBLEM_LABEL[p.problem] || nice(p.problem)}
                    {p.overdueHours !== undefined && ` · ${p.overdueHours}h overdue`}
                    {p.concern && ` · ${p.concern} concern`}
                  </span>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
      )}

      <div className="flex items-center justify-between">
        <p className="text-caption text-muted">
          {showAll ? 'All recommendations' : 'Awaiting your review'}
        </p>
        <Button variant="ghost" size="sm" onClick={() => setShowAll(v => !v)}>
          {showAll ? 'Show pending only' : 'Show reviewed too'}
        </Button>
      </div>

      {!recommendations ? (
        <Loading />
      ) : recommendations.length === 0 ? (
        <EmptyState
          title={showAll ? 'Nothing yet' : 'Nothing to review'}
          message="Run an agent to check for coordination gaps."
        />
      ) : (
        <div className="grid gap-3">
          {recommendations.map(rec => (
            <Card key={rec._id}>
              <CardBody>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-ink font-medium">{rec.patientId?.name}</p>
                    <p className="text-caption text-muted mt-0.5 tabular">
                      {rec.referralId
                        ? `${rec.referralId.referralId} · ${rec.referralId.reason}`
                        : [rec.patientId?.village, rec.patientId?.age && `${rec.patientId.age}y`]
                            .filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <Badge tone={CONCERN_TONE[rec.concern]}>{rec.concern} concern</Badge>
                    <Badge>{PROBLEM_LABEL[rec.problem] || nice(rec.problem)}</Badge>
                    <Badge tone="info">{AGENT_LABEL[rec.agentId] || rec.agentId}</Badge>
                    {rec.status !== 'pending' && (
                      <Badge tone={STATUS_TONE[rec.status]}>{nice(rec.status)}</Badge>
                    )}
                  </div>
                </div>

                {/* The reasoning is the thing being reviewed, so it is not
                    hidden behind a click. */}
                <ul className="mt-3 space-y-1">
                  {rec.reasoning.map((line, i) => (
                    <li key={i} className="text-small text-body">· {line}</li>
                  ))}
                </ul>

                <div className="mt-3 p-3 rounded-control bg-surface-2">
                  <p className="text-caption text-muted mb-1">Recommended</p>
                  <p className="text-small text-ink font-medium">{rec.recommendedAction.title}</p>
                  <p className="text-small text-body mt-1">{rec.recommendedAction.summary}</p>
                  <p className="text-caption text-muted mt-2">
                    Would be assigned to{' '}
                    <span className="text-ink">{rec.recommendedAction.ownerName || 'the facility'}</span>
                    {rec.recommendedAction.ownerRole && ` (${nice(rec.recommendedAction.ownerRole)})`}
                    {` · ${rec.recommendedAction.priority} priority · due in ${rec.recommendedAction.dueInDays} day(s)`}
                  </p>
                </div>

                {rec.status === 'pending' ? (
                  <div className="flex gap-2 mt-3">
                    <Button size="sm" onClick={() => setReviewing({ rec, decision: 'approve' })}>
                      Approve — create task
                    </Button>
                    <Button size="sm" variant="ghost" className="text-danger-500"
                            onClick={() => setReviewing({ rec, decision: 'reject' })}>
                      Reject
                    </Button>
                  </div>
                ) : (
                  <p className="text-caption text-muted mt-3">
                    {nice(rec.status)}
                    {rec.reviewedBy?.name && ` by ${rec.reviewedBy.name}`}
                    {rec.reviewNote && ` — "${rec.reviewNote}"`}
                  </p>
                )}
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      {reviewing && (
        <ReviewDialog
          rec={reviewing.rec}
          decision={reviewing.decision}
          onClose={() => setReviewing(null)}
          onConfirm={(note) => decide(reviewing.rec, reviewing.decision, note)}
        />
      )}
    </div>
  )
}

function ReviewDialog({ rec, decision, onClose, onConfirm }) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const approving = decision === 'approve'

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    await onConfirm(note)
    setBusy(false)
  }

  return (
    <Modal open onClose={onClose} title={approving ? 'Approve recommendation' : 'Reject recommendation'}>
      <form onSubmit={submit} className="space-y-4">
        <p className="text-small text-body">{rec.recommendedAction.title}</p>

        <Alert tone={approving ? 'info' : 'warning'}>
          {approving
            ? `A task will be created for ${rec.recommendedAction.ownerName || 'the facility'} and will appear on their worklist.`
            : 'No task will be created. The recommendation is closed and your decision is recorded.'}
        </Alert>

        <Field label="Note" hint="Recorded against your decision.">
          {(p) => <Textarea {...p} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />}
        </Field>

        <div className="flex gap-2 justify-end">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>
            {busy ? 'Saving…' : approving ? 'Approve' : 'Reject'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
