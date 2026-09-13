import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import api from '../../services/api'
import Button from '../ui/Button'
import Alert from '../ui/Alert'
import { Field, Input } from '../ui/Field'

/**
 * Where this facility is, asked for once, at sign-up.
 *
 * Only hospital and pharmacy accounts see this. Patients are shown facilities
 * by distance and then travel to them, so a facility with no coordinates is a
 * listing nobody can act on — while a patient's or doctor's whereabouts is
 * none of the platform's business.
 *
 * Two ways to answer, and the second is not optional extra polish.
 *
 * The browser fix is offered first because it is one tap and needs no typing.
 * But `getCurrentPosition` is genuinely unavailable on a great many of the
 * machines a clinic actually registers from: a desktop with no GPS radio and
 * no Wi-Fi positioning simply times out, as does a lookup from inside a
 * concrete building. Making the fix the only route meant a real clinic could
 * be permanently unable to create an account — so a typed address, resolved
 * to coordinates by the same map service, is a first-class path.
 *
 * Nothing is ever guessed on either route. A refusal, a timeout, a failed
 * lookup or an address that matches nothing all say exactly that and store no
 * location at all: a plausible-looking wrong pin on a clinic record is worse
 * than an empty one.
 */
export default function FacilityLocation({ value, onChange, error }) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState('')
  // Revealed by a GPS failure, or by asking for it. Never hidden again once
  // shown — somebody who has started typing must not lose the field.
  const [manualOpen, setManualOpen] = useState(false)
  const [typed, setTyped] = useState('')

  const fail = (message) => {
    onChange(null)
    setFailure(message)
    setManualOpen(true) // every dead end leads somewhere
  }

  const detect = () => {
    setFailure('')
    if (!navigator.geolocation) {
      fail(t('auth.location.unsupported'))
      return
    }
    setBusy(true)
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude, accuracy } = position.coords
        try {
          const { data } = await api.get('/geo/reverse', { params: { lat: latitude, lon: longitude } })
          if (!data?.address) throw new Error('no address')
          onChange({ latitude, longitude, accuracy, address: data.address, source: 'gps' })
          setFailure('')
        } catch {
          // The coordinates are good but unnamed. Still not saved — the person
          // confirms an address they can read, and there isn't one.
          fail(t('auth.location.geocodeFailed'))
        } finally {
          setBusy(false)
        }
      },
      (err) => {
        setBusy(false)
        const reason = err.code === err.PERMISSION_DENIED ? 'denied'
          : err.code === err.TIMEOUT ? 'timeout'
          : 'unavailable'
        fail(t(`auth.location.${reason}`))
      },
      /**
       * `enableHighAccuracy: false` deliberately.
       *
       * True asks for a satellite fix, which a desktop cannot give at all and
       * a phone indoors takes tens of seconds to fail at — that is what was
       * producing "getting a location took too long" on every attempt. The
       * coarse network fix is accurate to a neighbourhood, which is all a
       * "facilities near you" list needs, and it returns in about a second.
       *
       * A five-minute-old fix is accepted: a building has not moved, and
       * reusing another app's recent position avoids the prompt entirely.
       */
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 }
    )
  }

  const lookup = async () => {
    setFailure('')
    setBusy(true)
    try {
      const { data } = await api.get('/geo/search', { params: { q: typed } })
      if (!data?.address) throw new Error('no match')
      // Its canonical name, not the words typed, so the person confirms what
      // the map service actually matched.
      onChange({
        latitude: data.latitude,
        longitude: data.longitude,
        address: data.address,
        source: 'manual'
      })
    } catch (err) {
      onChange(null)
      setFailure(err?.response?.status === 404
        ? t('auth.location.noMatch')
        : t('auth.location.searchFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="field">
      <p className="label label-required">{t('auth.location.label')}</p>
      <p className="hint mb-2">{t('auth.location.why')}</p>

      {value?.address && (
        <Alert tone="success" title={t('auth.location.detected')}>
          <p>{value.address}</p>
          <p className="text-xs opacity-80 mt-1">
            {Number.isFinite(value.accuracy)
              ? t('auth.location.coords', {
                lat: value.latitude.toFixed(5),
                lon: value.longitude.toFixed(5),
                accuracy: Math.round(value.accuracy)
              })
              : t('auth.location.coordsOnly', {
                lat: value.latitude.toFixed(5),
                lon: value.longitude.toFixed(5)
              })}
          </p>
        </Alert>
      )}

      <div className="flex flex-wrap gap-2 mt-2">
        <Button type="button" variant="ghost" onClick={detect} loading={busy}>
          {value?.address ? t('auth.location.retry') : t('auth.location.detect')}
        </Button>
        {!manualOpen && (
          <Button type="button" variant="ghost" onClick={() => { setManualOpen(true); setFailure('') }}>
            {t('auth.location.enterManually')}
          </Button>
        )}
      </div>

      {failure && <p className="error-text mt-2" role="alert">{failure}</p>}
      {!failure && error && <p className="error-text mt-2" role="alert">{error}</p>}

      {manualOpen && (
        <div className="mt-3">
          <Field label={t('auth.location.manualLabel')} hint={t('auth.location.manualHint')}>
            {(props) => (
              <Input
                {...props}
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder={t('auth.location.manualPlaceholder')}
                // Enter searches rather than submitting a half-filled form.
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); if (typed.trim().length >= 4) lookup() }
                }}
              />
            )}
          </Field>
          <Button
            type="button" variant="ghost" onClick={lookup} loading={busy}
            disabled={typed.trim().length < 4}
          >
            {t('auth.location.searchAddress')}
          </Button>
        </div>
      )}
    </div>
  )
}
