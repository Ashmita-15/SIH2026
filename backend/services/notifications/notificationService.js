import { sendMail } from './mailer.js';
import { sendPushToUser, sendPushToUsers } from './pushService.js';
import * as templates from './emailTemplates.js';
import Notification from '../../models/Notification.js';

/**
 * Unified Notification Service for GramSathi.
 *
 * Architecture:
 *   Business Event → createNotification() → MongoDB + Web Push
 *
 * Design Principles:
 * 1. createNotification() is the SINGLE entry point for all notification creation.
 * 2. Failure isolation: Push failure does not break DB save; DB failure does not break push.
 * 3. Non-blocking: Notification failures never abort the underlying medical transaction.
 * 4. Healthcare security & privacy: Push bodies never expose diagnoses, lab values, or drug names.
 * 5. Deduplication: same (userId, type, entityId) within 5 minutes = skip duplicate creation.
 */

// ─── Central Notification Creator ────────────────────────────────────────────

/**
 * Creates a persistent in-app notification AND attempts Web Push delivery.
 *
 * @param {Object} params
 * @param {string|mongoose.Types.ObjectId} params.userId  - Target user ID (required)
 * @param {string} params.type        - NOTIFICATION_TYPE enum value
 * @param {string} params.title       - Short notification title
 * @param {string} params.body        - Privacy-safe preview body
 * @param {Object} [params.data]      - Metadata for SW/navigation { url, entityId, entityType }
 * @param {string} [params.link]      - Deep link for in-app navigation (HashRouter: "/#/path")
 * @param {string} [params.priority]  - 'urgent' | 'high' | 'normal' | 'low'
 * @param {string} [params.entityType] - 'appointment' | 'order' | 'diagnostic' | ...
 * @param {string} [params.entityId]  - MongoDB ID of the related entity (for dedup)
 * @param {string} [params.tag]       - Web Push tag for deduplication on device
 * @returns {Promise<Notification|null>}
 */
export async function createNotification({
    userId,
    type = 'GENERAL',
    title,
    body,
    data = {},
    link = '/',
    priority = 'normal',
    entityType = 'general',
    entityId = null,
    tag = null
}) {
    if (!userId || !title || !body) {
        console.warn('[notificationService] createNotification called with missing required fields:', { userId, title, body });
        return null;
    }

    // ── Deduplication: same (userId, type, entityId) within 5 minutes ──
    if (entityId && type !== 'GENERAL') {
        try {
            const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
            const existing = await Notification.findOne({
                userId,
                type,
                entityId: String(entityId),
                createdAt: { $gte: fiveMinutesAgo }
            }).select('_id').lean();

            if (existing) {
                console.debug(`[notificationService] Skipping duplicate: ${type} for entity ${entityId} (userId ${userId})`);
                return null;
            }
        } catch (dedupErr) {
            console.error('[notificationService] Dedup check failed:', dedupErr.message);
            // Continue — better a duplicate than a missed notification
        }
    }

    // ── 1. Persist to MongoDB ──
    let notification = null;
    try {
        notification = await Notification.create({
            userId,
            type,
            title,
            body,
            data,
            link,
            priority,
            entityType,
            entityId: entityId ? String(entityId) : null,
            pushSent: false
        });
    } catch (dbErr) {
        console.error('[notificationService] Failed to save notification:', dbErr.message);
        // Continue with push attempt even if DB save failed
    }

    // ── 2. Attempt Web Push delivery (fire-and-forget, never throws) ──
    sendPushToUser(userId, {
        title,
        body,
        tag: tag || `gramsathi-${type}-${entityId || Date.now()}`,
        data: {
            url: link,
            type,
            entityId: entityId ? String(entityId) : null,
            entityType,
            notificationId: notification ? String(notification._id) : null,
            ...data
        }
    }).then(result => {
        if (notification && result.sent > 0) {
            Notification.findByIdAndUpdate(notification._id, {
                pushSent: true,
                pushSentAt: new Date()
            }).catch(() => {});
        }
    }).catch(pushErr => {
        console.error(`[notificationService/push] Push failed for user ${userId}:`, pushErr.message);
    });

    return notification;
}

// ─── Unified Multi-Channel Dispatch (legacy-compatible) ──────────────────────

/**
 * Sends a notification across requested channels (push, email).
 * Kept for backward-compatibility; prefer createNotification() for new code.
 */
export async function sendNotification({
    userId,
    email,
    type = 'general',
    title,
    body,
    data = {},
    channels = ['push'],
    emailContent
}) {
    const promises = [];

    if (channels.includes('push') && userId) {
        promises.push(
            sendPushToUser(userId, {
                title,
                body,
                tag: `gramsathi-${type}-${data.entityId || Date.now()}`,
                data: { type, ...data }
            }).catch(err => {
                console.error(`[notificationService/push] Failed for user ${userId}:`, err.message);
                return { sent: 0, failed: 1, reason: err.message };
            })
        );
    }

    if (channels.includes('email') && email && emailContent) {
        promises.push(
            sendMail({
                to: email,
                subject: emailContent.subject || title,
                html: emailContent.html,
                text: emailContent.text
            }).catch(err => {
                console.error(`[notificationService/email] Failed for ${email}:`, err.message);
                return { success: false, reason: err.message };
            })
        );
    }

    return Promise.allSettled(promises);
}

// ─── Account Events ──────────────────────────────────────────────────────────

export async function notifyAccountCreated(user) {
    if (!user) return;
    const userId = user._id || user.id;

    // In-app + Push via createNotification
    if (userId) {
        createNotification({
            userId,
            type: 'ACCOUNT_CREATED',
            title: 'Welcome to GramSathi',
            body: 'Your GramSathi account is ready. Access doctors, records, and prescriptions anytime.',
            link: '/',
            entityType: 'account'
        }).catch(() => {});
    }

    // Email (fire-and-forget)
    if (user.email) {
        sendMail({
            to: user.email,
            ...templates.accountCreatedEmail({ name: user.name, role: user.role })
        }).catch(() => {});
    }
}

// ─── Appointments ────────────────────────────────────────────────────────────

/** Sent to both the patient and the doctor upon booking. */
export async function notifyAppointmentBooked({ patient, doctor, appointment }) {
    const jobs = [];
    const patientId = patient?._id || patient?.id || appointment?.patientId;
    const doctorId = doctor?._id || doctor?.id || appointment?.doctorId;
    const appointmentId = appointment?._id;

    // Patient: in-app + push
    if (patientId) {
        jobs.push(createNotification({
            userId: patientId,
            type: 'APPOINTMENT_BOOKED',
            title: 'Appointment Request Submitted',
            body: `Your consultation request with Dr. ${doctor?.name || 'the doctor'} has been placed. Awaiting confirmation.`,
            link: '/#/patient/appointments',
            entityType: 'appointment',
            entityId: appointmentId ? String(appointmentId) : null,
            data: { appointmentId: String(appointmentId || '') }
        }).catch(() => {}));
    }

    // Doctor: in-app + push
    if (doctorId) {
        jobs.push(createNotification({
            userId: doctorId,
            type: 'APPOINTMENT_BOOKED',
            title: 'New Consultation Request',
            body: `You have a new appointment request from ${patient?.name || 'a patient'} to review.`,
            link: '/#/doctor/today',
            entityType: 'appointment',
            entityId: appointmentId ? String(appointmentId) : null,
            data: { appointmentId: String(appointmentId || '') }
        }).catch(() => {}));
    }

    // Patient email
    if (patient?.email) {
        const { subject, html } = templates.appointmentBookedPatientEmail({
            patientName: patient.name,
            doctorName: doctor?.name,
            requestedDate: appointment?.requestedDate,
            timeSlot: appointment?.timeSlot,
            symptoms: appointment?.symptoms
        });
        jobs.push(sendMail({ to: patient.email, subject, html }).catch(() => {}));
    }

    // Doctor email
    if (doctor?.email) {
        const { subject, html } = templates.appointmentBookedDoctorEmail({
            doctorName: doctor.name,
            patientName: patient?.name,
            requestedDate: appointment?.requestedDate,
            timeSlot: appointment?.timeSlot
        });
        jobs.push(sendMail({ to: doctor.email, subject, html }).catch(() => {}));
    }

    return Promise.allSettled(jobs);
}

/** Doctor confirmed the appointment. */
export async function notifyAppointmentConfirmed({ patient, doctor, appointment, queueInfo }) {
    const jobs = [];
    const patientId = patient?._id || patient?.id || appointment?.patientId;
    const appointmentId = appointment?._id;

    if (patientId) {
        jobs.push(createNotification({
            userId: patientId,
            type: 'APPOINTMENT_CONFIRMED',
            title: 'Appointment Confirmed',
            body: `Your appointment with Dr. ${doctor?.name || 'the doctor'} is confirmed.`,
            link: '/#/patient/appointments',
            priority: 'high',
            entityType: 'appointment',
            entityId: appointmentId ? String(appointmentId) : null,
            data: { appointmentId: String(appointmentId || '') }
        }).catch(() => {}));
    }

    if (patient?.email) {
        const { subject, html } = templates.appointmentConfirmedEmail({
            patientName: patient.name,
            doctorName: doctor?.name,
            confirmedDate: appointment?.confirmedDate,
            timeSlot: appointment?.timeSlot,
            queuePosition: queueInfo?.position,
            estimatedAt: queueInfo?.estimatedAt
        });
        jobs.push(sendMail({ to: patient.email, subject, html }).catch(() => {}));
    }

    return Promise.allSettled(jobs);
}

/** Doctor rejected the appointment. */
export async function notifyAppointmentRejected({ patient, doctor, appointment }) {
    const jobs = [];
    const patientId = patient?._id || patient?.id || appointment?.patientId;
    const appointmentId = appointment?._id;

    if (patientId) {
        jobs.push(createNotification({
            userId: patientId,
            type: 'APPOINTMENT_REJECTED',
            title: 'Appointment Update',
            body: 'Your appointment request could not be accepted. Open GramSathi to find alternatives.',
            link: '/#/patient/appointments',
            entityType: 'appointment',
            entityId: appointmentId ? String(appointmentId) : null,
            data: { appointmentId: String(appointmentId || '') }
        }).catch(() => {}));
    }

    if (patient?.email) {
        const { subject, html } = templates.appointmentRejectedEmail({
            patientName: patient.name,
            doctorName: doctor?.name,
            rejectionReason: appointment?.rejectionReason
        });
        jobs.push(sendMail({ to: patient.email, subject, html }).catch(() => {}));
    }

    return Promise.allSettled(jobs);
}

/** Appointment cancelled (by patient or doctor). */
export async function notifyAppointmentCancelled({ patient, doctor, appointment }) {
    const jobs = [];
    const doctorId = doctor?._id || doctor?.id || appointment?.doctorId;
    const patientId = patient?._id || patient?.id || appointment?.patientId;
    const appointmentId = appointment?._id;

    if (doctorId) {
        jobs.push(createNotification({
            userId: doctorId,
            type: 'APPOINTMENT_CANCELLED',
            title: 'Appointment Cancelled',
            body: `An appointment with ${patient?.name || 'a patient'} has been cancelled.`,
            link: '/#/doctor/today',
            entityType: 'appointment',
            entityId: appointmentId ? String(appointmentId) : null,
            data: { appointmentId: String(appointmentId || '') }
        }).catch(() => {}));
    }

    if (patientId) {
        jobs.push(createNotification({
            userId: patientId,
            type: 'APPOINTMENT_CANCELLED',
            title: 'Appointment Cancelled',
            body: 'Your scheduled appointment has been cancelled.',
            link: '/#/patient/appointments',
            entityType: 'appointment',
            entityId: appointmentId ? String(appointmentId) : null,
            data: { appointmentId: String(appointmentId || '') }
        }).catch(() => {}));
    }

    if (doctor?.email) {
        const { subject, html } = templates.appointmentCancelledDoctorEmail({
            doctorName: doctor.name,
            patientName: patient?.name,
            requestedDate: appointment?.requestedDate,
            timeSlot: appointment?.timeSlot
        });
        jobs.push(sendMail({ to: doctor.email, subject, html }).catch(() => {}));
    }

    return Promise.allSettled(jobs);
}

/** Doctor marked appointment completed. */
export async function notifyAppointmentCompleted({ patient, doctor, appointment }) {
    const patientId = patient?._id || patient?.id || appointment?.patientId;
    const appointmentId = appointment?._id;

    if (!patientId) return;

    return createNotification({
        userId: patientId,
        type: 'APPOINTMENT_COMPLETED',
        title: 'Consultation Completed',
        body: `Your consultation with Dr. ${doctor?.name || 'the doctor'} is complete. View your records for details.`,
        link: '/#/patient/records',
        entityType: 'appointment',
        entityId: appointmentId ? String(appointmentId) : null,
        data: { appointmentId: String(appointmentId || '') }
    }).catch(() => {});
}

/** Patient requested queue status. */
export async function notifyQueueStatus({ patient, doctor, date, position, aheadOfYou, estimatedAt }) {
    const jobs = [];
    const patientId = patient?._id || patient?.id;

    if (patientId) {
        jobs.push(createNotification({
            userId: patientId,
            type: 'QUEUE_STATUS',
            title: 'Queue Position Update',
            body: `You are #${position} in queue. Estimated arrival: ${estimatedAt || 'On schedule'}.`,
            link: '/#/patient/appointments',
            entityType: 'appointment',
            data: { position, estimatedAt }
        }).catch(() => {}));
    }

    if (patient?.email) {
        const { subject, html } = templates.queueStatusEmail({
            patientName: patient.name,
            doctorName: doctor?.name,
            date,
            position,
            aheadOfYou,
            estimatedAt
        });
        jobs.push(sendMail({ to: patient.email, subject, html }).catch(() => {}));
    }

    return Promise.allSettled(jobs);
}

// ─── Health Records ──────────────────────────────────────────────────────────

export async function notifyHealthRecordUploaded({ recipient, uploadedBy, record }) {
    const jobs = [];
    const recipientId = recipient?._id || recipient?.id;
    const recordId = record?._id;

    if (recipientId) {
        jobs.push(createNotification({
            userId: recipientId,
            type: 'HEALTH_RECORD_ADDED',
            title: 'New Health Record Added',
            body: 'A new clinical record has been added to your GramSathi file.',
            link: '/#/patient/records',
            entityType: 'health_record',
            entityId: recordId ? String(recordId) : null,
            data: { recordId: String(recordId || '') }
        }).catch(() => {}));
    }

    if (recipient?.email) {
        const { subject, html } = templates.healthRecordUploadedEmail({
            recipientName: recipient.name,
            uploadedByName: uploadedBy?.name,
            uploadedByRole: uploadedBy?.role,
            diagnosis: record?.diagnosis
        });
        jobs.push(sendMail({ to: recipient.email, subject, html }).catch(() => {}));
    }

    return Promise.allSettled(jobs);
}

// ─── Referrals ───────────────────────────────────────────────────────────────

export async function notifyReferralCreated({ referral, patient, fromFacilityName, toFacilityEmail, toFacilityName }) {
    const jobs = [];
    const patientId = patient?._id || patient?.id || referral?.patientId;
    const referralId = referral?._id;

    if (patientId) {
        jobs.push(createNotification({
            userId: patientId,
            type: 'REFERRAL_CREATED',
            title: 'Specialty Referral Created',
            body: `A referral to ${toFacilityName || 'a specialist facility'} has been arranged for you.`,
            link: '/#/patient',
            priority: 'high',
            entityType: 'referral',
            entityId: referralId ? String(referralId) : null,
            data: { referralId: String(referralId || '') }
        }).catch(() => {}));
    }

    if (toFacilityEmail) {
        const { subject, html } = templates.referralCreatedFacilityEmail({
            facilityName: toFacilityName,
            patientName: patient?.name,
            fromFacilityName,
            priority: referral?.priority,
            reason: referral?.reason,
            dueBy: referral?.dueBy
        });
        jobs.push(sendMail({ to: toFacilityEmail, subject, html }).catch(() => {}));
    }

    if (patient?.email) {
        const { subject, html } = templates.referralCreatedPatientEmail({
            patientName: patient.name,
            toFacilityName,
            priority: referral?.priority,
            dueBy: referral?.dueBy
        });
        jobs.push(sendMail({ to: patient.email, subject, html }).catch(() => {}));
    }

    return Promise.allSettled(jobs);
}

export async function notifyReferralStatusChanged({ referral, patient, toFacilityName, status, note }) {
    const NOTIFY_STATUSES = ['scheduled', 'completed', 'missed', 'declined', 'lapsed'];
    if (!NOTIFY_STATUSES.includes(status)) return;

    const jobs = [];
    const patientId = patient?._id || patient?.id || referral?.patientId;
    const referralId = referral?._id;

    if (patientId) {
        jobs.push(createNotification({
            userId: patientId,
            type: 'REFERRAL_UPDATED',
            title: 'Referral Status Updated',
            body: `Your medical referral to ${toFacilityName || 'the facility'} has been updated.`,
            link: '/#/patient',
            entityType: 'referral',
            entityId: referralId ? String(referralId) : null,
            data: { referralId: String(referralId || ''), status }
        }).catch(() => {}));
    }

    if (patient?.email) {
        const { subject, html } = templates.referralStatusChangedEmail({
            patientName: patient.name,
            toFacilityName,
            status,
            note
        });
        jobs.push(sendMail({ to: patient.email, subject, html }).catch(() => {}));
    }

    return Promise.allSettled(jobs);
}

// ─── Session Scheduler & OPD Queues ──────────────────────────────────────────

export async function notifyQueueFinalized({ patient, doctorName, facilityName, date, sessionName, startsAt, position, estimatedArrivalTime, totalPatients }) {
    const jobs = [];
    const patientId = patient?._id || patient?.id;

    if (patientId) {
        jobs.push(createNotification({
            userId: patientId,
            type: 'QUEUE_FINALIZED',
            title: 'Session Queue Schedule Ready',
            body: `Your consultation position is #${position}. Estimated arrival: ${estimatedArrivalTime || 'On time'}.`,
            link: '/#/patient/appointments',
            priority: 'high',
            entityType: 'appointment',
            data: { position, estimatedArrivalTime, date, sessionName }
        }).catch(() => {}));
    }

    if (patient?.email) {
        const mail = templates.queueFinalizedEmail({
            patientName: patient.name, doctorName, facilityName, date, sessionName,
            position, estimatedArrivalTime, totalPatients
        });
        jobs.push(sendMail({ to: patient.email, ...mail }).catch(() => {}));
    }

    return Promise.allSettled(jobs);
}

export async function notifyDoctorSessionSchedule({ doctor, facilityName, date, sessionName, startsAt, endsAt, totalPatients, entries }) {
    const jobs = [];
    const doctorId = doctor?._id || doctor?.id;

    if (doctorId) {
        jobs.push(createNotification({
            userId: doctorId,
            type: 'DOCTOR_SESSION_READY',
            title: 'OPD Session Finalized',
            body: `${sessionName || 'Your session'} has ${totalPatients} confirmed patients scheduled.`,
            link: '/#/doctor/today',
            entityType: 'session',
            data: { date, sessionName, totalPatients }
        }).catch(() => {}));
    }

    if (doctor?.email) {
        const mail = templates.doctorSessionScheduleEmail({
            doctorName: doctor.name, facilityName, date, sessionName,
            startsAt, endsAt, totalPatients, entries
        });
        jobs.push(sendMail({ to: doctor.email, ...mail }).catch(() => {}));
    }

    return Promise.allSettled(jobs);
}

// ─── Diagnostics ─────────────────────────────────────────────────────────────

export async function notifyDiagnosticCompleted({ patient, testName, resultSummary, facilityName }) {
    const jobs = [];
    const patientId = patient?._id || patient?.id;

    if (patientId) {
        // Privacy rule: NEVER include resultSummary in push body — it may contain lab values
        jobs.push(createNotification({
            userId: patientId,
            type: 'DIAGNOSTIC_REPORT_READY',
            title: 'Diagnostic Report Ready',
            body: `Your medical test report is ready to view. Open GramSathi to see the results.`,
            link: '/#/patient/records',
            priority: 'high',
            entityType: 'diagnostic',
            data: { testName }
        }).catch(() => {}));
    }

    if (patient?.email) {
        const mail = templates.diagnosticCompletedEmail({
            patientName: patient.name, testName, resultSummary, facilityName
        });
        jobs.push(sendMail({ to: patient.email, ...mail }).catch(() => {}));
    }

    return Promise.allSettled(jobs);
}

// ─── Pharmacy Orders ─────────────────────────────────────────────────────────

/**
 * Maps Order model status values to user-friendly notification text.
 * Order statuses: 'pending', 'confirmed', 'preparing', 'ready', 'dispatched', 'delivered', 'cancelled'
 */
const ORDER_STATUS_MESSAGES = {
    confirmed:  { title: 'Order Confirmed', body: 'Your medicine order has been confirmed by the pharmacy.' },
    preparing:  { title: 'Order Being Prepared', body: 'Your medicine order is currently being prepared.' },
    ready:      { title: 'Order Ready', body: 'Your medicine order is ready for pickup.' },
    dispatched: { title: 'Order Dispatched', body: 'Your medicine order is on its way to you.' },
    delivered:  { title: 'Order Delivered', body: 'Your medicine order has been delivered successfully.' },
    cancelled:  { title: 'Order Cancelled', body: 'Your medicine order has been cancelled.' }
};

const ORDER_STATUS_TYPES = {
    confirmed:  'PHARMACY_ORDER_CONFIRMED',
    preparing:  'PHARMACY_ORDER_PREPARING',
    ready:      'PHARMACY_ORDER_READY',
    dispatched: 'PHARMACY_ORDER_DISPATCHED',
    delivered:  'PHARMACY_ORDER_DELIVERED',
    cancelled:  'PHARMACY_ORDER_CANCELLED'
};

export async function notifyPharmacyNewOrder({ order, pharmacyOwnerId }) {
    const jobs = [];
    const orderId = order?._id;
    const humanOrderId = order?.orderId || 'your medicine order';
    const isOnlinePaid = order?.paymentMethod === 'online' && order?.paymentStatus === 'paid';

    // Pharmacy owner gets in-app + push
    if (pharmacyOwnerId) {
        jobs.push(createNotification({
            userId: pharmacyOwnerId,
            type: 'PHARMACY_ORDER_PLACED',
            title: isOnlinePaid ? 'New Paid Pharmacy Order' : 'New Pharmacy Order',
            body: isOnlinePaid 
                ? `Paid medicine order ${humanOrderId} received via Razorpay.` 
                : `A new medicine order (${humanOrderId}) has been received at your pharmacy.`,
            link: '/#/pharmacy',
            priority: 'high',
            entityType: 'order',
            entityId: orderId ? String(orderId) : null,
            data: { orderId: String(orderId || '') }
        }).catch(() => {}));
    }

    // Patient gets in-app + push confirming order placed
    const patientId = order?.userId?._id || order?.userId;
    if (patientId && String(patientId) !== String(pharmacyOwnerId)) {
        jobs.push(createNotification({
            userId: patientId,
            type: 'PHARMACY_ORDER_PLACED',
            title: isOnlinePaid ? 'Payment Successful' : 'Order Placed Successfully',
            body: isOnlinePaid
                ? `Your medicine order ${humanOrderId} has been confirmed.`
                : `Your medicine order ${humanOrderId} has been placed successfully.`,
            link: `/#/patient/medicine/orders/${orderId}`,
            entityType: 'order',
            entityId: orderId ? String(orderId) : null,
            data: { orderId: String(orderId || '') }
        }).catch(() => {}));
    }

    return Promise.allSettled(jobs);
}

export async function notifyPharmacyPaymentFailed({ userId, orderId, humanOrderId }) {
    if (!userId) return;
    return createNotification({
        userId,
        type: 'PHARMACY_ORDER_CANCELLED',
        title: 'Payment Failed',
        body: `We couldn't complete payment for your medicine order${humanOrderId ? ` ${humanOrderId}` : ''}.`,
        link: '/#/patient/medicine/cart',
        priority: 'high',
        entityType: 'order',
        entityId: orderId ? String(orderId) : null,
        data: { orderId: String(orderId || ''), failure: true }
    }).catch(() => {});
}


export async function notifyPharmacyOrderStatus({ order, status, note }) {
    const userId = order?.userId?._id || order?.userId;
    if (!userId) return;

    const orderId = order?._id;
    const msg = ORDER_STATUS_MESSAGES[status];
    if (!msg) return; // 'pending' has no status-change notification

    const notifType = ORDER_STATUS_TYPES[status] || 'PHARMACY_ORDER_PLACED';
    const priority = (status === 'delivered' || status === 'ready') ? 'high' : 'normal';

    return createNotification({
        userId,
        type: notifType,
        title: msg.title,
        body: msg.body,
        link: `/#/patient/medicine/orders/${orderId}`,
        priority,
        entityType: 'order',
        entityId: orderId ? String(orderId) : null,
        data: { orderId: String(orderId || ''), status }
    }).catch(() => {});
}

export default {
    createNotification,
    sendNotification,
    sendPushToUser,
    sendPushToUsers,
    notifyAccountCreated,
    notifyAppointmentBooked,
    notifyAppointmentConfirmed,
    notifyAppointmentRejected,
    notifyAppointmentCancelled,
    notifyAppointmentCompleted,
    notifyQueueStatus,
    notifyHealthRecordUploaded,
    notifyReferralCreated,
    notifyReferralStatusChanged,
    notifyQueueFinalized,
    notifyDoctorSessionSchedule,
    notifyDiagnosticCompleted,
    notifyPharmacyNewOrder,
    notifyPharmacyPaymentFailed,
    notifyPharmacyOrderStatus
};