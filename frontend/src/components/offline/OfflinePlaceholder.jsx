import React from 'react'
import { useTranslation } from 'react-i18next'
import Card, { CardBody } from '../ui/Card'
import Button from '../ui/Button'

export default function OfflinePlaceholder({
  title = 'Internet connection required',
  message = 'This feature requires an active internet connection. Supported offline features (such as previously loaded appointments, medical records, and offline entries) remain accessible.',
  onRetry
}) {
  const { t } = useTranslation()

  return (
    <Card className="max-w-md mx-auto my-8 border border-line bg-surface shadow-rest">
      <CardBody className="p-6 text-center">
        <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-primary-50 text-primary-600 flex items-center justify-center">
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
            <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 5.636a9 9 0 010 12.728m0 0l-2.829-2.829m2.829 2.829L21 21M15.536 8.464a5 5 0 010 7.072m0 0l-2.829-2.829m-4.243 4.243a9 9 0 01-1.272-1.272m-2.829 2.829a9 9 0 010-12.728m2.829 2.829a5 5 0 017.072 0M3 3l18 18" />
          </svg>
        </div>
        <h2 className="text-h3 font-semibold text-ink mb-2">{title}</h2>
        <p className="text-small text-muted mb-6 leading-relaxed">
          {message}
        </p>
        {onRetry && (
          <Button variant="secondary" onClick={onRetry} className="w-full sm:w-auto">
            {t('common.retry', 'Check connection again')}
          </Button>
        )}
      </CardBody>
    </Card>
  )
}
