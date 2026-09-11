import nodemailer from 'nodemailer';
import { Resend } from 'resend';

/**
 * One shared transporter, built once and reused for every email.
 *
 * Built lazily rather than at import time: server.js imports controllers
 * before dotenv.config() has necessarily run in every environment, and a
 * transporter built with an empty user/pass would silently fail forever.
 * Building it on first use guarantees the env vars are already loaded.
 */
let transporter = null;
let resendClient = null;
let warnedMissingConfig = false;

// ─── Development: Gmail via Nodemailer (unchanged) ────────────────────────────

function getTransporter() {
    if (transporter) return transporter;

    const user = process.env.EMAIL_USER;
    const pass = process.env.EMAIL_APP_PASSWORD;

    if (!user || !pass) {
        if (!warnedMissingConfig) {
            console.warn(
                '[mailer] EMAIL_USER / EMAIL_APP_PASSWORD are not set. ' +
                'Notification emails will be skipped (logged, not sent) until they are configured in .env.'
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
        if (!warnedMissingConfig) {
            console.warn(
                '[mailer] RESEND_API_KEY is not set. ' +
                'Production emails will be skipped. Add RESEND_API_KEY to your Render env vars.'
            );
            warnedMissingConfig = true;
        }
        return null;
    }

    resendClient = new Resend(apiKey);
    return resendClient;
}

// ─── Shared sender address ─────────────────────────────────────────────────────
//
// Resend requires the FROM domain to be verified in your Resend account.
// On the free plan you can send from any address @your-verified-domain, OR
// from the Resend-provided sandbox address: onboarding@resend.dev (test only).
//
// Set EMAIL_FROM in your Render env vars to the verified address, e.g.:
//   noreply@gramsathi.org   (once DNS is verified in Resend dashboard)
// If EMAIL_FROM is not set, falls back to onboarding@resend.dev for testing.

function fromAddress() {
    const fromName = process.env.EMAIL_FROM_NAME || 'GramSathi';
    // In production use EMAIL_FROM (verified Resend domain); dev uses EMAIL_USER.
    const addr = process.env.NODE_ENV === 'production'
        ? (process.env.EMAIL_FROM || 'onboarding@resend.dev')
        : process.env.EMAIL_USER;
    return `"${fromName}" <${addr}>`;
}

/**
 * Sends one email. Never throws — a notification failing must never take
 * down the request that triggered it (booking an appointment should not
 * fail because an email provider was briefly unreachable). Errors are logged.
 *
 * @param {Object} params
 * @param {string} params.to - recipient address
 * @param {string} params.subject
 * @param {string} params.html
 * @param {string} [params.text] - plain-text fallback; derived from html if omitted
 */
export async function sendMail({ to, subject, html, text }) {
    if (!to) {
        console.warn('[mailer] sendMail called with no recipient — skipped:', subject);
        return { sent: false, reason: 'no_recipient' };
    }

    const plainText = text || html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

    // ── Production: use Resend ────────────────────────────────────────────────
    if (process.env.NODE_ENV === 'production') {
        const client = getResendClient();
        if (!client) return { sent: false, reason: 'not_configured' };

        try {
            const from = fromAddress();
            const { error } = await client.emails.send({ from, to, subject, html, text: plainText });
            if (error) {
                console.error(`[mailer/resend] Failed to send "${subject}" to ${to}:`, error.message ?? error);
                return { sent: false, reason: 'send_error', error: error.message };
            }
            return { sent: true };
        } catch (err) {
            console.error(`[mailer/resend] Failed to send "${subject}" to ${to}:`, err.message);
            return { sent: false, reason: 'send_error', error: err.message };
        }
    }

    // ── Development: use Gmail via Nodemailer (unchanged) ─────────────────────
    const t = getTransporter();
    if (!t) {
        return { sent: false, reason: 'not_configured' };
    }

    try {
        await t.sendMail({
            from: fromAddress(),
            to,
            subject,
            html,
            text: plainText
        });
        return { sent: true };
    } catch (err) {
        console.error(`[mailer] Failed to send "${subject}" to ${to}:`, err.message);
        return { sent: false, reason: 'send_error', error: err.message };
    }
}

export default { sendMail };