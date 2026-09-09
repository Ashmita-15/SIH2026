import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import api from '../services/api'
import DoctorCard from '../components/DoctorCard'
import PageHeader from '../components/ui/PageHeader'
import Card, { CardBody } from '../components/ui/Card'
import { Field, Input, Select } from '../components/ui/Field'
import { SkeletonGrid } from '../components/ui/Skeleton'
import { EmptyState, ErrorState } from '../components/ui/States'

export default function DoctorsPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()

  const [doctorsBySpecialty, setDoctorsBySpecialty] = useState({})
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [query, setQuery] = useState('')
  const [specialty, setSpecialty] = useState('')

  const [voice, setVoice] = useState(null)
  // null = not decided yet, '' = they named one we do not have.
  const [matchedSpecialty, setMatchedSpecialty] = useState(null)

  /**
   * What the patient said on the way here.
   *
   * Keyed on the history entry rather than on mount, because asking for a
   * doctor again while already on this page navigates to the same route: React
   * Router pushes a new entry but does not remount, so a mount-time read
   * silently ignored every command after the first one.
   *
   * Reading `location.state` also scopes it correctly — it lives on one entry,
   * so a preference given while looking for a doctor cannot reappear on the
   * records or pharmacy screens. `for` is checked as a second line of defence.
   */
  useEffect(() => {
    const c = location.state?.voiceContext
    setVoice(c && c.for === 'FIND_DOCTOR' ? c : null)
    setMatchedSpecialty(null)
    setSpecialty('')
  }, [location.key]) // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(false)
    try {
      const { data } = await api.get('/users/doctors/specialization')
      setDoctorsBySpecialty(data || {})
    } catch (err) {
      console.error('Failed to load doctors:', err)
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const specialties = useMemo(() => Object.keys(doctorsBySpecialty).sort(), [doctorsBySpecialty])

  /**
   * A speciality the patient named is only honoured if it is one this
   * service actually has. Matching against the loaded list rather than a
   * hardcoded table means an unknown or invented value simply shows every
   * doctor instead of an empty page — and nothing here looks at symptoms.
   */
  useEffect(() => {
    if (matchedSpecialty !== null || !specialties.length) return
    const wanted = voice?.specialization?.trim().toLowerCase()
    if (!wanted) { setMatchedSpecialty(''); return }
    const hit = specialties.find(s => s.toLowerCase() === wanted)
    setMatchedSpecialty(hit || '')
    if (hit) setSpecialty(hit)
  }, [voice, specialties, matchedSpecialty])

  const clearVoice = () => {
    if (matchedSpecialty) setSpecialty('')
    setVoice(null)
  }

  // Nothing worth showing unless the patient actually told us something.
  const showVoiceNote = Boolean(voice && (voice.symptom || voice.preferredTime || voice.specialization))

  const doctors = useMemo(() => {
    const pool = specialty
      ? (doctorsBySpecialty[specialty] || [])
      : Object.values(doctorsBySpecialty).flat()
    const q = query.trim().toLowerCase()
    if (!q) return pool
    return pool.filter(d =>
      d.name?.toLowerCase().includes(q) ||
      d.specialization?.toLowerCase().includes(q)
    )
  }, [doctorsBySpecialty, specialty, query])

  // One profile, at /doctors/:id — the old "View details" opened a modal
  // that duplicated the whole page. What the patient said travels with them so
  // the booking form does not have to ask for it a second time.
  const openProfile = (doctor) => navigate(
    `/patient/care/doctors/${doctor._id}`,
    voice ? { state: { voiceContext: voice } } : undefined
  )

  return (
    <div className="container-app py-6 sm:py-8">
      <PageHeader title={t('doctors.title')} description={t('doctors.subtitle')} />

      {/* What we heard, and a way out of it. Shown as the patient's own words
          played back — never as a conclusion drawn from them. */}
      {showVoiceNote && (
        <Card className="mb-4 border-primary-200 bg-primary-50">
          <CardBody className="flex items-start gap-3 py-3.5">
            <div className="min-w-0 flex-1">
              <p className="text-caption text-muted mb-1">{t('doctors.voiceNote.title')}</p>
              <ul className="text-small text-body space-y-0.5">
                {voice.symptom && <li>{t('doctors.voiceNote.reason', { value: voice.symptom })}</li>}
                {voice.preferredTime && <li>{t('doctors.voiceNote.time', { value: t(`appointments.pref.${voice.preferredTime}`) })}</li>}
                {matchedSpecialty
                  ? <li>{t('doctors.voiceNote.specialty', { value: matchedSpecialty })}</li>
                  : voice.specialization && <li className="text-muted">{t('doctors.voiceNote.unmatched')}</li>}
              </ul>
            </div>
            <button
              type="button"
              onClick={clearVoice}
              className="shrink-0 text-small font-semibold text-primary-700 underline min-h-touch px-1"
            >
              {t('doctors.voiceNote.clear')}
            </button>
          </CardBody>
        </Card>
      )}

      <Card className="mb-6">
        <CardBody>
          <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
            <Field label={t('common.search')}>
              {(props) => (
                <Input
                  {...props} type="search" placeholder={t('doctors.searchPlaceholder')}
                  value={query} onChange={(e) => setQuery(e.target.value)}
                />
              )}
            </Field>
            <Field label={t('doctors.specialty')}>
              {(props) => (
                <Select {...props} value={specialty} onChange={(e) => setSpecialty(e.target.value)} className="sm:w-56">
                  <option value="">{t('doctors.allSpecialties')}</option>
                  {specialties.map(s => <option key={s} value={s}>{s}</option>)}
                </Select>
              )}
            </Field>
          </div>
        </CardBody>
      </Card>

      {loading ? (
        <SkeletonGrid count={6} />
      ) : loadError ? (
        <Card><CardBody>
          <ErrorState title={t('doctors.loadError')} onRetry={load} retryLabel={t('common.retry')} />
        </CardBody></Card>
      ) : doctors.length === 0 ? (
        <Card><CardBody>
          <EmptyState
            icon={
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
                <circle cx="11" cy="11" r="7" /><path strokeLinecap="round" d="M20 20l-3.5-3.5" />
              </svg>
            }
            title={t('doctors.empty')}
            message={t('doctors.emptyHelp')}
          />
        </CardBody></Card>
      ) : (
        <>
          <p className="text-small text-muted mb-4" role="status">
            {t('doctors.found', { count: doctors.length })}
          </p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {doctors.map(doctor => (
              <DoctorCard
                key={doctor._id}
                doctor={doctor}
                onView={openProfile}
                onBook={openProfile}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
