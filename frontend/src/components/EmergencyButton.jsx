import React, { useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../context/AuthContext'
import Modal from './ui/Modal'
import api from '../services/api'

const SERVICES = [
  { key: 'ambulance', number: '108' },
  { key: 'emergency', number: '112' },
  { key: 'health',    number: '104' }
]

/**
 * SOS floating button — surfaces national emergency numbers and a one-tap
 * "alert the nearest hospital" action that emails the patient's live
 * geolocation to the closest facility.
 */
export default function EmergencyButton() {
  const { user } = useAuth()
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  // Alert-hospital flow states: idle | locating | sending | success | error
  const [alertState, setAlertState] = useState('idle')
  const [alertResult, setAlertResult] = useState(null)   // { hospital, emailSent }
  const [alertError, setAlertError] = useState('')

  const resetAlert = useCallback(() => {
    setAlertState('idle')
    setAlertResult(null)
    setAlertError('')
  }, [])

  const handleClose = useCallback(() => {
    setOpen(false)
    // Reset after the close animation finishes
    setTimeout(resetAlert, 250)
  }, [resetAlert])

  const handleAlertHospital = useCallback(async () => {
    resetAlert()

    if (!navigator.geolocation) {
      setAlertState('error')
      setAlertError(t('emergency.alertHospital.unavailable'))
      return
    }

    setAlertState('locating')

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        setAlertState('sending')
        try {
          const { data } = await api.post('/emergency/alert-nearest', {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude
          })
          setAlertResult(data)
          setAlertState('success')
        } catch (err) {
          setAlertState('error')
          setAlertError(
            err.response?.data?.message || t('emergency.alertHospital.error')
          )
        }
      },
      (err) => {
        setAlertState('error')
        if (err.code === err.PERMISSION_DENIED) {
          setAlertError(t('emergency.alertHospital.denied'))
        } else {
          setAlertError(t('emergency.alertHospital.unavailable'))
        }
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    )
  }, [t, resetAlert])

  if (!user || user.role !== 'patient') return null

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed right-4 lg:right-5 z-40 h-12 lg:h-14 px-4 lg:px-5 rounded-full
                   bottom-[calc(env(safe-area-inset-bottom)+5.25rem)] lg:bottom-5
                   bg-danger-500 text-white font-semibold shadow-lifted hover:bg-danger-600
                   transition-colors flex items-center gap-2"
      >
        <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h2.2a1 1 0 011 .77l.8 3.4a1 1 0 01-.53 1.1l-1.4.7a11 11 0 006 6l.7-1.4a1 1 0 011.1-.53l3.4.8a1 1 0 01.77 1V17a2 2 0 01-2 2A16 16 0 013 5z" />
        </svg>
        {t('emergency.button')}
      </button>

      <Modal
        open={open}
        onClose={handleClose}
        title={t('emergency.title')}
        description={t('emergency.description')}
        size="sm"
      >
        {/* ─── Alert Nearest Hospital ─────────────────────────────── */}
        <div className="mb-4">
          <div className="p-4 rounded-card border-2 border-danger-500 bg-danger-50">
            <div className="flex items-start gap-3 mb-3">
              <div className="shrink-0 w-10 h-10 flex items-center justify-center rounded-full bg-danger-500 text-white">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a2 2 0 01-2.828 0l-4.243-4.243a8 8 0 1111.314 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-h3 text-danger-500 mb-0.5">
                  {t('emergency.alertHospital.title')}
                </h3>
                <p className="text-caption text-muted">
                  {t('emergency.alertHospital.subtitle')}
                </p>
              </div>
            </div>

            {alertState === 'idle' && (
              <button
                type="button"
                onClick={handleAlertHospital}
                className="w-full min-h-touch rounded-control font-semibold text-white
                           bg-danger-500 hover:bg-danger-600 transition-colors
                           flex items-center justify-center gap-2 px-4"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
                {t('emergency.alertHospital.send')}
              </button>
            )}

            {alertState === 'locating' && (
              <div className="flex items-center justify-center gap-2 min-h-touch text-danger-500 font-medium" role="status">
                <svg className="w-5 h-5 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                </svg>
                {t('emergency.alertHospital.locating')}
              </div>
            )}

            {alertState === 'sending' && (
              <div className="flex items-center justify-center gap-2 min-h-touch text-danger-500 font-medium" role="status">
                <svg className="w-5 h-5 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                </svg>
                {t('emergency.alertHospital.sending')}
              </div>
            )}

            {alertState === 'success' && alertResult && (
              <div className="rounded-control bg-success-50 border border-success-500 p-3 animate-rise-in">
                <div className="flex items-start gap-2">
                  <svg className="w-5 h-5 text-success-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <div>
                    <p className="font-semibold text-success-600 text-small">
                      {t('emergency.alertHospital.success')}
                    </p>
                    <p className="text-caption text-body mt-1">
                      {t('emergency.alertHospital.successDetail', {
                        hospital: alertResult.hospital?.name,
                        distance: alertResult.hospital?.distanceKm
                      })}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {alertState === 'error' && (
              <div className="rounded-control bg-danger-50 border border-danger-500 p-3 animate-rise-in">
                <p className="text-small text-danger-600 font-medium mb-2">{alertError}</p>
                <button
                  type="button"
                  onClick={handleAlertHospital}
                  className="text-small font-semibold text-danger-500 hover:text-danger-600 underline"
                >
                  {t('emergency.alertHospital.retry')}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* ─── Divider ─────────────────────────────────────────────── */}
        <div className="flex items-center gap-3 mb-3">
          <div className="flex-1 h-px bg-line" />
          <span className="text-caption text-muted font-medium">{t('emergency.orCall')}</span>
          <div className="flex-1 h-px bg-line" />
        </div>

        {/* ─── Helpline Numbers ────────────────────────────────────── */}
        <ul className="flex flex-col gap-2">
          {SERVICES.map(s => (
            <li key={s.number}>
              <a
                href={`tel:${s.number}`}
                className="flex items-center justify-between gap-4 p-4 rounded-card border border-line
                           hover:border-danger-500 hover:bg-danger-50 transition-colors min-h-touch"
              >
                <span className="font-medium text-ink">{t(`emergency.services.${s.key}`)}</span>
                <span className="text-h3 font-semibold text-danger-500 tabular">{s.number}</span>
              </a>
            </li>
          ))}
        </ul>
        <p className="hint mt-4">{t('emergency.note')}</p>
      </Modal>
    </>
  )
}
