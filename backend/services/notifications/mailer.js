import nodemailer from 'nodemailer';

/**
 * One shared transporter, built once and reused for every email.
 *
 * Built lazily rather than at import time: server.js imports controllers
 * before dotenv.config() has necessarily run in every environment, and a
 * transporter built with an empty user/pass would silently fail forever.
 * Building it on first use guarantees the env vars are already loaded.
 */
let transporter = null;
let warnedMissingConfig = false;

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

/**
 * Sends one email. Never throws — a notification failing must never take
 * down the request that triggered it (booking an appointment should not
 * fail because Gmail was briefly unreachable). Errors are logged instead.
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

    const t = getTransporter();
    if (!t) {
        return { sent: false, reason: 'not_configured' };
    }

    const fromName = process.env.EMAIL_FROM_NAME || 'GramSathi';

    try {
        await t.sendMail({
            from: `"${fromName}" <${process.env.EMAIL_USER}>`,
            to,
            subject,
            html,
            text: text || html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
        });
        return { sent: true };
    } catch (err) {
        console.error(`[mailer] Failed to send "${subject}" to ${to}:`, err.message);
        return { sent: false, reason: 'send_error', error: err.message };
    }
}

export default { sendMail };