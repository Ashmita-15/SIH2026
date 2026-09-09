import React, { useEffect, useState, useCallback } from 'react'
import { Routes, Route, Navigate, useNavigate, useParams } from 'react-router-dom'
import Page from '../components/app/Page'
import VideoCall from '../components/VideoCall'
import Worklist from '../components/healthWorker/Worklist'
import FacilityPicker from '../components/healthWorker/FacilityPicker'
import ReferralDetail, { STATUS_TONE } from '../components/referral/ReferralDetail'
import PatientTimeline from '../components/timeline/PatientTimeline'
import api, { friendlyError } from '../services/api'
import {
  Button, Card, CardBody, Field, Input, Select, Textarea, Badge, Modal, Alert,
  EmptyState, ErrorState, Loading, useToast
} from '../components/ui'

const WORKER_LABEL = { asha: 'ASHA', anm: 'ANM', cho: 'CHO' }

const niceLabel = (v) => String(v || '').replace(/_/g, ' ')

/**
 * The frontline worker's area.
 *
 * The worklist is the landing view: what needs doing today, then who they
 * are responsible for. Everything a worker starts — a visit, a consultation
 * with a doctor, a referral — begins from a patient.
 */
export default function HealthWorkerDashboard() {
  const [profile, setProfile] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api.get('/health-worker/me')
      .then(({ data }) => setProfile(data))
      .catch(e => setError(friendlyError(e)))
  }, [])

  if (error) return <div className="p-6"><ErrorState message={error} /></div>
  if (!profile) return <div className="p-6"><Loading /></div>

  return (
    <Routes>
      <Route index element={<Overview profile={profile} />} />
      <Route path="patients" element={<Patients profile={profile} />} />
      <Route path="patients/:patientId" element={<PatientDetail profile={profile} />} />
      <Route path="patients/:patientId/timeline" element={<PatientTimelineRoute />} />
      <Route path="call/:appointmentId" element={<WorkerCall />} />
      <Route path="referrals" element={<WorkerReferrals />} />
      <Route path="referrals/:referralId" element={<WorkerReferralDetail />} />
      <Route path="profile" element={<Overview profile={profile} />} />
      <Route path="*" element={<Navigate to="/health-worker" replace />} />
    </Routes>
  )
}

/* ─────────────────────────── Overview ─────────────────────────── */

function Overview({ profile }) {
  const navigate = useNavigate()
  const type = WORKER_LABEL[profile.workerType] || 'Health worker'

  return (
    <Page
      title={profile.name}
      description={`${type}${profile.facility ? ` · ${profile.facility.name}` : ''}`}
      actions={<Button onClick={() => navigate('/health-worker/patients')}>View patients</Button>}
    >
      {/* The worklist comes first: the worker's question is "who needs me
          today", not "what are my details". */}
      <div className="mb-8">
        <Worklist />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardBody>
            <p className="text-caption text-muted mb-1">Facility</p>
            {profile.facility ? (
              <>
                <p className="text-ink font-medium">{profile.facility.name}</p>
                <p className="text-small text-muted mt-0.5">
                  {String(profile.facility.level || '').replace(/_/g, ' ')}
                </p>
                {profile.facility.address && (
                  <p className="text-small text-muted mt-2">{profile.facility.address}</p>
                )}
              </>
            ) : (
              <p className="text-small text-muted">No facility assigned</p>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardBody>
            <p className="text-caption text-muted mb-1">Registered patients</p>
            <p className="text-d3 text-ink tabular">{profile.patientCount}</p>
            <p className="text-small text-muted mt-0.5">across your catchment</p>
          </CardBody>
        </Card>

        <Card className="sm:col-span-2">
          <CardBody>
            <p className="text-caption text-muted mb-2">
              Catchment villages ({profile.catchmentVillages.length})
            </p>
            {profile.catchmentVillages.length ? (
              <div className="flex flex-wrap gap-2">
                {profile.catchmentVillages.map(v => <Badge key={v}>{v}</Badge>)}
              </div>
            ) : (
              <p className="text-small text-muted">
                No villages assigned yet — ask your facility to set your catchment area.
              </p>
            )}
          </CardBody>
        </Card>
      </div>

    </Page>
  )
}

/* ─────────────────────────── Patients ─────────────────────────── */

function Patients({ profile }) {
  const toast = useToast()
  const navigate = useNavigate()
  const [patients, setPatients] = useState(null)
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  const [showForm, setShowForm] = useState(false)

  const load = useCallback((term = '') => {
    setError('')
    api.get('/health-worker/patients', { params: term ? { search: term } : {} })
      .then(({ data }) => setPatients(data))
      .catch(e => { setError(friendlyError(e)); setPatients([]) })
  }, [])

  useEffect(() => { load() }, [load])

  // Typing is expensive on a cheap phone and every keystroke is a request on a
  // connection that can barely carry one, so the search waits for a pause.
  useEffect(() => {
    const id = setTimeout(() => load(search.trim()), 300)
    return () => clearTimeout(id)
  }, [search, load])

  return (
    <Page
      title="Patients"
      description={`${profile.catchmentVillages.join(', ') || 'No villages assigned'}`}
      actions={<Button onClick={() => setShowForm(true)}>Register patient</Button>}
    >
      <div className="mb-4 max-w-md">
        <Field label="Search">
          {(props) => (
            <Input
              {...props}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name or phone"
            />
          )}
        </Field>
      </div>

      {error && <ErrorState message={error} />}

      {!patients ? (
        <Loading />
      ) : patients.length === 0 ? (
        <EmptyState
          title={search ? 'No match' : 'No patients yet'}
          message={
            search
              ? 'No one in your catchment matches that.'
              : 'Register the first person you visit and they will appear here.'
          }
        />
      ) : (
        <div className="grid gap-3">
          {patients.map(p => (
            <Card key={p._id} interactive>
              <CardBody className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-ink font-medium truncate">{p.name}</p>
                  <p className="text-small text-muted mt-0.5">
                    {[p.age && `${p.age}y`, p.gender, p.village].filter(Boolean).join(' · ')}
                  </p>
                  {p.phone && <p className="text-caption text-muted mt-1">{p.phone}</p>}
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <Badge>{p.village}</Badge>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => navigate(`/health-worker/patients/${p._id}`)}
                  >
                    Open
                  </Button>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      {showForm && (
        <RegisterPatient
          villages={profile.catchmentVillages}
          onClose={() => setShowForm(false)}
          onDone={(created) => {
            setShowForm(false)
            toast.success(`${created.name} registered`)
            load(search.trim())
          }}
        />
      )}
    </Page>
  )
}

/**
 * Deliberately short. A worker standing at someone's door will not fill in
 * fifteen fields, and anything they skip is a field that gets a made-up value.
 */
function RegisterPatient({ villages, onClose, onDone }) {
  const [form, setForm] = useState({ name: '', age: '', gender: '', phone: '', village: villages[0] || '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      const { data } = await api.post('/health-worker/patients', form)
      onDone(data)
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title="Register patient">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Name" required>
          {(props) => <Input {...props} value={form.name} onChange={set('name')} required autoFocus />}
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Age">
            {(props) => <Input {...props} type="number" min="0" max="120" value={form.age} onChange={set('age')} />}
          </Field>
          <Field label="Gender">
            {(props) => (
              <Select {...props} value={form.gender} onChange={set('gender')}>
                <option value="">Not stated</option>
                <option value="female">Female</option>
                <option value="male">Male</option>
                <option value="other">Other</option>
              </Select>
            )}
          </Field>
        </div>

        <Field label="Phone" hint="Optional — used for reminders">
          {(props) => <Input {...props} value={form.phone} onChange={set('phone')} />}
        </Field>

        {/* A list, not a text box: the village decides who may open this record,
            so it must be one of the worker's own and not a typo. */}
        <Field label="Village" required>
          {(props) => (
            <Select {...props} value={form.village} onChange={set('village')} required>
              {villages.map(v => <option key={v} value={v}>{v}</option>)}
            </Select>
          )}
        </Field>

        {error && <p className="error-text" role="alert">{error}</p>}

        <div className="flex gap-2 justify-end pt-1">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Register'}</Button>
        </div>
      </form>
    </Modal>
  )
}

/* ────────────────────── Patient detail + home visit ────────────────────── */

/** Only the readings a sub-centre or an ASHA kit can actually produce. */
const VITAL_FIELDS = [
  { key: 'systolic', label: 'BP systolic', unit: 'mmHg', step: '1' },
  { key: 'diastolic', label: 'BP diastolic', unit: 'mmHg', step: '1' },
  { key: 'pulse', label: 'Pulse', unit: 'bpm', step: '1' },
  { key: 'temperature', label: 'Temperature', unit: '°C', step: '0.1' },
  { key: 'spo2', label: 'SpO₂', unit: '%', step: '1' },
  { key: 'weight', label: 'Weight', unit: 'kg', step: '0.1' },
  { key: 'hemoglobin', label: 'Haemoglobin', unit: 'g/dL', step: '0.1' },
  { key: 'bloodSugar', label: 'Blood sugar', unit: 'mg/dL', step: '1' }
]

const VITAL_DISPLAY = [
  ['systolic', (v, all) => `BP ${v}/${all.diastolic ?? '?'}`],
  ['pulse', v => `Pulse ${v}`],
  ['temperature', v => `${v}°C`],
  ['spo2', v => `SpO₂ ${v}%`],
  ['hemoglobin', v => `Hb ${v}`],
  ['bloodSugar', v => `Glucose ${v}`],
  ['weight', v => `${v} kg`]
]

const summariseVitals = (vitals) => {
  if (!vitals) return ''
  return VITAL_DISPLAY
    .filter(([k]) => vitals[k] !== undefined && vitals[k] !== null)
    .map(([k, fmt]) => fmt(vitals[k], vitals))
    .join(' · ')
}

// `profile` carries the worker's own facility, which the referral form needs
// so it can exclude "refer to where I already am" from the destination list.
function PatientDetail({ profile }) {
  const { patientId } = useParams()
  const navigate = useNavigate()
  const toast = useToast()

  const [patient, setPatient] = useState(null)
  const [visits, setVisits] = useState([])
  const [rules, setRules] = useState([])
  const [consults, setConsults] = useState([])
  const [plans, setPlans] = useState([])
  const [referrals, setReferrals] = useState([])
  const [error, setError] = useState('')
  const [visiting, setVisiting] = useState(false)
  const [sheet, setSheet] = useState(null)   // 'consult' | 'plan'

  const load = useCallback(async () => {
    try {
      const [p, v, r, c, cp, ref] = await Promise.all([
        api.get(`/health-worker/patients/${patientId}`),
        api.get(`/health-worker/patients/${patientId}/encounters`),
        api.get('/health-worker/danger-rules'),
        api.get(`/health-worker/patients/${patientId}/consultations`),
        api.get(`/health-worker/patients/${patientId}/care-plans`),
        api.get('/referrals', { params: { patientId } })
      ])
      setPatient(p.data)
      setVisits(v.data)
      setConsults(c.data)
      setPlans(cp.data)
      setReferrals(ref.data)
      // Labels come from the server so a threshold change never leaves the
      // screen describing a rule that no longer exists.
      setRules(r.data)
    } catch (e) {
      setError(friendlyError(e))
    }
  }, [patientId])

  useEffect(() => { load() }, [load])

  const labelFor = (code) => rules.find(r => r.code === code)?.label || code
  const severityOf = (code) => rules.find(r => r.code === code)?.severity || 'warning'

  if (error) return <div className="p-6"><ErrorState message={error} /></div>
  if (!patient) return <div className="p-6"><Loading /></div>

  return (
    <Page
      title={patient.name}
      description={[patient.age && `${patient.age}y`, patient.gender, patient.village].filter(Boolean).join(' · ')}
      back="/health-worker/patients"
      actions={
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm"
                  onClick={() => navigate(`/health-worker/patients/${patient._id}/timeline`)}>History</Button>
          <Button variant="secondary" size="sm" onClick={() => setSheet('consult')}>Ask a doctor</Button>
          <Button variant="secondary" size="sm" onClick={() => setSheet('refer')}>Refer</Button>
          <Button variant="secondary" size="sm" onClick={() => setSheet('plan')}>Care plan</Button>
          <Button onClick={() => setVisiting(true)}>Start home visit</Button>
        </div>
      }
    >
      {plans.length > 0 && (
        <section className="mb-6">
          <p className="text-caption text-muted mb-2">Care plans</p>
          <div className="grid gap-2">
            {plans.map(pl => (
              <Card key={pl._id}>
                <CardBody className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-small font-medium text-ink">{pl.type.toUpperCase()}</p>
                    {pl.riskFlags?.length > 0 && (
                      <p className="text-caption text-muted mt-0.5">{pl.riskFlags.map(niceLabel).join(', ')}</p>
                    )}
                  </div>
                  <Badge tone={pl.riskLevel === 'high' ? 'danger' : 'neutral'}>
                    {pl.riskLevel === 'high' ? 'High risk' : 'Normal'}
                  </Badge>
                </CardBody>
              </Card>
            ))}
          </div>
        </section>
      )}

      {consults.length > 0 && (
        <section className="mb-6">
          <p className="text-caption text-muted mb-2">Doctor consultations</p>
          <div className="grid gap-2">
            {consults.map(c => (
              <Card key={c._id}>
                <CardBody className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-small font-medium text-ink">{c.doctorId?.name}</p>
                    <p className="text-caption text-muted mt-0.5">
                      {new Date(c.confirmedDate || c.requestedDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                      {c.timeSlot && ` · ${c.timeSlot}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={c.status === 'confirmed' ? 'success' : c.status === 'rejected' ? 'danger' : 'neutral'}>
                      {c.status}
                    </Badge>
                    {/* The worker joins the same room as the patient and the
                        doctor — this is what makes it assisted. */}
                    {c.status === 'confirmed' && (
                      <Button size="sm" onClick={() => navigate(`/health-worker/call/${c._id}`)}>Join</Button>
                    )}
                  </div>
                </CardBody>
              </Card>
            ))}
          </div>
        </section>
      )}

      {referrals.length > 0 && (
        <section className="mb-6">
          <p className="text-caption text-muted mb-2">Referrals</p>
          <div className="grid gap-2">
            {referrals.map(rf => (
              <Card key={rf._id} interactive>
                <CardBody className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-small font-medium text-ink">{rf.toFacilityId?.name}</p>
                    <p className="text-caption text-muted mt-0.5 tabular">{rf.referralId} · {rf.reason}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={STATUS_TONE[rf.status]}>{niceLabel(rf.status)}</Badge>
                    <Button size="sm" variant="secondary"
                            onClick={() => navigate(`/health-worker/referrals/${rf._id}`)}>Open</Button>
                  </div>
                </CardBody>
              </Card>
            ))}
          </div>
        </section>
      )}

      <p className="text-caption text-muted mb-2">Visits ({visits.length})</p>

      {visits.length === 0 ? (
        <EmptyState title="No visits yet" message="Record the first home visit for this patient." />
      ) : (
        <div className="grid gap-3">
          {visits.map(v => (
            <Card key={v._id}>
              <CardBody>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-small font-medium text-ink">
                      {new Date(v.occurredAt || v.createdAt).toLocaleString('en-IN', {
                        day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
                      })}
                    </p>
                    <p className="text-caption text-muted mt-0.5">
                      {String(v.type || '').replace(/_/g, ' ')}
                      {v.authorId?.name && ` · ${v.authorId.name}`}
                      {v.authorId?.workerType && ` (${v.authorId.workerType.toUpperCase()})`}
                    </p>
                  </div>
                  {v.dangerSigns?.length > 0 && (
                    <Badge tone="warning">{v.dangerSigns.length} danger sign{v.dangerSigns.length > 1 ? 's' : ''}</Badge>
                  )}
                </div>

                {summariseVitals(v.vitals) && (
                  <p className="text-small text-body mt-2 tabular">{summariseVitals(v.vitals)}</p>
                )}
                {v.notes && <p className="text-small text-muted mt-1.5">{v.notes}</p>}

                {v.dangerSigns?.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2.5">
                    {v.dangerSigns.map(code => (
                      <Badge key={code} tone={severityOf(code) === 'critical' ? 'danger' : 'warning'}>
                        {labelFor(code)}
                      </Badge>
                    ))}
                  </div>
                )}
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      {sheet === 'consult' && (
        <AskDoctor patient={patient} visits={visits} onClose={() => setSheet(null)}
                   onDone={() => { setSheet(null); toast.success('Consultation requested'); load() }} />
      )}

      {sheet === 'refer' && (
        <ReferPatient patient={patient} visits={visits} facilityId={profile?.facility?._id}
                      onClose={() => setSheet(null)}
                      onDone={() => { setSheet(null); toast.success('Referral created'); load() }} />
      )}

      {sheet === 'plan' && (
        <OpenCarePlan patient={patient} onClose={() => setSheet(null)}
                      onDone={() => { setSheet(null); toast.success('Care plan opened'); load() }} />
      )}

      {visiting && (
        <HomeVisitForm
          patient={patient}
          onClose={() => setVisiting(false)}
          onSaved={(result) => {
            setVisiting(false)
            toast.success(result.dangerSigns.length ? 'Visit saved — danger signs found' : 'Visit saved')
            load()
          }}
        />
      )}
    </Page>
  )
}

/**
 * The visit form.
 *
 * Every reading is optional. A worker who has a thermometer but no oximeter
 * fills in one box and leaves the rest, and a blank field is recorded as
 * "not measured" rather than quietly standing in for a normal result.
 */
function HomeVisitForm({ patient, onClose, onSaved }) {
  const [vitals, setVitals] = useState({})
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)

  const set = (key) => (e) => setVitals(v => ({ ...v, [key]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      const { data } = await api.post(`/health-worker/patients/${patient._id}/encounters`, {
        type: 'home_visit',
        vitals,
        notes,
        // The device's own clock, so a visit made offline keeps its real time
        // once this reaches the server.
        occurredAt: new Date().toISOString()
      })
      // Danger signs are shown before the sheet closes: the worker is standing
      // with the patient, and this is the moment it matters.
      if (data.dangerSigns.length) setResult(data)
      else onSaved(data)
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy(false)
    }
  }

  if (result) {
    return (
      <Modal open onClose={() => onSaved(result)} title="Danger sign detected">
        <div className="space-y-4">
          <Alert tone={result.alert.severity === 'critical' ? 'error' : 'warning'} title={result.alert.message}>
            <ul className="mt-1.5 space-y-1">
              {result.dangerSigns.map(s => (
                <li key={s.code} className="text-small">
                  {s.label}{s.severity === 'critical' ? ' — urgent' : ''}
                </li>
              ))}
            </ul>
          </Alert>

          {/* Said plainly, because the worker is not the person who decides
              what this means and should not be left feeling that they are. */}
          <p className="text-small text-muted">
            The visit has been saved. This is not a diagnosis — a doctor decides what happens next.
          </p>

          <div className="flex justify-end">
            <Button onClick={() => onSaved(result)}>Done</Button>
          </div>
        </div>
      </Modal>
    )
  }

  return (
    <Modal open onClose={onClose} title={`Home visit — ${patient.name}`} size="lg">
      <form onSubmit={submit} className="space-y-4">
        <p className="text-caption text-muted">
          Fill in only what you measured. Leave the rest blank.
        </p>

        <div className="grid grid-cols-2 gap-3">
          {VITAL_FIELDS.map(f => (
            <Field key={f.key} label={`${f.label} (${f.unit})`}>
              {(props) => (
                <Input
                  {...props}
                  type="number"
                  step={f.step}
                  inputMode="decimal"
                  value={vitals[f.key] ?? ''}
                  onChange={set(f.key)}
                />
              )}
            </Field>
          ))}
        </div>

        <Field label="Observations" hint="What the patient told you, in any language">
          {(props) => <Textarea {...props} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />}
        </Field>

        {error && <p className="error-text" role="alert">{error}</p>}

        <div className="flex gap-2 justify-end pt-1">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save visit'}</Button>
        </div>
      </form>
    </Modal>
  )
}

/* ──────────────── Ask a doctor (assisted consultation) ──────────────── */

const SLOTS = [
  '09:00-10:00', '10:00-11:00', '11:00-12:00', '12:00-13:00',
  '14:00-15:00', '15:00-16:00', '16:00-17:00', '17:00-18:00'
]

/**
 * The worker presents a case they have already examined.
 *
 * The encounter is attached rather than retyped: the doctor gets the vitals
 * and danger signs as the worker recorded them, which is the entire point of
 * an assisted consultation as opposed to a patient dialling a stranger.
 */
function AskDoctor({ patient, visits, onClose, onDone }) {
  const [doctors, setDoctors] = useState([])
  const [form, setForm] = useState({
    doctorId: '', requestedDate: '', timeSlot: SLOTS[1],
    encounterId: visits[0]?._id || '', symptoms: ''
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    api.get('/users/doctors').then(({ data }) => {
      setDoctors(data)
      setForm(f => ({ ...f, doctorId: f.doctorId || data[0]?._id || '' }))
    }).catch(() => {})
  }, [])

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault()
    setError(''); setBusy(true)
    try {
      await api.post(`/health-worker/patients/${patient._id}/consultations`, {
        ...form,
        requestedDate: new Date(form.requestedDate).toISOString()
      })
      onDone()
    } catch (err) {
      setError(friendlyError(err)); setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={`Ask a doctor about ${patient.name}`}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Doctor" required>
          {(p) => (
            <Select {...p} value={form.doctorId} onChange={set('doctorId')} required>
              {doctors.map(d => (
                <option key={d._id} value={d._id}>
                  {d.name}{d.specialization ? ` · ${d.specialization}` : ''}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Date" required>
            {(p) => <Input {...p} type="date" value={form.requestedDate} onChange={set('requestedDate')} required />}
          </Field>
          <Field label="Time">
            {(p) => (
              <Select {...p} value={form.timeSlot} onChange={set('timeSlot')}>
                {SLOTS.map(sl => <option key={sl} value={sl}>{sl}</option>)}
              </Select>
            )}
          </Field>
        </div>

        <Field label="Attach a visit" hint="The doctor sees the vitals and danger signs from it.">
          {(p) => (
            <Select {...p} value={form.encounterId} onChange={set('encounterId')}>
              <option value="">None</option>
              {visits.map(v => (
                <option key={v._id} value={v._id}>
                  {new Date(v.occurredAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                  {v.dangerSigns?.length ? ` — ${v.dangerSigns.length} danger sign(s)` : ''}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field label="What do you want the doctor to look at?">
          {(p) => <Textarea {...p} rows={2} value={form.symptoms} onChange={set('symptoms')} />}
        </Field>

        {error && <p className="error-text" role="alert">{error}</p>}
        <div className="flex gap-2 justify-end">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? 'Sending…' : 'Request'}</Button>
        </div>
      </form>
    </Modal>
  )
}

/* ─────────────────────────── Care plan ─────────────────────────── */

const PLAN_TYPES = [
  ['anc', 'Pregnancy (antenatal)'],
  ['pnc', 'After delivery (postnatal)'],
  ['child_0_5', 'Child under 5'],
  ['hypertension', 'High blood pressure'],
  ['diabetes', 'Diabetes']
]

function OpenCarePlan({ patient, onClose, onDone }) {
  const [type, setType] = useState('anc')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    setError(''); setBusy(true)
    try {
      await api.post(`/health-worker/patients/${patient._id}/care-plans`, { type })
      onDone()
    } catch (err) {
      setError(friendlyError(err)); setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={`Care plan for ${patient.name}`}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Type of follow-up" required>
          {(p) => (
            <Select {...p} value={type} onChange={(e) => setType(e.target.value)}>
              {PLAN_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
          )}
        </Field>
        {/* Said plainly: the plan schedules visits, it does not assess anyone.
            Risk is computed from readings already recorded. */}
        <p className="text-small text-muted">
          This adds the follow-up visits to your worklist with dates. Risk is worked out
          from the vitals already recorded — it is not a clinical assessment.
        </p>
        {error && <p className="error-text" role="alert">{error}</p>}
        <div className="flex gap-2 justify-end">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? 'Opening…' : 'Open plan'}</Button>
        </div>
      </form>
    </Modal>
  )
}

/* ─────────────────────── Referrals (worker view) ─────────────────────── */

function WorkerReferrals() {
  const navigate = useNavigate()
  const [referrals, setReferrals] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api.get('/referrals')
      .then(({ data }) => setReferrals(data))
      .catch(e => { setError(friendlyError(e)); setReferrals([]) })
  }, [])

  return (
    <Page title="Referrals" description="Sent from and received by your facility">
      {/* One state at a time. Setting an empty list on failure meant the page
          said "we couldn't load this" and "no referrals" at once — one of them
          claiming it broke, the other claiming there is nothing to show. */}
      {error ? <ErrorState message={error} />
        : !referrals ? <Loading /> : referrals.length === 0 ? (
        <EmptyState title="No referrals" message="Referrals involving your facility will appear here." />
      ) : (
        <div className="grid gap-3">
          {referrals.map(r => {
            const late = !['completed', 'declined', 'lapsed', 'redirected'].includes(r.status) &&
              new Date(r.dueBy) < new Date()
            return (
              <Card key={r._id} interactive>
                <CardBody className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-ink font-medium">{r.patientId?.name}</p>
                    <p className="text-small text-muted mt-0.5">
                      {r.fromFacilityId?.name} → {r.toFacilityId?.name}
                    </p>
                    <p className="text-caption text-muted mt-0.5 tabular">{r.referralId} · {r.reason}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {late && <Badge tone="danger">Overdue</Badge>}
                    <Badge tone={STATUS_TONE[r.status]}>{niceLabel(r.status)}</Badge>
                    <Button size="sm" variant="secondary"
                            onClick={() => navigate(`/health-worker/referrals/${r._id}`)}>Open</Button>
                  </div>
                </CardBody>
              </Card>
            )
          })}
        </div>
      )}
    </Page>
  )
}

function WorkerReferralDetail() {
  const { referralId } = useParams()
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  const load = useCallback(() => {
    api.get(`/referrals/${referralId}`)
      .then(({ data }) => setData(data))
      .catch(e => setError(friendlyError(e)))
  }, [referralId])

  useEffect(() => { load() }, [load])

  if (error) return <div className="p-6"><ErrorState message={error} /></div>
  if (!data) return <div className="p-6"><Loading /></div>

  return (
    <Page title="Referral" description={data.referral.referralId} back="/health-worker/referrals">
      <ReferralDetail
        referral={data.referral}
        allowedTransitions={data.allowedTransitions}
        onChanged={load}
      />
    </Page>
  )
}

/**
 * The worker joins the consultation from the patient's side.
 *
 * Same room id as the doctor and the patient — the appointment — so this reuses
 * the existing WebRTC path exactly. Nothing about the call is new; what is new
 * is that somebody competent is holding the phone.
 */
function WorkerCall() {
  const { appointmentId } = useParams()
  const navigate = useNavigate()
  return (
    <div className="p-4">
      <VideoCall
        roomId={appointmentId}
        perspective="patient"
        onLeave={() => navigate(-1)}
      />
    </div>
  )
}

/* ─────────────────────────── Refer ─────────────────────────── */

const PRIORITIES = [
  ['emergency', 'Emergency — now'],
  ['urgent_24h', 'Urgent — within 24 hours'],
  ['urgent_72h', 'Urgent — within 3 days'],
  ['routine_7d', 'Routine — within a week'],
  ['routine_30d', 'Routine — within a month']
]

const TRANSPORT = [['own', 'Can travel themselves'], ['escort', 'Needs someone with them'], ['ambulance', 'Needs an ambulance']]

/**
 * Sending a patient somewhere that can help.
 *
 * The clinical summary is prefilled from the visit rather than retyped — a
 * worker standing at a door will not write it twice, and a referral assembled
 * from the record is the difference between this and a paper slip. The
 * destination is filtered by what the case needs and chosen by the worker;
 * nothing picks it for them.
 */
function ReferPatient({ patient, visits, facilityId, onClose, onDone }) {
  const withSigns = visits.find(v => v.dangerSigns?.length) || visits[0]
  const [form, setForm] = useState({
    toFacilityId: '',
    priority: withSigns?.dangerSigns?.length ? 'urgent_24h' : 'routine_7d',
    reason: '',
    clinicalSummary: summarise(withSigns, patient),
    requiredTests: '',
    transportNeed: 'own',
    encounterId: withSigns?._id || ''
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault()
    setError(''); setBusy(true)
    try {
      await api.post('/referrals', {
        patientId: patient._id,
        toFacilityId: form.toFacilityId,
        encounterId: form.encounterId || undefined,
        priority: form.priority,
        reason: form.reason,
        clinicalSummary: form.clinicalSummary,
        requiredTests: form.requiredTests.split(',').map(t => t.trim()).filter(Boolean),
        transportNeed: form.transportNeed
      })
      onDone()
    } catch (err) {
      setError(friendlyError(err)); setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={`Refer ${patient.name}`} size="lg">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Where to" required>
          {() => <FacilityPicker value={form.toFacilityId} excludeId={facilityId}
                                 onChange={(id) => setForm(f => ({ ...f, toFacilityId: id }))} />}
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="How urgent" required>
            {(p) => (
              <Select {...p} value={form.priority} onChange={set('priority')}>
                {PRIORITIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Getting there">
            {(p) => (
              <Select {...p} value={form.transportNeed} onChange={set('transportNeed')}>
                {TRANSPORT.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </Select>
            )}
          </Field>
        </div>

        <Field label="Why" required>
          {(p) => <Input {...p} value={form.reason} onChange={set('reason')} required
                         placeholder="e.g. Raised BP in pregnancy" />}
        </Field>

        <Field label="What the destination should know" hint="Filled in from the visit — edit if needed.">
          {(p) => <Textarea {...p} rows={3} value={form.clinicalSummary} onChange={set('clinicalSummary')} />}
        </Field>

        {/* Tests done before travelling turn two journeys into one, which is
            where most of the "reduced travel" actually comes from. */}
        <Field label="Tests needed" hint="Comma separated. If these can be done first, the patient travels once.">
          {(p) => <Input {...p} value={form.requiredTests} onChange={set('requiredTests')}
                         placeholder="CBC, Urine protein" />}
        </Field>

        {error && <p className="error-text" role="alert">{error}</p>}
        <div className="flex gap-2 justify-end">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy || !form.toFacilityId}>{busy ? 'Sending…' : 'Send referral'}</Button>
        </div>
      </form>
    </Modal>
  )
}

/** Prefill from the most relevant visit, so nothing is typed twice. */
function summarise(visit, patient) {
  if (!visit) return ''
  const bits = [`${patient.name}, ${patient.age || '?'}y.`]
  const v = visit.vitals || {}
  const readings = []
  if (v.systolic) readings.push(`BP ${v.systolic}/${v.diastolic}`)
  if (v.pulse) readings.push(`pulse ${v.pulse}`)
  if (v.temperature) readings.push(`temp ${v.temperature}C`)
  if (v.spo2) readings.push(`SpO2 ${v.spo2}%`)
  if (v.hemoglobin) readings.push(`Hb ${v.hemoglobin}`)
  if (v.bloodSugar) readings.push(`glucose ${v.bloodSugar}`)
  if (readings.length) {
    bits.push(`On ${new Date(visit.occurredAt).toLocaleDateString('en-IN')}: ${readings.join(', ')}.`)
  }
  if (visit.notes) bits.push(visit.notes)
  return bits.join(' ')
}

/**
 * The whole history in one place — the answer to a worker having to open five
 * screens to find out what has already been done for someone.
 */
function PatientTimelineRoute() {
  const { patientId } = useParams()
  const [patient, setPatient] = useState(null)

  useEffect(() => {
    api.get(`/health-worker/patients/${patientId}`)
      .then(({ data }) => setPatient(data))
      .catch(() => {})
  }, [patientId])

  return (
    <Page
      title={patient?.name || 'Patient history'}
      description={patient ? [patient.age && `${patient.age}y`, patient.gender, patient.village].filter(Boolean).join(' · ') : ''}
      back={`/health-worker/patients/${patientId}`}
    >
      <PatientTimeline patientId={patientId} />
    </Page>
  )
}
