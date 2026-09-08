import User from '../models/User.js';
import Referral from '../models/Referral.js';
import Task from '../models/Task.js';
import Appointment from '../models/Appointment.js';
import CarePlan from '../models/CarePlan.js';
import HealthRecord from '../models/HealthRecord.js';
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

    return {
        facility: { id: facility },
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
