import Appointment from '../models/Appointment.js';
import SessionQueue from '../models/SessionQueue.js';
import User from '../models/User.js';
import {
    sessionWindow, sessionKeyFor, runsOn, isValidTime, minutesOf, WEEKDAYS
} from '../config/sessions.js';

/**
 * What a doctor is offering, and whether it can still be booked.
 *
 * Everything here is derived from the doctor's configured sessions plus the
 * appointments already made against them. Nothing is stored about "how full"
 * a session is — a count that is kept would eventually disagree with the
 * appointments it claims to describe, and this way it cannot.
 */

const ACTIVE = ['pending', 'confirmed'];

/** open → cutoff passed → finalised. One session-instance moves through these once. */
export const SESSION_STATUS = { OPEN: 'open', FULL: 'full', CUTOFF: 'cutoff', FINALIZED: 'finalized' };

export function validateSession(input) {
    const name = String(input?.name || '').trim();
    if (!name) return { error: 'Session name is required' };
    if (!isValidTime(input?.startTime) || !isValidTime(input?.endTime)) {
        return { error: 'Times must be in HH:MM form' };
    }
    if (minutesOf(input.endTime) <= minutesOf(input.startTime)) {
        return { error: 'The session must end after it starts' };
    }
    const days = Array.isArray(input?.days) ? [...new Set(input.days.map(Number))] : [];
    if (!days.length || days.some(d => !WEEKDAYS.includes(d))) {
        return { error: 'Choose at least one working day' };
    }
    const maxPatients = Number(input?.maxPatients);
    if (!Number.isInteger(maxPatients) || maxPatients < 1 || maxPatients > 200) {
        return { error: 'Capacity must be between 1 and 200' };
    }
    return {
        value: {
            name: name.slice(0, 40), days: days.sort(),
            startTime: input.startTime, endTime: input.endTime,
            maxPatients, active: input.active !== false
        }
    };
}

/** Two sessions on the same weekday may not overlap. */
export function overlaps(candidate, others) {
    const cs = minutesOf(candidate.startTime), ce = minutesOf(candidate.endTime);
    return others.some(o => {
        if (!o.active) return false;
        if (!o.days.some(d => candidate.days.includes(d))) return false;
        return cs < minutesOf(o.endTime) && minutesOf(o.startTime) < ce;
    });
}

/**
 * The doctor's sessions for one date, with real booked counts.
 *
 * `includePrivate` is what separates the doctor's own view from a patient's:
 * a patient is told a session is full, never who filled it.
 */
export async function sessionsForDate({ doctorId, date, now = new Date() }) {
    const doctor = await User.findById(doctorId).select('role name specialization hospitalId sessions').lean();
    if (!doctor || doctor.role !== 'doctor') return null;

    const dateISO = String(date).slice(0, 10);
    const day = new Date(`${dateISO}T00:00:00.000Z`);
    if (Number.isNaN(day.getTime())) return null;

    const running = (doctor.sessions || []).filter(s => s.active && runsOn(dateISO, s));
    if (!running.length) return { doctor, date: dateISO, sessions: [] };

    const ids = running.map(s => s._id);
    const [booked, finals] = await Promise.all([
        Appointment.aggregate([
            { $match: { doctorId: doctor._id, sessionId: { $in: ids }, requestedDate: day, status: { $in: ACTIVE } } },
            { $group: { _id: '$sessionId', n: { $sum: 1 }, seats: { $push: '$seatNo' } } }
        ]),
        SessionQueue.find({ sessionKey: { $in: ids.map(id => sessionKeyFor(id, dateISO)) } })
            .select('sessionKey totalPatients finalizedAt').lean()
    ]);

    const bookedMap = new Map(booked.map(b => [String(b._id), b]));
    const finalMap = new Map(finals.map(f => [f.sessionKey, f]));

    const sessions = running.map(s => {
        const w = sessionWindow(dateISO, s);
        const agg = bookedMap.get(String(s._id));
        const count = agg?.n || 0;
        const final = finalMap.get(sessionKeyFor(s._id, dateISO));

        const status = final ? SESSION_STATUS.FINALIZED
            : now >= w.cutoff ? SESSION_STATUS.CUTOFF
            : count >= s.maxPatients ? SESSION_STATUS.FULL
            : SESSION_STATUS.OPEN;

        return {
            sessionId: String(s._id),
            name: s.name,
            startTime: s.startTime,
            endTime: s.endTime,
            startsAt: w.start,
            endsAt: w.end,
            cutoffAt: w.cutoff,
            maxPatients: s.maxPatients,
            booked: count,
            remaining: Math.max(0, s.maxPatients - count),
            status,
            bookable: status === SESSION_STATUS.OPEN,
            // Seats already taken, so a booking can claim a free number without
            // a second round trip. Never exposed to patients.
            takenSeats: (agg?.seats || []).filter(n => Number.isInteger(n)),
            finalizedAt: final?.finalizedAt || null,
            totalPatients: final?.totalPatients ?? null
        };
    });

    return { doctor, date: dateISO, sessions };
}

/** The patient-facing projection: capacity as a yes/no, never a roster. */
export const publicSession = (s) => ({
    sessionId: s.sessionId, name: s.name,
    startTime: s.startTime, endTime: s.endTime,
    startsAt: s.startsAt, endsAt: s.endsAt, cutoffAt: s.cutoffAt,
    remaining: s.remaining, maxPatients: s.maxPatients,
    status: s.status, bookable: s.bookable
});

/**
 * The lowest free seat number in a session.
 *
 * A seat is not a queue position and is never shown — it exists so the unique
 * index has something distinct to refuse. The position a patient is told comes
 * from finalisation, hours later, and has nothing to do with this number.
 */
export function nextFreeSeat(takenSeats, maxPatients) {
    const taken = new Set(takenSeats);
    for (let n = 1; n <= maxPatients; n++) if (!taken.has(n)) return n;
    return null;
}
