/**
 * Consulting sessions, and the moment their queue is decided.
 *
 * The hourly slot grid asks every patient to name an hour months in advance
 * and then holds the clinic to it. A rural OPD does not run that way: people
 * are told "come to the afternoon session" and are seen in an order the clinic
 * decides on the day. Sessions model that, and the cutoff is what makes the
 * order fair — bookings close, the queue is computed once from everyone who
 * actually booked, and nobody's position moves because somebody else booked
 * later.
 *
 * The old slots are untouched and still work; a session is an additional way
 * to book, not a replacement.
 */

/**
 * How long before a session starts that booking closes and the queue is fixed.
 *
 * Four hours so that a patient told to arrive at 2:15 has the morning to make
 * the journey — the travel is the expensive part, and a queue number that
 * arrives while they are already walking is worth little.
 */
export const BOOKING_CUTOFF_HOURS = Number(process.env.SESSION_CUTOFF_HOURS || 4);

/** How often the scheduler looks for sessions whose cutoff has passed. */
export const SCHEDULER_TICK_MS = Number(process.env.SESSION_TICK_MS || 60_000);

/**
 * Minutes reserved per patient when estimating arrival times.
 *
 * Only a fallback: when a session declares maxPatients the estimate divides
 * the session's real length by the number of people actually booked, which is
 * closer to the truth than any fixed figure.
 */
export const FALLBACK_MINUTES_PER_PATIENT = 10;

/** 0 = Sunday, matching Date#getDay. */
export const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];

/**
 * The clinic's wall clock, in minutes ahead of UTC. India: +05:30.
 *
 * A doctor typing "09:00" means nine in the morning where the clinic is, not
 * nine UTC. Storing instants is right; deriving them as if the typed time were
 * UTC was not, and it shifted every session, cutoff and arrival time by the
 * offset. One constant converts between the two.
 */
export const CLINIC_UTC_OFFSET_MINUTES = Number(process.env.CLINIC_UTC_OFFSET_MINUTES || 330);
export const CLINIC_TZ = process.env.CLINIC_TZ || 'Asia/Kolkata';

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const isValidTime = (v) => HHMM.test(String(v || ''));

/** Minutes since midnight, for comparing two "HH:MM" strings. */
export function minutesOf(hhmm) {
    const m = HHMM.exec(String(hhmm || ''));
    if (!m) return null;
    return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * A session on a specific day, as real instants.
 *
 * Built in UTC to match how appointment dates are stored — every requestedDate
 * in this system is pinned to UTC midnight, and deriving the session's clock
 * from a local-time date on a +05:30 server would land it on the previous day.
 */
export function sessionWindow(dateISO, session) {
    const day = new Date(`${String(dateISO).slice(0, 10)}T00:00:00.000Z`);
    if (Number.isNaN(day.getTime())) return null;

    // Wall-clock minutes, less the clinic's offset, gives the real instant.
    const start = new Date(day);
    start.setUTCMinutes((minutesOf(session.startTime) ?? 0) - CLINIC_UTC_OFFSET_MINUTES);
    const end = new Date(day);
    end.setUTCMinutes((minutesOf(session.endTime) ?? 0) - CLINIC_UTC_OFFSET_MINUTES);
    const cutoff = new Date(start.getTime() - BOOKING_CUTOFF_HOURS * 3600_000);

    return { start, end, cutoff };
}

/** One stable key per session-instance, used to make finalisation idempotent. */
export const sessionKeyFor = (sessionId, dateISO) =>
    `${String(sessionId)}:${String(dateISO).slice(0, 10)}`;

/** Does this session run on the weekday of `dateISO`? */
export function runsOn(dateISO, session) {
    const day = new Date(`${String(dateISO).slice(0, 10)}T00:00:00.000Z`);
    if (Number.isNaN(day.getTime())) return false;
    return (session.days || []).includes(day.getUTCDay());
}
