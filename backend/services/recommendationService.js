import AgentRecommendation, { PROBLEM_TYPES, RECOMMENDATION_STATUSES } from '../models/AgentRecommendation.js';
import User from '../models/User.js';
import * as taskService from './taskService.js';
import { badRequest, conflict, forbidden, notFound } from './errors.js';

/**
 * The review queue between an agent and the system.
 *
 * An agent may propose here; only a person may act. Approval is what calls the
 * task service, and it does so under the reviewer's own authority — the agent
 * is never the caller. That ordering is the point: the agent's grant stops at
 * writing a proposal, so even a badly behaved agent cannot put work on
 * anybody's list without someone agreeing to it first.
 *
 * Same context convention as every other service: { actorId, io }.
 */

const POPULATE = [
    { path: 'patientId', select: 'name age village phone' },
    { path: 'referralId', select: 'referralId status priority reason dueBy missedReason' },
    { path: 'encounterId', select: 'type occurredAt dangerSigns' },
    { path: 'recommendedAction.ownerId', select: 'name role workerType' },
    { path: 'reviewedBy', select: 'name role' },
    { path: 'createdTaskId', select: 'title status dueAt assignedTo' }
];

/**
 * Who is reviewing, and which facility they answer for.
 *
 * Recommendations are facility work, so a reviewer without a facility has no
 * queue rather than a global one.
 */
async function resolveReviewer(ctx) {
    if (!ctx?.actorId) throw forbidden('No acting user supplied');
    const user = await User.findById(ctx.actorId).select('role hospitalId name');
    if (!user) throw forbidden('Acting user not found');
    if (user.role !== 'hospital') throw forbidden('Only facility staff can review agent recommendations');
    if (!user.hospitalId) throw forbidden('Your account is not attached to a facility');
    return user;
}

/**
 * Records a proposal, unless the same unresolved problem is already queued.
 *
 * Called by the action interface on an agent's behalf, never from a route. The
 * duplicate check is what makes the agent safe to run repeatedly: a second run
 * over the same still-broken referral returns the existing row instead of
 * stacking another copy onto somebody's review queue.
 */
export async function proposeRecommendation(input) {
    const { agentId, agentRunId, patientId, problem, dedupeKey, recommendedAction } = input;

    // referralId is not required: a patient-level coordination gap need not
    // have a single referral behind it.
    if (!agentId || !agentRunId || !patientId || !problem || !dedupeKey) {
        throw badRequest('agentId, agentRunId, patientId, problem and dedupeKey are required');
    }
    if (!PROBLEM_TYPES.includes(problem)) throw badRequest(`Unknown problem type: ${problem}`);
    if (!recommendedAction?.taskType || !recommendedAction?.title) {
        throw badRequest('recommendedAction needs at least a taskType and a title');
    }

    /**
     * Blocks while the problem is still being dealt with.
     *
     * 'executed' has to be in this list: once a reviewer approved one and a
     * task exists, the referral is usually still stalled on the next run, and
     * proposing again would ask for a second task for work already underway.
     * A rejection is a decision that it is not worth doing now, so it does not
     * block — if the referral is still stuck later, that is new information
     * and worth raising again.
     */
    const existing = await AgentRecommendation.findOne({
        dedupeKey,
        status: { $in: ['pending', 'approved', 'executed'] }
    });
    if (existing) return { created: false, recommendation: existing };

    const recommendation = await AgentRecommendation.create({
        agentId,
        agentRunId,
        patientId,
        referralId: input.referralId || undefined,
        encounterId: input.encounterId || undefined,
        scopeFacilityIds: (input.scopeFacilityIds || []).filter(Boolean),
        problem,
        concern: input.concern || 'medium',
        reasoning: input.reasoning || [],
        recommendedAction,
        dedupeKey,
        status: 'pending'
    });

    return { created: true, recommendation };
}

/** Everything this facility is entitled to review. Scope first, filters second. */
export async function listRecommendations(filters = {}, ctx) {
    const reviewer = await resolveReviewer(ctx);

    const query = { scopeFacilityIds: reviewer.hospitalId };

    if (filters.status) {
        const wanted = String(filters.status).split(',').map(s => s.trim()).filter(Boolean);
        const unknown = wanted.filter(s => !RECOMMENDATION_STATUSES.includes(s));
        if (unknown.length) throw badRequest(`Unknown status: ${unknown.join(', ')}`);
        query.status = { $in: wanted };
    } else {
        query.status = 'pending';
    }

    if (filters.agentId) query.agentId = filters.agentId;
    if (filters.problem) query.problem = filters.problem;

    const rank = { high: 0, medium: 1, low: 2 };
    const rows = await AgentRecommendation.find(query)
        .populate(POPULATE)
        .limit(Math.min(Number(filters.limit) || 50, 200));

    return rows.sort((a, b) => rank[a.concern] - rank[b.concern] || b.createdAt - a.createdAt);
}

export async function getRecommendation(id, ctx) {
    const reviewer = await resolveReviewer(ctx);
    const rec = await AgentRecommendation.findById(id).populate(POPULATE);
    if (!rec) throw notFound('Recommendation not found');
    // Same answer for "no such row" and "not yours".
    const inScope = rec.scopeFacilityIds.some(f => String(f) === String(reviewer.hospitalId));
    if (!inScope) throw notFound('Recommendation not found');
    return rec;
}

/**
 * A person agrees, and only now does work appear.
 *
 * The task is created through the existing task service with exactly the
 * fields the reviewer saw. Nothing is recomputed at this point: approving a
 * proposal that then resolved to a different owner or a different priority
 * would not really have been an approval.
 */
export async function approveRecommendation(id, input = {}, ctx) {
    const reviewer = await resolveReviewer(ctx);
    const rec = await getRecommendation(id, ctx);

    if (rec.status !== 'pending') {
        throw conflict(`This recommendation is already ${rec.status}`);
    }

    const action = rec.recommendedAction;
    const dueAt = new Date(Date.now() + (action.dueInDays || 2) * 24 * 3600 * 1000);

    rec.status = 'approved';
    rec.reviewedBy = reviewer._id;
    rec.reviewedAt = new Date();
    rec.reviewNote = input.note ? String(input.note).trim() : '';
    await rec.save();

    try {
        const task = await taskService.createTask({
            patientId: rec.patientId._id || rec.patientId,
            assignedTo: action.ownerId?._id || action.ownerId || undefined,
            assignedRole: action.ownerRole,
            facilityId: action.ownerFacilityId,
            type: action.taskType,
            title: action.title,
            description: action.summary,
            dueAt,
            priority: action.priority,
            /**
             * Authorship. 'agent' says an agent proposed this rather than a
             * protocol or a clinician; recommendationId leads back to which
             * agent, which run, and which person approved it.
             */
            source: 'agent',
            /**
             * Groups the task with the thing it is about. A referral problem
             * points at the referral; a patient-level gap points at the
             * encounter that prompted it, so the worklist entry still leads
             * somewhere useful.
             */
            sourceRef: rec.referralId
                ? { model: 'Referral', id: rec.referralId._id || rec.referralId }
                : rec.encounterId
                    ? { model: 'HealthRecord', id: rec.encounterId._id || rec.encounterId }
                    : undefined,
            recommendationId: rec._id,
            dedupeKey: `recommendation:${rec._id}`
        });

        rec.status = 'executed';
        rec.createdTaskId = task._id;
        await rec.save();

        return { recommendation: await getRecommendation(rec._id, ctx), task };
    } catch (e) {
        // Approved but not executed is a state worth being able to see.
        rec.status = 'failed';
        rec.error = e.message;
        await rec.save();
        throw e;
    }
}

/** A person disagrees. Nothing is created; the decision is recorded. */
export async function rejectRecommendation(id, input = {}, ctx) {
    const reviewer = await resolveReviewer(ctx);
    const rec = await getRecommendation(id, ctx);

    if (rec.status !== 'pending') {
        throw conflict(`This recommendation is already ${rec.status}`);
    }

    rec.status = 'rejected';
    rec.reviewedBy = reviewer._id;
    rec.reviewedAt = new Date();
    rec.reviewNote = input.note ? String(input.note).trim() : '';
    await rec.save();

    return getRecommendation(rec._id, ctx);
}
