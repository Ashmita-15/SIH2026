import CarePlan, { CARE_PLAN_TYPES, PLAN_SCHEDULES } from '../models/CarePlan.js';
import HealthRecord from '../models/HealthRecord.js';
import Task from '../models/Task.js';
import { createTask, findCatchmentWorker } from './taskService.js';
import { badRequest, conflict, notFound } from './errors.js';

/**
 * Care plans: what ongoing follow-up a patient needs, and when.
 *
 * Two deliberate limits. The schedules are coordination timetables rather than
 * clinical guidelines — enough to put a date on a worklist, not a protocol
 * engine. And risk is decided by rules over readings that were actually taken,
 * never by a model: "high risk because two blood pressures were over 140" is
 * something a nurse can check and disagree with, which is the only kind of
 * risk flag worth having.
 */

/**
 * Danger signs that make a plan of this type high risk.
 *
 * The codes come from the deterministic engine in dangerSigns.js, so a flag
 * here can always be traced back to a specific measurement on a specific visit.
 */
const RISK_RULES = {
    anc: {
        signs: ['raised_blood_pressure', 'severe_hypertension', 'severe_anaemia'],
        extra: (patient) => {
            const flags = [];
            if (patient.age && patient.age < 18) flags.push('age_under_18');
            if (patient.age && patient.age > 35) flags.push('age_over_35');
            return flags;
        }
    },
    pnc: { signs: ['severe_hypertension', 'severe_anaemia', 'high_fever'] },
    child_0_5: { signs: ['high_fever', 'severe_hypoxia', 'low_oxygen', 'hypothermia'] },
    hypertension: { signs: ['severe_hypertension', 'raised_blood_pressure'] },
    diabetes: { signs: ['hypoglycaemia', 'very_high_glucose'] }
};

/**
 * Decides risk from what has been recorded, and says why.
 *
 * Recomputed rather than remembered, so a plan cannot stay flagged high on the
 * strength of a reading that was corrected, or stay normal after a bad visit.
 */
export async function assessRisk(type, patient, lookbackDays = 180) {
    const rule = RISK_RULES[type] || { signs: [] };
    const since = new Date(Date.now() - lookbackDays * 24 * 3600 * 1000);

    const encounters = await HealthRecord.find({
        patientId: patient._id,
        occurredAt: { $gte: since },
        dangerSigns: { $exists: true, $ne: [] }
    }).select('dangerSigns occurredAt');

    const seen = new Set();
    for (const e of encounters) {
        for (const sign of e.dangerSigns) {
            if (rule.signs.includes(sign)) seen.add(sign);
        }
    }

    const flags = [...seen, ...(rule.extra ? rule.extra(patient) : [])];
    return { riskLevel: flags.length ? 'high' : 'normal', riskFlags: flags };
}

/**
 * Opens a plan and lays its follow-ups onto the worklist straight away.
 *
 * The tasks are written now rather than computed on demand, so a visit that is
 * due next month exists as a job whether or not anyone opens the app between
 * now and then — which is the difference between a plan and a reminder.
 */
export async function createCarePlan(input, ctx, patient) {
    const { type } = input;
    if (!CARE_PLAN_TYPES.includes(type)) {
        throw badRequest(`Unknown care plan type. Expected one of: ${CARE_PLAN_TYPES.join(', ')}`);
    }

    const existing = await CarePlan.findOne({ patientId: patient._id, type, status: 'active' });
    if (existing) throw conflict(`This patient already has an active ${type} plan`);

    const startedAt = input.startedAt ? new Date(input.startedAt) : new Date();
    if (Number.isNaN(startedAt.getTime())) throw badRequest('startedAt must be a valid date');
    if (startedAt.getTime() > Date.now() + 5 * 60 * 1000) throw badRequest('startedAt cannot be in the future');

    const { riskLevel, riskFlags } = await assessRisk(type, patient);
    const worker = await findCatchmentWorker(patient);
    const schedule = PLAN_SCHEDULES[type];

    const plan = await CarePlan.create({
        patientId: patient._id,
        type,
        status: 'active',
        riskLevel,
        riskFlags,
        startedAt,
        expectedEndAt: new Date(startedAt.getTime() + schedule[schedule.length - 1].offsetDays * 24 * 3600 * 1000),
        assignedWorkerId: worker?._id,
        facilityId: worker?.hospitalId || ctx?.facilityId,
        createdBy: ctx?.actorId,
        notes: input.notes ? String(input.notes).trim() : ''
    });

    for (const step of schedule) {
        await createTask({
            patientId: patient._id,
            assignedTo: worker?._id,
            assignedRole: worker ? 'health_worker' : 'hospital',
            facilityId: worker?.hospitalId || ctx?.facilityId,
            type: 'follow_up_visit',
            title: step.label,
            description: `${type.toUpperCase()} care plan for ${patient.name}`,
            dueAt: new Date(startedAt.getTime() + step.offsetDays * 24 * 3600 * 1000),
            // A high-risk plan raises every one of its visits, because the
            // reason it is high risk does not go away between them.
            priority: riskLevel === 'high' ? 'high' : 'medium',
            source: 'protocol',
            sourceRef: { model: 'CarePlan', id: plan._id }
        });
    }

    return CarePlan.findById(plan._id)
        .populate('patientId', 'name age village')
        .populate('assignedWorkerId', 'name workerType');
}

export async function listCarePlansForPatient(patientId) {
    return CarePlan.find({ patientId })
        .populate('assignedWorkerId', 'name workerType')
        .sort({ createdAt: -1 });
}

/**
 * Re-runs the risk rules against the latest readings.
 *
 * Called after a visit is recorded: a blood pressure taken this morning should
 * change what tomorrow's worklist looks like, and raising the plan raises the
 * visits still outstanding with it.
 */
export async function refreshRisk(planId, patient) {
    const plan = await CarePlan.findById(planId);
    if (!plan) throw notFound('Care plan not found');

    const { riskLevel, riskFlags } = await assessRisk(plan.type, patient);
    const raised = riskLevel === 'high' && plan.riskLevel !== 'high';

    plan.riskLevel = riskLevel;
    plan.riskFlags = riskFlags;
    await plan.save();

    if (raised) {
        await Task.updateMany(
            { 'sourceRef.id': plan._id, status: { $in: ['open', 'in_progress'] } },
            { $set: { priority: 'high' } }
        );
    }

    return plan;
}

/** Every active plan for this patient gets its risk recomputed. */
export async function refreshRiskForPatient(patient) {
    const plans = await CarePlan.find({ patientId: patient._id, status: 'active' }).select('_id');
    for (const plan of plans) await refreshRisk(plan._id, patient);
    return plans.length;
}
