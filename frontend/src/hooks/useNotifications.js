import { useState, useEffect, useCallback, useRef } from 'react'
import api from '../services/api.js'

/**
 * useNotifications — Central hook for the GramSathi Notification Center.
 *
 * Provides:
 *   - notifications: paginated list (loaded on demand)
 *   - unreadCount: number (polled every 30s; lightweight)
 *   - loading, error, hasMore
 *   - fetchMore(): load next page
 *   - markRead(id): mark one notification read
 *   - markAllRead(): mark all read
 *   - refresh(): re-fetch current list + unread count
 *   - openCenter(true/false): toggle that also triggers lazy list load
 *
 * Design:
 * - Unread count is polled every POLL_INTERVAL_MS while the app is in the foreground.
 * - The full notification list is only fetched when the user opens the Notification Center.
 * - markRead() updates local state immediately (optimistic) before the API call completes.
 */

const POLL_INTERVAL_MS = 30_000; // 30 seconds
const PAGE_LIMIT = 20;

export function useNotifications() {
    const [notifications, setNotifications] = useState([])
    const [unreadCount, setUnreadCount] = useState(0)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(null)
    const [page, setPage] = useState(1)
    const [hasMore, setHasMore] = useState(false)
    const [listFetched, setListFetched] = useState(false)

    const pollIntervalRef = useRef(null)
    const isMountedRef = useRef(true)

    // ── Fetch unread count (lightweight) ──────────────────────────────────
    const fetchUnreadCount = useCallback(async () => {
        try {
            const { data } = await api.get('/notifications/unread-count')
            if (isMountedRef.current) {
                setUnreadCount(data.count ?? 0)
            }
        } catch {
            // Silently fail — unread count is a UI enhancement, not a blocker
        }
    }, [])

    // ── Fetch notification list (paginated) ───────────────────────────────
    const fetchPage = useCallback(async (pageNum = 1, append = false) => {
        if (!isMountedRef.current) return
        setLoading(true)
        setError(null)
        try {
            const { data } = await api.get('/notifications', {
                params: { page: pageNum, limit: PAGE_LIMIT }
            })
            if (!isMountedRef.current) return
            setNotifications(prev =>
                append ? [...prev, ...(data.notifications || [])] : (data.notifications || [])
            )
            setHasMore(data.hasMore ?? false)
            setPage(pageNum)
            setListFetched(true)
        } catch (err) {
            if (isMountedRef.current) {
                setError("Couldn't load notifications. Try again.")
            }
        } finally {
            if (isMountedRef.current) setLoading(false)
        }
    }, [])

    // ── Load more ─────────────────────────────────────────────────────────
    const fetchMore = useCallback(() => {
        if (!loading && hasMore) fetchPage(page + 1, true)
    }, [loading, hasMore, page, fetchPage])

    // ── Refresh both list and count ───────────────────────────────────────
    const refresh = useCallback(() => {
        fetchUnreadCount()
        if (listFetched) fetchPage(1, false)
    }, [fetchUnreadCount, fetchPage, listFetched])

    // ── Load list on first open of notification center ────────────────────
    const openCenter = useCallback((isOpen) => {
        if (isOpen && !listFetched) {
            fetchPage(1, false)
        }
    }, [listFetched, fetchPage])

    // ── Mark one notification as read ─────────────────────────────────────
    const markRead = useCallback(async (id) => {
        if (!id) return
        // Optimistic update
        setNotifications(prev =>
            prev.map(n => n._id === id ? { ...n, isRead: true, readAt: new Date().toISOString() } : n)
        )
        setUnreadCount(prev => Math.max(0, prev - 1))

        try {
            await api.patch(`/notifications/${id}/read`)
        } catch (err) {
            // Revert optimistic update on failure
            console.error('[useNotifications] markRead failed:', err.message)
            setNotifications(prev =>
                prev.map(n => n._id === id ? { ...n, isRead: false, readAt: null } : n)
            )
            setUnreadCount(prev => prev + 1)
        }
    }, [])

    // ── Mark all as read ─────────────────────────────────────────────────
    const markAllRead = useCallback(async () => {
        // Optimistic update
        const now = new Date().toISOString()
        setNotifications(prev => prev.map(n => ({ ...n, isRead: true, readAt: now })))
        const prevCount = unreadCount
        setUnreadCount(0)

        try {
            await api.patch('/notifications/read-all')
        } catch (err) {
            console.error('[useNotifications] markAllRead failed:', err.message)
            // Revert
            setNotifications(prev => prev.map((n, i) => ({
                ...n,
                isRead: i < prevCount ? false : n.isRead,
                readAt: i < prevCount ? null : n.readAt
            })))
            setUnreadCount(prevCount)
        }
    }, [unreadCount])

    // ── Mount: initial unread count + polling ─────────────────────────────
    useEffect(() => {
        isMountedRef.current = true
        fetchUnreadCount()

        pollIntervalRef.current = setInterval(fetchUnreadCount, POLL_INTERVAL_MS)

        return () => {
            isMountedRef.current = false
            clearInterval(pollIntervalRef.current)
        }
    }, [fetchUnreadCount])

    // ── Listen for custom push-received events to refresh count ───────────
    useEffect(() => {
        const onPushReceived = () => {
            fetchUnreadCount()
            if (listFetched) fetchPage(1, false)
        }

        window.addEventListener('gramsathi:notification-received', onPushReceived)
        window.addEventListener('gramsathi:push-status-changed', onPushReceived)

        return () => {
            window.removeEventListener('gramsathi:notification-received', onPushReceived)
            window.removeEventListener('gramsathi:push-status-changed', onPushReceived)
        }
    }, [fetchUnreadCount, fetchPage, listFetched])

    return {
        notifications,
        unreadCount,
        loading,
        error,
        hasMore,
        listFetched,
        fetchMore,
        markRead,
        markAllRead,
        refresh,
        openCenter
    }
}
