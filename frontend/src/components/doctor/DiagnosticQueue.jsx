import React, { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import api, { friendlyError } from '../../services/api'
import { useToast } from '../ui/Toast'
import Card, { CardBody } from '../ui/Card'
import Badge from '../ui/Badge'
import Button from '../ui/Button'
import { Field, Input, Textarea } from '../ui/Field'
import { Loading, EmptyState, ErrorState } from '../ui/States'
import { DX_TONE } from '../patient/MyDiagnostics'

/** Mirrors the server's transition table; the server still decides. */
const NEXT = {
  requested: ['scheduled', 'cancelled'],
  scheduled: ['sample_collected', 'cancelled'],
  sample_collected: ['completed', 'cancelled'],
  completed: [], cancelled: []
}

/**
 * Tests this clinician's facility ordered, and moving them along.
 *
 * The list is scoped server-side by the token, so there is nothing here to
 * filter and no facility id to pass.
 */
export default function DiagnosticQueue() {
  const { t } = useTranslation()
  const toast = useToast()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [completing, setCompleting] = useState(null)
  const [result, setResult] = useState({ resultSummary: '', resultNotes: '' })

  const load = useCallback(() => {
    setError('')
    api.get('/diagnostics')
      .then(({ data }) => setRows(data || []))
      .catch(e => { setError(friendlyError(e)); setRows([]) })
  }, [])
  useEffect(() => { load() }, [load])

  const move = async (row, status, extra = {}) => {
    setBusy(row._id)
    try {
      await api.patch(`/diagnostics/${row._id}/status`, { status, ...extra })
      toast.success(t(`diagnostics.moved.${status}`))
      setCompleting(null); setResult({ resultSummary: '', resultNotes: '' })
      load()
    } catch (e) { toast.error(friendlyError(e)) }
    finally { setBusy('') }
  }

  if (error) return <ErrorState message={error} />
  if (!rows) return <Loading />
  if (!rows.length) {
    return <Card><CardBody>
      <EmptyState title={t('diagnostics.queueNone')} message={t('diagnostics.queueNoneHelp')} />
    </CardBody></Card>
  }

  return (
    <div className="flex flex-col gap-3">
      {rows.map(d => (
        <Card key={d._id}>
          <CardBody className="flex flex-col gap-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-small font-semibold text-ink truncate">{d.testName}</p>
                <p className="text-caption text-muted truncate">
                  {d.patientId?.name || t('diagnostics.patient')}
                  {d.patientId?.village && ` · ${d.patientId.village}`}
                  {d.reason && ` · ${d.reason}`}
                </p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {d.priority === 'urgent' && <Badge tone="danger">{t('diagnostics.urgent')}</Badge>}
                <Badge tone={DX_TONE[d.status] || 'neutral'}>{t(`diagnostics.status.${d.status}`)}</Badge>
              </div>
            </div>

            {completing === d._id ? (
              <div className="flex flex-col gap-3 pt-1 border-t border-line-soft">
                <Field label={t('diagnostics.resultSummary')} required>
                  {(p) => <Input {...p} value={result.resultSummary}
                    placeholder={t('diagnostics.resultPlaceholder')}
                    onChange={e => setResult(r => ({ ...r, resultSummary: e.target.value }))} />}
                </Field>
                <Field label={t('diagnostics.resultNotes')}>
                  {(p) => <Textarea {...p} rows="2" value={result.resultNotes}
                    onChange={e => setResult(r => ({ ...r, resultNotes: e.target.value }))} />}
                </Field>
                <div className="flex gap-2">
                  <Button size="sm" loading={busy === d._id}
                    disabled={!result.resultSummary.trim()}
                    onClick={() => move(d, 'completed', result)}>
                    {t('diagnostics.saveResult')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setCompleting(null)}>
                    {t('common.cancel')}
                  </Button>
                </div>
              </div>
            ) : NEXT[d.status]?.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-1 border-t border-line-soft">
                {NEXT[d.status].map(s => (
                  <Button
                    key={s} size="sm"
                    variant={s === 'cancelled' ? 'ghost' : 'secondary'}
                    className={s === 'cancelled' ? 'text-danger-500' : ''}
                    loading={busy === d._id}
                    onClick={() => s === 'completed' ? setCompleting(d._id) : move(d, s)}
                  >
                    {t(`diagnostics.action.${s}`)}
                  </Button>
                ))}
              </div>
            )}

            {d.status === 'completed' && d.resultSummary && (
              <p className="text-caption text-muted">{t('diagnostics.result')}: {d.resultSummary}</p>
            )}
          </CardBody>
        </Card>
      ))}
    </div>
  )
}
