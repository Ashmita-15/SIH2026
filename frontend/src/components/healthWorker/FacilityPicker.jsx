import React, { useEffect, useState } from 'react'
import api, { friendlyError } from '../../services/api'
import { Field, Select, Badge, Loading, EmptyState } from '../ui'

/**
 * Choosing which hospital to send someone to.
 *
 * The list is filtered, never decided. Capability and level narrow it to
 * places that can actually take the case, and a person picks.
 *
 * The options are hospital accounts, loaded from /referrals/destinations —
 * not the raw facility list, which also holds seeded and unlinked records
 * whose referrals would reach no inbox. The value is the hospital account's
 * id (hospitalUserId); names are only ever displayed, never sent.
 */
export default function FacilityPicker({ value, onChange, excludeFacilityId }) {
  const [meta, setMeta] = useState({ levels: [], capabilities: [] })
  const [hospitals, setHospitals] = useState(null)
  const [capability, setCapability] = useState('')
  const [level, setLevel] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    // Vocabularies come from the server so this screen never keeps its own
    // copy of what a facility can do.
    api.get('/facilities/meta').then(({ data }) => setMeta(data)).catch(() => {})
  }, [])

  useEffect(() => {
    setHospitals(null)
    setError('')
    const params = {}
    if (capability) params.capability = capability
    if (level) params.level = level
    api.get('/referrals/destinations', { params })
      .then(({ data }) => {
        const list = (data || []).filter(h => String(h.facilityId) !== String(excludeFacilityId))
        setHospitals(list)
        // A selection the new filter no longer includes must not be sent silently.
        if (value && !list.some(h => h.hospitalUserId === value)) onChange('')
      })
      .catch(e => { setError(friendlyError(e)); setHospitals([]) })
    // onChange/value deliberately omitted: refetch only when the filters change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capability, level, excludeFacilityId])

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Needs capability">
          {(props) => (
            <Select {...props} value={capability} onChange={(e) => setCapability(e.target.value)}>
              <option value="">Any</option>
              {meta.capabilities.map(c => (
                <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Facility level">
          {(props) => (
            <Select {...props} value={level} onChange={(e) => setLevel(e.target.value)}>
              <option value="">Any</option>
              {meta.levels.map(l => (
                <option key={l} value={l}>{l.replace(/_/g, ' ')}</option>
              ))}
            </Select>
          )}
        </Field>
      </div>

      {error && <p className="error-text">{error}</p>}

      {!hospitals ? (
        <Loading />
      ) : hospitals.length === 0 ? (
        <EmptyState
          title="No hospital matches"
          message="No registered hospital offers that. Widen the filter or choose a higher level."
        />
      ) : (
        <div className="grid gap-2 max-h-64 overflow-y-auto">
          {hospitals.map(h => {
            const selected = value === h.hospitalUserId
            return (
              <button
                key={h.hospitalUserId}
                type="button"
                onClick={() => onChange(h.hospitalUserId)}
                aria-pressed={selected}
                className={`text-left p-3 rounded-control border transition-colors ${
                  selected ? 'border-primary-600 bg-primary-50' : 'border-line hover:bg-surface-2'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-small font-medium text-ink">{h.name}</p>
                    <p className="text-caption text-muted mt-0.5">
                      {String(h.level || '').replace(/_/g, ' ')}
                      {h.operatingDays?.length ? ` · ${h.operatingDays.join(' ')}` : ''}
                    </p>
                    {h.address && <p className="text-caption text-muted mt-0.5 truncate">{h.address}</p>}
                  </div>
                  {selected && <Badge tone="primary">Selected</Badge>}
                </div>
                {h.capabilities?.length > 0 && (
                  <p className="text-caption text-muted mt-1.5 truncate">
                    {h.capabilities.slice(0, 5).map(c => c.replace(/_/g, ' ')).join(' · ')}
                    {h.capabilities.length > 5 ? ' …' : ''}
                  </p>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
