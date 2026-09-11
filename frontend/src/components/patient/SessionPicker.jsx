import React, { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import api from '../../services/api'
import { upcomingDays, dayLabel } from '../../lib/slots'
import Skeleton from '../ui/Skeleton'

/**
 * Pick a day, then a session.
 *
 * Sessions replace the hour-picking for doctors who run them: a patient is
 * told "afternoon clinic" and given a queue number later, which is how the
 * clinic actually works. A doctor with no sessions configured falls back to
 * the slot picker, so nothing changes for them.
 *
 * Full and closed sessions are shown, not hidden — seeing that the morning
 * closed at ten is what makes the afternoon a choice rather than a mystery.
 */
export default function SessionPicker({ doctorId, value, onChange, error }) {
  const { t, i18n } = useTranslation()
  const [days] = useState(() => upcomingDays(7))
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)

  const selectedDay = value?.date || days[0].iso

  const load = useCallback(async () => {
    if (!doctorId || !selectedDay) return
    setLoading(true)
    try {
      const res = await api.get(`/sessions/doctor/${doctorId}`, { params: { date: selectedDay } })
      setData(res.data)
    } catch {
      setData({ sessions: [] })
    } finally { setLoading(false) }
  }, [doctorId, selectedDay])
  useEffect(() => { load() }, [load])

  const pickDay = (iso) => onChange({ date: iso, sessionId: '', sessionName: '' })
  const pick = (s) => onChange({ date: selectedDay, sessionId: s.sessionId, sessionName: s.name })

  /**
   * The doctor's own "09:00", not a converted instant.
   *
   * startsAt/endsAt are built in UTC to match how appointment dates are
   * stored, so rendering them through toLocaleTimeString shifted a 9 AM clinic
   * to 2:30 PM on a +05:30 machine. The wall-clock string the doctor typed is
   * what both of them mean, and it is what the doctor's own page shows.
   */
  const clock = (hhmm) => {
    const [h, m] = String(hhmm || '').split(':').map(Number)
    if (!Number.isFinite(h)) return ''
    const suffix = h < 12 ? 'AM' : 'PM'
    const twelve = h % 12 === 0 ? 12 : h % 12
    return `${twelve}:${String(m || 0).padStart(2, '0')} ${suffix}`
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="label mb-2">{t('appointments.pickDay')}</p>
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
          {days.map(day => {
            const active = day.iso === selectedDay
            return (
              <button key={day.iso} type="button" onClick={() => pickDay(day.iso)} aria-pressed={active}
                className={`shrink-0 min-w-[4.5rem] px-3 py-2.5 rounded-card border text-center transition-colors
                  ${active ? 'border-primary-500 bg-primary-50 text-primary-700'
                           : 'border-line bg-surface hover:border-primary-200'}`}>
                <span className="block text-caption text-muted">{dayLabel(day, i18n.language, t)}</span>
                <span className={`block text-small font-semibold ${active ? 'text-primary-700' : 'text-ink'}`}>
                  {day.date.getDate()}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      <div>
        <p className="label mb-2">{t('sessions.pick')}</p>

        {loading || !data ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {[0, 1].map(i => <Skeleton key={i} className="h-20 rounded-card" />)}
          </div>
        ) : data.sessions.length === 0 ? (
          <p className="hint">{t('sessions.noneThatDay')}</p>
        ) : (
          <div role="radiogroup" aria-label={t('sessions.pick')} className="grid gap-2 sm:grid-cols-2">
            {data.sessions.map(s => {
              const chosen = value?.sessionId === s.sessionId
              return (
                <button
                  key={s.sessionId} type="button" role="radio" aria-checked={chosen}
                  disabled={!s.bookable} onClick={() => pick(s)}
                  className={`text-left p-3.5 rounded-card border transition-colors min-h-touch
                    ${!s.bookable ? 'border-line-soft bg-surface-2 text-muted cursor-not-allowed'
                      : chosen ? 'border-primary-500 bg-primary-50'
                      : 'border-line bg-surface hover:border-primary-300'}`}
                >
                  <span className={`block text-small font-semibold ${chosen ? 'text-primary-700' : 'text-ink'}`}>
                    {s.name}
                  </span>
                  <span className="block text-caption text-muted">
                    {clock(s.startTime)} – {clock(s.endTime)}
                  </span>
                  <span className="block text-caption mt-1">
                    {s.status === 'open' ? t('sessions.placesLeft', { count: s.remaining })
                      : s.status === 'full' ? t('sessions.full')
                      : t('sessions.closed')}
                  </span>
                </button>
              )
            })}
          </div>
        )}

        {/* Said before booking, so the absence of a number afterwards is
            expected rather than alarming. */}
        {data?.sessions?.some(s => s.bookable) && (
          <p className="hint mt-2">{t('sessions.queueLater')}</p>
        )}
        {error && <p className="error-text mt-2">{error}</p>}
      </div>
    </div>
  )
}
