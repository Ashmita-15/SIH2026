import React, { useEffect, useState } from 'react'
import api, { friendlyError } from '../../services/api'
import { Field, Select, Badge, Loading, EmptyState } from '../ui'

/**
 * Choosing where to send someone.
 *
 * The list is filtered, never decided. Capability and level narrow it to
 * places that can actually take the case, distance orders what is left, and a
 * person picks — the software's job is to remove the ten minutes of phone
 * calls that finding a destination usually takes, not to make the choice.
 */
export default function FacilityPicker({ value, onChange, excludeId }) {
  const [meta, setMeta] = useState({ levels: [], capabilities: [] })
  const [facilities, setFacilities] = useState(null)
  const [capability, setCapability] = useState('')
  const [level, setLevel] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    // Vocabularies come from the server so this screen never keeps its own
    // copy of what a facility can do.
    api.get('/facilities/meta').then(({ data }) => setMeta(data)).catch(() => {})
  }, [])

  useEffect(() => {
    setFacilities(null)
    const params = {}
    if (capability) params.capability = capability
    if (level) params.level = level
    api.get('/facilities', { params })
      .then(({ data }) => setFacilities(data.filter(f => String(f._id) !== String(excludeId))))
      .catch(e => { setError(friendlyError(e)); setFacilities([]) })
  }, [capability, level, excludeId])

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

      {!facilities ? (
        <Loading />
      ) : facilities.length === 0 ? (
        <EmptyState
          title="No facility matches"
          message="Nothing nearby offers that. Widen the filter or choose a higher level."
        />
      ) : (
        <div className="grid gap-2 max-h-64 overflow-y-auto">
          {facilities.map(f => {
            const selected = String(value) === String(f._id)
            return (
              <button
                key={f._id}
                type="button"
                onClick={() => onChange(f._id)}
                className={`text-left p-3 rounded-control border transition-colors ${
                  selected ? 'border-primary-600 bg-primary-50' : 'border-line hover:bg-surface-2'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-small font-medium text-ink">{f.name}</p>
                    <p className="text-caption text-muted mt-0.5">
                      {String(f.level || '').replace(/_/g, ' ')}
                      {f.operatingDays?.length ? ` · ${f.operatingDays.join(' ')}` : ''}
                    </p>
                  </div>
                  {selected && <Badge tone="primary">Selected</Badge>}
                </div>
                {f.capabilities?.length > 0 && (
                  <p className="text-caption text-muted mt-1.5 truncate">
                    {f.capabilities.slice(0, 5).map(c => c.replace(/_/g, ' ')).join(' · ')}
                    {f.capabilities.length > 5 ? ' …' : ''}
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
