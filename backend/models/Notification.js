import mongoose from 'mongoose';

/**
 * Persistent in-app notification record.
 *
 * Design Rules:
 * 1. `userId` is the strict owner — all API endpoints enforce this from the JWT token.
 * 2. Healthcare privacy: `body` contains ONLY safe, general notification text. No lab values,
 *    diagnoses, or prescription drug details are stored here.
 * 3. `entityId` + `type` + `userId` form a soft-deduplication key.
 */

const NOTIFICATION_TYPES = [
    // Appointments
    'APPOINTMENT_BOOKED',
    'APPOINTMENT_CONFIRMED',
    'APPOINTMENT_REJECTED',
    'APPOINTMENT_CANCELLED',
    'APPOINTMENT_COMPLETED',
    // Queue / OPD Sessions
    'QUEUE_FINALIZED',
    'QUEUE_STATUS',
    'DOCTOR_SESSION_READY',
    // Health Records & Diagnostics
    'HEALTH_RECORD_ADDED',
    'DIAGNOSTIC_REPORT_READY',
    // Pharmacy Orders
    'PHARMACY_ORDER_PLACED',
    'PHARMACY_ORDER_CONFIRMED',
    'PHARMACY_ORDER_PREPARING',
    'PHARMACY_ORDER_READY',
    'PHARMACY_ORDER_DISPATCHED',
    'PHARMACY_ORDER_DELIVERED',
    'PHARMACY_ORDER_CANCELLED',
    // Referrals
    'REFERRAL_CREATED',
    'REFERRAL_UPDATED',
    // Emergency SOS
    'EMERGENCY_SOS',
    'EMERGENCY_SOS_UPDATE',
    // Account / General
    'ACCOUNT_CREATED',
    'SYSTEM_ALERT',
    'GENERAL'
];

const PRIORITIES = ['urgent', 'high', 'normal', 'low'];

const ENTITY_TYPES = [
    'appointment',
    'order',
    'diagnostic',
    'health_record',
    'referral',
    'session',
    'emergency',
    'account',
    'general'
];

const notificationSchema = new mongoose.Schema({
    /**
     * Target user — enforced by every API endpoint from req.user.id (JWT).
     * Never supplied by the client; always resolved server-side.
     */
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },

    /** Structured event type for frontend icon/routing decisions. */
    type: {
        type: String,
        enum: NOTIFICATION_TYPES,
        default: 'GENERAL'
    },

    /** Notification headline — shown in bold when unread. */
    title: {
        type: String,
        required: true,
        maxlength: 200
    },

    /**
     * Safe, privacy-compliant short notification body.
     * MUST NOT contain lab results, diagnoses, drug names, or personal health data.
     */
    body: {
        type: String,
        required: true,
        maxlength: 500
    },

    /**
     * Internal navigation data — passed to the service worker and the
     * frontend router. May contain { url, entityId, entityType, ... }
     */
    data: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
    },

    /**
     * Deep-link URL for in-app navigation.
     * HashRouter: use "/#/patient/appointments" format.
     */
    link: {
        type: String,
        default: '/'
    },

    isRead: {
        type: Boolean,
        default: false,
        index: true
    },

    readAt: {
        type: Date,
        default: null
    },

    priority: {
        type: String,
        enum: PRIORITIES,
        default: 'normal'
    },

    /** Entity classification for icon selection in the frontend. */
    entityType: {
        type: String,
        enum: ENTITY_TYPES,
        default: 'general'
    },

    /** Entity ID used for deduplication and deep-link construction. */
    entityId: {
        type: String,
        default: null
    },

    /** Whether the accompanying Web Push was dispatched. */
    pushSent: {
        type: Boolean,
        default: false
    },

    pushSentAt: {
        type: Date,
        default: null
    },

    /** Auto-expire old notifications after 90 days. */
    expiresAt: {
        type: Date,
        default: () => new Date(Date.now() + 90 * 24 * 60 * 60 * 1000)
    }
}, {
    timestamps: true // adds createdAt, updatedAt
});

// Efficient queries: user's unread notifications, newest first
notificationSchema.index({ userId: 1, createdAt: -1 });
notificationSchema.index({ userId: 1, isRead: 1, createdAt: -1 });

// Auto-expire via MongoDB TTL index
notificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export { NOTIFICATION_TYPES, ENTITY_TYPES };
export default mongoose.model('Notification', notificationSchema);
