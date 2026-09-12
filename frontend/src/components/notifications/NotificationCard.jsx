import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import Card, { CardBody, CardHeader } from '../ui/Card.jsx';
import Button from '../ui/Button.jsx';
import Badge from '../ui/Badge.jsx';
import {
  isPushSupported,
  getPushPermissionStatus,
  getCurrentPushSubscription,
  subscribeToPush,
  unsubscribeFromPush
} from '../../lib/pushNotifications.js';

export default function NotificationCard({ className = '' }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState('loading'); // 'loading' | 'default' | 'enabled' | 'denied' | 'unsupported'
  const [actionLoading, setActionLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);

  const checkStatus = async () => {
    if (!isPushSupported()) {
      setStatus('unsupported');
      return;
    }

    const perm = getPushPermissionStatus();
    if (perm === 'denied') {
      setStatus('denied');
      return;
    }

    try {
      const sub = await getCurrentPushSubscription();
      if (sub && perm === 'granted') {
        setStatus('enabled');
      } else {
        setStatus('default');
      }
    } catch {
      setStatus('default');
    }
  };

  useEffect(() => {
    checkStatus();

    const handlePushChange = () => {
      checkStatus();
    };

    window.addEventListener('gramsathi:push-status-changed', handlePushChange);
    return () => window.removeEventListener('gramsathi:push-status-changed', handlePushChange);
  }, []);

  const handleEnable = async () => {
    setActionLoading(true);
    setErrorMessage(null);

    try {
      const res = await subscribeToPush();
      if (res.success) {
        setStatus('enabled');
      } else if (res.reason === 'permission_denied') {
        setStatus('denied');
      } else {
        setErrorMessage(t('notifications.errorFailed', "We couldn't enable notifications right now. Please try again."));
      }
    } catch (err) {
      setErrorMessage(t('notifications.errorFailed', "We couldn't enable notifications right now. Please try again."));
    } finally {
      setActionLoading(false);
    }
  };

  const handleDisable = async () => {
    setActionLoading(true);
    setErrorMessage(null);

    try {
      const res = await unsubscribeFromPush();
      if (res.success) {
        setStatus('default');
      } else {
        setErrorMessage(t('notifications.errorDisable', "We couldn't disable notifications right now. Please try again."));
      }
    } catch (err) {
      setErrorMessage(t('notifications.errorDisable', "We couldn't disable notifications right now. Please try again."));
    } finally {
      setActionLoading(false);
    }
  };

  const statusBadge = () => {
    switch (status) {
      case 'enabled':
        return <Badge tone="success" dot>{t('notifications.statusEnabled', 'Enabled')}</Badge>;
      case 'denied':
        return <Badge tone="danger" dot>{t('notifications.statusBlocked', 'Blocked')}</Badge>;
      case 'unsupported':
        return <Badge tone="neutral">{t('notifications.statusUnsupported', 'Unavailable')}</Badge>;
      default:
        return <Badge tone="neutral" dot>{t('notifications.statusInactive', 'Not Enabled')}</Badge>;
    }
  };

  return (
    <Card className={`overflow-hidden ${className}`}>
      <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-line-soft">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center text-primary shrink-0">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
            </svg>
          </div>
          <div>
            <h3 className="text-h3 text-ink">{t('notifications.title', 'Notifications')}</h3>
            <p className="text-caption text-muted">{t('notifications.deviceAlerts', 'Push alerts on this device')}</p>
          </div>
        </div>
        <div>
          {status !== 'loading' && statusBadge()}
        </div>
      </CardHeader>

      <CardBody className="pt-4 space-y-4">
        {errorMessage && (
          <div className="p-3 rounded-xl bg-danger-50 border border-danger-200 text-danger-800 text-small flex items-center gap-2" role="alert">
            <span aria-hidden="true">⚠️</span>
            <span>{errorMessage}</span>
          </div>
        )}

        {/* State D: Unsupported Browser */}
        {status === 'unsupported' && (
          <div className="p-3.5 rounded-xl bg-surface-2 border border-line text-small text-muted space-y-1">
            <p className="font-medium text-ink">
              {t('notifications.unsupportedTitle', "Notifications aren't supported by this browser.")}
            </p>
            <p className="text-caption">
              {t('notifications.unsupportedDesc', 'Please use a modern browser (Google Chrome, Microsoft Edge, Mozilla Firefox) or install GramSathi as a Progressive Web App on your mobile device.')}
            </p>
          </div>
        )}

        {/* State C: Permission Denied */}
        {status === 'denied' && (
          <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-small text-amber-900 space-y-2">
            <p className="font-medium flex items-center gap-1.5">
              <span>🚫</span>
              <span>{t('notifications.blockedTitle', 'Notifications are blocked for GramSathi.')}</span>
            </p>
            <p className="text-caption text-amber-800 leading-relaxed">
              {t('notifications.blockedInstructions', 'To enable notifications, please open your browser site settings (tap the lock or tune icon in the address bar), set Notifications to Allow, and refresh this page.')}
            </p>
          </div>
        )}

        {/* State B: Notifications Enabled */}
        {status === 'enabled' && (
          <div className="space-y-4">
            <p className="text-body text-ink">
              {t('notifications.enabledBody', 'Notifications are enabled on this device.')}
            </p>
            <p className="text-small text-muted leading-relaxed">
              {t('notifications.enabledDetails', 'You will receive instant alerts for appointment confirmations, OPD queue calls, diagnostic lab reports, and pharmacy order status updates even when GramSathi is closed.')}
            </p>
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <Button
                variant="secondary"
                size="sm"
                disabled
                className="opacity-90 cursor-default"
                icon={<span className="text-emerald-600 mr-1.5">✓</span>}
              >
                {t('notifications.enabledButton', 'Notifications Enabled')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                loading={actionLoading}
                onClick={handleDisable}
                className="text-muted hover:text-danger-600"
              >
                {t('notifications.disableButton', 'Disable on this device')}
              </Button>
            </div>
          </div>
        )}

        {/* State A: Not Enabled (Default) */}
        {(status === 'default' || status === 'loading') && (
          <div className="space-y-4">
            <p className="text-body text-ink">
              {t('notifications.defaultBody', 'Stay updated with important GramSathi alerts.')}
            </p>
            <p className="text-small text-muted leading-relaxed">
              {t('notifications.defaultDetails', 'Receive important GramSathi updates such as appointment reminders, doctor availability, diagnostic reports, and pharmacy updates directly on your device.')}
            </p>
            <div className="pt-1">
              <Button
                variant="primary"
                size="md"
                loading={actionLoading}
                disabled={status === 'loading'}
                onClick={handleEnable}
                id="enable-notifications-card-btn"
                icon={
                  <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                  </svg>
                }
              >
                {actionLoading
                  ? t('notifications.enabling', 'Enabling notifications...')
                  : t('notifications.enableButton', 'Enable Notifications')}
              </Button>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
