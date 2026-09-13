import React, { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api, { friendlyError } from '../../services/api'
import Page from '../app/Page'
import Card, { CardBody } from '../ui/Card'
import Badge from '../ui/Badge'
import Button from '../ui/Button'
import Alert from '../ui/Alert'
import { Loading, EmptyState, ErrorState } from '../ui/States'
import {
  isPushSupported,
  getPushPermissionStatus,
  getCurrentPushSubscription,
  subscribeToPush
} from '../../lib/pushNotifications'

export const EMERGENCY_STATUS = {
  open: { tone: 'danger', label: 'Open' },
  acknowledged: { tone: 'warning', label: 'Acknowledged' },
  resolved: { tone: 'success', label: 'Resolved' }
}

const POLL_MS = 30000

export function timeAgo(dateStr) {
  const min = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000)
  if (min < 1) return 'Just now'
  if (min < 60) return `${min} min ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} h ago`
  return new Date(dateStr).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

/**
 * An SOS only reaches a phone that has subscribed. Facility staff are asked
 * here, on the page that exists for emergencies, rather than being expected
 * to find the setting in the notification menu.
 */
function PushOptIn() {
  const [state, setState] = useState('checking') // checking | ready | subscribed | denied | unsupported
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!isPushSupported()) return !cancelled && setState('unsupported')
      const permission = getPushPermissionStatus()
      if (permission === 'denied') return !cancelled && setState('denied')
      const sub = await getCurrentPushSubscription()
      if (!cancelled) setState(sub && permission === 'granted' ? 'subscribed' : 'ready')
    })()
    return () => { cancelled = true }
  }, [])

  const enable = async () => {
    setBusy(true)
    setError('')
    const result = await subscribeToPush()
    setBusy(false)
    if (result.success) setState('subscribed')
    else if (result.reason === 'permission_denied') setState('denied')
    else setError(result.error || 'Could not turn on alerts for this device.')
  }

  if (state === 'checking' || state === 'subscribed') return null

  if (state === 'unsupported') {
    return (
      <Alert tone="info" className="mb-6">
        This browser can't receive push alerts. Keep this page open to see new emergencies, or use Chrome on Android
        (on iPhone, add GramSathi to the Home Screen first).
      </Alert>
    )
  }
  if (state === 'denied') {
    return (
      <Alert tone="warning" title="Emergency alerts are blocked on this device" className="mb-6">
        Notifications are blocked for this site. Allow them in your browser's site settings so SOS alerts can reach you.
      </Alert>
    )
  }
  return (
    <Alert
      tone="warning"
      title="Turn on emergency alerts for this device"
      className="mb-6"
      action={<Button size="sm" loading={busy} onClick={enable}>Enable alerts</Button>}
    >
      Patients near this facility can send an SOS. Without alerts on, you'll only see them when this page is open.
      {error && <span className="block mt-1 text-danger-600">{error}</span>}
    </Alert>
  )
}

export default function EmergencyInbox() {
  const navigate = useNavigate()
  const [alerts, setAlerts] = useState(null)
  const [error, setError] = useState('')

  const load = useCallback(() => {
    api.get('/emergency/facility')
      .then(({ data }) => { setAlerts(data); setError('') })
      .catch(e => { setError(friendlyError(e)); setAlerts(prev => prev || []) })
  }, [])

  useEffect(() => {
    load()
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') load()
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [load])

  if (error && !alerts?.length) {
    return <Page title="Emergencies"><ErrorState message={error} onRetry={load} /></Page>
  }
  if (!alerts) return <Page title="Emergencies"><Loading /></Page>

  const active = alerts.filter(a => a.status !== 'resolved')
  const closed = alerts.filter(a => a.status === 'resolved')

  const Row = ({ a }) => {
    const s = EMERGENCY_STATUS[a.status] || EMERGENCY_STATUS.open
    return (
      <Card interactive className={a.status === 'open' ? 'border-danger-500' : ''}>
        <CardBody className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-ink font-medium">{a.patientName}</p>
            <p className="text-small text-muted mt-0.5">
              {timeAgo(a.createdAt)}{a.distanceKm != null ? ` · ${a.distanceKm} km from this facility` : ''}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Badge tone={s.tone} dot={a.status === 'open'}>{s.label}</Badge>
            <Button size="sm" variant={a.status === 'open' ? 'danger' : 'secondary'}
                    onClick={() => navigate(`/hospital/emergencies/${a.alertId}`)}>
              Open
            </Button>
          </div>
        </CardBody>
      </Card>
    )
  }

  return (
    <Page
      title="Emergencies"
      description={`${active.length} active · SOS alerts from patients near this facility`}
      actions={<Button variant="secondary" size="sm" onClick={load}>Refresh</Button>}
    >
      <PushOptIn />
      {alerts.length === 0 ? (
        <EmptyState title="No emergency alerts" message="When a nearby patient presses SOS, the alert will appear here." />
      ) : (
        <div className="space-y-6">
          {active.length > 0 && (
            <section>
              <p className="text-caption text-muted mb-2">Active ({active.length})</p>
              <div className="grid gap-3">{active.map(a => <Row key={a.alertId} a={a} />)}</div>
            </section>
          )}
          {closed.length > 0 && (
            <section>
              <p className="text-caption text-muted mb-2">Resolved ({closed.length})</p>
              <div className="grid gap-3">{closed.map(a => <Row key={a.alertId} a={a} />)}</div>
            </section>
          )}
        </div>
      )}
    </Page>
  )
}
