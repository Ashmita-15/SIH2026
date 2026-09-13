import React, { useState, useCallback, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../context/AuthContext'
import Modal from './ui/Modal'
import api from '../services/api'
import { getCurrentLocation, locationErrorKey } from '../lib/geolocation'

const SERVICES = [
  { key: 'ambulance', number: '108' },
  { key: 'emergency', number: '112' },
  { key: 'health',    number: '104' }
]

/** Reused across retries of one attempt, so a lost response cannot create a second alert. */
const newRequestId = () =>
  (typeof crypto !== 'undefined' && crypto.randomUUID?.()) ||
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`

/**
 * SOS floating button — national emergency numbers, plus a one-tap alert to
 * the nearest registered hospitals with the patient's live location.
 *
 * What the patient is told matches what the server confirmed: "sent" only
 * when a push service or email provider accepted the alert, and never
 * "hospital notified" on hope. The helplines stay visible in every state.
 */
export default function EmergencyButton() {
  const { user } = useAuth()
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  // idle | locating | sending | success | error
  const [alertState, setAlertState] = useState('idle')
  const [alertResult, setAlertResult] = useState(null)
  const [alertError, setAlertError] = useState('')
  const [slow, setSlow] = useState(false)

  const inFlight = useRef(false)
  const requestId = useRef(null)
  const slowTimer = useRef(null)

  useEffect(() => () => clearTimeout(slowTimer.current), [])

  const resetAlert = useCallback(() => {
    setAlertState('idle')
    setAlertResult(null)
    setAlertError('')
    setSlow(false)
  }, [])

  const handleClose = useCallback(() => {
    setOpen(false)
    // A fresh attempt next time the button is opened.
    if (!inFlight.current) requestId.current = null
    // Reset after the close animation finishes
    setTimeout(() => { if (!inFlight.current) resetAlert() }, 250)
  }, [resetAlert])

  const handleAlertHospital = useCallback(async () => {
    if (inFlight.current) return
    inFlight.current = true
    resetAlert()

    try {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        setAlertState('error')
        setAlertError(t('emergency.alertHospital.offline'))
        return
      }

      setAlertState('locating')
      let loc
      try {
        // A fix up to 30 s old is fine in an emergency and much faster to get.
        loc = await getCurrentLocation({ maximumAge: 30000 })
      } catch (err) {
        setAlertState('error')
        setAlertError(t(locationErrorKey(err)))
        return
      }

      setAlertState('sending')
      if (!requestId.current) requestId.current = newRequestId()
      slowTimer.current = setTimeout(() => setSlow(true), 8000)

      try {
        const { data } = await api.post('/emergency/alert-nearest', {
          latitude: loc.lat,
          longitude: loc.lng,
          accuracy: loc.accuracy,
          clientRequestId: requestId.current
        }, { timeout: 60000 })
        setAlertResult(data)
        setAlertState('success')
        requestId.current = null
      } catch (err) {
        setAlertState('error')
        const status = err.response?.status
        if (!err.response) {
          // No answer at all: the alert may or may not exist, so the same id
          // is kept and a retry cannot duplicate it.
          setAlertError(t('emergency.alertHospital.networkError'))
          return
        }
        if (status < 500) requestId.current = null
        if (err.response.data?.code === 'NO_FACILITY') {
          setAlertError(t('emergency.alertHospital.noFacility', { km: err.response.data.radiusKm || 100 }))
        } else {
          setAlertError(t('emergency.alertHospital.error'))
        }
      }
    } finally {
      clearTimeout(slowTimer.current)
      setSlow(false)
      inFlight.current = false
    }
  }, [t, resetAlert])

  if (!user || user.role !== 'patient') return null

  const facilities = alertResult?.facilities || []
  const confirmed = Boolean(alertResult?.delivery?.confirmed)
  const nearest = facilities[0]

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

            {(alertState === 'locating' || alertState === 'sending') && (
              <div className="flex flex-col items-center justify-center gap-1 min-h-touch text-danger-500 font-medium" role="status">
                <span className="flex items-center gap-2">
                  <svg className="w-5 h-5 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                  </svg>
                  {alertState === 'locating' ? t('emergency.alertHospital.locating') : t('emergency.alertHospital.sending')}
                </span>
                {slow && <span className="text-caption text-muted text-center">{t('emergency.alertHospital.slow')}</span>}
              </div>
            )}

            {alertState === 'success' && alertResult && (
              <div
                className={`rounded-control border p-3 animate-rise-in ${confirmed ? 'bg-success-50 border-success-500' : 'bg-warning-50 border-warning-500'}`}
                role="status"
              >
                <p className={`font-semibold text-small ${confirmed ? 'text-success-600' : 'text-warning-600'}`}>
                  {alertResult.status === 'acknowledged'
                    ? t('emergency.alertHospital.acknowledged')
                    : confirmed ? t('emergency.alertHospital.sentTitle') : t('emergency.alertHospital.unconfirmedTitle')}
                </p>
                <p className="text-caption text-body mt-1">
                  {confirmed
                    ? t('emergency.alertHospital.sentDetail', { hospital: nearest?.name, distance: nearest?.distanceKm, count: alertResult.delivery?.facilitiesReached || 0 })
                    : t('emergency.alertHospital.unconfirmedDetail')}
                </p>
                {alertResult.duplicate && (
                  <p className="text-caption text-muted mt-1">{t('emergency.alertHospital.duplicate')}</p>
                )}

                {facilities.length > 0 && (
                  <ul className="mt-3 flex flex-col gap-1.5">
                    {facilities.map((f, i) => (
                      <li key={i} className="flex items-center justify-between gap-2 text-caption">
                        <span className="min-w-0">
                          <span className="font-medium text-ink">{f.name}</span>
                          <span className="text-muted"> · {f.distanceKm} km · {f.reached ? t('emergency.alertHospital.reached') : t('emergency.alertHospital.notReached')}</span>
                        </span>
                        {f.phone && (
                          <a href={`tel:${f.phone}`} className="shrink-0 font-semibold text-danger-500 underline">
                            {t('emergency.alertHospital.callHospital')}
                          </a>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                <p className="text-caption text-muted mt-3">{t('emergency.alertHospital.notGuaranteed')}</p>
              </div>
            )}

            {alertState === 'error' && (
              <div className="rounded-control bg-danger-50 border border-danger-500 p-3 animate-rise-in" role="alert">
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
