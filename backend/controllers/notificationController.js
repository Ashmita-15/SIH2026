import {
    getVapidPublicKey,
    saveSubscription,
    removeSubscription,
    sendPushToUser,
    isValidSubscription
} from '../services/notifications/pushService.js';
import { sendMail } from '../services/notifications/mailer.js';
import User from '../models/User.js';
import Notification from '../models/Notification.js';

/**
 * Controller for Push, Email, and In-App Notification management.
 *
 * Security Requirements:
 * - All mutations and queries require authentication.
 * - userId is ALWAYS derived from req.user.id (JWT token). Never from query params or body.
 * - A user can only access, modify, or delete their OWN notifications.
 */

// ─── Push Subscription Management ────────────────────────────────────────────

/**
 * GET /api/notifications/push/public-key
 * Returns the VAPID public key for PushManager.subscribe().
 */
export const getPublicKey = (req, res) => {
    const publicKey = getVapidPublicKey();
    if (!publicKey) {
        return res.status(503).json({
            message: 'Web Push is not configured on this server (missing VAPID_PUBLIC_KEY)'
        });
    }
    return res.json({ publicKey });
};

/**
 * POST /api/notifications/push/subscribe
 * Registers or updates a push subscription for the authenticated user.
 */
export const subscribe = async (req, res) => {
    try {
        const subscriptionData = req.body;
        if (!isValidSubscription(subscriptionData)) {
            return res.status(400).json({ message: 'Invalid subscription payload. Must contain endpoint and keys.' });
        }

        const userAgent = req.headers['user-agent'] || '';
        const saved = await saveSubscription(req.user.id, subscriptionData, userAgent);

        return res.status(201).json({
            success: true,
            message: 'Subscription registered successfully',
            id: saved._id
        });
    } catch (err) {
        console.error('[notificationController/subscribe] Error:', err.message);
        return res.status(500).json({ message: 'Failed to save subscription', error: err.message });
    }
};

/**
 * POST /api/notifications/push/unsubscribe
 * Deactivates or removes a push subscription for the authenticated user.
 */
export const unsubscribe = async (req, res) => {
    try {
        const { endpoint } = req.body;
        if (!endpoint) {
            return res.status(400).json({ message: 'endpoint is required to unsubscribe' });
        }

        const removed = await removeSubscription(req.user.id, endpoint);
        return res.json({
            success: true,
            message: removed ? 'Subscription deactivated' : 'Subscription not found'
        });
    } catch (err) {
        console.error('[notificationController/unsubscribe] Error:', err.message);
        return res.status(500).json({ message: 'Failed to remove subscription', error: err.message });
    }
};

/**
 * POST /api/notifications/push/test
 * Sends a test push notification to the authenticated user's registered devices.
 */
export const testPush = async (req, res) => {
    try {
        const result = await sendPushToUser(req.user.id, {
            title: 'GramSathi Push Verification',
            body: 'Web Push notifications are working properly on your device!',
            tag: `test-push-${Date.now()}`,
            data: {
                url: '/',
                type: 'test_notification'
            }
        });

        return res.json({
            success: result.sent > 0,
            message: result.sent > 0
                ? `Dispatched to ${result.sent} device(s)`
                : 'No active device subscriptions found for your account',
            diagnostics: result
        });
    } catch (err) {
        console.error('[notificationController/testPush] Error:', err.message);
        return res.status(500).json({ message: 'Failed to send test push', error: err.message });
    }
};

/**
 * POST /api/notifications/test-email
 * Sends a diagnostic test email to the authenticated user's email address.
 */
export const testEmail = async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('name email');
        if (!user || !user.email) {
            return res.status(400).json({ message: 'User does not have an email address associated with their profile' });
        }

        const subject = 'GramSathi Email Delivery Diagnostic Test';
        const html = `
            <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #E2E8F0; rounded: 8px;">
                <h2 style="color: #0B5F63; margin-top: 0;">GramSathi Email System Diagnostic</h2>
                <p>Hello <strong>${user.name}</strong>,</p>
                <p>This is a test notification confirming that the GramSathi email delivery service is operational.</p>
                <div style="background: #F1F5F9; padding: 16px; border-radius: 6px; font-family: monospace; font-size: 13px;">
                    <div><strong>Timestamp:</strong> ${new Date().toISOString()}</div>
                    <div><strong>Recipient:</strong> ${user.email}</div>
                    <div><strong>Server Environment:</strong> ${process.env.NODE_ENV || 'development'}</div>
                </div>
                <p style="color: #64748B; font-size: 12px; margin-top: 24px;">GramSathi &bull; Telemedicine &amp; Healthcare for Rural Communities</p>
            </div>
        `;

        const result = await sendMail({ to: user.email, subject, html });

        return res.json({
            success: result.success,
            recipient: user.email,
            diagnostics: result
        });
    } catch (err) {
        console.error('[notificationController/testEmail] Error:', err.message);
        return res.status(500).json({ message: 'Failed to send test email', error: err.message });
    }
};

// ─── In-App Notification History ─────────────────────────────────────────────

/**
 * GET /api/notifications
 * Returns paginated notification history for the authenticated user.
 * Query params: page (default: 1), limit (default: 20), unreadOnly (boolean)
 */
export const getNotifications = async (req, res) => {
    try {
        const userId = req.user.id;
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
        const unreadOnly = req.query.unreadOnly === 'true';

        const query = { userId };
        if (unreadOnly) query.isRead = false;

        const [notifications, total] = await Promise.all([
            Notification.find(query)
                .sort({ createdAt: -1 })
                .limit(limit)
                .skip((page - 1) * limit)
                .lean(),
            Notification.countDocuments(query)
        ]);

        return res.json({
            notifications,
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),
            hasMore: page * limit < total
        });
    } catch (err) {
        console.error('[notificationController/getNotifications] Error:', err.message);
        return res.status(500).json({ message: 'Failed to load notifications' });
    }
};

/**
 * GET /api/notifications/unread-count
 * Returns the unread notification count for the authenticated user.
 * Lightweight — suitable for polling from the bell component.
 */
export const getUnreadCount = async (req, res) => {
    try {
        const count = await Notification.countDocuments({
            userId: req.user.id,
            isRead: false
        });
        return res.json({ count });
    } catch (err) {
        console.error('[notificationController/getUnreadCount] Error:', err.message);
        return res.status(500).json({ message: 'Failed to fetch unread count' });
    }
};

/**
 * PATCH /api/notifications/:id/read
 * Marks a specific notification as read.
 * Strictly enforces ownership — userId from JWT only.
 */
export const markRead = async (req, res) => {
    try {
        const notification = await Notification.findOneAndUpdate(
            { _id: req.params.id, userId: req.user.id },
            { isRead: true, readAt: new Date() },
            { new: true }
        );

        if (!notification) {
            return res.status(404).json({ message: 'Notification not found' });
        }

        return res.json({ success: true, notification });
    } catch (err) {
        console.error('[notificationController/markRead] Error:', err.message);
        return res.status(500).json({ message: 'Failed to mark notification as read' });
    }
};

/**
 * PATCH /api/notifications/read-all
 * Marks all notifications for the authenticated user as read.
 */
export const markAllRead = async (req, res) => {
    try {
        const result = await Notification.updateMany(
            { userId: req.user.id, isRead: false },
            { isRead: true, readAt: new Date() }
        );

        return res.json({
            success: true,
            updated: result.modifiedCount
        });
    } catch (err) {
        console.error('[notificationController/markAllRead] Error:', err.message);
        return res.status(500).json({ message: 'Failed to mark all notifications as read' });
    }
};

export default {
    getPublicKey,
    subscribe,
    unsubscribe,
    testPush,
    testEmail,
    getNotifications,
    getUnreadCount,
    markRead,
    markAllRead
};
