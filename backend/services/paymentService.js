import Razorpay from 'razorpay';
import crypto from 'crypto';

/**
 * Razorpay Payment Integration Service for GramSathi.
 *
 * Security Requirements:
 * 1. RAZORPAY_KEY_SECRET must NEVER be sent to the client.
 * 2. Signature verification is MANDATORY before confirming any payment.
 * 3. Amount is ALWAYS calculated server-side in integer paise.
 * 4. Webhook signatures are verified using the raw request body.
 */

let razorpayInstance = null;

function getRazorpayClient() {
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;

    if (!keyId || !keySecret) {
        throw new Error('Razorpay credentials missing. Please set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in the environment.');
    }

    if (!razorpayInstance) {
        razorpayInstance = new Razorpay({
            key_id: keyId,
            key_secret: keySecret
        });
    }

    return razorpayInstance;
}

export function getPublicRazorpayKey() {
    return process.env.RAZORPAY_KEY_ID || '';
}

/**
 * Creates a Razorpay Order on the Razorpay server.
 *
 * @param {Object} params
 * @param {number} params.amountInPaise - Exact amount in paise (e.g., ₹74.50 = 7450)
 * @param {string} params.receipt - Unique internal receipt string
 * @param {Object} [params.notes] - Key-value metadata
 * @returns {Promise<Object>} Razorpay Order response
 */
export async function createRazorpayOrder({ amountInPaise, receipt, notes = {} }) {
    if (!Number.isInteger(amountInPaise) || amountInPaise <= 0) {
        throw new Error(`Invalid amount in paise: ${amountInPaise}`);
    }

    const rzp = getRazorpayClient();
    const options = {
        amount: amountInPaise,
        currency: 'INR',
        receipt: String(receipt).slice(0, 40),
        notes
    };

    return rzp.orders.create(options);
}

/**
 * Verifies Razorpay Checkout signature using HMAC-SHA256.
 *
 * Formula: HMAC_SHA256(order_id + "|" + payment_id, secret) == signature
 *
 * @param {Object} params
 * @param {string} params.razorpayOrderId
 * @param {string} params.razorpayPaymentId
 * @param {string} params.razorpaySignature
 * @returns {boolean} True if signature is authentic
 */
export function verifyPaymentSignature({ razorpayOrderId, razorpayPaymentId, razorpaySignature }) {
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keySecret || !razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
        return false;
    }

    try {
        const body = `${razorpayOrderId}|${razorpayPaymentId}`;
        const expectedSignature = crypto
            .createHmac('sha256', keySecret)
            .update(body)
            .digest('hex');

        const expectedBuf = Buffer.from(expectedSignature, 'utf8');
        const sigBuf = Buffer.from(razorpaySignature, 'utf8');

        if (expectedBuf.length !== sigBuf.length) {
            return false;
        }

        return crypto.timingSafeEqual(expectedBuf, sigBuf);
    } catch (err) {
        console.error('[paymentService] Signature verification error:', err.message);
        return false;
    }
}

/**
 * Verifies Razorpay Webhook signature using HMAC-SHA256 on the raw request body.
 * Supports both verifyWebhookSignature(rawBody, signature) and verifyWebhookSignature({ rawBody, signature }).
 *
 * @param {Buffer|string|Object} arg1 - Raw request body buffer OR options object
 * @param {string} [arg2] - X-Razorpay-Signature header if arg1 is rawBody
 * @returns {boolean} True if webhook is authentic
 */
export function verifyWebhookSignature(arg1, arg2) {
    let rawBody, signature;
    if (arg1 && typeof arg1 === 'object' && !Buffer.isBuffer(arg1) && ('rawBody' in arg1 || 'signature' in arg1)) {
        rawBody = arg1.rawBody;
        signature = arg1.signature;
    } else {
        rawBody = arg1;
        signature = arg2;
    }

    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!webhookSecret || !rawBody || !signature) {
        return false;
    }

    try {
        const expectedSignature = crypto
            .createHmac('sha256', webhookSecret)
            .update(rawBody)
            .digest('hex');

        const expectedBuf = Buffer.from(expectedSignature, 'utf8');
        const sigBuf = Buffer.from(signature, 'utf8');

        if (expectedBuf.length !== sigBuf.length) {
            return false;
        }

        return crypto.timingSafeEqual(expectedBuf, sigBuf);
    } catch (err) {
        console.error('[paymentService] Webhook signature verification error:', err.message);
        return false;
    }
}


export default {
    getPublicRazorpayKey,
    createRazorpayOrder,
    verifyPaymentSignature,
    verifyWebhookSignature
};
