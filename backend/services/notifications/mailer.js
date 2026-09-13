import nodemailer from 'nodemailer';
import { Resend } from 'resend';

/**
 * Mailer service for GramSathi.
 *
 * Supports:
 * 1. Resend HTTPS API (Primary production path; recommended for serverless/cloud deployments)
 * 2. Nodemailer with Gmail SMTP (Development fallback)
 *
 * Lazily initializes clients on first use to ensure environment variables are loaded.
 */

let transporter = null;
let resendClient = null;
let warnedMissingConfig = false;

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ─── Development: Gmail via Nodemailer ────────────────────────────────────────

function getTransporter() {
    if (transporter) return transporter;

    const user = process.env.EMAIL_USER;
    const pass = process.env.EMAIL_APP_PASSWORD;

    if (!user || !pass) {
        if (!warnedMissingConfig) {
            console.warn(
                '[mailer] Neither RESEND_API_KEY nor (EMAIL_USER & EMAIL_APP_PASSWORD) are set. ' +
                'Notification emails will be skipped until configured.'
            );
            warnedMissingConfig = true;
        }
        return null;
    }

    transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user, pass }
    });

    return transporter;
}

// ─── Production: Resend HTTPS API ─────────────────────────────────────────────

function getResendClient() {
    if (resendClient) return resendClient;

    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
        return null;
    }

    resendClient = new Resend(apiKey);
    return resendClient;
}

// ─── Sender Address Helper ───────────────────────────────────────────────────

/**
 * Returns formatted "Sender Name <sender@domain.com>".
 *
 * In production or when using Resend, prefers:
 *   process.env.RESEND_FROM_EMAIL || process.env.RESEND_FROM || process.env.EMAIL_FROM
 * Falls back to 'onboarding@resend.dev' for sandbox testing.
 */
function fromAddress(isResend = true) {
    const fromName = process.env.EMAIL_FROM_NAME || process.env.RESEND_FROM_NAME || 'GramSathi';

    if (isResend) {
        const addr = process.env.RESEND_FROM_EMAIL ||
                     process.env.RESEND_FROM ||
                     process.env.EMAIL_FROM ||
                     'onboarding@resend.dev';
        return `"${fromName}" <${addr}>`;
    }

    const devAddr = process.env.EMAIL_USER || 'noreply@gramsathi.org';
    return `"${fromName}" <${devAddr}>`;
}

/**
 * Validates email address format.
 */
export function isValidEmail(email) {
    if (!email || typeof email !== 'string') return false;
    return EMAIL_REGEX.test(email.trim());
}

/**
 * Sends one email. Never throws — a notification failure must never crash
 * or revert the business transaction that triggered it.
 *
 * @param {Object} params
 * @param {string} params.to - recipient address
 * @param {string} params.subject - subject line
 * @param {string} params.html - HTML body
 * @param {string} [params.text] - plain-text fallback; derived from HTML if omitted
 * @returns {Promise<{success: boolean, sent: boolean, id?: string, provider?: string, reason?: string, error?: string}>}
 */
export async function sendMail({ to, subject, html, text }) {
    if (!to || !isValidEmail(to)) {
        console.warn(`[mailer] sendMail called with invalid recipient "${to}" — skipped: "${subject}"`);
        return { success: false, sent: false, reason: 'invalid_recipient', error: 'Invalid or missing recipient address' };
    }

    const trimmedTo = to.trim();
    const plainText = text || html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

    // ── Primary Path: Resend HTTPS API ────────────────────────────────────────
    // Use Resend whenever RESEND_API_KEY is available (in production or dev)
    const client = getResendClient();
    if (client) {
        const from = fromAddress(true);
        try {
            const { data, error } = await client.emails.send({
                from,
                to: trimmedTo,
                subject,
                html,
                text: plainText
            });

            if (error) {
                console.error(`[mailer/resend] Failed to send "${subject}" to ${trimmedTo}:`, {
                    provider: 'resend',
                    name: error.name,
                    message: error.message,
                    statusCode: error.statusCode
                });

                if (from.includes('onboarding@resend.dev')) {
                    console.warn(
                        '[mailer/resend] DIAGNOSTIC: "onboarding@resend.dev" is a test sandbox restricted to the Resend account owner. ' +
                        'To deliver to arbitrary Gmail recipients, verify your custom domain in the Resend dashboard and set RESEND_FROM_EMAIL.'
                    );
                }

                return { success: false, sent: false, provider: 'resend', reason: 'provider_error', error: error.message };
            }

            console.log(`[mailer/resend] Successfully dispatched "${subject}" to ${trimmedTo} (id: ${data?.id})`);
            return { success: true, sent: true, provider: 'resend', id: data?.id };
        } catch (err) {
            console.error(`[mailer/resend] Unexpected exception sending "${subject}" to ${trimmedTo}:`, err.message);
            return { success: false, sent: false, provider: 'resend', reason: 'send_exception', error: err.message };
        }
    }

    // ── Secondary Path: Nodemailer SMTP (Development fallback) ────────────────
    const t = getTransporter();
    if (!t) {
        return {
            success: false,
            sent: false,
            provider: 'none',
            reason: 'not_configured',
            error: 'Neither RESEND_API_KEY nor SMTP credentials configured'
        };
    }

    try {
        const from = fromAddress(false);
        const info = await t.sendMail({
            from,
            to: trimmedTo,
            subject,
            html,
            text: plainText
        });
        console.log(`[mailer/smtp] Successfully dispatched "${subject}" to ${trimmedTo} (messageId: ${info?.messageId})`);
        return { success: true, sent: true, provider: 'smtp', id: info?.messageId };
    } catch (err) {
        console.error(`[mailer/smtp] Failed to send "${subject}" to ${trimmedTo}:`, err.message);
        return { success: false, sent: false, provider: 'smtp', reason: 'send_error', error: err.message };
    }
}

export default { sendMail, isValidEmail };