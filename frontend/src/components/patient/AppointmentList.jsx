import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import api, { friendlyError } from '../../services/api'
import { useToast } from '../ui/Toast'
import AppointmentCard from '../AppointmentCard'
import QueueStatus from './QueueStatus'
import Button from '../ui/Button'
import ConfirmDialog from '../ui/ConfirmDialog'
import Card, { CardBody } from '../ui/Card'
import { EmptyState } from '../ui/States'

export default function AppointmentList({ appointments, onChanged, emptyAction }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const toast = useToast()
  const [cancelTarget, setCancelTarget] = useState(null)
  const [cancelling, setCancelling] = useState(false)

  const cancel = async () => {
    setCancelling(true)
    try {
      await api.put(`/appointments/${cancelTarget._id}/cancel`)
      toast.success(t('appointments.cancelled'))
      setCancelTarget(null)
      onChanged?.()
    } catch (err) {
      console.error('Cancel failed:', err)
      toast.error(friendlyError(err))
    } finally {
      setCancelling(false)
    }
  }

  /**
   * Only the soonest upcoming appointment gets a queue reading.
   *
   * The queue is per doctor per day, so a card under every appointment would
   * mean one request each — and the one a patient is actually waiting on is
   * the next one. The rest keep their normal card.
   *
   * "Soonest" has to mean soonest *ahead*: sorting by date alone put the
   * reading under an appointment from two days ago, where every slot has
   * already passed and the position means nothing.
   */
  // UTC, because every appointment date is pinned to UTC midnight. Comparing
  // against local midnight made a same-day appointment look like yesterday's
  // between 00:00 and 05:30 at +05:30, which silently hid the queue card.
  const startOfToday = new Date(); startOfToday.setUTCHours(0, 0, 0, 0)
  const whenOf = (a) => new Date(a.confirmedDate || a.requestedDate)
  const active = appointments
    .filter(a => ['pending', 'confirmed'].includes(a.status))
    .sort((a, b) => whenOf(a) - whenOf(b))
  const nextActive = active.find(a => whenOf(a) >= startOfToday) || null

  if (!appointments.length) {
    return (
      <Card><CardBody>
        <EmptyState
          icon={
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
              <rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" />
            </svg>
          }
          title={t('appointments.empty')}
          message={t('appointments.emptyHelp')}
          action={emptyAction}
        />
      </CardBody></Card>
    )
  }

  return (
    <>
      <div className="flex flex-col gap-4">
        {appointments.map(appointment => (
          <React.Fragment key={appointment._id}>
          <AppointmentCard
            appointment={appointment}
            perspective="patient"
            actions={
              <>
                {appointment.status === 'confirmed' && (
                  <Button size="sm" onClick={() => navigate(`/patient/care/call/${appointment._id}`)}>
                    {t('appointments.joinConsultation')}
                  </Button>
                )}
                {['pending', 'confirmed'].includes(appointment.status) && (
                  <Button variant="ghost" size="sm" className="text-danger-500" onClick={() => setCancelTarget(appointment)}>
                    {t('appointments.cancelRequest')}
                  </Button>
                )}
              </>
            }
          />
          {nextActive?._id === appointment._id && <QueueStatus appointment={appointment} />}
          </React.Fragment>
        ))}
      </div>

      <ConfirmDialog
        open={Boolean(cancelTarget)}
        onClose={() => setCancelTarget(null)}
        onConfirm={cancel}
        loading={cancelling}
        title={t('appointments.cancelTitle')}
        message={t('appointments.cancelMessage')}
        confirmLabel={t('appointments.cancelConfirm')}
        cancelLabel={t('appointments.cancelKeep')}
      />
    </>
  )
}
