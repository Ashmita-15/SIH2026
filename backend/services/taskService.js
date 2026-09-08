import Task from '../models/Task.js';
import User from '../models/User.js';
import HealthRecord from '../models/HealthRecord.js';
import { badRequest, forbidden, notFound } from './errors.js';

/**
 * Work items, and who they belong to.
 *
 * Everything here is deterministic application logic. The hooks at the bottom
 * are called from the referral and care-plan services when something happens
 * that somebody has to act on; nothing decides anything, it only writes down
 * what already follows from the rules. The follow-up agent will later call
 * these same functions rather than replacing them.
 */

const POPULATE = [
    { path: 'patientId', select: 'name age village phone' },
    { path: 'assignedTo', select: 'name workerType role' },
    { path: 'facilityId', select: 'name level' }
];

/**
 * The health worker whose catchment covers this patient.
 *
 * This is how a referral that nobody attended becomes a job for the one person
 * who can knock on the door and ask why. Returns null when nobody covers the
 * village, in which case the task falls to the facility instead of vanishing.
 */
export async function findCatchmentWorker(patient) {
    if (!patient?.village) return null;
    const village = String(patient.village).trim();
    return User.findOne({
        role: 'health_worker',
        catchmentVillages: { $elemMatch: { $regex: `^${village.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } }
    }).select('_id name hospitalId');
}

/**
 * Creates a task unless an identical one is already open.
 *
 * Called from event-shaped hooks that can fire more than once — a referral can
 * be marked missed twice — and a worklist that shows the same job four times
 * is a worklist people stop reading.
 */
export async function createTask(input) {
    const { patientId, type, title, dueAt } = input;
    if (!patientId || !type || !title || !dueAt) {
        throw badRequest('patientId, type, title and dueAt are required');
    }

    /**
     * Only deduplicated when the caller names the job. Without a key every
     * task is distinct, which is what a care plan needs — its four visits
     * share a plan but are four separate pieces of work.
     */
    if (input.dedupeKey) {
        const existing = await Task.findOne({
            dedupeKey: input.dedupeKey,
            status: { $in: ['open', 'in_progress'] }
        });
        if (existing) return existing;
    }

    return Task.create({
        patientId,
        assignedTo: input.assignedTo || undefined,
        assignedRole: input.assignedRole || undefined,
        facilityId: input.facilityId || undefined,
        type,
        title,
        description: input.description || '',
        dueAt,
        priority: input.priority || 'medium',
        source: input.source || 'system',
        sourceRef: input.sourceRef || undefined,
        dedupeKey: input.dedupeKey || undefined,
        // Set only when an approved agent recommendation produced this task.
        recommendationId: input.recommendationId || undefined
    });
}

/** Resolves who is asking, without assuming a role. */
async function resolveActor(ctx) {
    if (!ctx?.actorId) throw forbidden('No acting user supplied');
    const user = await User.findById(ctx.actorId).select('role hospitalId name');
    if (!user) throw forbidden('Acting user not found');
    return user;
}

/**
 * Everything the actor is responsible for: tasks addressed to them by name,
 * plus tasks addressed to their role at their facility.
 */
function scopeFor(actor) {
    const clauses = [{ assignedTo: actor._id }];
    if (actor.hospitalId) {
        clauses.push({ assignedRole: actor.role, facilityId: actor.hospitalId });
    }
    return { $or: clauses };
}

const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };

/**
 * The worklist.
 *
 * Ordered by three things a person can explain to themselves: how urgent it
 * is, whether it is already late, and when it was due. Nothing clever —
 * a worker needs to trust why the top item is at the top.
 */
export async function listTasks(filters = {}, ctx) {
    const actor = await resolveActor(ctx);

    const query = scopeFor(actor);
    query.status = filters.status
        ? { $in: String(filters.status).split(',').map(s => s.trim()) }
        : { $in: ['open', 'in_progress'] };

    if (filters.patientId) query.patientId = filters.patientId;
    if (filters.type) query.type = filters.type;

    const tasks = await Task.find(query)
        .populate(POPULATE)
        .limit(Math.min(Number(filters.limit) || 100, 200));

    const now = Date.now();
    return tasks.sort((a, b) => {
        const rank = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
        if (rank !== 0) return rank;
        const lateA = a.dueAt.getTime() < now ? 0 : 1;
        const lateB = b.dueAt.getTime() < now ? 0 : 1;
        if (lateA !== lateB) return lateA - lateB;
        return a.dueAt - b.dueAt;
    });
}

/**
 * Grouped the way the worklist is read: what is late or urgent, what is
 * coming, and what can wait.
 */
export async function getWorklist(ctx) {
    const tasks = await listTasks({}, ctx);
    const now = Date.now();
    const soon = now + 7 * 24 * 3600 * 1000;

    const overdue = (t) => t.dueAt.getTime() < now;

    return {
        high: tasks.filter(t => t.priority === 'high' || overdue(t)),
        upcoming: tasks.filter(t => t.priority !== 'high' && !overdue(t) && t.dueAt.getTime() <= soon),
        routine: tasks.filter(t => t.priority !== 'high' && !overdue(t) && t.dueAt.getTime() > soon),
        counts: {
            total: tasks.length,
            overdue: tasks.filter(overdue).length
        }
    };
}

export async function getTask(id, ctx) {
    const actor = await resolveActor(ctx);
    const task = await Task.findById(id).populate(POPULATE);
    if (!task) throw notFound('Task not found');

    const mine = String(task.assignedTo?._id || task.assignedTo) === String(actor._id);
    const myFacility = task.assignedRole === actor.role &&
        String(task.facilityId?._id || task.facilityId) === String(actor.hospitalId);
    // Same 404 for "not yours" as for "does not exist".
    if (!mine && !myFacility) throw notFound('Task not found');

    return task;
}

/** Closing a task is a claim that the work happened, so it is attributable. */
export async function completeTask(id, input = {}, ctx) {
    const actor = await resolveActor(ctx);
    const task = await getTask(id, ctx);

    if (task.status === 'done') throw badRequest('That task is already done');
    if (task.status === 'cancelled') throw badRequest('That task was cancelled');

    if (input.completedEncounterId) {
        const encounter = await HealthRecord.findById(input.completedEncounterId).select('patientId');
        if (!encounter) throw notFound('Encounter not found');
        if (String(encounter.patientId) !== String(task.patientId._id || task.patientId)) {
            throw badRequest('That visit is for a different patient');
        }
        task.completedEncounterId = input.completedEncounterId;
    }

    task.status = 'done';
    task.completionNote = input.note ? String(input.note).trim() : '';
    task.completedAt = new Date();
    task.completedBy = actor._id;
    await task.save();

    return Task.findById(task._id).populate(POPULATE);
}

/* ─────────────────── Hooks: things that create work ─────────────────── */

const days = (n) => new Date(Date.now() + n * 24 * 3600 * 1000);

/** A referral has been sent, so the destination has something to answer. */
export async function onReferralCreated(referral, destinationFacilityId) {
    return createTask({
        patientId: referral.patientId?._id || referral.patientId,
        assignedRole: 'hospital',
        facilityId: destinationFacilityId,
        type: 'referral_acknowledge',
        title: `Acknowledge referral ${referral.referralId}`,
        description: referral.reason,
        // The referral already carries the deadline; the task inherits it
        // rather than inventing a second one that could disagree.
        dueAt: referral.dueBy,
        priority: referral.priority === 'emergency' || referral.priority === 'urgent_24h' ? 'high' : 'medium',
        source: 'system',
        sourceRef: { model: 'Referral', id: referral._id },
        dedupeKey: `referral:${referral._id}:acknowledge`
    });
}

/**
 * Nobody attended. This is the moment the system stops being a filing cabinet:
 * the job goes to the health worker who knows the household, and it says what
 * to find out rather than only that something went wrong.
 */
export async function onReferralMissed(referral, patient) {
    const worker = await findCatchmentWorker(patient);
    return createTask({
        patientId: patient._id,
        assignedTo: worker?._id,
        assignedRole: worker ? 'health_worker' : 'hospital',
        facilityId: worker?.hospitalId || referral.fromFacilityId,
        type: 'referral_chase',
        title: `${patient.name} did not attend referral ${referral.referralId}`,
        description: referral.missedReason
            ? `Recorded reason: ${referral.missedReason.replace(/_/g, ' ')}. Visit the household and confirm what happened.`
            : 'Visit the household and find out why, then update the referral.',
        dueAt: days(2),
        priority: 'high',
        source: 'system',
        sourceRef: { model: 'Referral', id: referral._id },
        dedupeKey: `referral:${referral._id}:chase`
    });
}

/**
 * The loop closed. The specialist's follow-up instruction becomes somebody's
 * job instead of a paragraph nobody reads again.
 */
export async function onReferralCompleted(referral, patient) {
    const instructions = referral.counterReferral?.followUpInstructions;
    if (!instructions) return null;

    const worker = await findCatchmentWorker(patient);
    return createTask({
        patientId: patient._id,
        assignedTo: worker?._id,
        assignedRole: worker ? 'health_worker' : 'hospital',
        facilityId: worker?.hospitalId || referral.fromFacilityId,
        type: 'follow_up_visit',
        title: `Follow up ${patient.name} after hospital visit`,
        description: instructions,
        dueAt: days(7),
        priority: 'high',
        source: 'clinician',
        sourceRef: { model: 'Referral', id: referral._id },
        dedupeKey: `referral:${referral._id}:followup`
    });
}
