import React, { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import api from '../../services/api'
import Button from '../ui/Button'
import { slotLabel } from '../../lib/slots'

/**
 * Where the patient stands in the day's queue.
 *
 * Read-only, and deliberately incurious: the server already knows the order,
 * so this asks and renders. It never sorts, never scores and never books.
 *
 * The response also carries the priority tier that put somebody where they
 * are, and none of it is shown. "You are higher up because of your pregnancy"
 * is true, useful to a clinician, and nobody's business on a phone screen
 * being read over a patient's shoulder — so this shows a number and a time,
 * which is what the person waiting actually wants to know.
 */

/** Only these two are in the queue at all; the rest have left it. */
const ACTIVE = ['pending', 'confirmed']

const ALT_LABEL = {
  same_doctor_today: 'sameDoctorToday',
  same_doctor_later_day: 'sameDoctorLaterDay',
  same_specialization_same_facility: 'sameFacility',
  same_specialization_other_facility: 'otherFacility'
}

export default function QueueStatus({ appointment }) {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const [data, setData] = useState(null)
  const [failed, setFailed] = useState(false)

  const doctorId = appointment?.doctorId?._id || appointment?.doctorId
  // The stored day, as the server wrote it. Slicing the ISO string keeps the
  // UTC date the appointment was pinned to rather than re-deriving a local one.
  const day = String(appointment?.confirmedDate || appointment?.requestedDate || '').slice(0, 10)
  const active = ACTIVE.includes(appointment?.status)

  const load = useCallback(async () => {
    if (!active || !doctorId || !day) return
    setFailed(false)
    try {
      const res = await api.get('/appointments/queue', { params: { doctorId, date: day } })
      setData(res.data)
    } catch {
      // The appointment itself is already on screen; a missing queue reading
      // is not worth an error banner over the top of it.
      setFailed(true)
    }
  }, [active, doctorId, day])

  // Fetched when the card appears and whenever the appointment changes.
  // No polling: a queue that quietly re-reads itself every few seconds costs
  // the patient data they are paying for, to move a number they are not
  // watching.
  useEffect(() => { load() }, [load])

  /**
   * A session booking has no position until its cutoff. Saying so is the whole
   * point — an empty space where a number should be reads as a fault, and a
   * patient who was told a number is coming will not go looking for one.
   */
  if (active && appointment?.sessionId && !appointment?.queuePosition) {
    return (
      <div className="rounded-card border border-line bg-surface-2 p-4 flex flex-col gap-1.5">
        <p className="text-caption text-muted uppercase tracking-wide">{t('queue.title')}</p>
        <p className="text-small text-body">{t('queue.pendingSession')}</p>
      </div>
    )
  }

  /** Finalised: the stored number, not a live recomputation. */
  if (active && appointment?.queuePosition) {
    const arriveAt = appointment.estimatedArrivalTime
      ? new Date(appointment.estimatedArrivalTime).toLocaleTimeString(
          i18n.language === 'en' ? 'en-IN' : i18n.language, { hour: 'numeric', minute: '2-digit' })
      : null
    return (
      <div className="rounded-card border border-line bg-surface-2 p-4 flex flex-col gap-1.5">
        <p className="text-caption text-muted uppercase tracking-wide">{t('queue.title')}</p>
        <p className="text-h3 text-ink tabular">{t('queue.position', { n: appointment.queuePosition })}</p>
        {arriveAt && (
          <>
            <p className="text-small text-body">{t('queue.arriveBy', { time: arriveAt })}</p>
            <p className="text-caption text-muted">{t('queue.approx')}</p>
          </>
        )}
      </div>
    )
  }

  if (!active || failed || !data) return null

  const you = data.you
  const alternatives = data.alternatives || []
  const full = data.capacity?.remainingToday <= 0

  const clock = (iso) => {
    if (!iso) return null
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return null
    return d.toLocaleTimeString(i18n.language === 'en' ? 'en-IN' : i18n.language,
      { hour: 'numeric', minute: '2-digit' })
  }
  const at = clock(you?.estimatedAt)

  // Nothing worth a card: no place in the queue and nowhere else to suggest.
  if (!you && !alternatives.length) return null

  return (
    <div className="rounded-card border border-line bg-surface-2 p-4 flex flex-col gap-3">

      {you && (
        <div className="flex flex-col gap-1.5">
          <p className="text-caption text-muted uppercase tracking-wide">{t('queue.title')}</p>

          <p className="text-h3 text-ink tabular">
            {t('queue.position', { n: you.position })}
          </p>

          {you.aheadOfYou > 0 && (
            <p className="text-small text-body">{t('queue.ahead', { count: you.aheadOfYou })}</p>
          )}

          {/* Time only when the server actually gave one. Rather than guess a
              clock time, the position stands on its own. */}
          {at && (
            <>
              <p className="text-small text-body">{t('queue.eta', { time: at })}</p>
              <p className="text-caption text-muted">{t('queue.approx')}</p>
            </>
          )}
        </div>
      )}

      {full && alternatives.length > 0 && (
        <div className="flex flex-col gap-2 pt-1 border-t border-line-soft">
          <p className="text-small font-semibold text-ink">{t('queue.full')}</p>
          <p className="text-caption text-muted">{t('queue.alternatives')}</p>

          <ul className="flex flex-col gap-2 mt-1">
            {alternatives.map((alt, i) => (
              <li
                key={`${alt.doctorId}-${alt.date}-${i}`}
                className="flex items-center gap-3 p-3 rounded-control border border-line bg-surface"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-small font-medium text-ink truncate">{alt.doctorName}</p>
                  <p className="text-caption text-muted truncate">
                    {t(`queue.alt.${ALT_LABEL[alt.kind] || 'sameFacility'}`)}
                    {alt.slots?.[0] && ` · ${slotLabel(alt.slots[0], i18n.language)}`}
                  </p>
                </div>
                {/* Nothing is moved or booked here. This opens the ordinary
                    booking screen with that doctor chosen, and the patient
                    picks a time and submits exactly as they always would. */}
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => navigate('/patient/care/book', {
                    state: { doctor: { _id: alt.doctorId, name: alt.doctorName, specialization: alt.specialization } }
                  })}
                >
                  {t('queue.choose')}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
