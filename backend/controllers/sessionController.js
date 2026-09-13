import User from '../models/User.js';
import SessionQueue from '../models/SessionQueue.js';
import {
    sessionsForDate, publicSession, validateSession, overlaps, SESSION_STATUS
} from '../services/sessionService.js';

/**
 * Doctors configure their own sessions; patients read what is bookable.
 *
 * Every write here resolves the doctor from the token. A doctorId in a body
 * would let one doctor rewrite another's clinic, so none is accepted.
 */

/** GET /api/sessions/mine — the signed-in doctor's own configuration. */
export const getMySessions = async (req, res) => {
    try {
        const doctor = await User.findById(req.user.id).select('role sessions').lean();
        if (!doctor || doctor.role !== 'doctor') return res.status(403).json({ message: 'Only a doctor has sessions' });
        res.json({ sessions: doctor.sessions || [] });
    } catch (e) { res.status(500).json({ message: e.message }); }
};

/** POST /api/sessions — add one to the caller's own schedule. */
export const createSession = async (req, res) => {
    try {
        const doctor = await User.findById(req.user.id).select('role sessions');
        if (!doctor || doctor.role !== 'doctor') return res.status(403).json({ message: 'Only a doctor can add a session' });

        const { error, value } = validateSession(req.body);
        if (error) return res.status(400).json({ message: error });
        if (overlaps(value, doctor.sessions || [])) {
            return res.status(409).json({ message: 'This overlaps a session you already run that day' });
        }

        doctor.sessions.push(value);
        await doctor.save();
        res.status(201).json({ sessions: doctor.sessions });
    } catch (e) { res.status(500).json({ message: e.message }); }
};

/** PUT /api/sessions/:sessionId — edit one of the caller's own. */
export const updateSession = async (req, res) => {
    try {
        const doctor = await User.findById(req.user.id).select('role sessions');
        if (!doctor || doctor.role !== 'doctor') return res.status(403).json({ message: 'Only a doctor can edit a session' });

        const session = doctor.sessions.id(req.params.sessionId);
        if (!session) return res.status(404).json({ message: 'Session not found' });

        const { error, value } = validateSession({ ...session.toObject(), ...req.body });
        if (error) return res.status(400).json({ message: error });
        const others = doctor.sessions.filter(s => String(s._id) !== String(session._id));
        if (overlaps(value, others)) {
            return res.status(409).json({ message: 'This overlaps a session you already run that day' });
        }

        Object.assign(session, value);
        await doctor.save();
        res.json({ sessions: doctor.sessions });
    } catch (e) { res.status(500).json({ message: e.message }); }
};

/**
 * DELETE /api/sessions/:sessionId — retire one.
 *
 * Deactivated rather than removed: appointments already booked against it
 * still name it, and deleting the definition would leave them pointing at
 * nothing.
 */
export const deleteSession = async (req, res) => {
    try {
        const doctor = await User.findById(req.user.id).select('role sessions');
        if (!doctor || doctor.role !== 'doctor') return res.status(403).json({ message: 'Only a doctor can remove a session' });
        const session = doctor.sessions.id(req.params.sessionId);
        if (!session) return res.status(404).json({ message: 'Session not found' });
        session.active = false;
        await doctor.save();
        res.json({ sessions: doctor.sessions });
    } catch (e) { res.status(500).json({ message: e.message }); }
};

/**
 * GET /api/sessions/doctor/:doctorId?date= — what a patient may book.
 *
 * Capacity is reported as a number of free places and a yes/no. Who holds the
 * others is not part of the answer.
 */
export const getDoctorSessions = async (req, res) => {
    try {
        const { date } = req.query;
        // A malformed id is a doctor that does not exist, not a server fault.
        if (!/^[a-f0-9]{24}$/i.test(String(req.params.doctorId))) {
            return res.status(404).json({ message: 'Doctor not found' });
        }
        if (!date || Number.isNaN(new Date(date).getTime())) {
            return res.status(400).json({ message: 'A valid date is required' });
        }
        const result = await sessionsForDate({ doctorId: req.params.doctorId, date });
        if (!result) return res.status(404).json({ message: 'Doctor not found' });

        res.json({
            doctor: { id: String(result.doctor._id), name: result.doctor.name, specialization: result.doctor.specialization || null },
            date: result.date,
            /**
             * How many sessions this doctor runs at all, irrespective of the
             * date asked about. `sessions` below is only the ones running that
             * day, so a caller deciding which booking UI to show cannot use it:
             * a doctor with Saturday-only sessions would look slot-based on
             * every other day of the week.
             */
            configured: (result.doctor.sessions || []).filter(s => s.active).length,
            sessions: result.sessions.map(publicSession)
        });
    } catch (e) { res.status(500).json({ message: e.message }); }
};

/**
 * GET /api/sessions/mine/queue?date= — the doctor's own finalised lists.
 *
 * Scoped to the caller by construction: the query is built from the token, so
 * there is no id to tamper with and no other doctor's clinic to reach.
 */
export const getMySessionQueues = async (req, res) => {
    try {
        const doctor = await User.findById(req.user.id).select('role').lean();
        if (!doctor || doctor.role !== 'doctor') return res.status(403).json({ message: 'Only a doctor has a queue' });

        const filter = { doctorId: req.user.id };
        if (req.query.date) filter.date = String(req.query.date).slice(0, 10);

        const queues = await SessionQueue.find(filter).sort({ date: -1, startsAt: 1 }).limit(30)
            .populate('entries.patientId', 'name age village').lean();

        res.json({
            queues: queues.map(q => ({
                sessionId: String(q.sessionId), sessionName: q.sessionName, date: q.date,
                startsAt: q.startsAt, endsAt: q.endsAt, cutoffAt: q.cutoffAt,
                finalizedAt: q.finalizedAt, totalPatients: q.totalPatients,
                entries: q.entries.map(e => ({
                    position: e.position,
                    patientName: e.patientId?.name || 'Patient',
                    patientAge: e.patientId?.age ?? null,
                    estimatedArrivalTime: e.estimatedArrivalTime,
                    // The doctor is the one clinician who may see why somebody
                    // is where they are; it is what the order is for.
                    referralPriority: e.referralPriority,
                    priorityGroups: e.priorityGroups
                }))
            }))
        });
    } catch (e) { res.status(500).json({ message: e.message }); }
};

export { SESSION_STATUS };
