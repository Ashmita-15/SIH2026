import Referral, {
    PRIORITY_SLA_HOURS,
    REFERRAL_PRIORITIES,
    MISSED_REASONS,
    TRANSPORT_NEEDS
} from '../models/Referral.js';
import Hospital from '../models/Hospital.js';
import HealthRecord from '../models/HealthRecord.js';
import User from '../models/User.js';
import * as tasks from './taskService.js';
import { badRequest, forbidden, notFound, conflict } from './errors.js';

/**
 * Referral business logic.
 *
 * Everything here takes a context rather than an Express request, because the
 * coordination agent in a later step has to be able to call these same
 * functions with no HTTP involved. A context is { actorId, io }: who is acting,
 * and optionally a socket server to announce the result on. Nothing in this
 * file reads req, res or a token.
 */

// ─── State machine ───────────────────────────────────────────────────────────

/**
 * Which statuses may follow which. Declared as data so that adding the
 * automatic lapse sweep later is a table entry rather than another branch.
 *
 * The shape to notice: scheduled → missed → scheduled is a loop, because a
 * patient who did not come once is usually rebooked rather than abandoned,
 * and lapsed is the deliberate decision to stop trying.
 */
const ALLOWED_NEXT = {
    created: ['acknowledged', 'declined', 'redirected', 'lapsed'],
    acknowledged: ['scheduled', 'declined', 'redirected', 'lapsed'],
    scheduled: ['attended', 'missed'],
    attended: ['completed'],
    missed: ['scheduled', 'lapsed'],
    // Terminal.
    completed: [],
    declined: [],
    redirected: [],
    lapsed: []
};

/**
 * Who may make each move, and what they must supply to make it.
 *
 * `side` is the facility side of the referral, not a role: the destination
 * decides whether it can take the patient, so only the destination may
 * acknowledge, schedule or complete. Missing and lapsing are 'both' because
 * the referring side often finds out first — usually from the health worker
 * who knows the family.
 */
const TRANSITION_RULES = {
    acknowledged: {
        side: 'destination',
        apply: (referral) => { referral.acknowledgedAt = new Date(); }
    },
    scheduled: {
        side: 'destination',
        requires: ['scheduledFor'],
        apply: (referral, payload) => { referral.scheduledFor = payload.scheduledFor; }
    },
    attended: {
        side: 'destination',
        apply: (referral) => { referral.attendedAt = new Date(); }
    },
    completed: {
        side: 'destination',
        requiresCounterReferral: true,
        apply: (referral, payload, actor) => {
            referral.counterReferral = { ...payload.counterReferral, issuedBy: actor.id, issuedAt: new Date() };
            referral.completedAt = new Date();
        }
    },
    missed: {
        side: 'both',
        requires: ['missedReason'],
        apply: (referral, payload) => { referral.missedReason = payload.missedReason; }
    },
    // A decline or a redirect that does not say why is not actionable by the
    // facility that has to find somewhere else for this patient to go.
    declined: { side: 'destination', requiresNote: true },
    redirected: { side: 'destination', requiresNote: true },
    lapsed: { side: 'both', requiresNote: true }
};

/** Roles that may move a referral at all. Patients read, they do not act. */
const ACTING_ROLES = ['doctor', 'health_worker', 'hospital'];

// ─── Context ─────────────────────────────────────────────────────────────────

/**
 * Resolves who is acting.
 *
 * The JWT only carries { id, role, name }, so facility membership is not in the
 * token and has to be read. Doing it here — rather than in a controller — is
 * what lets an agent pass nothing but an actorId later.
 */
async function resolveActor(ctx) {
    if (!ctx?.actorId) throw forbidden('No acting user supplied');
    const user = await User.findById(ctx.actorId).select('role hospitalId name');
    if (!user) throw forbidden('Acting user not found');
    return {
        id: String(user._id),
        role: user.role,
        name: user.name,
        facilityId: user.hospitalId ? String(user.hospitalId) : null
    };
}

/** Which end of this referral the actor stands at, if either. */
function sideOf(actor, referral) {
    if (!actor.facilityId) return null;
    if (actor.facilityId === String(referral.fromFacilityId?._id || referral.fromFacilityId)) return 'origin';
    if (actor.facilityId === String(referral.toFacilityId?._id || referral.toFacilityId)) return 'destination';
    return null;
}

function canView(actor, referral) {
    const patientId = String(referral.patientId?._id || referral.patientId);
    if (actor.role === 'patient') return actor.id === patientId;
    if (actor.id === String(referral.createdBy?._id || referral.createdBy)) return true;
    return sideOf(actor, referral) !== null;
}

/** Fire-and-forget. io is absent when an agent or a test calls the service. */
function announce(io, event, rooms, payload) {
    if (!io) return;
    for (const room of rooms.filter(Boolean)) io.to(room).emit(event, payload);
}

// ─── Creation ────────────────────────────────────────────────────────────────

/** Deterministic. The priority decides the deadline; nothing else does. */
export function calculateDueBy(priority, from = new Date()) {
    const hours = PRIORITY_SLA_HOURS[priority];
    if (!hours) throw badRequest(`Unknown priority. Expected one of: ${REFERRAL_PRIORITIES.join(', ')}`);
    return new Date(from.getTime() + hours * 60 * 60 * 1000);
}

export async function createReferral(input, ctx) {
    const actor = await resolveActor(ctx);

    if (!ACTING_ROLES.includes(actor.role)) {
        throw forbidden('Only a doctor, health worker or facility can create a referral');
    }
    if (!actor.facilityId) {
        throw badRequest('Your account is not attached to a facility, so it cannot refer from one');
    }

    const { patientId, toFacilityId, priority, reason } = input;
    if (!patientId) throw badRequest('patientId is required');
    if (!toFacilityId) throw badRequest('toFacilityId is required');
    if (!priority) throw badRequest('priority is required');
    if (!reason || !String(reason).trim()) throw badRequest('reason is required');
    if (!REFERRAL_PRIORITIES.includes(priority)) {
        throw badRequest(`Unknown priority. Expected one of: ${REFERRAL_PRIORITIES.join(', ')}`);
    }

    /**
     * The origin is taken from the actor, never from the request body. A
     * referral that claims to come from a facility the sender does not work at
     * is forgery, and deriving it removes the possibility rather than checking
     * for it.
     */
    const fromFacilityId = actor.facilityId;
    if (input.fromFacilityId && String(input.fromFacilityId) !== fromFacilityId) {
        throw forbidden('You can only refer from your own facility');
    }
    if (String(toFacilityId) === fromFacilityId) {
        throw badRequest('A referral must go to a different facility');
    }

    const patient = await User.findById(patientId).select('role');
    if (!patient) throw notFound('Patient not found');
    if (patient.role !== 'patient') throw badRequest('That user is not a patient');

    const destination = await Hospital.findById(toFacilityId).select('name isActive ownerId level');
    if (!destination) throw notFound('Destination facility not found');
    if (!destination.isActive) throw badRequest('That destination facility is not active');

    // An encounter, if given, must belong to this patient — otherwise the
    // referral would carry someone else's clinical history to another facility.
    if (input.encounterId) {
        const encounter = await HealthRecord.findById(input.encounterId).select('patientId');
        if (!encounter) throw notFound('Encounter not found');
        if (String(encounter.patientId) !== String(patientId)) {
            throw badRequest('That encounter belongs to a different patient');
        }
    }

    if (input.transportNeed && !TRANSPORT_NEEDS.includes(input.transportNeed)) {
        throw badRequest(`Unknown transportNeed. Expected one of: ${TRANSPORT_NEEDS.join(', ')}`);
    }

    let requiredTests = [];
    if (input.requiredTests !== undefined) {
        if (!Array.isArray(input.requiredTests)) throw badRequest('requiredTests must be an array');
        requiredTests = input.requiredTests.map(t => String(t).trim()).filter(Boolean);
    }

    const referral = await Referral.create({
        patientId,
        fromFacilityId,
        toFacilityId,
        createdBy: actor.id,
        encounterId: input.encounterId || undefined,
        priority,
        reason: String(reason).trim(),
        clinicalSummary: input.clinicalSummary ? String(input.clinicalSummary).trim() : '',
        requiredTests,
        transportNeed: input.transportNeed || 'own',
        status: 'created',
        dueBy: calculateDueBy(priority)
    });

    /**
     * A referral nobody has to act on is a filed document. The destination
     * gets a task with the referral's own deadline, so an unanswered hand-off
     * shows up as late work rather than staying invisible until someone looks.
     */
    await tasks.onReferralCreated(referral, toFacilityId);

    announce(ctx?.io, 'referral:created',
        [`user_${destination.ownerId}`, `user_${patientId}`],
        { referralId: referral._id, code: referral.referralId, priority, dueBy: referral.dueBy });

    return getReferralById(referral._id, ctx);
}

// ─── Reads ───────────────────────────────────────────────────────────────────

const POPULATE = [
    { path: 'patientId', select: 'name age village phone' },
    { path: 'fromFacilityId', select: 'name level phone address' },
    { path: 'toFacilityId', select: 'name level phone address' },
    { path: 'createdBy', select: 'name role workerType specialization' }
];

export async function getReferralById(id, ctx) {
    const actor = await resolveActor(ctx);
    const referral = await Referral.findById(id).populate(POPULATE);
    if (!referral) throw notFound('Referral not found');
    // Same message for "does not exist" and "not yours", so an id cannot be
    // probed for existence.
    if (!canView(actor, referral)) throw notFound('Referral not found');
    return referral;
}

/**
 * Referrals the actor is entitled to see, narrowed by the supplied filters.
 *
 * The scope is applied first and the filters second, so a filter can only ever
 * narrow what someone may already see, never widen it.
 */
export async function listReferrals(filters = {}, ctx) {
    const actor = await resolveActor(ctx);
    const query = {};

    if (actor.role === 'patient') {
        query.patientId = actor.id;
    } else {
        if (!actor.facilityId) throw forbidden('Your account is not attached to a facility');
        query.$or = [{ fromFacilityId: actor.facilityId }, { toFacilityId: actor.facilityId }];
    }

    if (filters.patientId) query.patientId = filters.patientId;
    if (filters.fromFacilityId) query.fromFacilityId = filters.fromFacilityId;
    if (filters.toFacilityId) query.toFacilityId = filters.toFacilityId;

    if (filters.status) {
        const wanted = String(filters.status).split(',').map(s => s.trim()).filter(Boolean);
        const unknown = wanted.filter(s => !ALLOWED_NEXT[s]);
        if (unknown.length) throw badRequest(`Unknown status: ${unknown.join(', ')}`);
        query.status = { $in: wanted };
    }

    if (filters.priority) {
        if (!REFERRAL_PRIORITIES.includes(filters.priority)) {
            throw badRequest(`Unknown priority. Expected one of: ${REFERRAL_PRIORITIES.join(', ')}`);
        }
        query.priority = filters.priority;
    }

    // Past its deadline and not yet finished. This is the query the Step 3
    // agent will run; exposing it now keeps that from being written twice.
    if (String(filters.overdue) === 'true') {
        query.dueBy = { $lt: new Date() };
        query.status = query.status || { $in: ['created', 'acknowledged', 'scheduled', 'missed'] };
    }

    return Referral.find(query)
        .populate(POPULATE)
        .sort({ createdAt: -1 })
        .limit(Math.min(Number(filters.limit) || 50, 200));
}

// ─── Transitions ─────────────────────────────────────────────────────────────

/**
 * Moves a referral to a new status, or refuses.
 *
 * One path for every transition including completion, so authorization and
 * history recording cannot drift between them.
 */
export async function transitionReferral(id, toStatus, payload = {}, ctx) {
    const actor = await resolveActor(ctx);
    const referral = await Referral.findById(id).populate(POPULATE);
    if (!referral) throw notFound('Referral not found');
    if (!canView(actor, referral)) throw notFound('Referral not found');

    if (!ACTING_ROLES.includes(actor.role)) {
        throw forbidden('Your role cannot change a referral');
    }

    const rule = TRANSITION_RULES[toStatus];
    if (!rule) throw badRequest(`Unknown status: ${toStatus}`);

    const allowed = ALLOWED_NEXT[referral.status] || [];
    if (!allowed.includes(toStatus)) {
        throw conflict(
            allowed.length
                ? `A referral that is ${referral.status} cannot become ${toStatus}. Allowed: ${allowed.join(', ')}`
                : `This referral is ${referral.status} and can no longer be changed`
        );
    }

    const side = sideOf(actor, referral);
    if (rule.side !== 'both' && side !== rule.side) {
        throw forbidden(`Only the ${rule.side} facility can mark a referral ${toStatus}`);
    }

    const note = payload.note ? String(payload.note).trim() : '';
    if (rule.requiresNote && !note) throw badRequest(`A note explaining why is required to mark this ${toStatus}`);

    for (const field of rule.requires || []) {
        if (payload[field] === undefined || payload[field] === null || payload[field] === '') {
            throw badRequest(`${field} is required to mark this referral ${toStatus}`);
        }
    }

    if (toStatus === 'scheduled') {
        const when = new Date(payload.scheduledFor);
        if (Number.isNaN(when.getTime())) throw badRequest('scheduledFor must be a valid date');
        if (when.getTime() < Date.now() - 5 * 60 * 1000) throw badRequest('scheduledFor cannot be in the past');
        payload = { ...payload, scheduledFor: when };
    }

    if (toStatus === 'missed' && !MISSED_REASONS.includes(payload.missedReason)) {
        throw badRequest(`Unknown missedReason. Expected one of: ${MISSED_REASONS.join(', ')}`);
    }

    if (rule.requiresCounterReferral) {
        const cr = payload.counterReferral;
        if (!cr || typeof cr !== 'object') {
            throw badRequest('A counter-referral is required to complete a referral');
        }
        if (!cr.summary || !String(cr.summary).trim()) {
            throw badRequest('counterReferral.summary is required — the referring facility has to be told what happened');
        }
        payload = {
            ...payload,
            counterReferral: {
                summary: String(cr.summary).trim(),
                medications: cr.medications ? String(cr.medications).trim() : '',
                followUpInstructions: cr.followUpInstructions ? String(cr.followUpInstructions).trim() : ''
            }
        };
    }

    rule.apply?.(referral, payload, actor);
    referral.status = toStatus;
    referral.statusHistory.push({ status: toStatus, timestamp: new Date(), by: actor.id, note });
    await referral.save();

    /**
     * Two moves create work for somebody else, so they create it here rather
     * than relying on a person noticing.
     *
     * A missed referral becomes a job for the health worker who knows the
     * household — the one useful thing anyone can do about it. A completed one
     * turns the specialist's follow-up instruction into a dated task instead of
     * a paragraph that gets read once.
     */
    if (toStatus === 'missed' || toStatus === 'completed') {
        const patient = await User.findById(referral.patientId?._id || referral.patientId)
            .select('name village');
        if (patient) {
            if (toStatus === 'missed') await tasks.onReferralMissed(referral, patient);
            else await tasks.onReferralCompleted(referral, patient);
        }
    }

    const [origin, destination] = await Promise.all([
        Hospital.findById(referral.fromFacilityId).select('ownerId'),
        Hospital.findById(referral.toFacilityId).select('ownerId')
    ]);

    announce(ctx?.io, 'referral:updated',
        [`user_${origin?.ownerId}`, `user_${destination?.ownerId}`, `user_${referral.patientId?._id || referral.patientId}`],
        { referralId: referral._id, code: referral.referralId, status: toStatus, by: actor.name });

    return referral;
}

/**
 * Completing a referral is exactly a transition to `completed`, so it routes
 * through the same function rather than repeating its checks. It exists as its
 * own entry point because closing the loop is the meaningful action, and the
 * caller should not have to know it is spelled as a status change.
 */
export function completeReferral(id, counterReferral, ctx, note = '') {
    return transitionReferral(id, 'completed', { counterReferral, note }, ctx);
}

/** Exposed so a controller or an agent can show what is possible next. */
export function allowedTransitions(status) {
    return ALLOWED_NEXT[status] || [];
}
