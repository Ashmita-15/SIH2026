import * as actions from './actions.js';

/**
 * Finds patients whose care appears to have stalled, and proposes who should
 * pick it up.
 *
 * The difference from the referral agent is where the signal comes from. That
 * one reads a single document and asks whether it moved. This one reads five —
 * encounters, tasks, care plans, referrals, appointments — and asks a question
 * none of them can answer alone: something concerning was written down, so did
 * anything happen next?
 *
 * It is not a risk engine and does not want to be. The danger signs it reasons
 * about were decided by the deterministic rules in dangerSigns.js at the moment
 * the visit was recorded, and this agent never re-evaluates a vital or invents
 * a threshold. It reasons about silence: a critical observation with nothing
 * after it, a scheduled visit nobody made, a plan marked high risk whose
 * patient has not been seen. Every sentence it produces is about the system's
 * behaviour, never about the patient's body.
 */

/**
 * Coordination windows — not medical thresholds.
 *
 * These say how long the system may reasonably stay silent before that silence
 * is itself worth flagging. They encode no clinical opinion and changing one
 * changes how noisy the agent is, never what counts as dangerous. That
 * judgement was made by the danger-sign rules and is not revisited here.
 */
export const WINDOWS = {
    /** How far back a critical danger sign is still "recent" enough to chase. */
    RECENT_CRITICAL_DAYS: 14,
    /** How long after a concerning visit before silence counts as a gap. */
    FOLLOWUP_GRACE_DAYS: 3,
    /** The span over which repeated warnings are treated as a pattern. */
    REPEATED_WARNING_DAYS: 90,
    /** How many warnings of the same kind make a pattern. */
    REPEATED_WARNING_COUNT: 3,
    /** How long a high-risk care plan may go without any contact. */
    NO_CONTACT_DAYS: 45,
    /** How overdue a protocol visit must be before it is a coordination gap. */
    PLAN_OVERDUE_GRACE_DAYS: 3
};

/**
 * The severities the danger-sign engine assigns. Mirrored as a lookup rather
 * than recomputed — this agent must never decide what is critical, only notice
 * that something already marked critical was not acted on.
 */
const CRITICAL_SIGNS = new Set([
    'severe_hypertension', 'severe_hypoxia', 'hypothermia', 'hypoglycaemia', 'severe_anaemia'
]);

const SIGN_LABELS = {
    severe_hypertension: 'very high blood pressure',
    raised_blood_pressure: 'raised blood pressure',
    severe_hypoxia: 'very low oxygen',
    low_oxygen: 'low oxygen',
    high_fever: 'high fever',
    hypothermia: 'low body temperature',
    hypoglycaemia: 'very low blood sugar',
    very_high_glucose: 'very high blood sugar',
    severe_anaemia: 'severe anaemia',
    fast_pulse: 'fast pulse'
};

const days = (n) => n * 24 * 3600 * 1000;
const daysAgo = (date, now) => Math.round((now - new Date(date)) / 86400000);
const label = (code) => SIGN_LABELS[code] || String(code).replace(/_/g, ' ');
const OPEN_TASK = ['open', 'in_progress'];

/**
 * Task types that mean somebody is actually going to contact this patient.
 *
 * Deliberately excludes 'referral_acknowledge', which is administrative work
 * at a destination facility — a hospital clerk being asked to respond to a
 * referral is not follow-up for the patient, and counting it as such would let
 * a concerning reading sit unanswered because a different facility had an open
 * inbox item.
 */
const PATIENT_CONTACT_TASKS = ['follow_up_visit', 'referral_chase', 'vitals_check'];
const isPatientContact = (t) => PATIENT_CONTACT_TASKS.includes(t.type);

/**
 * Was anything done for this patient after a given moment?
 *
 * The definition of "something happened" is deliberately generous: a
 * consultation, a referral, or any open piece of coordination work. Being
 * generous is the safe direction — it makes the agent quieter, and a missed
 * nudge costs less than a queue nobody reads because it cries wolf.
 */
function activityAfter(snapshot, since) {
    const after = (d) => d && new Date(d).getTime() > new Date(since).getTime();

    const consultation = snapshot.appointments.find(a => after(a.createdAt));
    const referral = snapshot.referrals.find(r => after(r.createdAt));
    /**
     * Only work raised after the observation counts as a response to it. A
     * task that already existed beforehand was answering something else.
     */
    const task = snapshot.tasks.find(t => isPatientContact(t) && after(t.createdAt));
    const doctorRecord = snapshot.encounters.find(e => e.diagnosis && after(e.occurredAt));

    return {
        any: Boolean(consultation || referral || task || doctorRecord),
        consultation: Boolean(consultation),
        referral: Boolean(referral),
        task: Boolean(task),
        doctorRecord: Boolean(doctorRecord)
    };
}

/**
 * Is somebody already lined up to contact this patient?
 *
 * Used by the lower-priority patterns to stay quiet when work is already
 * queued. Counts only tasks that involve contacting the patient, and any open
 * proposal from any agent — so two agents cannot both ask for the same visit.
 */
const hasOpenCoordination = (snapshot) =>
    snapshot.tasks.some(t => isPatientContact(t) && OPEN_TASK.includes(t.status)) ||
    snapshot.recommendations.length > 0;

/* ─────────────────────── The four patterns ─────────────────────── */

/**
 * A. A critical danger sign was recorded and nothing followed.
 *
 * The highest-value pattern in the system: the deterministic engine already
 * decided this reading was critical, a worker was told to escalate, and the
 * record shows no consultation, no referral and no open task afterwards. That
 * is the exact failure the whole product exists to catch.
 */
function criticalSignNoFollowup(snapshot, now) {
    const cutoff = now - days(WINDOWS.RECENT_CRITICAL_DAYS);
    const grace = now - days(WINDOWS.FOLLOWUP_GRACE_DAYS);

    const encounter = snapshot.encounters.find(e =>
        new Date(e.occurredAt).getTime() >= cutoff &&
        new Date(e.occurredAt).getTime() <= grace &&
        (e.dangerSigns || []).some(s => CRITICAL_SIGNS.has(s))
    );
    if (!encounter) return null;

    const activity = activityAfter(snapshot, encounter.occurredAt);
    if (activity.any) return null;

    const signs = (encounter.dangerSigns || []).filter(s => CRITICAL_SIGNS.has(s)).map(label);

    return {
        problem: 'critical_sign_no_followup',
        concern: 'high',
        encounterId: encounter._id,
        signals: ['recent_critical_danger_sign', 'no_followup_activity'],
        reasoning: [
            `A visit ${daysAgo(encounter.occurredAt, now)} day(s) ago recorded a danger sign the system classes as critical (${signs.join(', ')}).`,
            'No consultation, referral or follow-up task was recorded after that visit.',
            `More than ${WINDOWS.FOLLOWUP_GRACE_DAYS} days have passed, so this is a gap in coordination rather than work still in progress.`
        ],
        action: {
            taskType: 'follow_up_visit',
            title: 'Follow up after a concerning visit',
            summary: 'A recent visit recorded a critical danger sign and nothing has been recorded since. Contact the patient, check how they are, and arrange a consultation or referral if one is needed.',
            priority: 'high',
            dueInDays: 1
        }
    };
}

/**
 * B. The same warning keeps appearing.
 *
 * One raised reading is noise; the same one at three visits over three months
 * is a pattern the record is showing and nobody has acted on. The agent counts
 * repetitions — it does not name what the repetition might mean.
 */
function repeatedWarningSigns(snapshot, now) {
    if (hasOpenCoordination(snapshot)) return null;

    const cutoff = now - days(WINDOWS.REPEATED_WARNING_DAYS);
    const recent = snapshot.encounters.filter(e => new Date(e.occurredAt).getTime() >= cutoff);

    const counts = {};
    for (const e of recent) {
        for (const sign of e.dangerSigns || []) {
            if (CRITICAL_SIGNS.has(sign)) continue;   // criticals are pattern A
            (counts[sign] ||= []).push(e);
        }
    }

    const [sign, occurrences] = Object.entries(counts)
        .find(([, list]) => list.length >= WINDOWS.REPEATED_WARNING_COUNT) || [];
    if (!sign) return null;

    return {
        problem: 'repeated_warning_signs',
        concern: 'medium',
        encounterId: occurrences[0]._id,
        signals: ['repeated_warning_sign', 'no_active_coordination'],
        reasoning: [
            `The same warning sign (${label(sign)}) has been recorded at ${occurrences.length} visits in the last ${WINDOWS.REPEATED_WARNING_DAYS} days.`,
            'No follow-up task or consultation is currently open for this patient.',
            'A repeated observation with no coordination around it is worth someone looking at.'
        ],
        action: {
            taskType: 'follow_up_visit',
            title: 'Review a repeated observation',
            summary: `The same warning sign has been recorded at ${occurrences.length} visits. Visit the patient, take fresh readings, and arrange a consultation if the pattern continues.`,
            priority: 'medium',
            dueInDays: 5
        }
    };
}

/**
 * C. A care plan's scheduled visit has come and gone.
 *
 * The plan already put a dated task on somebody's list. This notices that the
 * date passed and the task is still open — the plan is quietly not happening.
 */
function carePlanVisitOverdue(snapshot, now) {
    const grace = now - days(WINDOWS.PLAN_OVERDUE_GRACE_DAYS);

    const overdue = snapshot.tasks
        .filter(t => t.source === 'protocol' && OPEN_TASK.includes(t.status) &&
            new Date(t.dueAt).getTime() < grace)
        .sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt))[0];
    if (!overdue) return null;

    const plan = snapshot.carePlans.find(p => p.status === 'active');
    const highRisk = plan?.riskLevel === 'high';

    return {
        problem: 'care_plan_visit_overdue',
        concern: highRisk ? 'high' : 'medium',
        signals: ['care_plan_visit_overdue', ...(highRisk ? ['high_risk_care_plan'] : [])],
        reasoning: [
            `A scheduled follow-up ("${overdue.title}") was due ${daysAgo(overdue.dueAt, now)} day(s) ago and is still not complete.`,
            plan
                ? `It belongs to an active ${String(plan.type).toUpperCase()} care plan${highRisk ? ', which the system has flagged as high risk based on recorded observations' : ''}.`
                : 'It came from a care plan schedule.',
            'A scheduled visit that has not happened does not reschedule itself.'
        ],
        action: {
            taskType: 'follow_up_visit',
            title: 'Complete an overdue scheduled visit',
            summary: `A planned follow-up is overdue ("${overdue.title}"). Visit the patient, record the visit, and close the outstanding task.`,
            priority: highRisk ? 'high' : 'medium',
            dueInDays: 3
        }
    };
}

/**
 * D. A high-risk plan whose patient has not been seen at all.
 *
 * The plan's own tasks may not be overdue yet, but nobody has recorded contact
 * for weeks. Being enrolled in a high-risk plan and not being seen is its own
 * kind of gap.
 */
function highRiskPlanNoContact(snapshot, now) {
    if (hasOpenCoordination(snapshot)) return null;

    const plan = snapshot.carePlans.find(p => p.status === 'active' && p.riskLevel === 'high');
    if (!plan) return null;

    const lastEncounter = snapshot.encounters[0];
    const since = lastEncounter ? new Date(lastEncounter.occurredAt).getTime() : new Date(plan.startedAt).getTime();
    if (since > now - days(WINDOWS.NO_CONTACT_DAYS)) return null;

    return {
        problem: 'high_risk_plan_no_contact',
        concern: 'medium',
        signals: ['high_risk_care_plan', 'no_recent_contact'],
        reasoning: [
            `This patient has an active ${String(plan.type).toUpperCase()} care plan the system has flagged as high risk${plan.riskFlags?.length ? ` (${plan.riskFlags.map(label).join(', ')})` : ''}.`,
            lastEncounter
                ? `The most recent recorded contact was ${daysAgo(lastEncounter.occurredAt, now)} day(s) ago.`
                : 'No contact has been recorded since the plan was started.',
            `That is longer than the ${WINDOWS.NO_CONTACT_DAYS}-day window this review uses for a high-risk plan.`
        ],
        action: {
            taskType: 'follow_up_visit',
            title: 'Check in on a high-risk care plan',
            summary: 'This patient is on a high-risk care plan and has not been seen recently. Visit them, record current readings, and confirm the plan is still on track.',
            priority: 'medium',
            dueInDays: 7
        }
    };
}

/**
 * Ordered by how much the silence matters. The first match wins — one finding
 * per patient, because four proposals about the same person on one queue is
 * the noise this design is trying to avoid.
 */
const PATTERNS = [criticalSignNoFollowup, carePlanVisitOverdue, repeatedWarningSigns, highRiskPlanNoContact];

/**
 * Referral-shaped gaps belong to the Referral Follow-up Agent.
 *
 * Both agents can see the same stalled referral, and both could reasonably
 * propose chasing it. Rather than have them race, this one stands down: if the
 * only thing wrong with a patient is a referral, Step 13 owns it.
 */
function referralAgentAlreadyOwns(snapshot) {
    return snapshot.recommendations.some(r => r.agentId === 'referral_followup_agent');
}

export default async function highRiskFollowupAgent(ctx) {
    const now = Date.now();

    const patients = await actions.read(ctx, 'patient.listForFacilityReview', {});

    const findings = [];
    let proposed = 0, duplicates = 0, previewed = 0, deferred = 0;

    for (const patient of patients) {
        const snapshot = await actions.read(ctx, 'patient.coordinationSnapshot', { patientId: patient._id });

        let finding = null;
        for (const pattern of PATTERNS) {
            finding = pattern(snapshot, now);
            if (finding) break;
        }
        if (!finding) continue;

        if (referralAgentAlreadyOwns(snapshot)) { deferred++; continue; }

        // The worker who covers the village, exactly as the referral agent
        // resolves it; falls back to the reviewing facility if nobody does.
        const worker = patient.village
            ? await actions.read(ctx, 'worker.findForCatchment', { village: patient.village })
            : null;

        const owner = worker
            ? { ownerId: worker._id, ownerName: worker.name, ownerRole: 'health_worker', ownerFacilityId: worker.hospitalId }
            : { ownerId: null, ownerName: ctx.delegate.facilityId ? 'Reviewing facility' : '', ownerRole: 'hospital', ownerFacilityId: ctx.delegate.facilityId };

        const recommendedAction = { ...finding.action, ...owner };

        /**
         * The encounter is part of the key where there is one, so a genuinely
         * new critical reading later raises a fresh finding instead of being
         * silenced by the previous one.
         */
        const dedupeKey = [ctx.agentId, patient._id, finding.problem, finding.encounterId || 'none'].join(':');

        const outcome = await actions.invoke(ctx, 'recommendation.propose', {
            agentId: ctx.agentId,
            agentRunId: ctx.agentRunId,
            patientId: patient._id,
            encounterId: finding.encounterId,
            scopeFacilityIds: [ctx.delegate.facilityId],
            problem: finding.problem,
            concern: finding.concern,
            reasoning: finding.reasoning,
            dedupeKey,
            recommendedAction
        }, { model: 'HealthRecord', id: finding.encounterId });

        if (outcome.status === 'recommended') previewed++;
        else if (outcome.ok) (outcome.result?.created ? proposed++ : duplicates++);

        findings.push({
            patientId: patient._id,
            patient: patient.name,
            village: patient.village,
            age: patient.age,
            problem: finding.problem,
            concern: finding.concern,
            signals: finding.signals,
            reasoning: finding.reasoning,
            recommendedAction,
            persisted: outcome.status === 'performed' ? (outcome.result?.created ? 'created' : 'already_pending') : 'preview',
            recommendationId: outcome.result?.recommendation?._id || null
        });
    }

    const rank = { high: 0, medium: 1, low: 2 };
    findings.sort((a, b) => rank[a.concern] - rank[b.concern]);

    const byProblem = {};
    for (const f of findings) byProblem[f.problem] = (byProblem[f.problem] || 0) + 1;

    const summary = findings.length === 0
        ? 'No follow-up gaps found among this facility\'s patients.'
        : ctx.dryRun
            ? `${findings.length} patient(s) would be proposed for follow-up (preview only, nothing saved).`
            : `${findings.length} patient(s) need follow-up: ${proposed} new recommendation(s), ${duplicates} already awaiting review.`;

    return {
        summary,
        observed: {
            patientsReviewed: patients.length,
            findings: findings.length,
            byProblem,
            proposed,
            duplicatesSkipped: duplicates,
            previewOnly: previewed,
            deferredToReferralAgent: deferred
        },
        findings,
        windows: WINDOWS,
        note: ctx.dryRun
            ? 'Preview only. Nothing was saved and no task was created.'
            : 'Recommendations are pending human review. No task is created until somebody approves one.'
    };
}
