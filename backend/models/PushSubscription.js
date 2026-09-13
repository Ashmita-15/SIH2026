import mongoose from 'mongoose';

/**
 * Web Push Subscription Model for GramSathi PWA.
 *
 * Stores W3C Push API subscription endpoints and encryption keys (p256dh, auth).
 * Supports multiple devices/browsers per user account (e.g. mobile phone, tablet, laptop).
 */
const pushSubscriptionSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    endpoint: {
        type: String,
        required: true,
        unique: true,
        trim: true
    },
    keys: {
        p256dh: {
            type: String,
            required: true,
            trim: true
        },
        auth: {
            type: String,
            required: true,
            trim: true
        }
    },
    userAgent: {
        type: String,
        default: ''
    },
    active: {
        type: Boolean,
        default: true,
        index: true
    },
    lastUsedAt: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true
});

// Compound index to quickly fetch all active subscriptions for a user
pushSubscriptionSchema.index({ userId: 1, active: 1 });

export default mongoose.model('PushSubscription', pushSubscriptionSchema);
