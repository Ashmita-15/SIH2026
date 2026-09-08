import User from '../models/User.js';
import HealthRecord from '../models/HealthRecord.js';
import Appointment from '../models/Appointment.js';
import Referral from '../models/Referral.js';
import Task from '../models/Task.js';
import CarePlan from '../models/CarePlan.js';
import AgentRecommendation from '../models/AgentRecommendation.js';
import { mayAccessTimeline } from './timelineService.js';
import { forbidden, notFound } from './errors.js';

/**
 * Read-only views for coordination review.
 *
 * Two questions an agent needs answered that nothing else answered before:
 * which patients is this facility responsible for, and what coordination has
 * or has not happened for one of them.
 *
 * Neither invents an access rule. Membership is the same three connections
 * timelineService already treats as legitimate grounds for a facility to see a
 * patient — a referral at either end, an encounter recorded there, or an
 * assisted consultation arranged from there — and the per-patient read calls
 * that module's own check rather than repeating it. A facility gains no reach
 * here that it did not already have on the timeline screen.
 */

async function resolveFacilityActor(ctx) {
    if (!ctx?.actorId) throw forbidden('No acting user supplied');
    const user = await User.findById(ctx.actorId).select('role hospitalId catchmentVillages name');
    if (!user) throw forbidden('Acting user not found');
    if (!user.hospitalId) throw forbidden('Your account is not attached to a facility');
    return user;
}

/**
 * The patients this facility is entitled to review.
 *
 * Gathered from the three connections rather than from a patient list, because
 * there is no such thing as "this facility's patients" in the data — there are
 * only patients this facility has been involved with, which is exactly the set
 * that should be reviewable.
 */
export async function listFacilityPatients(ctx) {
    const actor = await resolveFacilityActor(ctx);
    const facility = actor.hospitalId;

    const [fromReferrals, fromEncounters, fromAppointments] = await Promise.all([
        Referral.find({ $or: [{ toFacilityId: facility }, { fromFacilityId: facility }] }).distinct('patientId'),
        HealthRecord.find({ facilityId: facility }).distinct('patientId'),
        Appointment.find({ assistedFacilityId: facility }).distinct('patientId')
    ]);

    const ids = [...new Set([...fromReferrals, ...fromEncounters, ...fromAppointments].map(String))];
    if (!ids.length) return [];

    return User.find({ _id: { $in: ids }, role: 'patient' })
        .select('name age gender village phone')
        .limit(500);
}

/**
 * Everything needed to judge whether a patient has been followed up.
 *
 * Deliberately one call. The agent's reasoning is about the relationship
 * between these things — a danger sign is only a coordination problem if
 * nothing happened after it — and fetching them separately would invite an
 * agent to reason over a half-loaded picture.
 *
 * Access is re-checked per patient through the timeline rule, so a patient id
 * guessed rather than listed still gets refused.
 */
export async function getCoordinationSnapshot(patientId, ctx) {
    const actor = await resolveFacilityActor(ctx);

    const patient = await User.findOne({ _id: patientId, role: 'patient' })
        .select('name age gender village phone');
    if (!patient) throw notFound('Patient not found');
    if (!await mayAccessTimeline(actor, patient)) throw notFound('Patient not found');

    const [encounters, tasks, carePlans, referrals, appointments, recommendations] = await Promise.all([
        // Only what the reasoning uses: when, what kind, and what the
        // deterministic engine already flagged. No vitals, no notes.
        HealthRecord.find({ patientId })
            .select('type occurredAt dangerSigns facilityId authorRole diagnosis')
            .sort({ occurredAt: -1 }).limit(30),

        Task.find({ patientId })
            .select('type title status priority dueAt completedAt source sourceRef createdAt')
            .sort({ createdAt: -1 }).limit(50),

        CarePlan.find({ patientId })
            .select('type status riskLevel riskFlags startedAt assignedWorkerId')
            .sort({ createdAt: -1 }).limit(10),

        Referral.find({ patientId })
            .select('referralId status priority dueBy createdAt completedAt')
            .sort({ createdAt: -1 }).limit(20),

        Appointment.find({ patientId })
            .select('status requestedDate confirmedDate createdAt')
            .sort({ createdAt: -1 }).limit(20),

        // What other agents have already proposed for this person, so a second
        // agent does not ask for work that is already queued or underway.
        AgentRecommendation.find({ patientId, status: { $in: ['pending', 'approved', 'executed'] } })
            .select('agentId problem status createdAt createdTaskId')
            .sort({ createdAt: -1 }).limit(30)
    ]);

    return { patient, encounters, tasks, carePlans, referrals, appointments, recommendations };
}
