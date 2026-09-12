import React, { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import api, { friendlyError } from '../../services/api'
import { useToast } from '../ui/Toast'
import Card, { CardBody, CardHeader } from '../ui/Card'
import Button from '../ui/Button'
import { Field, Input } from '../ui/Field'
import { Loading, EmptyState, ErrorState } from '../ui/States'
import Alert from '../ui/Alert'

/**
 * The doctor's own consulting sessions.
 *
 * A session is what a rural OPD actually runs — "afternoon clinic, twenty
 * patients" — rather than an hour a patient guesses at. Configuring one here
 * is what makes session booking appear for patients; a doctor who configures
 * none keeps the hourly slots exactly as before.
 */

const DAYS = [
  { v: 1, k: 'mon' }, { v: 2, k: 'tue' }, { v: 3, k: 'wed' }, { v: 4, k: 'thu' },
  { v: 5, k: 'fri' }, { v: 6, k: 'sat' }, { v: 0, k: 'sun' }
]

const BLANK = { name: '', days: [], startTime: '14:00', endTime: '17:00', maxPatients: 20 }

export default function SessionSchedule() {
  const { t } = useTranslation()
  const toast = useToast()
  const [sessions, setSessions] = useState(null)
  const [error, setError] = useState('')
  const [draft, setDraft] = useState(BLANK)
  const [saving, setSaving] = useState(false)

  const load = useCallback(() => {
    setError('')
    api.get('/sessions/mine')
      .then(({ data }) => setSessions(data.sessions || []))
      .catch(e => { setError(friendlyError(e)); setSessions([]) })
  }, [])
  useEffect(() => { load() }, [load])

  const toggleDay = (v) => setDraft(d => ({
    ...d, days: d.days.includes(v) ? d.days.filter(x => x !== v) : [...d.days, v]
  }))

  const add = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      await api.post('/sessions', { ...draft, maxPatients: Number(draft.maxPatients) })
      toast.success(t('sessions.added'))
      setDraft(BLANK)
      load()
    } catch (err) {
      toast.error(friendlyError(err))
    } finally { setSaving(false) }
  }

  const retire = async (s) => {
    try {
      await api.delete(`/sessions/${s._id}`)
      toast.success(t('sessions.removed'))
      load()
    } catch (err) { toast.error(friendlyError(err)) }
  }

  const live = (sessions || []).filter(s => s.active)

  return (
    <div className="flex flex-col gap-5">
      {/* Booking is session-only, so a doctor with none is invisible to
          patients. Said plainly here rather than left to be discovered from an
          empty appointment list. */}
      {sessions && live.length === 0 && (
        <Alert tone="warning" title={t('sessions.onboardingTitle')}>
          {t('sessions.onboardingBody')}
        </Alert>
      )}

      <Card>
        <CardHeader><h2 className="section-title">{t('sessions.yours')}</h2></CardHeader>
        <CardBody>
          {error ? <ErrorState message={error} />
            : !sessions ? <Loading />
            : live.length === 0 ? <EmptyState title={t('sessions.none')} message={t('sessions.noneHelp')} />
            : (
              <ul className="flex flex-col gap-2.5">
                {live.map(s => (
                  <li key={s._id} className="flex items-center gap-3 p-3.5 rounded-card border border-line bg-surface">
                    <div className="min-w-0 flex-1">
                      <p className="text-small font-semibold text-ink truncate">{s.name}</p>
                      <p className="text-caption text-muted truncate">
                        {s.startTime}–{s.endTime} · {t('sessions.capacity', { count: s.maxPatients })} ·{' '}
                        {DAYS.filter(d => s.days.includes(d.v)).map(d => t(`sessions.day.${d.k}`)).join(', ')}
                      </p>
                    </div>
                    <Button variant="ghost" size="sm" className="text-danger-500" onClick={() => retire(s)}>
                      {t('sessions.remove')}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader><h2 className="section-title">{t('sessions.addTitle')}</h2></CardHeader>
        <CardBody>
          <form onSubmit={add} className="flex flex-col gap-4">
            <Field label={t('sessions.name')} required>
              {(p) => <Input {...p} value={draft.name} placeholder={t('sessions.namePlaceholder')}
                onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} />}
            </Field>

            <div>
              <p className="label mb-2">{t('sessions.days')}</p>
              <div className="flex flex-wrap gap-2">
                {DAYS.map(d => (
                  <button
                    key={d.v} type="button" onClick={() => toggleDay(d.v)}
                    aria-pressed={draft.days.includes(d.v)}
                    className={`px-3 py-2 rounded-control border text-small font-medium min-h-touch transition-colors
                      ${draft.days.includes(d.v)
                        ? 'border-primary-500 bg-primary-600 text-white'
                        : 'border-line bg-surface text-ink hover:border-primary-300'}`}
                  >
                    {t(`sessions.day.${d.k}`)}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid sm:grid-cols-3 gap-4">
              <Field label={t('sessions.from')} required>
                {(p) => <Input {...p} type="time" value={draft.startTime}
                  onChange={e => setDraft(d => ({ ...d, startTime: e.target.value }))} />}
              </Field>
              <Field label={t('sessions.to')} required>
                {(p) => <Input {...p} type="time" value={draft.endTime}
                  onChange={e => setDraft(d => ({ ...d, endTime: e.target.value }))} />}
              </Field>
              <Field label={t('sessions.maxPatients')} required>
                {(p) => <Input {...p} type="number" inputMode="numeric" min="1" max="200" value={draft.maxPatients}
                  onChange={e => setDraft(d => ({ ...d, maxPatients: e.target.value }))} />}
              </Field>
            </div>

            <p className="hint">{t('sessions.cutoffNote')}</p>
            <Button type="submit" loading={saving} className="self-start">{t('sessions.add')}</Button>
          </form>
        </CardBody>
      </Card>
    </div>
  )
}
