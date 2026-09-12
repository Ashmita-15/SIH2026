import {
    getVapidPublicKey,
    saveSubscription,
    removeSubscription,
    sendPushToUser,
    isValidSubscription
} from '../services/notifications/pushService.js';
import { sendMail } from '../services/notifications/mailer.js';
import User from '../models/User.js';

/**
 * Controller for Push and Email Notification management.
 *
 * Security Requirements:
 * - All mutations and test dispatches require authentication.
 * - Endpoints strictly bind to req.user.id from the verified JWT token.
 * - Client-supplied userIds are never trusted.
 */

/**
 * GET /api/notifications/push/public-key
 * Returns the VAPID public key needed by browser PushManager.subscribe().
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

        const result = await sendMail({
            to: user.email,
            subject,
            html
        });

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

export default {
    getPublicKey,
    subscribe,
    unsubscribe,
    testPush,
    testEmail
};
