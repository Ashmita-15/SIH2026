import React, { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { MapContainer, TileLayer, Marker, Circle } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import api, { friendlyError } from '../../services/api'
import Page from '../app/Page'
import Card, { CardBody, CardHeader } from '../ui/Card'
import Badge from '../ui/Badge'
import Button from '../ui/Button'
import Alert from '../ui/Alert'
import { Loading, ErrorState } from '../ui/States'
import { useToast } from '../ui/Toast'
import { EMERGENCY_STATUS, timeAgo } from './EmergencyInbox'

// A DivIcon, because Leaflet's default marker images don't survive bundling.
const PATIENT_ICON = new L.DivIcon({
  className: '',
  html: `<div style="width:22px;height:22px;border-radius:50%;background:#D92D20;border:3px solid #fff;
    box-shadow:0 2px 8px rgba(217,45,32,.5),0 0 0 8px rgba(217,45,32,.18);"></div>`,
  iconSize: [22, 22],
  iconAnchor: [11, 11]
})

const fullTime = (d) => d
  ? new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' })
  : ''

/**
 * One SOS as an alerted facility sees it: who, how to call them, where they
 * are. Opened from the push notification. The server decides whether this
 * account may see it — a facility the alert was not routed to gets a 404.
 */
export default function EmergencyDetail() {
  const { alertId } = useParams()
  const toast = useToast()
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')

  const load = useCallback(() => {
    api.get(`/emergency/${alertId}`)
      .then(({ data }) => { setData(data); setError('') })
      .catch(e => setError(friendlyError(e)))
  }, [alertId])

  useEffect(() => { load() }, [load])

  const update = async (status) => {
    setBusy(status)
    try {
      const { data: next } = await api.patch(`/emergency/${alertId}/status`, { status })
      setData(next)
      toast.success(status === 'acknowledged' ? 'Acknowledged. The patient has been told.' : 'Marked as resolved.')
    } catch (e) {
      toast.error(friendlyError(e))
      load()
    } finally {
      setBusy('')
    }
  }

  if (error) return <Page title="Emergency alert" back="/hospital/emergencies"><ErrorState message={error} onRetry={load} /></Page>
  if (!data) return <Page title="Emergency alert" back="/hospital/emergencies"><Loading /></Page>

  const s = EMERGENCY_STATUS[data.status] || EMERGENCY_STATUS.open
  const { latitude, longitude, accuracyMetres } = data.location
  const point = [latitude, longitude]
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`
  const directionsUrl = `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`

  return (
    <Page
      title="Emergency alert"
      description={`Received ${timeAgo(data.createdAt)}`}
      back={{ label: 'Emergencies' }}
      actions={<Button variant="secondary" size="sm" onClick={load}>Refresh</Button>}
    >
      {data.status === 'open' && (
        <Alert tone="error" title="A patient needs emergency help" className="mb-6">
          Call them if you can, then acknowledge so they know this facility has seen the alert.
        </Alert>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex items-center justify-between gap-2">
            <h2 className="card-title">Patient</h2>
            <Badge tone={s.tone} dot={data.status === 'open'}>{s.label}</Badge>
          </CardHeader>
          <CardBody className="space-y-3">
            <div>
              <p className="text-h3 text-ink">{data.patient?.name || 'Patient'}</p>
              {data.patient?.phone ? (
                <a href={`tel:${data.patient.phone}`} className="btn btn-danger mt-3 inline-flex">
                  Call {data.patient.phone}
                </a>
              ) : (
                <p className="text-small text-muted mt-1">No phone number on this patient's account.</p>
              )}
            </div>
            <dl className="text-small grid grid-cols-[auto,1fr] gap-x-4 gap-y-1.5">
              <dt className="text-muted">Received</dt><dd className="tabular">{fullTime(data.createdAt)}</dd>
              {data.facility && (<><dt className="text-muted">Distance</dt><dd>{data.facility.distanceKm} km from {data.facility.name}</dd></>)}
              {data.acknowledgedAt && (<><dt className="text-muted">Acknowledged</dt><dd className="tabular">{fullTime(data.acknowledgedAt)}</dd></>)}
              {data.resolvedAt && (<><dt className="text-muted">Resolved</dt><dd className="tabular">{fullTime(data.resolvedAt)}</dd></>)}
            </dl>
            <div className="flex flex-wrap gap-2 pt-2">
              {data.status === 'open' && (
                <Button variant="danger" loading={busy === 'acknowledged'} disabled={Boolean(busy)} onClick={() => update('acknowledged')}>
                  Acknowledge
                </Button>
              )}
              {data.status !== 'resolved' && (
                <Button variant="secondary" loading={busy === 'resolved'} disabled={Boolean(busy)} onClick={() => update('resolved')}>
                  Mark resolved
                </Button>
              )}
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader><h2 className="card-title">Location</h2></CardHeader>
          <CardBody className="space-y-3">
            {/* isolate: Leaflet's own z-indexes would otherwise paint over the fixed bottom nav on phones. */}
            <div className="isolate rounded-card overflow-hidden border border-line" style={{ height: 260 }}>
              <MapContainer center={point} zoom={15} style={{ height: '100%', width: '100%' }}>
                <TileLayer
                  url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                />
                {accuracyMetres > 0 && (
                  <Circle center={point} radius={accuracyMetres} pathOptions={{ color: '#D92D20', weight: 1, fillOpacity: 0.08 }} />
                )}
                <Marker position={point} icon={PATIENT_ICON} />
              </MapContainer>
            </div>
            <p className="text-small text-muted tabular">
              {latitude.toFixed(6)}, {longitude.toFixed(6)}
              {accuracyMetres != null && ` · accurate to about ${accuracyMetres} m`}
            </p>
            <div className="flex flex-wrap gap-2">
              <a href={directionsUrl} target="_blank" rel="noopener noreferrer" className="btn btn-primary btn-sm">Directions ↗</a>
              <a href={mapsUrl} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm">Open in Google Maps ↗</a>
            </div>
          </CardBody>
        </Card>
      </div>
    </Page>
  )
}
