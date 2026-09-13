import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    isPushSupported,
    getPushPermissionStatus,
    getCurrentPushSubscription,
    subscribeToPush,
    unsubscribeFromPush
} from '../../lib/pushNotifications.js';
import { useNotifications } from '../../hooks/useNotifications.js';
import { useAuth } from '../../context/AuthContext.jsx';

// ─── Notification type → icon mapping ────────────────────────────────────────

function NotificationIcon({ type, className = 'w-5 h-5' }) {
    const d = (() => {
        if (type?.startsWith('EMERGENCY')) return 'M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z';
        if (type?.startsWith('APPOINTMENT')) return 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z';
        if (type?.startsWith('QUEUE') || type === 'DOCTOR_SESSION_READY') return 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z';
        if (type?.startsWith('PHARMACY')) return 'M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z';
        if (type?.startsWith('HEALTH_RECORD') || type === 'DIAGNOSTIC_REPORT_READY') return 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z';
        if (type?.startsWith('REFERRAL')) return 'M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z';
        // Default bell
        return 'M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9';
    })();

    return (
        <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d={d} />
        </svg>
    );
}

function iconBgFor(type) {
    if (type?.startsWith('EMERGENCY')) return 'bg-danger-50 text-danger-600';
    if (type?.startsWith('APPOINTMENT')) return 'bg-primary-50 text-primary-600';
    if (type?.startsWith('QUEUE') || type === 'DOCTOR_SESSION_READY') return 'bg-accent-50 text-accent-600';
    if (type?.startsWith('PHARMACY')) return 'bg-success-50 text-success-600';
    if (type?.startsWith('HEALTH_RECORD') || type === 'DIAGNOSTIC_REPORT_READY') return 'bg-warning-50 text-warning-600';
    if (type?.startsWith('REFERRAL')) return 'bg-purple-50 text-purple-600';
    return 'bg-surface-2 text-muted';
}

// ─── Relative time formatting ─────────────────────────────────────────────────

function relativeTime(dateStr) {
    if (!dateStr) return '';
    const diff = Date.now() - new Date(dateStr).getTime();
    const min = Math.floor(diff / 60000);
    if (min < 1) return 'Just now';
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const day = Math.floor(hr / 24);
    if (day === 1) return 'Yesterday';
    if (day < 7) return `${day}d ago`;
    return new Date(dateStr).toLocaleDateString();
}

// ─── Push Settings sub-panel ──────────────────────────────────────────────────

function PushSettingsPanel({ onBack }) {
    const [permission, setPermission] = useState('default');
    const [isSubscribed, setIsSubscribed] = useState(false);
    const [loading, setLoading] = useState(false);
    const [feedback, setFeedback] = useState(null);

    useEffect(() => {
        async function checkStatus() {
            if (!isPushSupported()) { setPermission('unsupported'); return; }
            setPermission(getPushPermissionStatus());
            const sub = await getCurrentPushSubscription();
            setIsSubscribed(Boolean(sub));
        }
        checkStatus();

        const onStatusChange = (e) => {
            setIsSubscribed(Boolean(e.detail?.subscribed));
            checkStatus();
        };
        window.addEventListener('gramsathi:push-status-changed', onStatusChange);
        return () => window.removeEventListener('gramsathi:push-status-changed', onStatusChange);
    }, []);

    const handleSubscribe = async () => {
        setLoading(true); setFeedback(null);
        try {
            const res = await subscribeToPush();
            if (res.success) { setIsSubscribed(true); setPermission('granted'); setFeedback({ type: 'success', message: 'Notifications enabled!' }); }
            else if (res.reason === 'permission_denied') { setPermission('denied'); setFeedback({ type: 'error', message: 'Permission denied in browser settings.' }); }
            else { setFeedback({ type: 'error', message: res.error || 'Could not enable notifications.' }); }
        } catch { setFeedback({ type: 'error', message: 'Unexpected error. Please try again.' }); }
        finally { setLoading(false); }
    };

    const handleUnsubscribe = async () => {
        setLoading(true); setFeedback(null);
        try {
            const res = await unsubscribeFromPush();
            if (res.success) { setIsSubscribed(false); setFeedback({ type: 'info', message: 'Notifications disabled on this device.' }); }
            else { setFeedback({ type: 'error', message: res.error || 'Failed to disable.' }); }
        } catch { setFeedback({ type: 'error', message: 'Error disabling notifications.' }); }
        finally { setLoading(false); }
    };

    const isEnabled = isSubscribed && permission === 'granted';

    return (
        <div>
            <div className="flex items-center gap-2 px-4 py-3 border-b border-line-soft">
                <button type="button" onClick={onBack} className="btn btn-icon btn-ghost btn-sm -ml-1" aria-label="Back to notifications">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
                </button>
                <h3 className="text-small font-semibold text-ink">Notification Settings</h3>
            </div>

            {feedback && (
                <div className="px-4 pt-3">
                    <div role="alert" className={`alert ${feedback.type === 'success' ? 'alert-success' : feedback.type === 'error' ? 'alert-error' : 'alert-info'}`}>
                        <span className="shrink-0 text-sm" aria-hidden="true">{feedback.type === 'success' ? '✓' : feedback.type === 'error' ? '⚠' : 'ℹ'}</span>
                        <span className="flex-1">{feedback.message}</span>
                    </div>
                </div>
            )}

            <div className="px-4 py-3 space-y-3">
                <div className="flex items-center justify-between">
                    <div>
                        <p className="text-small font-medium text-ink">Push Notifications</p>
                        <p className="text-caption text-muted">Alerts on your device</p>
                    </div>
                    <span className={`badge ${isEnabled ? 'badge-success' : permission === 'denied' ? 'badge-danger' : 'badge-neutral'}`}>
                        {isEnabled ? 'Active' : permission === 'denied' ? 'Blocked' : 'Inactive'}
                    </span>
                </div>

                {permission === 'unsupported' && (
                    <p className="text-caption text-muted p-3 bg-surface-2 rounded-xl border border-line">
                        Push notifications are not supported in this browser. On iOS, add GramSathi to your Home Screen.
                    </p>
                )}

                {permission === 'denied' && (
                    <div className="p-3 rounded-xl bg-warning-50 border border-warning-100">
                        <p className="text-caption font-medium text-warning-600">🚫 Blocked by browser</p>
                        <p className="text-caption text-muted mt-1">Open site settings (lock icon in address bar), set Notifications to Allow, then refresh.</p>
                    </div>
                )}

                {!isEnabled && permission !== 'denied' && permission !== 'unsupported' && (
                    <button type="button" id="enable-push-notifications-btn" onClick={handleSubscribe} disabled={loading} className="btn btn-primary btn-block">
                        {loading ? (<><svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" aria-hidden="true"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" /></svg>Enabling…</>) : 'Enable Push Notifications'}
                    </button>
                )}

                {isEnabled && (
                    <div className="flex items-center gap-2">
                        <span className="btn btn-secondary flex-1 cursor-default pointer-events-none opacity-90">
                            <span className="text-success-600 font-bold" aria-hidden="true">✓</span> Active on this device
                        </span>
                        <button type="button" id="disable-push-notifications-btn" onClick={handleUnsubscribe} disabled={loading} className="btn btn-sm btn-ghost text-muted hover:text-danger-500">
                            {loading ? 'Disabling…' : 'Disable'}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}

// ─── Individual notification item ─────────────────────────────────────────────

function NotificationItem({ notification, onRead, onNavigate }) {
    const handleClick = () => {
        if (!notification.isRead) onRead(notification._id);
        if (notification.link && notification.link !== '/') onNavigate(notification.link);
    };

    return (
        <button
            type="button"
            onClick={handleClick}
            className={`w-full text-left flex items-start gap-3 px-4 py-3 transition-colors hover:bg-surface-2 focus-visible:bg-surface-2 relative ${!notification.isRead ? 'bg-primary-50/40' : ''}`}
            aria-label={`${notification.isRead ? '' : 'Unread: '}${notification.title}`}
        >
            {/* Unread stripe */}
            {!notification.isRead && (
                <span className="absolute left-0 top-3 bottom-3 w-0.5 rounded-r-full bg-primary-600" aria-hidden="true" />
            )}

            {/* Icon */}
            <span className={`shrink-0 w-9 h-9 rounded-xl flex items-center justify-center mt-0.5 ${iconBgFor(notification.type)}`} aria-hidden="true">
                <NotificationIcon type={notification.type} className="w-4 h-4" />
            </span>

            {/* Content */}
            <span className="flex-1 min-w-0">
                <span className={`block text-small leading-snug truncate ${!notification.isRead ? 'font-semibold text-ink' : 'font-medium text-body'}`}>
                    {notification.title}
                </span>
                <span className="block text-caption text-muted leading-snug mt-0.5 line-clamp-2">
                    {notification.body}
                </span>
                <span className="block text-[0.6875rem] text-muted mt-1 tabular">
                    {relativeTime(notification.createdAt)}
                </span>
            </span>

            {/* Unread dot */}
            {!notification.isRead && (
                <span className="shrink-0 w-2 h-2 rounded-full bg-primary-600 mt-2" aria-hidden="true" />
            )}
        </button>
    );
}

// ─── Skeleton loading items ───────────────────────────────────────────────────

function NotificationSkeleton() {
    return (
        <div className="flex items-start gap-3 px-4 py-3 animate-pulse" aria-hidden="true">
            <div className="shrink-0 w-9 h-9 rounded-xl bg-surface-2" />
            <div className="flex-1 space-y-2 pt-0.5">
                <div className="h-3.5 bg-surface-2 rounded w-3/5" />
                <div className="h-3 bg-surface-2 rounded w-full" />
                <div className="h-2.5 bg-surface-2 rounded w-1/4" />
            </div>
        </div>
    );
}

// ─── Main NotificationBell component ─────────────────────────────────────────

export default function NotificationBell({ className = '' }) {
    const { user } = useAuth();
    const navigate = useNavigate();
    const [isOpen, setIsOpen] = useState(false);
    const [showSettings, setShowSettings] = useState(false);
    const popoverRef = useRef(null);

    const {
        notifications,
        unreadCount,
        loading,
        error,
        hasMore,
        listFetched,
        fetchMore,
        markRead,
        markAllRead,
        openCenter
    } = useNotifications();

    // Open center and trigger list load
    const handleOpen = () => {
        const next = !isOpen;
        setIsOpen(next);
        if (next) {
            setShowSettings(false);
            openCenter(true);
        }
    };

    // Close on outside click or Escape
    useEffect(() => {
        const onClickOutside = (e) => {
            if (popoverRef.current && !popoverRef.current.contains(e.target)) setIsOpen(false);
        };
        const onKeyDown = (e) => { if (e.key === 'Escape') setIsOpen(false); };

        if (isOpen) {
            document.addEventListener('mousedown', onClickOutside);
            document.addEventListener('keydown', onKeyDown);
        }
        return () => {
            document.removeEventListener('mousedown', onClickOutside);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [isOpen]);

    // Navigate using deep link (HashRouter: link is "/#/path")
    const handleNavigate = useCallback((link) => {
        setIsOpen(false);
        if (!link || link === '/') return;
        // Strip hash prefix so react-router navigate() works
        const path = link.startsWith('/#/') ? link.slice(2) : link;
        navigate(path);
    }, [navigate]);

    const badgeCount = Math.min(unreadCount, 99);

    return (
        <div className={`relative inline-block ${className}`} ref={popoverRef}>

            {/* ── Bell trigger button ── */}
            <button
                type="button"
                id="notification-bell-btn"
                onClick={handleOpen}
                aria-label={`Notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ''}`}
                aria-haspopup="true"
                aria-expanded={isOpen}
                className="btn btn-icon btn-ghost relative"
            >
                {/* Bell icon */}
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                </svg>

                {/* Unread count badge */}
                {unreadCount > 0 && (
                    <span
                        className="absolute -top-0.5 -right-0.5 min-w-[1.125rem] h-[1.125rem] px-1 rounded-full bg-danger-500 text-white text-[0.625rem] font-bold flex items-center justify-center tabular leading-none"
                        aria-hidden="true"
                    >
                        {badgeCount > 99 ? '99+' : badgeCount}
                    </span>
                )}
            </button>

            {/* ── Dropdown panel ── */}
            {isOpen && (
                <div
                    id="notification-center-panel"
                    role="dialog"
                    aria-label="Notification Center"
                    className="absolute right-0 mt-2 w-80 sm:w-96 bg-surface rounded-card border border-line shadow-raised z-50 text-left animate-rise-in overflow-hidden"
                    style={{ maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}
                >
                    {showSettings ? (
                        <PushSettingsPanel onBack={() => setShowSettings(false)} />
                    ) : (
                        <>
                            {/* Header */}
                            <div className="flex items-center justify-between px-4 py-3 border-b border-line-soft shrink-0">
                                <div className="flex items-center gap-2">
                                    <h3 className="text-small font-semibold text-ink">Notifications</h3>
                                    {unreadCount > 0 && (
                                        <span className="badge badge-primary text-[0.625rem] px-1.5 py-0.5">
                                            {unreadCount} unread
                                        </span>
                                    )}
                                </div>
                                <div className="flex items-center gap-1">
                                    {unreadCount > 0 && (
                                        <button
                                            type="button"
                                            onClick={markAllRead}
                                            className="text-caption text-primary-600 hover:text-primary-500 font-medium px-2 py-1 rounded-control hover:bg-primary-50 transition-colors"
                                        >
                                            Mark all read
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        id="notification-settings-btn"
                                        onClick={() => setShowSettings(true)}
                                        aria-label="Notification settings"
                                        className="btn btn-icon btn-ghost btn-sm"
                                    >
                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                        </svg>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setIsOpen(false)}
                                        aria-label="Close notifications"
                                        className="btn btn-icon btn-ghost btn-sm"
                                    >
                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                                    </button>
                                </div>
                            </div>

                            {/* Notification list */}
                            <div className="overflow-y-auto flex-1 divide-y divide-line-soft">

                                {/* Loading skeleton */}
                                {loading && !listFetched && (
                                    <>
                                        <NotificationSkeleton />
                                        <NotificationSkeleton />
                                        <NotificationSkeleton />
                                    </>
                                )}

                                {/* Error state */}
                                {error && !loading && (
                                    <div className="px-4 py-8 text-center">
                                        <p className="text-caption text-muted">{error}</p>
                                    </div>
                                )}

                                {/* Empty state */}
                                {!loading && !error && listFetched && notifications.length === 0 && (
                                    <div className="px-4 py-10 text-center">
                                        <div className="w-10 h-10 mx-auto mb-3 flex items-center justify-center rounded-full bg-surface-2 text-muted">
                                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                                            </svg>
                                        </div>
                                        <p className="text-small font-medium text-ink">You're all caught up</p>
                                        <p className="text-caption text-muted mt-1">Important GramSathi updates will appear here.</p>
                                    </div>
                                )}

                                {/* Notification items */}
                                {notifications.map(n => (
                                    <NotificationItem
                                        key={n._id}
                                        notification={n}
                                        onRead={markRead}
                                        onNavigate={handleNavigate}
                                    />
                                ))}

                                {/* Load more */}
                                {hasMore && !loading && (
                                    <div className="px-4 py-3">
                                        <button
                                            type="button"
                                            onClick={fetchMore}
                                            className="btn btn-secondary btn-block btn-sm"
                                        >
                                            Load more
                                        </button>
                                    </div>
                                )}

                                {/* Loading more spinner */}
                                {loading && listFetched && (
                                    <div className="px-4 py-3 flex justify-center">
                                        <svg className="animate-spin h-4 w-4 text-muted" viewBox="0 0 24 24" aria-hidden="true">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                                            <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                                        </svg>
                                    </div>
                                )}
                            </div>

                            {/* Footer */}
                            <div className="px-4 py-2.5 border-t border-line-soft shrink-0 bg-surface-2/50">
                                <button
                                    type="button"
                                    onClick={() => { setIsOpen(false); navigate(`/${user?.role || 'patient'}/notifications`); }}
                                    className="text-caption text-primary-600 hover:text-primary-500 font-medium w-full text-center py-1 rounded-control hover:bg-primary-50 transition-colors block"
                                >
                                    View all notifications →
                                </button>
                            </div>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}
