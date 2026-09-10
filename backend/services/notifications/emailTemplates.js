/**
 * Every email shares this shell so the inbox reads as one product, not six
 * different scripts that happen to send mail. Inline styles only -  most
 * webmail clients strip <style> blocks.
 */
function wrapEmail({ title, bodyHtml, footerNote }) {
    return `
<div style="font-family: Arial, Helvetica, sans-serif; background:#f4f6f8; padding:24px 0; margin:0;">
  <div style="max-width:520px; margin:0 auto; background:#ffffff; border-radius:8px; overflow:hidden; border:1px solid #e5e7eb;">
    <div style="background:#0f766e; padding:18px 24px;">
      <span style="color:#ffffff; font-size:18px; font-weight:bold; letter-spacing:0.3px;">GramSathi</span>
    </div>
    <div style="padding:24px;">
      <h2 style="margin:0 0 16px 0; color:#111827; font-size:18px;">${title}</h2>
      <div style="color:#374151; font-size:14px; line-height:1.6;">${bodyHtml}</div>
    </div>
    <div style="padding:16px 24px; background:#f9fafb; border-top:1px solid #e5e7eb;">
      <p style="margin:0; color:#9ca3af; font-size:12px;">
        ${footerNote || 'This is an automated message from GramSathi. Please do not reply to this email.'}
      </p>
    </div>
  </div>
</div>`.trim();
}

function infoRow(label, value) {
    if (value === undefined || value === null || value === '') return '';
    return `<p style="margin:4px 0;"><strong style="color:#111827;">${label}:</strong> ${value}</p>`;
}

function fmtDate(date) {
    if (!date) return '';
    try {
        return new Date(date).toLocaleString('en-IN', {
            weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });
    } catch {
        return String(date);
    }
}

// ─── Account ────────────────────────────────────────────────────────────────

export function accountCreatedEmail({ name, role }) {
    return {
        subject: 'Welcome to GramSathi - your account is ready',
        html: wrapEmail({
            title: `Welcome, ${name}!`,
            bodyHtml: `
                <p>Your GramSathi account has been created successfully.</p>
                ${infoRow('Account type', role)}
                <p>You can now sign in and start using GramSathi.</p>
            `
        })
    };
}

// ─── Appointments ───────────────────────────────────────────────────────────

export function appointmentBookedPatientEmail({ patientName, doctorName, requestedDate, timeSlot, symptoms }) {
    return {
        subject: 'Appointment request received',
        html: wrapEmail({
            title: `Hi ${patientName}, we've got your request`,
            bodyHtml: `
                <p>Your appointment request has been sent to the doctor for review.</p>
                ${infoRow('Doctor', doctorName)}
                ${infoRow('Requested date', fmtDate(requestedDate))}
                ${infoRow('Time slot', timeSlot)}
                ${infoRow('Symptoms', symptoms)}
                <p>You'll get another email as soon as the doctor confirms or reschedules it.</p>
            `
        })
    };
}

export function appointmentBookedDoctorEmail({ doctorName, patientName, requestedDate, timeSlot }) {
    return {
        subject: 'New appointment request',
        html: wrapEmail({
            title: `Hi Dr. ${doctorName}, a new request is waiting`,
            bodyHtml: `
                <p>A patient has requested an appointment with you.</p>
                ${infoRow('Patient', patientName)}
                ${infoRow('Requested date', fmtDate(requestedDate))}
                ${infoRow('Time slot', timeSlot)}
                <p>Please sign in to GramSathi to confirm or reject this request.</p>
            `
        })
    };
}

export function appointmentConfirmedEmail({ patientName, doctorName, confirmedDate, timeSlot, queuePosition, estimatedAt }) {
    const queueBlock = queuePosition
        ? `
            <p style="margin-top:16px;">Your current place in the doctor's queue for that day:</p>
            ${infoRow('Position in queue', queuePosition)}
            ${infoRow('Approximate time', estimatedAt ? fmtDate(estimatedAt) : 'Will be updated as the queue moves')}
            <p style="font-size:12px; color:#6b7280;">This is an estimate and can shift if the queue changes before your visit.</p>
        `
        : '';
    return {
        subject: 'Your appointment is confirmed',
        html: wrapEmail({
            title: `Confirmed, ${patientName}`,
            bodyHtml: `
                <p>Your appointment has been confirmed.</p>
                ${infoRow('Doctor', doctorName)}
                ${infoRow('Confirmed date & time', fmtDate(confirmedDate))}
                ${infoRow('Time slot', timeSlot)}
                ${queueBlock}
            `
        })
    };
}

export function appointmentRejectedEmail({ patientName, doctorName, rejectionReason }) {
    return {
        subject: 'Your appointment request was not confirmed',
        html: wrapEmail({
            title: `Hi ${patientName}`,
            bodyHtml: `
                <p>Unfortunately, Dr. ${doctorName} was not able to confirm your requested appointment.</p>
                ${infoRow('Reason', rejectionReason || 'Not specified')}
                <p>Please book another slot at a time that works.</p>
            `
        })
    };
}

export function appointmentCancelledDoctorEmail({ doctorName, patientName, requestedDate, timeSlot }) {
    return {
        subject: 'An appointment was cancelled by the patient',
        html: wrapEmail({
            title: `Hi Dr. ${doctorName}`,
            bodyHtml: `
                <p>A patient has cancelled their appointment with you.</p>
                ${infoRow('Patient', patientName)}
                ${infoRow('Was scheduled for', fmtDate(requestedDate))}
                ${infoRow('Time slot', timeSlot)}
                <p>That slot is now free again.</p>
            `
        })
    };
}

export function queueStatusEmail({ patientName, doctorName, date, position, aheadOfYou, estimatedAt }) {
    return {
        subject: `Your queue status for ${fmtDate(date)}`,
        html: wrapEmail({
            title: `Hi ${patientName}, here's where you stand`,
            bodyHtml: `
                ${infoRow('Doctor', doctorName)}
                ${infoRow('Date', fmtDate(date))}
                ${infoRow('Your position', position)}
                ${infoRow('Patients ahead of you', aheadOfYou)}
                ${infoRow('Approximate time', estimatedAt ? fmtDate(estimatedAt) : 'Not yet available')}
                <p style="font-size:12px; color:#6b7280;">This is an approximate estimate and can change as the queue moves.</p>
            `
        })
    };
}

// ─── Health records ─────────────────────────────────────────────────────────

export function healthRecordUploadedEmail({ recipientName, uploadedByName, uploadedByRole, diagnosis }) {
    return {
        subject: 'A new health record has been added to your file',
        html: wrapEmail({
            title: `Hi ${recipientName}`,
            bodyHtml: `
                <p>A new health record has been added${uploadedByName ? ` by ${uploadedByRole === 'doctor' ? 'Dr. ' : ''}${uploadedByName}` : ''}.</p>
                ${infoRow('Diagnosis / notes', diagnosis)}
                <p>Sign in to GramSathi to view the full record.</p>
            `
        })
    };
}

// ─── Referrals ──────────────────────────────────────────────────────────────

export function referralCreatedFacilityEmail({ facilityName, patientName, fromFacilityName, priority, reason, dueBy }) {
    return {
        subject: `New referral received - ${priority}`,
        html: wrapEmail({
            title: `A patient has been referred to ${facilityName}`,
            bodyHtml: `
                ${infoRow('Patient', patientName)}
                ${infoRow('Referred from', fromFacilityName)}
                ${infoRow('Priority', priority)}
                ${infoRow('Reason', reason)}
                ${infoRow('Respond by', fmtDate(dueBy))}
                <p>Please sign in to GramSathi to review and act on this referral.</p>
            `
        })
    };
}

export function referralCreatedPatientEmail({ patientName, toFacilityName, priority, dueBy }) {
    return {
        subject: 'You have been referred to another facility',
        html: wrapEmail({
            title: `Hi ${patientName}`,
            bodyHtml: `
                <p>Your health worker or doctor has referred you for further care.</p>
                ${infoRow('Referred to', toFacilityName)}
                ${infoRow('Priority', priority)}
                ${infoRow('Expected by', fmtDate(dueBy))}
                <p>Please follow up with the facility above as soon as possible.</p>
            `
        })
    };
}

export function referralStatusChangedEmail({ patientName, toFacilityName, status, note }) {
    const statusText = {
        acknowledged: 'has been acknowledged by the receiving facility',
        scheduled: 'has been scheduled',
        attended: 'visit has been marked as attended',
        completed: 'has been completed',
        missed: 'was marked as missed',
        redirected: 'has been redirected to another facility',
        declined: 'was declined by the receiving facility',
        lapsed: 'has lapsed (deadline passed without action)'
    }[status] || `status changed to ${status}`;

    return {
        subject: `Referral update: ${status}`,
        html: wrapEmail({
            title: `Hi ${patientName}`,
            bodyHtml: `
                <p>Your referral to ${toFacilityName} ${statusText}.</p>
                ${infoRow('Note', note)}
            `
        })
    };
}

export default {
    accountCreatedEmail,
    appointmentBookedPatientEmail,
    appointmentBookedDoctorEmail,
    appointmentConfirmedEmail,
    appointmentRejectedEmail,
    appointmentCancelledDoctorEmail,
    queueStatusEmail,
    healthRecordUploadedEmail,
    referralCreatedFacilityEmail,
    referralCreatedPatientEmail,
    referralStatusChangedEmail
};