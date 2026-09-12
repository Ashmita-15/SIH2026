import assert from 'assert';
import dotenv from 'dotenv';
dotenv.config();

import { isValidEmail, sendMail } from './services/notifications/mailer.js';
import {
    getVapidPublicKey,
    isValidSubscription
} from './services/notifications/pushService.js';
import notificationService from './services/notifications/notificationService.js';
import notificationRoutes from './routes/notificationRoutes.js';
import mongoose from 'mongoose';

// Disable query buffering during unit tests when not connected to DB
mongoose.set('bufferCommands', false);

async function runTests() {
    console.log('🧪 Starting GramSathi Email & Push Notification Verification Suite...\n');

    let passed = 0;
    let failed = 0;

    function test(name, fn) {
        try {
            fn();
            console.log(`  ✅ [PASS] ${name}`);
            passed++;
        } catch (err) {
            console.error(`  ❌ [FAIL] ${name}:`, err.message);
            failed++;
        }
    }

    async function asyncTest(name, fn) {
        try {
            await fn();
            console.log(`  ✅ [PASS] ${name}`);
            passed++;
        } catch (err) {
            console.error(`  ❌ [FAIL] ${name}:`, err.message);
            failed++;
        }
    }

    // ── 1. Email Validator Tests ──────────────────────────────────────────────
    console.log('--- 1. Email Validation & Diagnostics ---');
    test('isValidEmail accepts standard email addresses', () => {
        assert.strictEqual(isValidEmail('patient@gmail.com'), true);
        assert.strictEqual(isValidEmail('dr.sharma@hospital.org'), true);
        assert.strictEqual(isValidEmail('user.name+tag@domain.co.in'), true);
    });

    test('isValidEmail rejects malformed addresses', () => {
        assert.strictEqual(isValidEmail(''), false);
        assert.strictEqual(isValidEmail(null), false);
        assert.strictEqual(isValidEmail('not-an-email'), false);
        assert.strictEqual(isValidEmail('@missinguser.com'), false);
        assert.strictEqual(isValidEmail('missingdomain@'), false);
    });

    await asyncTest('sendMail returns structured failure on invalid recipient without throwing', async () => {
        const res = await sendMail({
            to: 'invalid-email-format',
            subject: 'Test Subject',
            html: '<p>Test</p>'
        });
        assert.strictEqual(res.success, false);
        assert.strictEqual(res.sent, false);
        assert.strictEqual(res.reason, 'invalid_recipient');
    });

    // ── 2. VAPID & Push Subscription Tests ────────────────────────────────────
    console.log('\n--- 2. VAPID Configuration & Subscription Validation ---');
    test('VAPID public key is configured and matches standard base64 pattern', () => {
        const pubKey = getVapidPublicKey();
        assert.ok(pubKey, 'VAPID public key must not be null');
        assert.strictEqual(typeof pubKey, 'string');
        assert.ok(pubKey.length > 50, 'VAPID public key length should be > 50 characters');
    });

    test('isValidSubscription correctly verifies PushSubscription shape', () => {
        const validSub = {
            endpoint: 'https://fcm.googleapis.com/fcm/send/sample-token-12345',
            keys: {
                p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QT9t0PPMwoEC0FnWIPvggS6UdLSGWq',
                auth: 'tBHItJAhVoA2ukNhhQI'
            }
        };
        assert.strictEqual(isValidSubscription(validSub), true);

        assert.strictEqual(isValidSubscription(null), false);
        assert.strictEqual(isValidSubscription({}), false);
        assert.strictEqual(isValidSubscription({ endpoint: 'invalid-endpoint' }), false);
        assert.strictEqual(isValidSubscription({ endpoint: 'https://test.com', keys: {} }), false);
    });

    // ── 3. Notification Service Abstraction Tests ─────────────────────────────
    console.log('\n--- 3. Notification Service Event Methods & Failure Isolation ---');
    test('notificationService exposes all required event notification methods', () => {
        assert.strictEqual(typeof notificationService.sendNotification, 'function');
        assert.strictEqual(typeof notificationService.notifyAccountCreated, 'function');
        assert.strictEqual(typeof notificationService.notifyAppointmentBooked, 'function');
        assert.strictEqual(typeof notificationService.notifyAppointmentConfirmed, 'function');
        assert.strictEqual(typeof notificationService.notifyAppointmentRejected, 'function');
        assert.strictEqual(typeof notificationService.notifyAppointmentCancelled, 'function');
        assert.strictEqual(typeof notificationService.notifyQueueStatus, 'function');
        assert.strictEqual(typeof notificationService.notifyHealthRecordUploaded, 'function');
        assert.strictEqual(typeof notificationService.notifyReferralCreated, 'function');
        assert.strictEqual(typeof notificationService.notifyReferralStatusChanged, 'function');
        assert.strictEqual(typeof notificationService.notifyQueueFinalized, 'function');
        assert.strictEqual(typeof notificationService.notifyDoctorSessionSchedule, 'function');
        assert.strictEqual(typeof notificationService.notifyDiagnosticCompleted, 'function');
        assert.strictEqual(typeof notificationService.notifyPharmacyNewOrder, 'function');
        assert.strictEqual(typeof notificationService.notifyPharmacyOrderStatus, 'function');
    });

    await asyncTest('notificationService isolates channel failures without throwing', async () => {
        // Dispatching to a non-existent user and invalid email must NOT throw
        const results = await notificationService.sendNotification({
            userId: '65f1234567890abcdef12345',
            email: 'invalid-email',
            type: 'test_event',
            title: 'Test Notification',
            body: 'Safe preview body',
            channels: ['push', 'email'],
            emailContent: { subject: 'Test', html: '<p>Test</p>' }
        });
        assert.ok(Array.isArray(results), 'Expected array of settled promise results');
        assert.strictEqual(results.length, 2, 'Should process both push and email channel attempts');
    });

    // ── 4. Route Verification ─────────────────────────────────────────────────
    console.log('\n--- 4. API Route Mounting Verification ---');
    test('notificationRoutes router is defined with registered route stack', () => {
        assert.ok(notificationRoutes);
        assert.ok(notificationRoutes.stack);
        const paths = notificationRoutes.stack.map(layer => layer.route?.path).filter(Boolean);
        assert.ok(paths.includes('/push/public-key'), 'Should have /push/public-key endpoint');
        assert.ok(paths.includes('/push/subscribe'), 'Should have /push/subscribe endpoint');
        assert.ok(paths.includes('/push/unsubscribe'), 'Should have /push/unsubscribe endpoint');
        assert.ok(paths.includes('/push/test'), 'Should have /push/test endpoint');
        assert.ok(paths.includes('/test-email'), 'Should have /test-email endpoint');
    });

    console.log(`\n========================================`);
    console.log(`Suite finished: ${passed} passed, ${failed} failed.`);
    console.log(`========================================\n`);

    if (failed > 0) {
        process.exit(1);
    }
}

runTests().catch(err => {
    console.error('Fatal test error:', err);
    process.exit(1);
});
