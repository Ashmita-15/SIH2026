import React, { useState, useEffect, useRef } from 'react';
import {
  isPushSupported,
  getPushPermissionStatus,
  getCurrentPushSubscription,
  subscribeToPush,
  unsubscribeFromPush
} from '../../lib/pushNotifications.js';

export default function NotificationBell({ className = '' }) {
  const [isOpen, setIsOpen] = useState(false);
  const [permission, setPermission] = useState('default');
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const popoverRef = useRef(null);

  const checkStatus = async () => {
    if (!isPushSupported()) {
      setPermission('unsupported');
      setIsSubscribed(false);
      return;
    }
    const perm = getPushPermissionStatus();
    setPermission(perm);

    const sub = await getCurrentPushSubscription();
    setIsSubscribed(Boolean(sub));
  };

  useEffect(() => {
    checkStatus();

    const handleStatusChange = (e) => {
      setIsSubscribed(Boolean(e.detail?.subscribed));
      checkStatus();
    };

    window.addEventListener('gramsathi:push-status-changed', handleStatusChange);
    return () => window.removeEventListener('gramsathi:push-status-changed', handleStatusChange);
  }, []);

  // Close dropdown on click outside or Escape
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') setIsOpen(false);
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const handleSubscribe = async () => {
    setLoading(true);
    setFeedback(null);
    try {
      const res = await subscribeToPush();
      if (res.success) {
        setIsSubscribed(true);
        setPermission('granted');
        setFeedback({ type: 'success', message: 'Notifications enabled successfully!' });
      } else if (res.reason === 'permission_denied') {
        setPermission('denied');
        setFeedback({ type: 'error', message: 'Notification permission was denied in browser.' });
      } else {
        setFeedback({ type: 'error', message: res.error || 'Could not enable notifications.' });
      }
    } catch (err) {
      setFeedback({ type: 'error', message: 'An unexpected error occurred.' });
    } finally {
      setLoading(false);
    }
  };

  const handleUnsubscribe = async () => {
    setLoading(true);
    setFeedback(null);
    try {
      const res = await unsubscribeFromPush();
      if (res.success) {
        setIsSubscribed(false);
        setFeedback({ type: 'info', message: 'Notifications disabled on this device.' });
      } else {
        setFeedback({ type: 'error', message: res.error || 'Failed to disable.' });
      }
    } catch (err) {
      setFeedback({ type: 'error', message: 'Error disabling notifications.' });
    } finally {
      setLoading(false);
    }
  };

  const isEnabled = isSubscribed && permission === 'granted';

  // Determine dot color class
  const dotColor = isEnabled
    ? 'bg-success-500'
    : permission === 'denied'
      ? 'bg-danger-500'
      : 'bg-warning-500';

  // Determine status badge style
  const statusConfig = isEnabled
    ? { label: 'Active', classes: 'badge badge-success' }
    : permission === 'denied'
      ? { label: 'Blocked', classes: 'badge badge-danger' }
      : { label: 'Inactive', classes: 'badge badge-neutral' };

  return (
    <div className={`relative inline-block text-left ${className}`} ref={popoverRef}>
      {/* Trigger Button */}
      <button
        type="button"
        id="push-notification-bell-btn"
        onClick={() => {
          setIsOpen(!isOpen);
          setFeedback(null);
        }}
        aria-label="Push Notifications"
        aria-haspopup="true"
        aria-expanded={isOpen}
        className="btn btn-icon btn-ghost"
      >
        {/* Bell Icon */}
        <svg
          className="w-5 h-5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth="1.8"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0"
          />
        </svg>

        {/* Status Indicator Dot */}
        <span
          className={`absolute top-1.5 right-1.5 w-2.5 h-2.5 rounded-full border-2 border-surface ${dotColor}`}
          aria-hidden="true"
        />
      </button>

      {/* Popover Dropdown */}
      {isOpen && (
        <div
          id="push-notification-dropdown"
          role="region"
          aria-label="Notification settings"
          className="absolute right-0 mt-2 w-80 sm:w-96 bg-surface rounded-card border border-line shadow-raised p-0 z-50 text-left animate-rise-in"
        >
          {/* Header */}
          <div className="flex items-center justify-between p-4 pb-3 border-b border-line-soft">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-primary-50 flex items-center justify-center text-primary-600 shrink-0">
                <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                </svg>
              </div>
              <div>
                <h3 className="text-small font-semibold text-ink leading-tight">Push Notifications</h3>
                <p className="text-caption text-muted">Stay alerted on appointments & reports</p>
              </div>
            </div>
            <span className={statusConfig.classes}>
              {statusConfig.label}
            </span>
          </div>

          {/* Feedback Message */}
          {feedback && (
            <div className="px-4 pt-3">
              <div
                role="alert"
                className={`alert ${
                  feedback.type === 'success'
                    ? 'alert-success'
                    : feedback.type === 'error'
                      ? 'alert-error'
                      : 'alert-info'
                }`}
              >
                <span className="shrink-0 text-sm" aria-hidden="true">
                  {feedback.type === 'success' ? '✓' : feedback.type === 'error' ? '⚠' : 'ℹ'}
                </span>
                <span className="flex-1">{feedback.message}</span>
              </div>
            </div>
          )}

          {/* Body Content based on Status */}
          <div className="px-4 py-3">
            {permission === 'unsupported' ? (
              <div className="p-3 rounded-xl bg-surface-2 border border-line text-caption text-muted leading-relaxed">
                Web Push notifications are not supported in this browser or private browsing mode.
                For Android, use Chrome or Firefox; for iOS, add GramSathi to your Home Screen.
              </div>
            ) : permission === 'denied' ? (
              <div className="p-3 rounded-xl bg-warning-50 border border-warning-100 space-y-1.5">
                <p className="text-small font-medium text-warning-600 flex items-center gap-1.5">
                  <span aria-hidden="true">🚫</span>
                  Notifications are blocked by your browser
                </p>
                <p className="text-caption text-muted leading-relaxed">
                  Open your browser site settings (lock or tune icon in the address bar), set Notifications to <em>Allow</em>, and refresh.
                </p>
              </div>
            ) : isEnabled ? (
              <div className="space-y-2">
                <p className="text-small text-ink font-medium flex items-center gap-1.5">
                  <span className="text-success-500" aria-hidden="true">✓</span>
                  Receiving alerts on this device
                </p>
                <ul className="text-caption space-y-1 pl-5 list-disc text-muted">
                  <li>Appointment confirmations & doctor notes</li>
                  <li>OPD queue turns & estimated arrival times</li>
                  <li>Diagnostic lab results readiness</li>
                  <li>Pharmacy medicine order status updates</li>
                </ul>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-small text-ink font-medium">
                  Receive instant alerts even when the app is closed
                </p>
                <p className="text-caption text-muted leading-relaxed">
                  Get notified when a doctor confirms your consultation, when your queue turn arrives, and when medical reports are ready.
                </p>
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="px-4 pb-4 pt-1 border-t border-line-soft">
            {/* STATE: Not subscribed & permission not denied/unsupported → Show Enable button */}
            {!isEnabled && permission !== 'denied' && permission !== 'unsupported' && (
              <button
                type="button"
                id="enable-push-notifications-btn"
                onClick={handleSubscribe}
                disabled={loading}
                className="btn btn-primary btn-block"
              >
                {loading ? (
                  <>
                    <svg className="animate-spin h-4 w-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                    </svg>
                    Connecting...
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                    </svg>
                    Enable Notifications
                  </>
                )}
              </button>
            )}

            {/* STATE: Subscribed & enabled → Show Active + Disable */}
            {isEnabled && (
              <div className="flex items-center gap-2">
                <span className="btn btn-secondary flex-1 cursor-default pointer-events-none opacity-90">
                  <span className="text-success-600 font-bold" aria-hidden="true">✓</span>
                  Active
                </span>
                <button
                  type="button"
                  id="disable-push-notifications-btn"
                  onClick={handleUnsubscribe}
                  disabled={loading}
                  className="btn btn-sm btn-ghost text-muted hover:text-danger-500"
                >
                  {loading ? 'Disabling...' : 'Disable'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
