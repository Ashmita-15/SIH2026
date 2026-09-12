import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import Page from '../components/app/Page.jsx';
import Skeleton from '../components/ui/Skeleton.jsx';
import { EmptyState, ErrorState } from '../components/ui/States.jsx';
import Button from '../components/ui/Button.jsx';
import { useNotifications } from '../hooks/useNotifications.js';
import NotificationCard from '../components/notifications/NotificationCard.jsx';

// ─── Notification type → icon ─────────────────────────────────────────────────

function iconPathFor(type) {
    if (type?.startsWith('APPOINTMENT')) return 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z';
    if (type?.startsWith('QUEUE') || type === 'DOCTOR_SESSION_READY') return 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z';
    if (type?.startsWith('PHARMACY')) return 'M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z';
    if (type?.startsWith('HEALTH_RECORD') || type === 'DIAGNOSTIC_REPORT_READY') return 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z';
    if (type?.startsWith('REFERRAL')) return 'M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z';
    return 'M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9';
}

function iconBgFor(type) {
    if (type?.startsWith('APPOINTMENT')) return 'bg-primary-50 text-primary-600';
    if (type?.startsWith('QUEUE') || type === 'DOCTOR_SESSION_READY') return 'bg-accent-50 text-accent-600';
    if (type?.startsWith('PHARMACY')) return 'bg-success-50 text-success-600';
    if (type?.startsWith('HEALTH_RECORD') || type === 'DIAGNOSTIC_REPORT_READY') return 'bg-warning-50 text-warning-600';
    if (type?.startsWith('REFERRAL')) return 'bg-purple-50 text-purple-600';
    return 'bg-surface-2 text-muted';
}

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
    return new Date(dateStr).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

// ─── Notification row on the page ─────────────────────────────────────────────

function NotificationRow({ notification, onRead, onNavigate }) {
    const handleClick = () => {
        if (!notification.isRead) onRead(notification._id);
        if (notification.link && notification.link !== '/') onNavigate(notification.link);
    };

    return (
        <button
            type="button"
            onClick={handleClick}
            className={`w-full text-left flex items-start gap-4 p-4 sm:p-5 transition-colors hover:bg-surface-2 focus-visible:bg-surface-2 rounded-card relative ${!notification.isRead ? 'bg-primary-50/30 border-l-2 border-primary-500' : 'border-l-2 border-transparent'}`}
            aria-label={`${notification.isRead ? '' : 'Unread: '}${notification.title}`}
        >
            {/* Icon */}
            <span className={`shrink-0 w-11 h-11 rounded-xl flex items-center justify-center mt-0.5 ${iconBgFor(notification.type)}`} aria-hidden="true">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
                    <path strokeLinecap="round" strokeLinejoin="round" d={iconPathFor(notification.type)} />
                </svg>
            </span>

            {/* Content */}
            <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                    <p className={`text-small leading-snug ${!notification.isRead ? 'font-semibold text-ink' : 'font-medium text-body'}`}>
                        {notification.title}
                    </p>
                    <span className="text-caption text-muted tabular shrink-0 mt-0.5">
                        {relativeTime(notification.createdAt)}
                    </span>
                </div>
                <p className="text-caption text-muted mt-0.5 leading-relaxed">
                    {notification.body}
                </p>
                {notification.link && notification.link !== '/' && (
                    <p className="text-caption text-primary-600 mt-1.5 font-medium">
                        Tap to view →
                    </p>
                )}
            </div>

            {/* Unread dot */}
            {!notification.isRead && (
                <span className="shrink-0 w-2.5 h-2.5 rounded-full bg-primary-600 mt-1.5" aria-hidden="true" />
            )}
        </button>
    );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function NotificationRowSkeleton() {
    return (
        <div className="flex items-start gap-4 p-4 sm:p-5 animate-pulse" aria-hidden="true">
            <div className="shrink-0 w-11 h-11 rounded-xl bg-surface-2" />
            <div className="flex-1 space-y-2 pt-1">
                <div className="flex items-start justify-between gap-2">
                    <div className="h-3.5 bg-surface-2 rounded w-2/5" />
                    <div className="h-3 bg-surface-2 rounded w-12" />
                </div>
                <div className="h-3 bg-surface-2 rounded w-full" />
                <div className="h-3 bg-surface-2 rounded w-3/5" />
            </div>
        </div>
    );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

const TABS = [
    { id: 'all', label: 'All' },
    { id: 'unread', label: 'Unread' }
];

export default function NotificationsPage() {
    const navigate = useNavigate();
    const [tab, setTab] = useState('all');

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
        openCenter,
        refresh
    } = useNotifications();

    // Load notification list on page mount
    useEffect(() => {
        openCenter(true);
    }, [openCenter]);

    const handleNavigate = useCallback((link) => {
        if (!link || link === '/') return;
        const path = link.startsWith('/#/') ? link.slice(2) : link;
        navigate(path);
    }, [navigate]);

    const displayedNotifications = tab === 'unread'
        ? notifications.filter(n => !n.isRead)
        : notifications;

    return (
        <Page title="Notifications">
            <div className="container-app py-6 max-w-2xl">

                {/* Page header */}
                <div className="flex items-center justify-between mb-5">
                    <div>
                        <h1 className="text-heading font-bold text-ink">Notifications</h1>
                        {unreadCount > 0 && (
                            <p className="text-caption text-muted mt-0.5">{unreadCount} unread</p>
                        )}
                    </div>
                    {unreadCount > 0 && (
                        <Button variant="secondary" size="sm" onClick={markAllRead}>
                            Mark all read
                        </Button>
                    )}
                </div>

                {/* Tabs */}
                <div className="flex gap-1 p-1 bg-surface-2 rounded-xl mb-4">
                    {TABS.map(t => (
                        <button
                            key={t.id}
                            type="button"
                            onClick={() => setTab(t.id)}
                            className={`flex-1 py-2 text-small font-medium rounded-lg transition-colors ${tab === t.id ? 'bg-surface text-ink shadow-rest' : 'text-muted hover:text-body'}`}
                        >
                            {t.label}
                            {t.id === 'unread' && unreadCount > 0 && (
                                <span className="ml-1.5 inline-flex items-center justify-center min-w-[1.1rem] h-[1.1rem] px-1 rounded-full bg-danger-500 text-white text-[0.6rem] font-bold leading-none tabular">
                                    {unreadCount}
                                </span>
                            )}
                        </button>
                    ))}
                </div>

                {/* Notification list */}
                <div className="card overflow-hidden">

                    {/* Loading skeleton */}
                    {loading && !listFetched && (
                        <div className="divide-y divide-line-soft">
                            {[1, 2, 3, 4, 5].map(i => <NotificationRowSkeleton key={i} />)}
                        </div>
                    )}

                    {/* Error */}
                    {error && !loading && (
                        <div className="card-body">
                            <ErrorState
                                title="Couldn't load notifications"
                                message="Something went wrong. Please try again."
                                onRetry={refresh}
                                retryLabel="Try again"
                            />
                        </div>
                    )}

                    {/* Empty: unread tab */}
                    {!loading && !error && listFetched && tab === 'unread' && displayedNotifications.length === 0 && (
                        <div className="card-body">
                            <EmptyState
                                icon={
                                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                }
                                title="All caught up"
                                message="No unread notifications."
                            />
                        </div>
                    )}

                    {/* Empty: all tab */}
                    {!loading && !error && listFetched && tab === 'all' && displayedNotifications.length === 0 && (
                        <div className="card-body">
                            <EmptyState
                                icon={
                                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                                    </svg>
                                }
                                title="You're all caught up"
                                message="Important GramSathi updates will appear here."
                            />
                        </div>
                    )}

                    {/* Notification rows */}
                    {displayedNotifications.length > 0 && (
                        <div className="divide-y divide-line-soft">
                            {displayedNotifications.map(n => (
                                <NotificationRow
                                    key={n._id}
                                    notification={n}
                                    onRead={markRead}
                                    onNavigate={handleNavigate}
                                />
                            ))}
                        </div>
                    )}

                    {/* Load more */}
                    {hasMore && !loading && tab === 'all' && (
                        <div className="card-footer">
                            <Button variant="secondary" className="w-full" onClick={fetchMore}>
                                Load more
                            </Button>
                        </div>
                    )}

                    {/* Loading more */}
                    {loading && listFetched && (
                        <div className="py-4 flex justify-center">
                            <svg className="animate-spin h-5 w-5 text-muted" viewBox="0 0 24 24" aria-hidden="true">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                                <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                            </svg>
                        </div>
                    )}
                </div>

                {/* Push notification settings card */}
                <div className="mt-6">
                    <NotificationCard />
                </div>

            </div>
        </Page>
    );
}
