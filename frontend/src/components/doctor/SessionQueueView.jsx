import React, { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import api, { friendlyError } from '../../services/api'
import Card, { CardBody, CardHeader } from '../ui/Card'
import { Loading, EmptyState, ErrorState } from '../ui/States'

/**
 * The doctor's finalised sessions, read from /sessions/mine/queue.
 *
 * Scoped by the token on the server, so there is no id here to tamper with.
 * Only sessions past their cutoff appear — before that no order exists, and
 * showing a provisional one would be showing a number that will change.
 */
export default function SessionQueueView() {
  const { t, i18n } = useTranslation()
  const [queues, setQueues] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api.get('/sessions/mine/queue')
      .then(({ data }) => setQueues(data.queues || []))
      .catch(e => { setError(friendlyError(e)); setQueues([]) })
  }, [])

  const clock = (iso) => iso ? new Date(iso).toLocaleTimeString(
    i18n.language === 'en' ? 'en-IN' : i18n.language,
    { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '—'

  if (error) return <ErrorState message={error} />
  if (!queues) return <Loading />
  if (!queues.length) {
    return <Card><CardBody>
      <EmptyState title={t('sessionQueue.none')} message={t('sessionQueue.noneHelp')} />
    </CardBody></Card>
  }

  return (
    <div className="flex flex-col gap-5">
      {queues.map(q => (
        <Card key={`${q.sessionId}-${q.date}`}>
          <CardHeader>
            <div>
              <h2 className="section-title">{q.sessionName} · {q.date}</h2>
              <p className="text-caption text-muted">
                {clock(q.startsAt)} – {clock(q.endsAt)} · {t('sessionQueue.total', { count: q.totalPatients })}
              </p>
            </div>
          </CardHeader>
          <CardBody>
            <ul className="flex flex-col gap-2">
              {q.entries.map(e => (
                <li key={e.position} className="flex items-center gap-3 p-3 rounded-card border border-line bg-surface">
                  <span className="shrink-0 w-8 h-8 rounded-full bg-primary-50 text-primary-700
                                   flex items-center justify-center text-small font-bold tabular">
                    {e.position}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-small font-medium text-ink truncate">{e.patientName}</span>
                    {e.patientAge != null && (
                      <span className="block text-caption text-muted">{t('sessionQueue.age', { count: e.patientAge })}</span>
                    )}
                  </span>
                  <span className="shrink-0 text-caption text-muted tabular">{clock(e.estimatedArrivalTime)}</span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ))}
    </div>
  )
}
