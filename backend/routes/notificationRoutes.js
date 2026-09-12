import express from 'express';
import { authRequired } from '../middleware/authMiddleware.js';
import {
    getPublicKey,
    subscribe,
    unsubscribe,
    testPush,
    testEmail
} from '../controllers/notificationController.js';

const router = express.Router();

// Public VAPID key (safe to access for authenticated users)
router.get('/push/public-key', authRequired, getPublicKey);

// Push subscription management (requires authentication)
router.post('/push/subscribe', authRequired, subscribe);
router.post('/push/unsubscribe', authRequired, unsubscribe);

// Test endpoints (authenticated - only sends to the caller's own account/devices)
router.post('/push/test', authRequired, testPush);
router.post('/test-email', authRequired, testEmail);

export default router;
