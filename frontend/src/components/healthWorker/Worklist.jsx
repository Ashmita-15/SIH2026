import React, { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import api, { friendlyError } from '../../services/api'
import {
  Button, Card, CardBody, Badge, Modal, Textarea, Field,
  EmptyState, ErrorState, Loading, useToast
} from '../ui'

/**
 * What the worker should do today, instead of a list of everyone they cover.
 *
 * The three groups are the only question a person standing in a village
 * actually asks: what is late or urgent, what is coming, what can wait. The
 * ordering is deliberately dull — priority, then overdue, then due date — so
 * that the reason the top item is at the top is always obvious.
 */

const TYPE_LABEL = {
  follow_up_visit: 'Follow-up visit',
  referral_acknowledge: 'Referral to acknowledge',
  referral_chase: 'Referral not attended',
  vitals_check: 'Check vitals',
  appointment_reminder: 'Appointment reminder',
  review_counter_referral: 'Review hospital notes'
}

const GROUPS = [
  { key: 'high', dot: '🔴', title: 'Needs attention', hint: 'Overdue or urgent' },
  { key: 'upcoming', dot: '🟡', title: 'This week', hint: null },
  { key: 'routine', dot: '⚪', title: 'Later', hint: null }
]

const dueLabel = (dueAt) => {
  const diff = new Date(dueAt) - Date.now()
  const days = Math.round(diff / 86400000)
  if (diff < 0) return { text: `${Math.abs(days)}d overdue`, late: true }
  if (days === 0) return { text: 'Due today', late: false }
  return { text: `Due in ${days}d`, late: false }
}

export default function Worklist() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [acting, setActing] = useState(null)

  const load = useCallback(() => {
    api.get('/tasks/worklist')
      .then(({ data }) => setData(data))
      .catch(e => setError(friendlyError(e)))
  }, [])

  useEffect(() => { load() }, [load])

  if (error) return <ErrorState message={error} />
  if (!data) return <Loading />

  if (data.counts.total === 0) {
    return <EmptyState title="Nothing due" message="No follow-ups or referrals need you right now." />
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-3">
        <Stat label="Open" value={data.counts.total} />
        <Stat label="Overdue" value={data.counts.overdue} tone={data.counts.overdue ? 'danger' : 'neutral'} />
      </div>

      {GROUPS.map(g => data[g.key].length > 0 && (
        <section key={g.key}>
          <p className="text-caption text-muted mb-2">
            {g.dot} {g.title} ({data[g.key].length}){g.hint ? ` · ${g.hint}` : ''}
          </p>
          <div className="grid gap-3">
            {data[g.key].map(task => (
              <TaskCard key={task._id} task={task} onAct={() => setActing(task)} />
            ))}
          </div>
        </section>
      ))}

      {acting && (
        <CompleteTask
          task={acting}
          onClose={() => setActing(null)}
          onDone={() => { setActing(null); load() }}
        />
      )}
    </div>
  )
}

const Stat = ({ label, value, tone = 'neutral' }) => (
  <div className="px-3 py-2 rounded-control bg-surface-2">
    <span className={`text-body font-semibold tabular ${tone === 'danger' ? 'text-danger-500' : 'text-ink'}`}>{value}</span>
    <span className="text-caption text-muted ml-1.5">{label}</span>
  </div>
)

function TaskCard({ task, onAct }) {
  const navigate = useNavigate()
  const due = dueLabel(task.dueAt)

  return (
    <Card>
      <CardBody>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-ink font-medium">{task.title}</p>
            <p className="text-small text-muted mt-0.5">
              {task.patientId?.name}
              {task.patientId?.village && ` · ${task.patientId.village}`}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Badge tone={due.late ? 'danger' : task.priority === 'high' ? 'warning' : 'neutral'}>
              {due.text}
            </Badge>
          </div>
        </div>

        <p className="text-caption text-muted mt-1.5">{TYPE_LABEL[task.type] || task.type}</p>
        {task.description && <p className="text-small text-body mt-2">{task.description}</p>}

        <div className="flex flex-wrap gap-2 mt-3">
          {task.patientId?._id && (
            <Button
              size="sm" variant="secondary"
              onClick={() => navigate(`/health-worker/patients/${task.patientId._id}`)}
            >
              Open patient
            </Button>
          )}
          <Button size="sm" onClick={onAct}>Mark done</Button>
        </div>
      </CardBody>
    </Card>
  )
}

/** Closing a task is a claim that the work happened, so it asks what happened. */
function CompleteTask({ task, onClose, onDone }) {
  const toast = useToast()
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      await api.patch(`/tasks/${task._id}/complete`, { note })
      toast.success('Task completed')
      onDone()
    } catch (err) {
      toast.error(friendlyError(err))
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={task.title}>
      <form onSubmit={submit} className="space-y-4">
        <p className="text-small text-muted">{task.patientId?.name} · {task.patientId?.village}</p>
        <Field label="What happened?" hint="A short note is enough.">
          {(p) => <Textarea {...p} rows={3} value={note} onChange={(e) => setNote(e.target.value)} autoFocus />}
        </Field>
        <div className="flex gap-2 justify-end">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Mark done'}</Button>
        </div>
      </form>
    </Modal>
  )
}
