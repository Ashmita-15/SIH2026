import Appointment from '../models/Appointment.js';
import SessionQueue from '../models/SessionQueue.js';
import User from '../models/User.js';
import Hospital from '../models/Hospital.js';
import { computeSessionOrder, arrivalTimes } from './queueService.js';
import { sessionWindow, sessionKeyFor, runsOn, SCHEDULER_TICK_MS } from '../config/sessions.js';
import { notifyQueueFinalized, notifyDoctorSessionSchedule } from './notifications/notificationService.js';

/**
 * The thing that makes this automatic.
 *
 * Nobody presses a button. Once a minute this looks for sessions whose booking
 * cutoff has passed and which have not been finalised, fixes their order,
 * writes it down and tells everyone involved.
 *
 * Three properties matter more than anything else here:
 *
 *  1. It runs at most once per session. The SessionQueue unique key decides
 *     that, not a flag this process remembers — so a restart mid-tick, a
 *     second server, or two ticks overlapping all end with one queue.
 *  2. Finalising and notifying are separate. A dead mail server must not cause
 *     the queue to be recomputed, so the order is committed first and the
 *     sending is retried on later ticks against the stored snapshot.
 *  3. It never invents. Positions come from computeSessionOrder, which reads
 *     the same referral priorities and care plans a clinician entered.
 */

/** Sessions whose cutoff fell within this window are still worth finalising. */
const LOOKBACK_HOURS = 48;
const MAX_NOTIFY_ATTEMPTS = 5;

let timer = null;
let running = false;

/** Every (doctor, session, date) whose cutoff has passed and is not yet frozen. */
async function dueSessions(now) {
    const doctors = await User.find({ role: 'doctor', 'sessions.0': { $exists: true } })
        .select('name email sessions hospitalId').lean();

    const due = [];
    for (const doctor of doctors) {
        for (const session of doctor.sessions) {
            if (!session.active) continue;
            // Today and the next two days: a cutoff is at most a few hours
            // before a session, so nothing further out can be due yet.
            for (let offset = -Math.ceil(LOOKBACK_HOURS / 24); offset <= 2; offset++) {
                const d = new Date(now);
                d.setUTCDate(d.getUTCDate() + offset);
                const dateISO = d.toISOString().slice(0, 10);
                if (!runsOn(dateISO, session)) continue;

                const w = sessionWindow(dateISO, session);
                if (!w) continue;
                if (now < w.cutoff) continue;                                  // not yet
                if (now - w.cutoff > LOOKBACK_HOURS * 3600_000) continue;      // long gone
                due.push({ doctor, session, dateISO, window: w });
            }
        }
    }
    return due;
}

/**
 * Freeze one session. Returns the stored queue, or null if there was nothing
 * to freeze. Safe to call twice — the second call finds the existing record.
 */
export async function finalizeSession({ doctor, session, dateISO, window }) {
    const sessionKey = sessionKeyFor(session._id, dateISO);

    const existing = await SessionQueue.findOne({ sessionKey });
    if (existing) return existing;

    const order = await computeSessionOrder({
        doctorId: doctor._id, sessionId: session._id, date: dateISO
    });
    if (!order.length) return null; // nobody booked; nothing to fix or announce

    const at = arrivalTimes({ startsAt: window.start, endsAt: window.end, count: order.length });
    const entries = order.map((row, i) => ({
        appointmentId: row.appointmentId,
        patientId: row.patientId,
        position: row.position,
        estimatedArrivalTime: at(i),
        tier: row.tier,
        priorityGroups: row.priorityGroups,
        referralPriority: row.referralPriority,
        requestedAt: row.requestedAt
    }));

    let stored;
    try {
        stored = await SessionQueue.create({
            doctorId: doctor._id,
            facilityId: doctor.hospitalId || undefined,
            sessionId: session._id,
            sessionName: session.name,
            date: dateISO,
            sessionKey,
            startsAt: window.start,
            endsAt: window.end,
            cutoffAt: window.cutoff,
            entries,
            totalPatients: entries.length
        });
    } catch (e) {
        // Another tick or another instance got there first. Theirs is as valid
        // as ours would have been, and there is now exactly one.
        if (e?.code === 11000) return SessionQueue.findOne({ sessionKey });
        throw e;
    }

    /**
     * The position is copied onto the appointment too, so every existing
     * screen that already reads an appointment can show it without knowing
     * this system exists. The snapshot above stays the source of truth.
     */
    await Promise.all(entries.map(entry =>
        Appointment.updateOne(
            { _id: entry.appointmentId },
            {
                queuePosition: entry.position,
                estimatedArrivalTime: entry.estimatedArrivalTime,
                queueFinalizedAt: stored.finalizedAt
            }
        )
    ));

    return stored;
}

/**
 * Send what a finalised queue owes people, and record that it was sent.
 *
 * Patients and the doctor are tracked separately: if the doctor's email
 * bounces, patients are not told their position a second time.
 */
export async function notifyFinalized(queueDoc) {
    if (queueDoc.patientsNotifiedAt && queueDoc.doctorNotifiedAt) return queueDoc;
    if (queueDoc.notifyAttempts >= MAX_NOTIFY_ATTEMPTS) return queueDoc;

    const [doctor, patients] = await Promise.all([
        User.findById(queueDoc.doctorId).select('name email specialization hospitalId').lean(),
        User.find({ _id: { $in: queueDoc.entries.map(e => e.patientId) } }).select('name email').lean()
    ]);
    const byId = new Map(patients.map(p => [String(p._id), p]));

    // Imported rather than resolved through mongoose.model(): the registry is
    // only populated in a process that has already imported the model, so the
    // lazy version worked under the server and threw everywhere else.
    const facilityName = doctor?.hospitalId
        ? (await Hospital.findById(doctor.hospitalId).select('name').lean())?.name || null
        : null;

    await SessionQueue.updateOne({ _id: queueDoc._id }, { $inc: { notifyAttempts: 1 } });

    if (!queueDoc.patientsNotifiedAt) {
        await Promise.all(queueDoc.entries.map(entry => notifyQueueFinalized({
            patient: byId.get(String(entry.patientId)),
            doctorName: doctor?.name,
            facilityName,
            date: queueDoc.date,
            sessionName: queueDoc.sessionName,
            startsAt: queueDoc.startsAt,
            position: entry.position,
            estimatedArrivalTime: entry.estimatedArrivalTime,
            totalPatients: queueDoc.totalPatients
        }).catch(() => {})));
        await SessionQueue.updateOne({ _id: queueDoc._id }, { patientsNotifiedAt: new Date() });
    }

    if (!queueDoc.doctorNotifiedAt) {
        await notifyDoctorSessionSchedule({
            doctor,
            facilityName,
            date: queueDoc.date,
            sessionName: queueDoc.sessionName,
            startsAt: queueDoc.startsAt,
            endsAt: queueDoc.endsAt,
            totalPatients: queueDoc.totalPatients,
            entries: queueDoc.entries.map(e => ({
                position: e.position,
                patientName: byId.get(String(e.patientId))?.name || 'Patient',
                estimatedArrivalTime: e.estimatedArrivalTime
            }))
        }).catch(() => {});
        await SessionQueue.updateOne({ _id: queueDoc._id }, { doctorNotifiedAt: new Date() });
    }

    return SessionQueue.findById(queueDoc._id);
}

/** One pass. Exported so tests can run it directly instead of waiting a minute. */
export async function runOnce(now = new Date()) {
    const result = { finalized: 0, notified: 0, skipped: 0 };

    for (const due of await dueSessions(now)) {
        try {
            const before = await SessionQueue.findOne({ sessionKey: sessionKeyFor(due.session._id, due.dateISO) });
            const queue = await finalizeSession(due);
            if (!queue) { result.skipped++; continue; }
            if (!before) result.finalized++;

            const after = await notifyFinalized(queue);
            if (after?.patientsNotifiedAt && !before?.patientsNotifiedAt) result.notified++;
        } catch (e) {
            // One bad session must not stop the rest of the clinic's day.
            console.error('[sessions] finalisation failed:', e.message);
        }
    }
    return result;
}

export function startSessionScheduler() {
    /**
     * Tests drive runOnce() directly and must not race a background tick.
     * Opt-out only: absent or any value other than "false", the scheduler runs,
     * so production behaviour is unchanged by adding this.
     */
    if (process.env.SESSION_SCHEDULER === 'false') {
        console.log('[sessions] scheduler disabled (SESSION_SCHEDULER=false)');
        return null;
    }
    if (timer) return timer;
    const tick = async () => {
        if (running) return; // a slow pass must not overlap the next one
        running = true;
        try { await runOnce(); } catch (e) { console.error('[sessions] tick failed:', e.message); }
        finally { running = false; }
    };
    timer = setInterval(tick, SCHEDULER_TICK_MS);
    timer.unref?.();
    setTimeout(tick, 5_000); // one pass shortly after boot, to catch up
    console.log(`[sessions] scheduler started (every ${Math.round(SCHEDULER_TICK_MS / 1000)}s)`);
    return timer;
}

export function stopSessionScheduler() {
    if (timer) clearInterval(timer);
    timer = null;
}
