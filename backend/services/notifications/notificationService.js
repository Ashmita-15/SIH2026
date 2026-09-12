import { sendMail } from './mailer.js';
import { sendPushToUser, sendPushToUsers } from './pushService.js';
import * as templates from './emailTemplates.js';

/**
 * Unified Notification Service for GramSathi.
 *
 * Coordinates multi-channel notifications across Web Push and Email.
 *
 * Design Principles:
 * 1. Failure isolation: Push failure does not break Email; Email failure does not break Push.
 * 2. Non-blocking: Notifications are fire-and-forget or executed asynchronously; a notification
 *    failure never aborts the underlying medical transaction (appointment, record, order).
 * 3. Healthcare security & privacy: Push notifications convey essential actionable updates
 *    without exposing sensitive diagnoses, test results, or prescription details in notification banners.
 */

// ─── Unified Multi-Channel Dispatch ──────────────────────────────────────────

/**
 * Sends a notification across requested channels (push, email).
 *
 * @param {Object} params
 * @param {string|mongoose.Types.ObjectId} [params.userId] - Target user ID (for push)
 * @param {string} [params.email] - Target email address (for email)
 * @param {string} params.type - Event category
 * @param {string} params.title - Notification title
 * @param {string} params.body - Safe preview body
 * @param {Object} [params.data] - Custom payload for service worker / client navigation
 * @param {Array<'push'|'email'>} [params.channels] - Channels to dispatch through
 * @param {Object} [params.emailContent] - Optional { subject, html, text }
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

    // Push notification channel
    if (channels.includes('push') && userId) {
        promises.push(
            sendPushToUser(userId, {
                title,
                body,
                tag: `gramsathi-${type}-${data.entityId || Date.now()}`,
                data: {
                    type,
                    ...data
                }
            }).catch(err => {
                console.error(`[notificationService/push] Failed for user ${userId}:`, err.message);
                return { sent: 0, failed: 1, reason: err.message };
            })
        );
    }

    // Email channel
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

    const results = await Promise.allSettled(promises);
    return results;
}

// ─── Account Events ──────────────────────────────────────────────────────────

export async function notifyAccountCreated(user) {
    if (!user) return;
    const userId = user._id || user.id;

    const emailJob = user.email
        ? sendMail({
            to: user.email,
            ...templates.accountCreatedEmail({ name: user.name, role: user.role })
        }).catch(() => {})
        : Promise.resolve();

    const pushJob = userId
        ? sendPushToUser(userId, {
            title: 'Welcome to GramSathi',
            body: 'Your GramSathi account is ready. Access doctors, records, and prescriptions anytime.',
            tag: 'gramsathi-account-created',
            data: { url: '/', type: 'account_created' }
        }).catch(() => {})
        : Promise.resolve();

    return Promise.allSettled([emailJob, pushJob]);
}

// ─── Appointments ───────────────────────────────────────────────────────────

/** Sent to both the patient and the doctor upon booking. */
export async function notifyAppointmentBooked({ patient, doctor, appointment }) {
    const jobs = [];
    const patientId = patient?._id || patient?.id || appointment?.patientId;
    const doctorId = doctor?._id || doctor?.id || appointment?.doctorId;

    // Patient email + push
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
    if (patientId) {
        jobs.push(
            sendPushToUser(patientId, {
                title: 'Appointment Request Submitted',
                body: `Your consultation request with Dr. ${doctor?.name || 'the doctor'} has been placed.`,
                tag: `appointment-${appointment?._id}`,
                data: {
                    url: '/patient/appointments',
                    type: 'appointment_booked',
                    appointmentId: String(appointment?._id || '')
                }
            }).catch(() => {})
        );
    }

    // Doctor email + push
    if (doctor?.email) {
        const { subject, html } = templates.appointmentBookedDoctorEmail({
            doctorName: doctor.name,
            patientName: patient?.name,
            requestedDate: appointment?.requestedDate,
            timeSlot: appointment?.timeSlot
        });
        jobs.push(sendMail({ to: doctor.email, subject, html }).catch(() => {}));
    }
    if (doctorId) {
        jobs.push(
            sendPushToUser(doctorId, {
                title: 'New Consultation Request',
                body: `You have a new appointment booking request to review (${patient?.name || 'Patient'}).`,
                tag: `appointment-review-${appointment?._id}`,
                data: {
                    url: '/doctor/today',
                    type: 'appointment_review',
                    appointmentId: String(appointment?._id || '')
                }
            }).catch(() => {})
        );
    }

    return Promise.allSettled(jobs);
}

/** Doctor confirmed the appointment. */
export async function notifyAppointmentConfirmed({ patient, doctor, appointment, queueInfo }) {
    const jobs = [];
    const patientId = patient?._id || patient?.id || appointment?.patientId;

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

    if (patientId) {
        jobs.push(
            sendPushToUser(patientId, {
                title: 'Appointment Confirmed',
                body: `Your appointment with Dr. ${doctor?.name || 'the doctor'} is confirmed.`,
                tag: `appointment-confirmed-${appointment?._id}`,
                data: {
                    url: '/patient/appointments',
                    type: 'appointment_confirmed',
                    appointmentId: String(appointment?._id || '')
                }
            }).catch(() => {})
        );
    }

    return Promise.allSettled(jobs);
}

/** Doctor rejected the appointment. */
export async function notifyAppointmentRejected({ patient, doctor, appointment }) {
    const jobs = [];
    const patientId = patient?._id || patient?.id || appointment?.patientId;

    if (patient?.email) {
        const { subject, html } = templates.appointmentRejectedEmail({
            patientName: patient.name,
            doctorName: doctor?.name,
            rejectionReason: appointment?.rejectionReason
        });
        jobs.push(sendMail({ to: patient.email, subject, html }).catch(() => {}));
    }

    if (patientId) {
        jobs.push(
            sendPushToUser(patientId, {
                title: 'Appointment Update',
                body: 'Your appointment request could not be accepted. Open GramSathi for alternatives.',
                tag: `appointment-rejected-${appointment?._id}`,
                data: {
                    url: '/patient/appointments',
                    type: 'appointment_rejected',
                    appointmentId: String(appointment?._id || '')
                }
            }).catch(() => {})
        );
    }

    return Promise.allSettled(jobs);
}

/** Appointment cancelled. */
export async function notifyAppointmentCancelled({ patient, doctor, appointment }) {
    const jobs = [];
    const doctorId = doctor?._id || doctor?.id || appointment?.doctorId;
    const patientId = patient?._id || patient?.id || appointment?.patientId;

    if (doctor?.email) {
        const { subject, html } = templates.appointmentCancelledDoctorEmail({
            doctorName: doctor.name,
            patientName: patient?.name,
            requestedDate: appointment?.requestedDate,
            timeSlot: appointment?.timeSlot
        });
        jobs.push(sendMail({ to: doctor.email, subject, html }).catch(() => {}));
    }

    if (doctorId) {
        jobs.push(
            sendPushToUser(doctorId, {
                title: 'Appointment Cancelled',
                body: `An appointment with ${patient?.name || 'a patient'} has been cancelled.`,
                tag: `appointment-cancelled-${appointment?._id}`,
                data: {
                    url: '/doctor/today',
                    type: 'appointment_cancelled',
                    appointmentId: String(appointment?._id || '')
                }
            }).catch(() => {})
        );
    }

    if (patientId) {
        jobs.push(
            sendPushToUser(patientId, {
                title: 'Appointment Cancelled',
                body: 'Your scheduled appointment has been cancelled.',
                tag: `appointment-cancelled-${appointment?._id}`,
                data: {
                    url: '/patient/appointments',
                    type: 'appointment_cancelled',
                    appointmentId: String(appointment?._id || '')
                }
            }).catch(() => {})
        );
    }

    return Promise.allSettled(jobs);
}

/** Patient requested queue status. */
export async function notifyQueueStatus({ patient, doctor, date, position, aheadOfYou, estimatedAt }) {
    const jobs = [];
    const patientId = patient?._id || patient?.id;

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

    if (patientId) {
        jobs.push(
            sendPushToUser(patientId, {
                title: 'Queue Position Update',
                body: `You are #${position} in queue. Estimated arrival: ${estimatedAt || 'On schedule'}.`,
                tag: 'queue-status',
                data: {
                    url: '/patient/queue',
                    type: 'queue_status',
                    position
                }
            }).catch(() => {})
        );
    }

    return Promise.allSettled(jobs);
}

// ─── Health Records ──────────────────────────────────────────────────────────

export async function notifyHealthRecordUploaded({ recipient, uploadedBy, record }) {
    const jobs = [];
    const recipientId = recipient?._id || recipient?.id;

    if (recipient?.email) {
        const { subject, html } = templates.healthRecordUploadedEmail({
            recipientName: recipient.name,
            uploadedByName: uploadedBy?.name,
            uploadedByRole: uploadedBy?.role,
            diagnosis: record?.diagnosis
        });
        jobs.push(sendMail({ to: recipient.email, subject, html }).catch(() => {}));
    }

    if (recipientId) {
        jobs.push(
            sendPushToUser(recipientId, {
                title: 'New Health Record Added',
                body: 'A new clinical consultation record has been added to your GramSathi file.',
                tag: `record-${record?._id || Date.now()}`,
                data: {
                    url: '/patient/records',
                    type: 'health_record',
                    recordId: String(record?._id || '')
                }
            }).catch(() => {})
        );
    }

    return Promise.allSettled(jobs);
}

// ─── Referrals ───────────────────────────────────────────────────────────────

export async function notifyReferralCreated({ referral, patient, fromFacilityName, toFacilityEmail, toFacilityName }) {
    const jobs = [];
    const patientId = patient?._id || patient?.id || referral?.patientId;

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

    if (patientId) {
        jobs.push(
            sendPushToUser(patientId, {
                title: 'Specialty Referral Created',
                body: `A referral to ${toFacilityName || 'higher medical facility'} has been arranged for you.`,
                tag: `referral-${referral?._id}`,
                data: {
                    url: '/patient',
                    type: 'referral_created',
                    referralId: String(referral?._id || '')
                }
            }).catch(() => {})
        );
    }

    return Promise.allSettled(jobs);
}

export async function notifyReferralStatusChanged({ referral, patient, toFacilityName, status, note }) {
    const NOTIFY_STATUSES = ['scheduled', 'completed', 'missed', 'declined', 'lapsed'];
    if (!NOTIFY_STATUSES.includes(status)) return;

    const jobs = [];
    const patientId = patient?._id || patient?.id || referral?.patientId;

    if (patient?.email) {
        const { subject, html } = templates.referralStatusChangedEmail({
            patientName: patient.name,
            toFacilityName,
            status,
            note
        });
        jobs.push(sendMail({ to: patient.email, subject, html }).catch(() => {}));
    }

    if (patientId) {
        jobs.push(
            sendPushToUser(patientId, {
                title: 'Referral Status Updated',
                body: `Your medical referral status has moved to: ${status}.`,
                tag: `referral-status-${referral?._id}`,
                data: {
                    url: '/patient',
                    type: 'referral_status',
                    referralId: String(referral?._id || '')
                }
            }).catch(() => {})
        );
    }

    return Promise.allSettled(jobs);
}

// ─── Session Scheduler & OPD Queues ──────────────────────────────────────────

export async function notifyQueueFinalized({ patient, doctorName, facilityName, date, sessionName, startsAt, position, estimatedArrivalTime, totalPatients }) {
    const jobs = [];
    const patientId = patient?._id || patient?.id;

    if (patient?.email) {
        const mail = templates.queueFinalizedEmail({
            patientName: patient.name, doctorName, facilityName, date, sessionName,
            position, estimatedArrivalTime, totalPatients
        });
        jobs.push(sendMail({ to: patient.email, ...mail }).catch(() => {}));
    }

    if (patientId) {
        jobs.push(
            sendPushToUser(patientId, {
                title: 'Session Queue Schedule Ready',
                body: `Your consultation position is #${position}. Estimated arrival: ${estimatedArrivalTime || 'On time'}.`,
                tag: `queue-finalized-${date}-${position}`,
                data: {
                    url: '/patient/queue',
                    type: 'queue_finalized',
                    position
                }
            }).catch(() => {})
        );
    }

    return Promise.allSettled(jobs);
}

export async function notifyDoctorSessionSchedule({ doctor, facilityName, date, sessionName, startsAt, endsAt, totalPatients, entries }) {
    const jobs = [];
    const doctorId = doctor?._id || doctor?.id;

    if (doctor?.email) {
        const mail = templates.doctorSessionScheduleEmail({
            doctorName: doctor.name, facilityName, date, sessionName,
            startsAt, endsAt, totalPatients, entries
        });
        jobs.push(sendMail({ to: doctor.email, ...mail }).catch(() => {}));
    }

    if (doctorId) {
        jobs.push(
            sendPushToUser(doctorId, {
                title: 'OPD Session Finalized',
                body: `${sessionName || 'Your session'} has ${totalPatients} confirmed patients scheduled.`,
                tag: `doctor-session-${date}`,
                data: {
                    url: '/doctor/today',
                    type: 'doctor_session'
                }
            }).catch(() => {})
        );
    }

    return Promise.allSettled(jobs);
}

// ─── Diagnostics ─────────────────────────────────────────────────────────────

export async function notifyDiagnosticCompleted({ patient, testName, resultSummary, facilityName }) {
    const jobs = [];
    const patientId = patient?._id || patient?.id;

    if (patient?.email) {
        const mail = templates.diagnosticCompletedEmail({
            patientName: patient.name, testName, resultSummary, facilityName
        });
        jobs.push(sendMail({ to: patient.email, ...mail }).catch(() => {}));
    }

    if (patientId) {
        // Privacy rule: Safe general preview without exposing detailed lab values
        jobs.push(
            sendPushToUser(patientId, {
                title: 'Diagnostic Report Ready',
                body: `Your medical test report (${testName || 'Diagnostic Test'}) is ready to view.`,
                tag: `diagnostic-ready-${Date.now()}`,
                data: {
                    url: '/patient/records',
                    type: 'diagnostic_completed'
                }
            }).catch(() => {})
        );
    }

    return Promise.allSettled(jobs);
}

// ─── Pharmacy Orders ─────────────────────────────────────────────────────────

export async function notifyPharmacyNewOrder({ order, pharmacyOwnerId }) {
    if (!pharmacyOwnerId) return;

    return sendPushToUser(pharmacyOwnerId, {
        title: 'New Pharmacy Order',
        body: 'A new medicine order has been received at your pharmacy.',
        tag: `order-${order?._id}`,
        data: {
            url: '/pharmacy',
            type: 'pharmacy_new_order',
            orderId: String(order?._id || '')
        }
    });
}

export async function notifyPharmacyOrderStatus({ order, status, note }) {
    const userId = order?.userId?._id || order?.userId;
    if (!userId) return;

    const friendlyStatus = {
        confirmed: 'confirmed by pharmacy',
        ready: 'ready for pickup',
        completed: 'completed',
        cancelled: 'cancelled'
    }[status] || status;

    return sendPushToUser(userId, {
        title: 'Medicine Order Update',
        body: `Your medicine order is now ${friendlyStatus}.`,
        tag: `order-status-${order?._id}`,
        data: {
            url: '/patient/orders',
            type: 'pharmacy_order_status',
            orderId: String(order?._id || ''),
            status
        }
    });
}

export default {
    sendNotification,
    sendPushToUser,
    sendPushToUsers,
    notifyAccountCreated,
    notifyAppointmentBooked,
    notifyAppointmentConfirmed,
    notifyAppointmentRejected,
    notifyAppointmentCancelled,
    notifyQueueStatus,
    notifyHealthRecordUploaded,
    notifyReferralCreated,
    notifyReferralStatusChanged,
    notifyQueueFinalized,
    notifyDoctorSessionSchedule,
    notifyDiagnosticCompleted,
    notifyPharmacyNewOrder,
    notifyPharmacyOrderStatus
};