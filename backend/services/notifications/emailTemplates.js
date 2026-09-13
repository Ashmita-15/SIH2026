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
            hour: '2-digit', minute: '2-digit',
            // The clinic's clock, not the server's.
            timeZone: process.env.CLINIC_TZ || 'Asia/Kolkata'
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

// ─── Session queue ──────────────────────────────────────────────────────────

export function queueFinalizedEmail({ patientName, doctorName, facilityName, date, sessionName, position, estimatedArrivalTime, totalPatients }) {
    return {
        subject: `Your queue number for ${date} - GramSathi`,
        html: wrapEmail({
            title: `You are number ${position} in the queue`,
            bodyHtml: `
                <p>Hello ${patientName || 'there'}, booking for this session has now closed and your place is confirmed.</p>
                ${infoRow('Doctor', doctorName)}
                ${infoRow('Facility', facilityName)}
                ${infoRow('Date', date)}
                ${infoRow('Session', sessionName)}
                ${infoRow('Your queue number', `<strong>${position}</strong> of ${totalPatients}`)}
                ${infoRow('Please arrive by', fmtDate(estimatedArrivalTime))}
                <p style="margin-top:16px; padding:12px; background:#fef3c7; border-radius:6px; color:#92400e;">
                  <strong>Your arrival time is an estimate.</strong> Consultations can run early or late.
                  Please be ready from a little before this time.
                </p>
                <p>Your queue number will not change.</p>
            `
        })
    };
}

export function doctorSessionScheduleEmail({ doctorName, facilityName, date, sessionName, startsAt, endsAt, totalPatients, entries }) {
    const rows = (entries || []).map(e => `
        <tr>
          <td style="padding:6px 10px; border-bottom:1px solid #e5e7eb;">${e.position}</td>
          <td style="padding:6px 10px; border-bottom:1px solid #e5e7eb;">${e.patientName}</td>
          <td style="padding:6px 10px; border-bottom:1px solid #e5e7eb;">${fmtDate(e.estimatedArrivalTime)}</td>
        </tr>`).join('');

    return {
        subject: `Your ${sessionName} schedule for ${date} - ${totalPatients} patients`,
        html: wrapEmail({
            title: `${sessionName}: ${totalPatients} patients booked`,
            bodyHtml: `
                <p>Hello ${doctorName || 'Doctor'}, booking has closed and the queue for this session is final.</p>
                ${infoRow('Facility', facilityName)}
                ${infoRow('Date', date)}
                ${infoRow('Session', `${fmtDate(startsAt)} to ${fmtDate(endsAt)}`)}
                ${infoRow('Total patients', totalPatients)}
                <table style="width:100%; border-collapse:collapse; margin-top:14px; font-size:13px;">
                  <thead>
                    <tr style="background:#f3f4f6;">
                      <th align="left" style="padding:8px 10px;">#</th>
                      <th align="left" style="padding:8px 10px;">Patient</th>
                      <th align="left" style="padding:8px 10px;">Expected</th>
                    </tr>
                  </thead>
                  <tbody>${rows}</tbody>
                </table>
                <p style="margin-top:14px; color:#6b7280;">
                  Order is set by referral priority and then by booking time. Expected times are estimates.
                </p>
            `
        })
    };
}

export function diagnosticCompletedEmail({ patientName, testName, resultSummary, facilityName }) {
    return {
        subject: `Your ${testName} result is ready - GramSathi`,
        html: wrapEmail({
            title: 'Your test result is ready',
            bodyHtml: `
                <p>Hello ${patientName || 'there'}, the result of your test has been recorded.</p>
                ${infoRow('Test', testName)}
                ${infoRow('Facility', facilityName)}
                ${infoRow('Result', resultSummary)}
                <p style="margin-top:14px;">You can see this in the app under <strong>My tests</strong>, and it has been added to your health record.</p>
                <p style="color:#6b7280;">Please discuss the result with your doctor. This message is not medical advice.</p>
            `
        })
    };
}

// ─── Emergency alert ────────────────────────────────────────────────────────

export function emergencyAlertEmail({ patientName, latitude, longitude, timestamp, dashboardUrl }) {
    const mapsUrl = `https://www.google.com/maps?q=${latitude},${longitude}`;
    const fmtTime = timestamp
        ? new Date(timestamp).toLocaleString('en-IN', {
            weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
            timeZone: process.env.CLINIC_TZ || 'Asia/Kolkata'
        })
        : 'Unknown';

    return {
        subject: `🚨 EMERGENCY ALERT – Patient ${patientName} needs help`,
        html: `
<div style="font-family: Arial, Helvetica, sans-serif; background:#f4f6f8; padding:24px 0; margin:0;">
  <div style="max-width:520px; margin:0 auto; background:#ffffff; border-radius:8px; overflow:hidden; border:1px solid #e5e7eb;">
    <div style="background:#A81E17; padding:18px 24px;">
      <span style="color:#ffffff; font-size:18px; font-weight:bold; letter-spacing:0.3px;">🚨 EMERGENCY ALERT — GramSathi</span>
    </div>
    <div style="padding:24px;">
      <h2 style="margin:0 0 16px 0; color:#A81E17; font-size:18px;">A patient near your facility needs emergency help</h2>
      <div style="color:#374151; font-size:14px; line-height:1.6;">
        ${infoRow('Patient name', patientName)}
        ${infoRow('Alert sent at', fmtTime)}
        ${infoRow('Coordinates', `${latitude}, ${longitude}`)}
        <p style="margin:16px 0 8px 0;">
          <a href="${mapsUrl}" style="display:inline-block; padding:10px 20px; background:#A81E17; color:#ffffff; text-decoration:none; border-radius:6px; font-weight:bold;">
            📍 Open Patient Location in Google Maps
          </a>
        </p>
        ${dashboardUrl ? `<p style="margin:8px 0;">
          <a href="${dashboardUrl}" style="color:#A81E17; font-weight:bold;">Acknowledge this alert in GramSathi →</a>
        </p>` : ''}
        <p style="margin-top:16px; padding:12px; background:#fef3f2; border-radius:6px; color:#A81E17; font-weight:500;">
          This patient triggered an emergency alert from the GramSathi app. Please respond immediately if possible.
        </p>
      </div>
    </div>
    <div style="padding:16px 24px; background:#f9fafb; border-top:1px solid #e5e7eb;">
      <p style="margin:0; color:#9ca3af; font-size:12px;">
        This is an automated emergency alert from GramSathi. Please do not reply to this email.
      </p>
    </div>
  </div>
</div>`.trim()
    };
}

export default {
    diagnosticCompletedEmail,
    queueFinalizedEmail,
    doctorSessionScheduleEmail,
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
    referralStatusChangedEmail,
    emergencyAlertEmail
};