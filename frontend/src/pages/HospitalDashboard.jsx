import React, { useState, useEffect, useCallback } from 'react'
import { Routes, Route, Navigate, useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import ReferralDetail, { STATUS_TONE } from '../components/referral/ReferralDetail'
import CoordinationPanel from '../components/agents/CoordinationPanel'
import Badge from '../components/ui/Badge'
import { Loading } from '../components/ui/States'
import api, { friendlyError } from '../services/api'
import { useToast } from '../components/ui/Toast'
import Page from '../components/app/Page'
import Card, { CardBody, CardHeader } from '../components/ui/Card'
import Button from '../components/ui/Button'
import Avatar from '../components/ui/Avatar'
import Modal from '../components/ui/Modal'
import ConfirmDialog from '../components/ui/ConfirmDialog'
import { Field, Input, Select } from '../components/ui/Field'
import { SkeletonList } from '../components/ui/Skeleton'
import { EmptyState, ErrorState } from '../components/ui/States'

/**
 * Now uses the shared page shell — it previously rendered its own H1 and
 * its own Logout button directly under the navbar's, and leaned on
 * `btn-danger` and `btn-sm`, neither of which existed, so every remove
 * button rendered as unstyled text.
 */
/**
 * The facility area. Profile as before, plus the referral inbox — the queue of
 * patients other facilities have sent here, which is the destination half of
 * the referral loop.
 */
export default function HospitalDashboard() {
  return (
    <Routes>
      <Route index element={<FacilityOverview />} />
      <Route path="profile" element={<HospitalProfile />} />
      <Route path="coordination" element={<CoordinationRoute />} />
      <Route path="referrals" element={<ReferralInbox />} />
      <Route path="referrals/:referralId" element={<FacilityReferralDetail />} />
      <Route path="*" element={<Navigate to="/hospital" replace />} />
    </Routes>
  )
}

function HospitalProfile() {
  const { t } = useTranslation()
  const toast = useToast()

  const [hospital, setHospital] = useState(null)
  const [doctors, setDoctors] = useState([])
  const [pharmacies, setPharmacies] = useState([])
  const [availablePharmacies, setAvailablePharmacies] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)

  const [doctorOpen, setDoctorOpen] = useState(false)
  const [pharmacyOpen, setPharmacyOpen] = useState(false)
  const [doctorEmail, setDoctorEmail] = useState('')
  const [pharmacyId, setPharmacyId] = useState('')
  const [busy, setBusy] = useState(false)
  const [removeTarget, setRemoveTarget] = useState(null)

  const load = useCallback(async () => {
    setLoadError(false)
    try {
      const { data } = await api.get('/hospital/my/profile')
      setHospital(data)
      setDoctors(data.doctors || [])
      setPharmacies(data.pharmacies || [])

      const all = await api.get('/pharmacy/all')
      setAvailablePharmacies(
        (all.data || []).filter(p => !(data.pharmacies || []).some(existing => existing._id === p._id))
      )
    } catch (err) {
      console.error('Failed to load hospital data:', err)
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const addDoctor = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      const { data } = await api.get('/users/doctors')
      const doctor = (data || []).find(d => d.email?.toLowerCase() === doctorEmail.trim().toLowerCase())
      if (!doctor) {
        toast.error(t('hospital.doctorNotFound'))
        return
      }
      await api.post('/hospital/doctors/add', { doctorId: doctor._id })
      toast.success(t('hospital.doctorAdded'))
      setDoctorEmail('')
      setDoctorOpen(false)
      load()
    } catch (err) {
      console.error('Add doctor failed:', err)
      toast.error(friendlyError(err))
    } finally {
      setBusy(false)
    }
  }

  const addPharmacy = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      await api.post('/hospital/pharmacies/add', { pharmacyId })
      toast.success(t('hospital.pharmacyAdded'))
      setPharmacyId('')
      setPharmacyOpen(false)
      load()
    } catch (err) {
      console.error('Add pharmacy failed:', err)
      toast.error(friendlyError(err))
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    setBusy(true)
    try {
      if (removeTarget.kind === 'doctor') {
        await api.delete('/hospital/doctors/remove', { data: { doctorId: removeTarget.id } })
        toast.success(t('hospital.doctorRemoved'))
      } else {
        await api.delete('/hospital/pharmacies/remove', { data: { pharmacyId: removeTarget.id } })
        toast.success(t('hospital.pharmacyRemoved'))
      }
      setRemoveTarget(null)
      load()
    } catch (err) {
      console.error('Remove failed:', err)
      toast.error(friendlyError(err))
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return <Page title={t('hospital.title')}><SkeletonList count={2} /></Page>
  }

  if (loadError) {
    return (
      <Page title={t('hospital.title')}>
        <Card><CardBody>
          <ErrorState title={t('hospital.loadError')} onRetry={load} retryLabel={t('common.retry')} />
        </CardBody></Card>
      </Page>
    )
  }

  return (
    <Page title={hospital?.name || t('hospital.title')} description={hospital?.address}>
      <div className="flex flex-col gap-5">
        <Card>
          <CardHeader><h2 className="card-title">{t('hospital.profile')}</h2></CardHeader>
          <CardBody>
            <dl className="grid gap-4 sm:grid-cols-2">
              {[
                [t('common.name'), hospital?.name],
                [t('common.email'), hospital?.email],
                [t('common.phone'), hospital?.phone],
                [t('hospital.address'), hospital?.address]
              ].map(([label, value]) => value ? (
                <div key={label}>
                  <dt className="text-caption font-semibold text-muted uppercase tracking-wide mb-0.5">{label}</dt>
                  <dd className="text-body break-words">{value}</dd>
                </div>
              ) : null)}
            </dl>
          </CardBody>
        </Card>

        <AssociationList
          title={t('hospital.doctors')}
          addLabel={t('hospital.addDoctor')}
          onAdd={() => setDoctorOpen(true)}
          items={doctors}
          emptyTitle={t('hospital.noDoctors')}
          emptyMessage={t('hospital.noDoctorsHelp')}
          renderMeta={(d) => [d.specialization, d.email].filter(Boolean).join(' · ')}
          onRemove={(d) => setRemoveTarget({ kind: 'doctor', id: d._id, name: d.name })}
          removeLabel={t('common.remove')}
        />

        <AssociationList
          title={t('hospital.pharmacies')}
          addLabel={t('hospital.addPharmacy')}
          onAdd={() => setPharmacyOpen(true)}
          items={pharmacies}
          emptyTitle={t('hospital.noPharmacies')}
          emptyMessage={t('hospital.noPharmaciesHelp')}
          renderMeta={(p) => [p.location, p.contact].filter(Boolean).join(' · ')}
          onRemove={(p) => setRemoveTarget({ kind: 'pharmacy', id: p._id, name: p.name })}
          removeLabel={t('common.remove')}
        />
      </div>

      <Modal
        open={doctorOpen} onClose={() => setDoctorOpen(false)}
        title={t('hospital.addDoctor')} description={t('hospital.addDoctorHelp')} size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDoctorOpen(false)}>{t('common.cancel')}</Button>
            <Button form="add-doctor" type="submit" loading={busy}>{t('common.add')}</Button>
          </>
        }
      >
        <form id="add-doctor" onSubmit={addDoctor}>
          <Field label={t('common.email')} required>
            {(props) => (
              <Input {...props} type="email" required autoComplete="off"
                placeholder={t('auth.emailPlaceholder')}
                value={doctorEmail} onChange={(e) => setDoctorEmail(e.target.value)} />
            )}
          </Field>
        </form>
      </Modal>

      <Modal
        open={pharmacyOpen} onClose={() => setPharmacyOpen(false)}
        title={t('hospital.addPharmacy')} size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setPharmacyOpen(false)}>{t('common.cancel')}</Button>
            <Button form="add-pharmacy" type="submit" loading={busy} disabled={!pharmacyId}>{t('common.add')}</Button>
          </>
        }
      >
        <form id="add-pharmacy" onSubmit={addPharmacy}>
          <Field label={t('hospital.pharmacies')} required>
            {(props) => (
              <Select {...props} required value={pharmacyId} onChange={(e) => setPharmacyId(e.target.value)}>
                <option value="">{t('hospital.choosePharmacy')}</option>
                {availablePharmacies.map(p => (
                  <option key={p._id} value={p._id}>{p.name} — {p.location}</option>
                ))}
              </Select>
            )}
          </Field>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(removeTarget)}
        onClose={() => setRemoveTarget(null)}
        onConfirm={remove}
        loading={busy}
        title={t('hospital.removeTitle')}
        message={t('hospital.removeMessage', { name: removeTarget?.name || '' })}
        confirmLabel={t('common.remove')}
        cancelLabel={t('common.cancel')}
      />
    </Page>
  )
}

/** Cards on mobile, a list on desktop — the old raw tables forced the
 *  whole page to scroll sideways on a phone. */
function AssociationList({ title, addLabel, onAdd, items, emptyTitle, emptyMessage, renderMeta, onRemove, removeLabel }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="card-title">{title}</h2>
          <Button size="sm" onClick={onAdd}>{addLabel}</Button>
        </div>
      </CardHeader>
      <CardBody className={items.length ? 'p-0 sm:p-0' : ''}>
        {items.length === 0 ? (
          <EmptyState title={emptyTitle} message={emptyMessage} className="py-8" />
        ) : (
          <ul className="divide-y divide-line-soft">
            {items.map(item => (
              <li key={item._id} className="flex items-center gap-3 px-5 py-4">
                <Avatar name={item.name} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-ink truncate">{item.name}</p>
                  <p className="text-caption text-muted truncate">{renderMeta(item)}</p>
                </div>
                <Button variant="ghost" size="sm" className="text-danger-500 shrink-0" onClick={() => onRemove(item)}>
                  {removeLabel}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  )
}

/* ─────────────────── Referral inbox (destination side) ─────────────────── */

const label = (v) => String(v || '').replace(/_/g, ' ')

/**
 * What other facilities have sent us.
 *
 * Split by whether anyone here has responded yet, because an unacknowledged
 * referral is the failure this system exists to make visible — on paper it is
 * simply a slip nobody at this end ever knew about.
 */
function ReferralInbox() {
  const navigate = useNavigate()
  const [referrals, setReferrals] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api.get('/referrals')
      .then(({ data }) => setReferrals(data))
      .catch(e => { setError(friendlyError(e)); setReferrals([]) })
  }, [])

  if (error) return <Page title="Referrals"><ErrorState message={error} /></Page>
  if (!referrals) return <Page title="Referrals"><Loading /></Page>

  const now = Date.now()
  const open = referrals.filter(r => !['completed', 'declined', 'lapsed', 'redirected'].includes(r.status))
  const closed = referrals.filter(r => ['completed', 'declined', 'lapsed', 'redirected'].includes(r.status))
  const waiting = open.filter(r => r.status === 'created')

  const Row = ({ r }) => {
    const late = !['completed', 'declined', 'lapsed', 'redirected'].includes(r.status) && new Date(r.dueBy) < now
    return (
      <Card interactive>
        <CardBody className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-ink font-medium">{r.patientId?.name}</p>
            <p className="text-small text-muted mt-0.5">from {r.fromFacilityId?.name} · {r.reason}</p>
            <p className="text-caption text-muted mt-0.5 tabular">{r.referralId}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {late && <Badge tone="danger">Overdue</Badge>}
            <Badge tone={r.priority?.startsWith('urgent') || r.priority === 'emergency' ? 'danger' : 'neutral'}>
              {label(r.priority)}
            </Badge>
            <Badge tone={STATUS_TONE[r.status]}>{label(r.status)}</Badge>
            <Button size="sm" variant="secondary"
                    onClick={() => navigate(`/hospital/referrals/${r._id}`)}>Open</Button>
          </div>
        </CardBody>
      </Card>
    )
  }

  return (
    <Page title="Referrals" description={`${open.length} open · ${waiting.length} not yet acknowledged`}>
      {referrals.length === 0 ? (
        <EmptyState title="No referrals" message="Referrals sent to this facility will appear here." />
      ) : (
        <div className="space-y-6">
          {open.length > 0 && (
            <section>
              <p className="text-caption text-muted mb-2">Open ({open.length})</p>
              <div className="grid gap-3">{open.map(r => <Row key={r._id} r={r} />)}</div>
            </section>
          )}
          {closed.length > 0 && (
            <section>
              <p className="text-caption text-muted mb-2">Closed ({closed.length})</p>
              <div className="grid gap-3">{closed.map(r => <Row key={r._id} r={r} />)}</div>
            </section>
          )}
        </div>
      )}
    </Page>
  )
}

function FacilityReferralDetail() {
  const { referralId } = useParams()
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  const load = useCallback(() => {
    api.get(`/referrals/${referralId}`)
      .then(({ data }) => setData(data))
      .catch(e => setError(friendlyError(e)))
  }, [referralId])

  useEffect(() => { load() }, [load])

  if (error) return <Page title="Referral"><ErrorState message={error} /></Page>
  if (!data) return <Page title="Referral"><Loading /></Page>

  return (
    <Page title="Referral" description={data.referral.referralId} back="/hospital/referrals">
      <ReferralDetail
        referral={data.referral}
        allowedTransitions={data.allowedTransitions}
        onChanged={load}
      />
    </Page>
  )
}

/* ─────────────────── Operational dashboard ─────────────────── */

/**
 * What this facility has to deal with today.
 *
 * Three groups, in the order they matter: what is already late, what is
 * waiting on us, and what is happening today. Every number opens into the
 * list behind it, because a count you cannot act on is decoration.
 */
function FacilityOverview() {
  const navigate = useNavigate()
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api.get('/facility/dashboard')
      .then(({ data }) => setData(data))
      .catch(e => setError(friendlyError(e)))
  }, [])

  if (error) return <Page title="Overview"><ErrorState message={error} /></Page>
  if (!data) return <Page title="Overview"><SkeletonList count={3} /></Page>

  const { needsAttention: n, pending: p, today: td, sent, patients } = data

  return (
    <Page
      title="Overview"
      description="Referrals and work needing this facility today"
      actions={<Button variant="secondary" size="sm" onClick={() => navigate('/hospital/profile')}>Facility profile</Button>}
    >
      <div className="space-y-8">
        <Group
          dot="🔴" title="Needs attention"
          stats={[
            ['Overdue referrals', n.overdueReferrals, 'danger'],
            ['Missed', n.missedReferrals, n.missedReferrals ? 'danger' : 'neutral'],
            ['Urgent open', n.urgentReferrals, n.urgentReferrals ? 'danger' : 'neutral'],
            ['Overdue tasks', n.overdueTasks, n.overdueTasks ? 'danger' : 'neutral']
          ]}
          list={data.lists.needsAttention}
          emptyText="Nothing overdue or urgent."
          navigate={navigate}
        />

        <Group
          dot="🟡" title="Waiting on us"
          stats={[
            ['Awaiting acknowledgement', p.awaitingAcknowledgement, p.awaitingAcknowledgement ? 'warning' : 'neutral'],
            ['Pending consultations', p.pendingConsultations, 'neutral'],
            ['High-priority tasks', p.highPriorityTasks, 'neutral'],
            ['Open tasks', p.openTasks, 'neutral']
          ]}
          list={data.lists.awaitingAcknowledgement}
          emptyText="Every referral sent here has been acknowledged."
          navigate={navigate}
        />

        <Group
          dot="🟢" title="Today"
          stats={[
            ['Scheduled referrals', td.scheduledReferrals, 'neutral'],
            ["Today's consultations", td.todaysConsultations, 'neutral'],
            ['Completed referrals', td.completedReferrals, 'neutral'],
            ['High-risk patients', patients.highRiskPlans, patients.highRiskPlans ? 'warning' : 'neutral']
          ]}
          list={data.lists.todayScheduled}
          emptyText="Nothing scheduled here today."
          navigate={navigate}
        />

        {/* What we sent elsewhere — the other half of the loop, which a
            facility usually has no way of following at all. */}
        <section>
          <p className="text-caption text-muted mb-2">Referrals we sent out</p>
          <div className="flex flex-wrap gap-2">
            <Stat label="Open" value={sent.open} />
            <Stat label="Overdue" value={sent.overdue} tone={sent.overdue ? 'danger' : 'neutral'} />
            <Stat label="Completed" value={sent.completed} />
          </div>
        </section>
      </div>
    </Page>
  )
}

function Group({ dot, title, stats, list, emptyText, navigate }) {
  return (
    <section>
      <p className="text-caption text-muted mb-2">{dot} {title}</p>
      <div className="flex flex-wrap gap-2 mb-3">
        {stats.map(([label, value, tone]) => <Stat key={label} label={label} value={value} tone={tone} />)}
      </div>
      {list.length === 0 ? (
        <p className="text-small text-muted">{emptyText}</p>
      ) : (
        <div className="grid gap-2">
          {list.map(r => (
            <Card key={r._id}>
              <CardBody className="py-3 flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-small font-medium text-ink">{r.patient}</p>
                  <p className="text-caption text-muted mt-0.5">
                    {[r.from, r.village, r.reason].filter(Boolean).join(' · ')}
                  </p>
                  <p className="text-caption text-muted mt-0.5 tabular">{r.referralId}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {r.overdue && <Badge tone="danger">Overdue</Badge>}
                  {r.missedReason && <Badge tone="warning">{String(r.missedReason).replace(/_/g, ' ')}</Badge>}
                  <Badge tone={STATUS_TONE[r.status]}>{String(r.status).replace(/_/g, ' ')}</Badge>
                  <Button size="sm" variant="secondary"
                          onClick={() => navigate(`/hospital/referrals/${r._id}`)}>Open</Button>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </section>
  )
}

const Stat = ({ label, value, tone = 'neutral' }) => (
  <div className="px-3 py-2 rounded-control bg-surface-2">
    <span className={`text-body font-semibold tabular ${tone === 'danger' ? 'text-danger-500' : tone === 'warning' ? 'text-warning-600' : 'text-ink'}`}>
      {value}
    </span>
    <span className="text-caption text-muted ml-1.5">{label}</span>
  </div>
)

/**
 * Care coordination — the agent review queue.
 *
 * Its own destination rather than a panel bolted onto the operational
 * dashboard: approving automated suggestions is a deliberate act, and burying
 * it under the day's referral counts would make it something people click
 * through rather than read.
 */
function CoordinationRoute() {
  return (
    <Page
      title="Care coordination"
      description="Follow-up suggested by agents. Nothing happens until you approve it."
    >
      <CoordinationPanel />
    </Page>
  )
}
