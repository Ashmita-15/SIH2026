import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import api, { friendlyError } from '../../services/api'
import { Button, Card, CardBody, Field, Input, Badge, Loading, EmptyState } from '../ui'

/**
 * Where a prescribed medicine can actually be got.
 *
 * The question is whether to make the trip, so the answer is a category and a
 * phone number, not a stock count. A pharmacy's shelf is its own business and
 * a number that was true an hour ago is worse than useless to someone
 * standing at a bus stop — the freshness caveat below says so out loud.
 */

const TONE = { available: 'success', low_stock: 'warning', unavailable: 'danger' }
const MARK = { available: '✔', low_stock: '⚠', unavailable: '✖' }

/**
 * Pulls likely medicine names out of a free-text prescription.
 *
 * Prescriptions are prose — "Paracetamol 500mg twice daily for 3 days" — so
 * this is a guess, and it is offered as an editable starting point rather than
 * used silently. Words that are plainly dosages or instructions are dropped.
 */
export function guessMedicines(prescription) {
  if (!prescription) return []
  const STOP = new Set([
    'tablet', 'tablets', 'capsule', 'capsules', 'syrup', 'daily', 'twice', 'once',
    'thrice', 'morning', 'night', 'after', 'before', 'food', 'meals', 'days', 'day',
    'week', 'weeks', 'take', 'for', 'and', 'with', 'the', 'one', 'two', 'three'
  ])
  const seen = new Set()
  for (const raw of String(prescription).split(/[\n,;]+/)) {
    const word = (raw.trim().match(/[A-Za-z][A-Za-z-]{2,}/) || [])[0]
    if (!word) continue
    const lower = word.toLowerCase()
    if (STOP.has(lower) || word.length < 3) continue
    seen.add(word)
    if (seen.size >= 5) break
  }
  return [...seen]
}

export default function MedicineAvailability({ initialMedicines = [], compact = false }) {
  const { t } = useTranslation()
  const [query, setQuery] = useState(initialMedicines.join(', '))
  const [items, setItems] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const getAvailabilityLabel = (availability) => {
    switch (availability) {
      case 'available': return t('pharmacy.inStock', 'Available')
      case 'low_stock': return t('pharmacy.lowStock', 'Low stock')
      case 'unavailable': return t('pharmacy.outOfStock', 'Not in stock')
      default: return availability
    }
  }

  const search = async (e) => {
    e?.preventDefault()
    const terms = query.split(',').map(t => t.trim()).filter(t => t.length >= 3)
    if (!terms.length) { setError(t('pharmacy.typeThreeLetters', 'Type at least three letters of a medicine name.')); return }

    setError(''); setBusy(true)
    try {
      const { data } = await api.get('/medicines/availability', { params: { medicines: terms.join(',') } })
      setItems(data.items)
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={search} className="flex items-end gap-2">
        <div className="flex-1">
          <Field label={t('pharmacy.medicines', 'Medicines')} hint="Separate several with commas.">
            {(p) => <Input {...p} value={query} onChange={(e) => setQuery(e.target.value)}
                           placeholder="Paracetamol, Metformin" />}
          </Field>
        </div>
        <Button type="submit" disabled={busy} className="mb-[2px]">
          {busy ? t('common.loading', 'Checking…') : t('common.search', 'Check')}
        </Button>
      </form>

      {error && <p className="error-text" role="alert">{error}</p>}
      {busy && !items && <Loading />}

      {items?.map(item => (
        <div key={item.query}>
          <div className="flex items-center gap-2 mb-2">
            <p className="text-small font-medium text-ink">{item.query}</p>
            <Badge tone={item.anyAvailable ? 'success' : 'danger'}>
              {item.anyAvailable ? t('pharmacy.inStock', 'Available nearby') : t('pharmacy.outOfStock', 'Not available nearby')}
            </Badge>
          </div>

          {item.results.length === 0 ? (
            <EmptyState
              title={t('pharmacy.empty', 'No pharmacies found')}
              message={t('pharmacy.emptyAvailability', 'None of the pharmacies on GramSathi stock it. Ask at the PHC before travelling.')}
            />
          ) : (
            <div className="grid gap-2">
              {item.results.slice(0, compact ? 3 : 20).map((r, i) => (
                <Card key={`${r.pharmacy?._id}-${i}`}>
                  <CardBody className="py-3 flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-small font-medium text-ink">
                        <span aria-hidden="true">{MARK[r.availability]}</span> {r.pharmacy?.name}
                      </p>
                      <p className="text-caption text-muted mt-0.5">
                        {[r.pharmacy?.location, r.medicineName, r.dosage].filter(Boolean).join(' · ')}
                      </p>
                      {r.prescriptionRequired && (
                        <p className="text-caption text-muted mt-0.5">{t('pharmacy.prescriptionRequired', 'Prescription required')}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {r.price ? <span className="text-small text-body tabular">₹{r.price}</span> : null}
                      <Badge tone={TONE[r.availability]}>{getAvailabilityLabel(r.availability)}</Badge>
                      {r.pharmacy?.contact && (
                        <a href={`tel:${r.pharmacy.contact}`} className="btn btn-secondary btn-sm">{t('pharmacy.call', 'Call')}</a>
                      )}
                    </div>
                  </CardBody>
                </Card>
              ))}
            </div>
          )}
        </div>
      ))}

      {/* Said plainly. Stock moves, and someone about to spend money on a bus
          fare deserves to know this is a guide and not a guarantee. */}
      {items?.length > 0 && (
        <p className="text-caption text-muted">
          {t('pharmacy.disclaimer', 'Based on what each pharmacy last recorded. Call before travelling to be sure.')}
        </p>
      )}
    </div>
  )
}
