import User from '../models/User.js';
import Referral from '../models/Referral.js';
import Task from '../models/Task.js';
import Appointment from '../models/Appointment.js';
import CarePlan from '../models/CarePlan.js';
import HealthRecord from '../models/HealthRecord.js';
import DiagnosticRequest from '../models/DiagnosticRequest.js';
import SessionQueue from '../models/SessionQueue.js';
import { runsOn } from '../config/sessions.js';
import { forbidden } from './errors.js';

/**
 * What this facility has to deal with today.
 *
 * Operational, not analytical. Every number here names something a person can
 * act on this morning, and every one of them opens into the actual list —
 * a count with nothing behind it is decoration, and the thing that makes a
 * dashboard get ignored is being unable to do anything from it.
 *
 * There is no district view. That would need a role and a hierarchy of
 * permissions that do not exist yet, and inventing one to make a nicer screen
 * would be the wrong order to build things in.
 */

const OPEN_REFERRAL_STATES = ['created', 'acknowledged', 'scheduled', 'missed'];
const CLOSED_REFERRAL_STATES = ['completed', 'declined', 'lapsed', 'redirected'];

/**
 * The facility the caller actually belongs to.
 *
 * Read from their account, never from the request. A facilityId in a query
 * string is a request to look at somebody else's ward.
 */
async function resolveFacilityActor(ctx) {
    if (!ctx?.actorId) throw forbidden('No acting user supplied');
    const user = await User.findById(ctx.actorId).select('role hospitalId name');
    if (!user) throw forbidden('Acting user not found');

    if (!['hospital', 'doctor', 'health_worker'].includes(user.role)) {
        throw forbidden('This dashboard is for facility staff');
    }
    if (!user.hospitalId) throw forbidden('Your account is not attached to a facility');

    return user;
}

const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const endOfToday = () => { const d = new Date(); d.setHours(23, 59, 59, 999); return d; };

export async function getFacilityDashboard(ctx) {
    const actor = await resolveFacilityActor(ctx);
    const facility = actor.hospitalId;
    const now = new Date();

    /**
     * Scope first, count second.
     *
     * Every query below is anchored to this facility before any other
     * condition, so there is no path through this file that can total up
     * somebody else's referrals.
     */
    const inbound = { toFacilityId: facility };
    const outbound = { fromFacilityId: facility };

    const [
        awaitingAck, inboundScheduled, inboundOverdue, inboundMissed, inboundCompleted,
        outboundOpen, outboundOverdue, outboundCompleted,
        openTasks, overdueTasks, highTasks,
        pendingConsults, todayConsults,
        highRiskPlans,
        urgentInbound
    ] = await Promise.all([
        Referral.countDocuments({ ...inbound, status: 'created' }),
        Referral.countDocuments({ ...inbound, status: 'scheduled' }),
        Referral.countDocuments({ ...inbound, status: { $in: OPEN_REFERRAL_STATES }, dueBy: { $lt: now } }),
        Referral.countDocuments({ ...inbound, status: 'missed' }),
        Referral.countDocuments({ ...inbound, status: 'completed' }),

        Referral.countDocuments({ ...outbound, status: { $in: OPEN_REFERRAL_STATES } }),
        Referral.countDocuments({ ...outbound, status: { $in: OPEN_REFERRAL_STATES }, dueBy: { $lt: now } }),
        Referral.countDocuments({ ...outbound, status: 'completed' }),

        Task.countDocuments({ facilityId: facility, status: { $in: ['open', 'in_progress'] } }),
        Task.countDocuments({ facilityId: facility, status: { $in: ['open', 'in_progress'] }, dueAt: { $lt: now } }),
        Task.countDocuments({ facilityId: facility, status: { $in: ['open', 'in_progress'] }, priority: 'high' }),

        countFacilityAppointments(facility, { status: 'pending' }),
        countFacilityAppointments(facility, {
            status: 'confirmed',
            confirmedDate: { $gte: startOfToday(), $lte: endOfToday() }
        }),

        CarePlan.countDocuments({ facilityId: facility, status: 'active', riskLevel: 'high' }),

        Referral.countDocuments({
            ...inbound,
            status: { $in: OPEN_REFERRAL_STATES },
            priority: { $in: ['emergency', 'urgent_24h'] }
        })
    ]);

    // The lists behind the headline numbers, so a count is one tap from the work.
    const [needsAttention, awaitingList, todayList] = await Promise.all([
        Referral.find({
            $or: [
                { ...inbound, status: { $in: OPEN_REFERRAL_STATES }, dueBy: { $lt: now } },
                { ...inbound, status: 'missed' },
                { ...inbound, status: { $in: OPEN_REFERRAL_STATES }, priority: { $in: ['emergency', 'urgent_24h'] } }
            ]
        }).populate('patientId', 'name village').populate('fromFacilityId', 'name level')
          .sort({ dueBy: 1 }).limit(20),

        Referral.find({ ...inbound, status: 'created' })
            .populate('patientId', 'name village').populate('fromFacilityId', 'name level')
            .sort({ dueBy: 1 }).limit(20),

        Referral.find({ ...inbound, status: 'scheduled', scheduledFor: { $gte: startOfToday(), $lte: endOfToday() } })
            .populate('patientId', 'name village').populate('fromFacilityId', 'name level')
            .sort({ scheduledFor: 1 }).limit(20)
    ]);

    /**
     * Quality, as distinct from workload.
     *
     * Everything above answers "what must someone do today". This answers
     * "how is this facility doing" — the accountability the problem statement
     * asks for. Every figure is counted from real documents; a facility with no
     * diagnostics reports zero rather than being hidden.
     */
    const [
        refByStatus, dxByStatus, planByType, finalisedToday, overdueFollowUps
    ] = await Promise.all([
        Referral.aggregate([
            { $match: { $or: [{ toFacilityId: facility }, { fromFacilityId: facility }] } },
            { $group: { _id: '$status', n: { $sum: 1 } } }
        ]),
        DiagnosticRequest.aggregate([
            { $match: { facilityId: facility } },
            { $group: { _id: '$status', n: { $sum: 1 } } }
        ]),
        CarePlan.aggregate([
            { $match: { facilityId: facility, status: 'active' } },
            { $group: { _id: '$type', n: { $sum: 1 } } }
        ]),
        SessionQueue.countDocuments({ facilityId: facility, date: todayISO() }),
        // A follow-up nobody did is the failure this system exists to catch.
        Task.countDocuments({ facilityId: facility, status: { $in: ['open', 'in_progress'] }, dueAt: { $lt: now } })
    ]);

    const tally = (rows) => rows.reduce((acc, r) => ({ ...acc, [r._id]: r.n }), {});
    const referralStatus = tally(refByStatus);
    const diagnosticStatus = tally(dxByStatus);
    const carePlanMix = tally(planByType);

    /**
     * Appointment load, and how much of today's clinic is already spoken for.
     *
     * Capacity is read from the sessions the doctors here actually configured,
     * so a facility that runs no sessions reports a capacity of zero rather
     * than a made-up denominator. `runsOn` is the same function the scheduler
     * uses to decide whether a session happens on a given date — asking the
     * question twice, two different ways, is how the two drift apart.
     */
    const today = todayISO();
    const facilityDoctors = await User.find({ role: 'doctor', hospitalId: facility })
        .select('_id sessions').lean();
    const doctorIds = facilityDoctors.map(d => d._id);

    const [apptRows, sessionBooked] = await Promise.all([
        Appointment.aggregate([
            { $match: { $or: [{ doctorId: { $in: doctorIds } }, { assistedFacilityId: facility }] } },
            { $group: { _id: '$status', n: { $sum: 1 } } }
        ]),
        Appointment.countDocuments({
            doctorId: { $in: doctorIds },
            sessionId: { $type: 'objectId' },
            // Appointment dates are pinned to UTC midnight, and session dates
            // are the same UTC day string, so these two agree by construction.
            requestedDate: new Date(`${today}T00:00:00.000Z`),
            status: { $in: ['pending', 'confirmed'] }
        })
    ]);

    const appointmentStatus = tally(apptRows);
    const sessionCapacityToday = facilityDoctors.reduce((total, d) => total +
        (d.sessions || [])
            .filter(s => s.active && runsOn(today, s))
            .reduce((n, s) => n + (s.maxPatients || 0), 0), 0);

    // Closed = reached a real ending, either way. Rate is out of what has
    // actually finished, so an inbox full of open referrals cannot flatter it.
    const closed = (referralStatus.completed || 0) + (referralStatus.declined || 0) +
        (referralStatus.missed || 0) + (referralStatus.lapsed || 0);
    const completionRate = closed > 0
        ? Math.round(((referralStatus.completed || 0) / closed) * 100)
        : null; // null, not 0 — nothing has closed yet, which is not 0%

    return {
        facility: { id: facility },
        quality: {
            referralCompletionRate: completionRate,
            referralsClosed: closed,
            referralsTotal: Object.values(referralStatus).reduce((a, b) => a + b, 0),
            referralStatus,
            /** Open past their due time, both directions — the accountability number. */
            slaBreached: inboundOverdue + outboundOverdue,
            referralsPending: awaitingAck,

            /**
             * Every appointment this facility owns, by status. Reported as
             * stored: nothing is re-derived, so these add up to the total.
             */
            appointmentStatus,
            appointmentsTotal: Object.values(appointmentStatus).reduce((a, b) => a + b, 0),

            /**
             * Today's clinic. `capacity` is null when no session runs today —
             * a load of "3 of 0" would read as an overflow rather than as a
             * facility that simply is not holding a clinic.
             */
            sessionCapacityToday: sessionCapacityToday || null,
            sessionBookedToday: sessionBooked,

            diagnosticStatus,
            /** anc/pnc = maternal, child_0_5 = child, the rest chronic. */
            carePlanMix,
            maternalPlans: (carePlanMix.anc || 0) + (carePlanMix.pnc || 0),
            childPlans: carePlanMix.child_0_5 || 0,
            chronicPlans: (carePlanMix.hypertension || 0) + (carePlanMix.diabetes || 0),
            overdueFollowUps,
            sessionsFinalisedToday: finalisedToday
        },
        needsAttention: {
            overdueReferrals: inboundOverdue,
            missedReferrals: inboundMissed,
            urgentReferrals: urgentInbound,
            overdueTasks
        },
        pending: {
            awaitingAcknowledgement: awaitingAck,
            pendingConsultations: pendingConsults,
            highPriorityTasks: highTasks,
            openTasks
        },
        today: {
            scheduledReferrals: inboundScheduled,
            todaysConsultations: todayConsults,
            completedReferrals: inboundCompleted
        },
        sent: {
            open: outboundOpen,
            overdue: outboundOverdue,
            completed: outboundCompleted
        },
        patients: { highRiskPlans: highRiskPlans },
        lists: {
            needsAttention: needsAttention.map(summarise),
            awaitingAcknowledgement: awaitingList.map(summarise),
            todayScheduled: todayList.map(summarise)
        }
    };
}

/**
 * Appointments belonging to a facility.
 *
 * Two ways an appointment is this facility's: a doctor who works here is
 * taking it, or a health worker here arranged it. Both are counted, because
 * both put someone in this building.
 */
/** Today, as the sessions collection writes it. */
function todayISO() {
    return new Date().toISOString().slice(0, 10);
}

async function countFacilityAppointments(facility, extra) {
    const doctors = await User.find({ role: 'doctor', hospitalId: facility }).select('_id');
    const ids = doctors.map(d => d._id);
    return Appointment.countDocuments({
        $or: [{ doctorId: { $in: ids } }, { assistedFacilityId: facility }],
        ...extra
    });
}

/** Only what a list row needs — never the whole document. */
const summarise = (r) => ({
    _id: r._id,
    referralId: r.referralId,
    patient: r.patientId?.name || null,
    village: r.patientId?.village || null,
    from: r.fromFacilityId?.name || null,
    status: r.status,
    priority: r.priority,
    reason: r.reason,
    dueBy: r.dueBy,
    scheduledFor: r.scheduledFor || null,
    missedReason: r.missedReason || null,
    overdue: !CLOSED_REFERRAL_STATES.includes(r.status) && new Date(r.dueBy) < new Date()
});
