import { sendMail } from './mailer.js';
import * as templates from './emailTemplates.js';

/**
 * Every function here is fire-and-forget from the caller's point of view:
 * it returns a promise, but a controller should call it without awaiting
 * (or await + .catch(()=>{})) so a slow or failing mail server never delays
 * or breaks the actual request. sendMail() itself never throws.
 */

// ─── Account ────────────────────────────────────────────────────────────────

export async function notifyAccountCreated(user) {
    if (!user?.email) return;
    const { subject, html } = templates.accountCreatedEmail({
        name: user.name,
        role: user.role
    });
    return sendMail({ to: user.email, subject, html });
}

// ─── Appointments ───────────────────────────────────────────────────────────

/** Sent to both the patient (confirmation of request) and the doctor (new request to review). */
export async function notifyAppointmentBooked({ patient, doctor, appointment }) {
    const jobs = [];
    if (patient?.email) {
        const { subject, html } = templates.appointmentBookedPatientEmail({
            patientName: patient.name,
            doctorName: doctor?.name,
            requestedDate: appointment.requestedDate,
            timeSlot: appointment.timeSlot,
            symptoms: appointment.symptoms
        });
        jobs.push(sendMail({ to: patient.email, subject, html }));
    }
    if (doctor?.email) {
        const { subject, html } = templates.appointmentBookedDoctorEmail({
            doctorName: doctor.name,
            patientName: patient?.name,
            requestedDate: appointment.requestedDate,
            timeSlot: appointment.timeSlot
        });
        jobs.push(sendMail({ to: doctor.email, subject, html }));
    }
    return Promise.all(jobs);
}

/**
 * The "final time allotted" notification: sent when the doctor confirms.
 * queueInfo is optional — when supplied, the same email also carries the
 * patient's current approximate queue position for that day, so they get
 * one email instead of two.
 */
export async function notifyAppointmentConfirmed({ patient, doctor, appointment, queueInfo }) {
    if (!patient?.email) return;
    const { subject, html } = templates.appointmentConfirmedEmail({
        patientName: patient.name,
        doctorName: doctor?.name,
        confirmedDate: appointment.confirmedDate,
        timeSlot: appointment.timeSlot,
        queuePosition: queueInfo?.position,
        estimatedAt: queueInfo?.estimatedAt
    });
    return sendMail({ to: patient.email, subject, html });
}

export async function notifyAppointmentRejected({ patient, doctor, appointment }) {
    if (!patient?.email) return;
    const { subject, html } = templates.appointmentRejectedEmail({
        patientName: patient.name,
        doctorName: doctor?.name,
        rejectionReason: appointment.rejectionReason
    });
    return sendMail({ to: patient.email, subject, html });
}

export async function notifyAppointmentCancelled({ patient, doctor, appointment }) {
    if (!doctor?.email) return;
    const { subject, html } = templates.appointmentCancelledDoctorEmail({
        doctorName: doctor.name,
        patientName: patient?.name,
        requestedDate: appointment.requestedDate,
        timeSlot: appointment.timeSlot
    });
    return sendMail({ to: doctor.email, subject, html });
}

/**
 * The "approx time allotted" notification: user-triggered ("email me my
 * queue status"), never sent automatically on every queue read — a patient
 * refreshing the queue screen should not trigger an email each time.
 */
export async function notifyQueueStatus({ patient, doctor, date, position, aheadOfYou, estimatedAt }) {
    if (!patient?.email) return;
    const { subject, html } = templates.queueStatusEmail({
        patientName: patient.name,
        doctorName: doctor?.name,
        date,
        position,
        aheadOfYou,
        estimatedAt
    });
    return sendMail({ to: patient.email, subject, html });
}

// ─── Health records ─────────────────────────────────────────────────────────

/**
 * Works for either direction (doctor -> patient today; patient/health-worker
 * -> doctor whenever that upload path is added) — recipient and uploader are
 * both passed in explicitly rather than assumed.
 */
export async function notifyHealthRecordUploaded({ recipient, uploadedBy, record }) {
    if (!recipient?.email) return;
    const { subject, html } = templates.healthRecordUploadedEmail({
        recipientName: recipient.name,
        uploadedByName: uploadedBy?.name,
        uploadedByRole: uploadedBy?.role,
        diagnosis: record?.diagnosis
    });
    return sendMail({ to: recipient.email, subject, html });
}

// ─── Referrals ──────────────────────────────────────────────────────────────

/** Sent to the destination facility's own inbox and to the patient. */
export async function notifyReferralCreated({ referral, patient, fromFacilityName, toFacilityEmail, toFacilityName }) {
    const jobs = [];
    if (toFacilityEmail) {
        const { subject, html } = templates.referralCreatedFacilityEmail({
            facilityName: toFacilityName,
            patientName: patient?.name,
            fromFacilityName,
            priority: referral.priority,
            reason: referral.reason,
            dueBy: referral.dueBy
        });
        jobs.push(sendMail({ to: toFacilityEmail, subject, html }));
    }
    if (patient?.email) {
        const { subject, html } = templates.referralCreatedPatientEmail({
            patientName: patient.name,
            toFacilityName,
            priority: referral.priority,
            dueBy: referral.dueBy
        });
        jobs.push(sendMail({ to: patient.email, subject, html }));
    }
    return Promise.all(jobs);
}

/** Sent to the patient whenever a referral moves to a status worth knowing about. */
export async function notifyReferralStatusChanged({ referral, patient, toFacilityName, status, note }) {
    if (!patient?.email) return;
    // Not every intermediate status needs to reach the patient's inbox.
    const NOTIFY_STATUSES = ['scheduled', 'completed', 'missed', 'declined', 'lapsed'];
    if (!NOTIFY_STATUSES.includes(status)) return;

    const { subject, html } = templates.referralStatusChangedEmail({
        patientName: patient.name,
        toFacilityName,
        status,
        note
    });
    return sendMail({ to: patient.email, subject, html });
}

/**
 * A patient's final place in a session queue. Sent once, by the scheduler,
 * after booking closes — never at booking time, when no position exists yet.
 */
export async function notifyQueueFinalized({ patient, doctorName, facilityName, date, sessionName, startsAt, position, estimatedArrivalTime, totalPatients }) {
    if (!patient?.email) return { sent: false, reason: 'no_recipient' };
    const mail = templates.queueFinalizedEmail({
        patientName: patient.name, doctorName, facilityName, date, sessionName,
        position, estimatedArrivalTime, totalPatients
    });
    return sendMail({ to: patient.email, ...mail });
}

/** The doctor's own list for a finalised session. */
export async function notifyDoctorSessionSchedule({ doctor, facilityName, date, sessionName, startsAt, endsAt, totalPatients, entries }) {
    if (!doctor?.email) return { sent: false, reason: 'no_recipient' };
    const mail = templates.doctorSessionScheduleEmail({
        doctorName: doctor.name, facilityName, date, sessionName,
        startsAt, endsAt, totalPatients, entries
    });
    return sendMail({ to: doctor.email, ...mail });
}

/** A finished test, told to the patient who was waiting for it. */
export async function notifyDiagnosticCompleted({ patient, testName, resultSummary, facilityName }) {
    if (!patient?.email) return { sent: false, reason: 'no_recipient' };
    const mail = templates.diagnosticCompletedEmail({
        patientName: patient.name, testName, resultSummary, facilityName
    });
    return sendMail({ to: patient.email, ...mail });
}

export default {
    notifyDiagnosticCompleted,
    notifyQueueFinalized,
    notifyDoctorSessionSchedule,
    notifyAccountCreated,
    notifyAppointmentBooked,
    notifyAppointmentConfirmed,
    notifyAppointmentRejected,
    notifyAppointmentCancelled,
    notifyQueueStatus,
    notifyHealthRecordUploaded,
    notifyReferralCreated,
    notifyReferralStatusChanged
};