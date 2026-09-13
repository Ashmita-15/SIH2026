import webpush from 'web-push';
import PushSubscription from '../../models/PushSubscription.js';

/**
 * Web Push Notification Service for GramSathi PWA.
 *
 * Implements W3C Push API / VAPID standard.
 * Dispatches encrypted push messages to service workers across all active user devices.
 * Automatically prunes expired endpoints (HTTP 404 / 410).
 */

let vapidInitialized = false;

function initVapid() {
    if (vapidInitialized) return true;

    const publicKey = process.env.VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;
    const subject = process.env.VAPID_SUBJECT || 'mailto:support@gramsathi.org';

    if (!publicKey || !privateKey) {
        console.warn('[pushService] VAPID keys not configured in environment. Web Push notifications will be skipped.');
        return false;
    }

    try {
        webpush.setVapidDetails(subject, publicKey, privateKey);
        vapidInitialized = true;
        return true;
    } catch (err) {
        console.error('[pushService] Failed to initialize VAPID details:', err.message);
        return false;
    }
}

/**
 * Returns the public VAPID key to provide to client browsers for PushManager.subscribe().
 */
export function getVapidPublicKey() {
    return process.env.VAPID_PUBLIC_KEY || null;
}

/**
 * Validates the structure of a PushSubscription object received from the frontend.
 */
export function isValidSubscription(sub) {
    return Boolean(
        sub &&
        typeof sub.endpoint === 'string' &&
        sub.endpoint.startsWith('http') &&
        sub.keys &&
        typeof sub.keys.p256dh === 'string' &&
        typeof sub.keys.auth === 'string'
    );
}

/**
 * Registers or updates a push subscription for the authenticated user.
 */
export async function saveSubscription(userId, subscriptionData, userAgent = '') {
    if (!isValidSubscription(subscriptionData)) {
        throw new Error('Invalid push subscription payload');
    }

    const { endpoint, keys } = subscriptionData;

    // Upsert subscription by unique endpoint, associating it with the authenticated user
    const subscription = await PushSubscription.findOneAndUpdate(
        { endpoint },
        {
            userId,
            endpoint,
            keys: {
                p256dh: keys.p256dh.trim(),
                auth: keys.auth.trim()
            },
            userAgent: String(userAgent).slice(0, 500),
            active: true,
            lastUsedAt: new Date()
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    console.log(`[pushService] Push subscription registered for user ${userId} on endpoint ${endpoint.slice(0, 35)}...`);
    return subscription;
}

/**
 * Deactivates or removes a push subscription for a user.
 */
export async function removeSubscription(userId, endpoint) {
    if (!endpoint) return false;

    const result = await PushSubscription.deleteOne({
        userId,
        endpoint
    });

    console.log(`[pushService] Push subscription removed for user ${userId}: deleted ${result.deletedCount}`);
    return result.deletedCount > 0;
}

/**
 * Deactivates all subscriptions for a user on logout (optional security precaution).
 */
export async function deactivateAllForUser(userId) {
    if (!userId) return;
    await PushSubscription.updateMany({ userId }, { active: false });
}

/**
 * Dispatches a Web Push notification to all active devices registered to a specific user.
 *
 * Enforces healthcare security: sensitive medical details (e.g. diagnoses, test values,
 * prescription details) must not be included in the preview payload.
 *
 * @param {string|mongoose.Types.ObjectId} userId
 * @param {Object} payload
 * @param {string} payload.title - Notification header
 * @param {string} payload.body - Safe, sanitized preview text
 * @param {string} [payload.icon] - PWA icon url
 * @param {string} [payload.badge] - Monochrome badge url
 * @param {string} [payload.tag] - Notification tag for deduplication / replacement
 * @param {Object} [payload.data] - Custom metadata (e.g. destination url, entityId)
 * @param {boolean} [payload.requireInteraction] - Keep the notification on screen until acted on
 * @param {Object} [options]
 * @param {number} [options.ttl] - Seconds the push service may hold an undelivered message (default 24h)
 * @param {string} [options.urgency] - 'very-low' | 'low' | 'normal' | 'high'
 * @returns {Promise<{sent: number, failed: number, total: number}>}
 */
export async function sendPushToUser(userId, payload, options = {}) {
    if (!initVapid()) {
        return { sent: 0, failed: 0, total: 0, reason: 'vapid_not_configured' };
    }

    if (!userId) {
        return { sent: 0, failed: 0, total: 0, reason: 'no_user_id' };
    }

    const subscriptions = await PushSubscription.find({
        userId,
        active: true
    });

    if (!subscriptions || subscriptions.length === 0) {
        return { sent: 0, failed: 0, total: 0, reason: 'no_subscriptions' };
    }

    // Default payload formatting matching PWA requirements
    const notificationPayload = JSON.stringify({
        title: payload.title || 'GramSathi',
        body: payload.body || 'You have an update in GramSathi.',
        icon: payload.icon || '/pwa-192x192.png',
        badge: payload.badge || '/logo.png',
        tag: payload.tag || `gramsathi-${Date.now()}`,
        requireInteraction: Boolean(payload.requireInteraction),
        data: {
            url: payload.data?.url || '/',
            type: payload.data?.type || 'general',
            entityId: payload.data?.entityId || null,
            receivedAt: new Date().toISOString()
        }
    });

    const deliveryOptions = {
        TTL: Number.isFinite(options.ttl) && options.ttl >= 0 ? options.ttl : 60 * 60 * 24 // 24 hours
    };
    if (['very-low', 'low', 'normal', 'high'].includes(options.urgency)) {
        deliveryOptions.urgency = options.urgency;
    }

    let sent = 0;
    let failed = 0;

    const deliveryPromises = subscriptions.map(async (sub) => {
        const pushSubscriptionShape = {
            endpoint: sub.endpoint,
            keys: {
                p256dh: sub.keys.p256dh,
                auth: sub.keys.auth
            }
        };

        try {
            await webpush.sendNotification(pushSubscriptionShape, notificationPayload, deliveryOptions);
            sent++;
            sub.lastUsedAt = new Date();
            await sub.save().catch(() => {});
        } catch (err) {
            failed++;
            const statusCode = err.statusCode;
            console.error(`[pushService] Web Push delivery failed for sub ${sub._id} (${statusCode}):`, err.message);

            // HTTP 404 (Not Found) or 410 (Gone) indicates the subscription is permanently expired/unregistered
            if (statusCode === 404 || statusCode === 410) {
                console.log(`[pushService] Pruning expired push subscription ${sub._id} (endpoint: ${sub.endpoint.slice(0, 35)}...)`);
                await PushSubscription.deleteOne({ _id: sub._id }).catch(pruneErr => {
                    console.error('[pushService] Error pruning invalid subscription:', pruneErr.message);
                });
            }
        }
    });

    await Promise.allSettled(deliveryPromises);

    return {
        sent,
        failed,
        total: subscriptions.length
    };
}

/**
 * Dispatches push notification to multiple user IDs.
 */
export async function sendPushToUsers(userIds, payload) {
    if (!Array.isArray(userIds) || userIds.length === 0) return [];
    return Promise.allSettled(userIds.map(id => sendPushToUser(id, payload)));
}

export default {
    getVapidPublicKey,
    isValidSubscription,
    saveSubscription,
    removeSubscription,
    deactivateAllForUser,
    sendPushToUser,
    sendPushToUsers
};
