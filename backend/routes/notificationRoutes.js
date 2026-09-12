import express from 'express';
import { authRequired } from '../middleware/authMiddleware.js';
import {
    getPublicKey,
    subscribe,
    unsubscribe,
    testPush,
    testEmail,
    getNotifications,
    getUnreadCount,
    markRead,
    markAllRead
} from '../controllers/notificationController.js';

const router = express.Router();

// ─── Push Subscription Management ────────────────────────────────────────────

// Public VAPID key (required by the browser before subscribe)
router.get('/push/public-key', authRequired, getPublicKey);

// Push subscription lifecycle
router.post('/push/subscribe', authRequired, subscribe);
router.post('/push/unsubscribe', authRequired, unsubscribe);

// Diagnostic test endpoints (sends only to the caller's own account/devices)
router.post('/push/test', authRequired, testPush);
router.post('/test-email', authRequired, testEmail);

// ─── In-App Notification History ─────────────────────────────────────────────
// All routes: userId is derived from the JWT token, never from query params.

// GET  /api/notifications              — paginated list (page, limit, unreadOnly)
router.get('/', authRequired, getNotifications);

// GET  /api/notifications/unread-count — lightweight unread badge count
router.get('/unread-count', authRequired, getUnreadCount);

// PATCH /api/notifications/read-all    — mark all as read (must come before /:id)
router.patch('/read-all', authRequired, markAllRead);

// PATCH /api/notifications/:id/read    — mark one notification as read
router.patch('/:id/read', authRequired, markRead);

export default router;
