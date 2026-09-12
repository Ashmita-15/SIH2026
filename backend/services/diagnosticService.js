import DiagnosticRequest, { ALLOWED_NEXT, DIAGNOSTIC_PRIORITIES } from '../models/DiagnosticRequest.js';
import HealthRecord from '../models/HealthRecord.js';
import User from '../models/User.js';
import { mayAccessTimeline } from './timelineService.js';
import Hospital from '../models/Hospital.js';
import { notifyDiagnosticCompleted } from './notifications/notificationService.js';

/**
 * Ordering a test, and following it until somebody has the result.
 *
 * Authorisation reuses what already decides who may read a patient at all:
 * `mayAccessTimeline` answers "is this clinician allowed near this person",
 * and this file does not invent a second, subtly different answer to the same
 * question.
 */

class ServiceError extends Error {
    constructor(status, message) { super(message); this.status = status; }
}
const badRequest = (m) => new ServiceError(400, m);
const forbidden = (m) => new ServiceError(403, m);
const notFound = (m) => new ServiceError(404, m);

/** Only these two order tests. A patient cannot order their own. */
const ORDERING_ROLES = ['doctor', 'health_worker'];

async function resolveActor(ctx) {
    if (!ctx?.actorId) throw forbidden('No acting user supplied');
    const user = await User.findById(ctx.actorId).select('role hospitalId catchmentVillages name');
    if (!user) throw forbidden('Acting user not found');
    return user;
}

/**
 * Which requests this actor may touch.
 *
 * A patient sees their own and nothing else. Staff see what their facility
 * ordered, plus anything they ordered themselves — a health worker with no
 * facility yet can still follow up the tests they raised.
 */
function scopeFor(actor) {
    if (actor.role === 'patient') return { patientId: actor._id };
    const or = [{ requestedBy: actor._id }];
    if (actor.hospitalId) or.push({ facilityId: actor.hospitalId });
    return { $or: or };
}

export async function createRequest(input, ctx) {
    const actor = await resolveActor(ctx);
    if (!ORDERING_ROLES.includes(actor.role)) {
        throw forbidden('Only a doctor or health worker can order a test');
    }

    const testName = String(input?.testName || '').trim();
    if (!testName) throw badRequest('testName is required');
    if (!input?.patientId) throw badRequest('patientId is required');

    const priority = input.priority || 'routine';
    if (!DIAGNOSTIC_PRIORITIES.includes(priority)) throw badRequest('Unknown priority');

    const patient = await User.findOne({ _id: input.patientId, role: 'patient' }).select('name village');
    // Same answer for "no such patient" and "not yours", so this cannot be
    // used to discover which patients exist.
    if (!patient) throw notFound('Patient not found');
    if (!await mayAccessTimeline(actor, patient)) throw notFound('Patient not found');

    return DiagnosticRequest.create({
        patientId: patient._id,
        testName: testName.slice(0, 120),
        reason: String(input.reason || '').trim().slice(0, 500),
        priority,
        // Derived from the account. A facilityId in the body reaches nothing.
        requestedBy: actor._id,
        requestedByRole: actor.role,
        facilityId: actor.hospitalId || undefined
    });
}

export async function listRequests(filters = {}, ctx) {
    const actor = await resolveActor(ctx);
    const query = scopeFor(actor);

    if (filters.status) {
        const wanted = String(filters.status).split(',').map(s => s.trim()).filter(Boolean);
        if (wanted.some(s => !(s in ALLOWED_NEXT))) throw badRequest('Unknown status');
        query.status = { $in: wanted };
    }
    // A staff member may narrow to one patient, but only inside their scope.
    if (filters.patientId && actor.role !== 'patient') query.patientId = filters.patientId;

    return DiagnosticRequest.find(query)
        .populate('patientId', 'name age village')
        .populate('requestedBy', 'name role workerType specialization')
        .populate('facilityId', 'name level')
        .sort({ createdAt: -1 })
        .limit(Number(filters.limit) || 100)
        .lean();
}

export async function getRequest(id, ctx) {
    const actor = await resolveActor(ctx);
    const doc = await DiagnosticRequest.findOne({ _id: id, ...scopeFor(actor) })
        .populate('patientId', 'name age village')
        .populate('requestedBy', 'name role workerType specialization')
        .populate('facilityId', 'name level')
        .lean();
    // 404 rather than 403: an id outside your scope must not be confirmable.
    if (!doc) throw notFound('Diagnostic request not found');
    return doc;
}

/**
 * Move one request along.
 *
 * The transition table decides what is legal; a patient never reaches here,
 * and the scope query means staff can only move what is theirs to move.
 *
 * Completing writes the result into the patient's health record, so the
 * timeline picks it up from the same collection every other clinical event
 * already lives in — no second source of truth, no bespoke timeline branch.
 */
export async function updateStatus(id, input, ctx) {
    const actor = await resolveActor(ctx);
    if (actor.role === 'patient') throw forbidden('A patient cannot change a test status');

    const doc = await DiagnosticRequest.findOne({ _id: id, ...scopeFor(actor) });
    if (!doc) throw notFound('Diagnostic request not found');

    const next = String(input?.status || '');
    const allowed = ALLOWED_NEXT[doc.status] || [];
    if (!allowed.includes(next)) {
        throw badRequest(`Cannot move from ${doc.status} to ${next || '(nothing)'}`);
    }

    if (next === 'completed') {
        const summary = String(input?.resultSummary || '').trim();
        if (!summary) throw badRequest('A result summary is required to complete a test');
        doc.resultSummary = summary.slice(0, 1000);
        doc.resultNotes = String(input?.resultNotes || '').trim().slice(0, 2000);
        doc.reportUrl = String(input?.reportUrl || '').trim().slice(0, 500);
        doc.completedBy = actor._id;
        doc.completedAt = new Date();
    }

    doc.status = next;
    doc.statusHistory.push({
        status: next, at: new Date(), by: actor._id,
        note: String(input?.note || '').trim().slice(0, 300)
    });
    await doc.save();

    if (next === 'completed') {
        await writeResultToRecord(doc, actor);
        // Fire-and-forget: a dead mail server must not fail the status change
        // or leave the result unrecorded.
        notifyResult(doc).catch(() => {});
    }

    return doc;
}

/**
 * The result, as a normal health record.
 *
 * `type: 'lab_result'` rather than a new collection: the timeline already
 * reads HealthRecord, so a completed test appears in the patient's history
 * without the aggregation knowing diagnostics exist.
 */
async function writeResultToRecord(doc, actor) {
    const existing = await HealthRecord.findOne({ diagnosticRequestId: doc._id }).select('_id');
    if (existing) return existing; // completion is terminal, but stay idempotent

    return HealthRecord.create({
        patientId: doc.patientId,
        type: 'lab_result',
        occurredAt: doc.completedAt || new Date(),
        authorId: actor._id,
        authorRole: actor.role,
        facilityId: doc.facilityId || actor.hospitalId || undefined,
        diagnosticRequestId: doc._id,
        notes: [doc.testName, doc.resultSummary, doc.resultNotes].filter(Boolean).join(' — ').slice(0, 2000)
    });
}

/** The patient learns their result is ready. Best effort, never blocking. */
async function notifyResult(doc) {
    const [patient, facility] = await Promise.all([
        User.findById(doc.patientId).select('name email').lean(),
        doc.facilityId ? Hospital.findById(doc.facilityId).select('name').lean() : null
    ]);
    return notifyDiagnosticCompleted({
        patient,
        testName: doc.testName,
        resultSummary: doc.resultSummary,
        facilityName: facility?.name || null
    });
}

export { ServiceError };
