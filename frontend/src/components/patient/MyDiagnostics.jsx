import React, { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import api, { friendlyError } from '../../services/api'
import Card, { CardBody } from '../ui/Card'
import Badge from '../ui/Badge'
import { Loading, EmptyState, ErrorState } from '../ui/States'

/** Status colour carries the same meaning the word does, for quick scanning. */
export const DX_TONE = {
  requested: 'warning', scheduled: 'primary', sample_collected: 'primary',
  completed: 'success', cancelled: 'neutral'
}

/**
 * The patient's own tests.
 *
 * Scoped entirely by the server — this sends no patient id and could not ask
 * for somebody else's if it tried.
 */
export default function MyDiagnostics() {
  const { t, i18n } = useTranslation()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api.get('/diagnostics')
      .then(({ data }) => setRows(data || []))
      .catch(e => { setError(friendlyError(e)); setRows([]) })
  }, [])

  const when = (d) => d ? new Date(d).toLocaleDateString(i18n.language === 'en' ? 'en-IN' : i18n.language,
    { day: 'numeric', month: 'short', year: 'numeric' }) : ''

  if (error) return <ErrorState message={error} />
  if (!rows) return <Loading />
  if (!rows.length) {
    return <Card><CardBody>
      <EmptyState title={t('diagnostics.none')} message={t('diagnostics.noneHelp')} />
    </CardBody></Card>
  }

  return (
    <div className="flex flex-col gap-3">
      {rows.map(d => (
        <Card key={d._id}>
          <CardBody className="flex flex-col gap-2">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-small font-semibold text-ink truncate">{d.testName}</p>
                <p className="text-caption text-muted truncate">
                  {when(d.createdAt)}
                  {d.requestedBy?.name && ` · ${d.requestedBy.name}`}
                  {d.facilityId?.name && ` · ${d.facilityId.name}`}
                </p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {d.priority === 'urgent' && <Badge tone="danger">{t('diagnostics.urgent')}</Badge>}
                <Badge tone={DX_TONE[d.status] || 'neutral'}>{t(`diagnostics.status.${d.status}`)}</Badge>
              </div>
            </div>

            {d.reason && <p className="text-caption text-muted">{t('diagnostics.reason')}: {d.reason}</p>}

            {/* Only a completed test has anything to read. */}
            {d.status === 'completed' && d.resultSummary && (
              <div className="rounded-control border border-line bg-surface-2 p-3 flex flex-col gap-1">
                <p className="text-caption text-muted uppercase tracking-wide">{t('diagnostics.result')}</p>
                <p className="text-small text-ink">{d.resultSummary}</p>
                {d.resultNotes && <p className="text-caption text-muted">{d.resultNotes}</p>}
                {d.reportUrl && (
                  <a href={d.reportUrl} target="_blank" rel="noreferrer" className="link text-caption">
                    {t('diagnostics.openReport')}
                  </a>
                )}
              </div>
            )}
          </CardBody>
        </Card>
      ))}
    </div>
  )
}
