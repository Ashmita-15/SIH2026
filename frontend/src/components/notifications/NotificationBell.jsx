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
        className="relative p-2 rounded-control text-ink hover:bg-surface-2 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40"
      >
        {/* Bell Icon */}
        <svg
          className="w-5 h-5 text-ink"
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
          className={`absolute top-1.5 right-1.5 w-2.5 h-2.5 rounded-full border-2 border-surface ${
            isEnabled ? 'bg-emerald-500' : permission === 'denied' ? 'bg-rose-500' : 'bg-amber-400'
          }`}
          aria-hidden="true"
        />
      </button>

      {/* Popover Dropdown */}
      {isOpen && (
        <div
          id="push-notification-dropdown"
          role="region"
          aria-label="Notification settings"
          className="absolute right-0 mt-2 w-80 sm:w-96 rounded-2xl bg-surface border border-line shadow-xl p-4 z-50 text-left animate-in fade-in duration-150"
        >
          {/* Header */}
          <div className="flex items-center justify-between pb-3 border-b border-line-soft">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                </svg>
              </div>
              <div>
                <h3 className="text-small font-semibold text-ink">Push Notifications</h3>
                <p className="text-caption text-muted">Stay alerted on appointments &amp; reports</p>
              </div>
            </div>

            <span
              className={`text-caption px-2 py-0.5 rounded-full font-medium ${
                isEnabled
                  ? 'bg-emerald-100 text-emerald-800'
                  : permission === 'denied'
                  ? 'bg-rose-100 text-rose-800'
                  : 'bg-amber-100 text-amber-800'
              }`}
            >
              {isEnabled ? 'Active' : permission === 'denied' ? 'Blocked' : 'Inactive'}
            </span>
          </div>

          {/* Feedback Message */}
          {feedback && (
            <div
              className={`mt-3 p-2.5 rounded-xl text-caption flex items-start gap-2 ${
                feedback.type === 'success'
                  ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                  : feedback.type === 'error'
                  ? 'bg-rose-50 text-rose-800 border border-rose-200'
                  : 'bg-slate-50 text-slate-700 border border-slate-200'
              }`}
            >
              <span className="shrink-0 text-sm">
                {feedback.type === 'success' ? '✓' : feedback.type === 'error' ? '⚠' : 'ℹ'}
              </span>
              <span className="flex-1">{feedback.message}</span>
            </div>
          )}

          {/* Body Content based on Status */}
          <div className="py-3 text-small text-muted">
            {permission === 'unsupported' ? (
              <p className="text-caption leading-relaxed">
                Web Push notifications are not supported in this browser or private browsing mode. For Android, use Chrome or Firefox; for iOS, add GramSathi to your Home Screen.
              </p>
            ) : permission === 'denied' ? (
              <div className="space-y-2">
                <p className="text-caption leading-relaxed text-ink">
                  Notifications are currently <strong>blocked</strong> by your browser.
                </p>
                <p className="text-caption leading-relaxed text-muted">
                  To receive updates, open your browser site settings (lock or tune icon in the address bar), set Notifications to <em>Allow</em>, and refresh.
                </p>
              </div>
            ) : isEnabled ? (
              <div className="space-y-2">
                <p className="text-caption leading-relaxed text-ink">
                  ✓ This device is subscribed to receive instant alerts for:
                </p>
                <ul className="text-caption space-y-1 pl-3 list-disc text-muted">
                  <li>Appointment confirmations &amp; doctor notes</li>
                  <li>OPD queue turns &amp; estimated arrival times</li>
                  <li>Diagnostic lab results readiness</li>
                  <li>Pharmacy medicine order status updates</li>
                </ul>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-caption leading-relaxed text-ink font-medium">
                  Receive instant alerts even when the app is closed:
                </p>
                <p className="text-caption leading-relaxed text-muted">
                  Get notified when a doctor confirms your consultation, when your queue turn arrives, and when medical reports are ready.
                </p>
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="pt-2 border-t border-line-soft flex flex-col gap-2">
            {!isEnabled && permission !== 'denied' && permission !== 'unsupported' && (
              <button
                type="button"
                id="enable-push-notifications-btn"
                onClick={handleSubscribe}
                disabled={loading}
                className="w-full py-2 px-3 bg-primary hover:bg-primary-hover text-white rounded-control font-medium text-small flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
              >
                {loading ? (
                  <>
                    <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Connecting...
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                    </svg>
                    Enable Notifications
                  </>
                )}
              </button>
            )}

            {isEnabled && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled
                  className="flex-1 py-1.5 px-3 bg-emerald-50 text-emerald-800 rounded-control text-small font-medium border border-emerald-200 cursor-default flex items-center justify-center gap-1.5"
                >
                  <span className="text-emerald-600 font-bold">✓</span>
                  <span>Active</span>
                </button>
                <button
                  type="button"
                  id="disable-push-notifications-btn"
                  onClick={handleUnsubscribe}
                  disabled={loading}
                  className="py-1.5 px-3 text-rose-600 hover:bg-rose-50 rounded-control text-caption font-medium transition-colors disabled:opacity-50"
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
