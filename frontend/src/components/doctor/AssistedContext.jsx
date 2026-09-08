import React from 'react'
import Badge from '../ui/Badge'

/**
 * The frontline observations behind an assisted consultation.
 *
 * A doctor with three minutes needs the vitals and the danger signs before the
 * call starts, not during it. These are shown as what they are — measurements
 * a health worker took at the patient's door — attributed to the person who
 * took them, and never as the doctor's own finding.
 */

const VITALS = [
  ['systolic', (v, all) => `BP ${v}/${all.diastolic ?? '?'}`],
  ['pulse', v => `Pulse ${v}`],
  ['temperature', v => `${v}°C`],
  ['spo2', v => `SpO₂ ${v}%`],
  ['hemoglobin', v => `Hb ${v}`],
  ['bloodSugar', v => `Glucose ${v}`],
  ['weight', v => `${v} kg`]
]

const SIGN_LABELS = {
  severe_hypertension: 'Very high blood pressure',
  raised_blood_pressure: 'Raised blood pressure',
  severe_hypoxia: 'Very low oxygen',
  low_oxygen: 'Low oxygen',
  high_fever: 'High fever',
  hypothermia: 'Body temperature too low',
  hypoglycaemia: 'Very low blood sugar',
  very_high_glucose: 'Very high blood sugar',
  severe_anaemia: 'Severe anaemia',
  fast_pulse: 'Fast pulse'
}

const CRITICAL = new Set([
  'severe_hypertension', 'severe_hypoxia', 'hypothermia', 'hypoglycaemia', 'severe_anaemia'
])

export default function AssistedContext({ appointment }) {
  const worker = appointment.assistedBy
  if (!worker) return null

  const encounter = appointment.encounterId
  const vitals = encounter?.vitals

  const readings = vitals
    ? VITALS.filter(([k]) => vitals[k] !== undefined && vitals[k] !== null)
        .map(([k, fmt]) => fmt(vitals[k], vitals))
    : []

  return (
    <div className="rounded-control border border-line bg-surface-2 p-3 mt-3">
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <Badge tone="info">Assisted consultation</Badge>
        <span className="text-caption text-muted">
          {worker.name}
          {worker.workerType && ` (${worker.workerType.toUpperCase()})`}
          {appointment.assistedFacilityId?.name && ` · ${appointment.assistedFacilityId.name}`}
        </span>
      </div>

      {encounter ? (
        <>
          <p className="text-caption text-muted">
            Home visit on {new Date(encounter.occurredAt).toLocaleDateString('en-IN', {
              day: 'numeric', month: 'short', year: 'numeric'
            })}
          </p>

          {readings.length > 0 && (
            <p className="text-small text-ink mt-1.5 tabular">{readings.join('   ·   ')}</p>
          )}

          {encounter.dangerSigns?.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {encounter.dangerSigns.map(code => (
                <Badge key={code} tone={CRITICAL.has(code) ? 'danger' : 'warning'}>
                  {SIGN_LABELS[code] || code}
                </Badge>
              ))}
            </div>
          )}

          {encounter.notes && (
            <p className="text-small text-body mt-2">
              <span className="text-muted">Worker's note: </span>{encounter.notes}
            </p>
          )}
        </>
      ) : (
        <p className="text-caption text-muted">No visit record attached to this request.</p>
      )}
    </div>
  )
}
