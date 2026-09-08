import * as actions from './actions.js';

/**
 * Finds referrals that have stalled and proposes who should chase them.
 *
 * The agent's whole job is coordination: it works out what went wrong, how
 * badly, and which of the people already in the system is the right one to do
 * something about it. It proposes; it does not act. Every proposal waits for a
 * person to approve it before any work appears on anybody's list.
 *
 * It is not clinical and cannot become clinical. It reads referral state and
 * SLA deadlines the system already computed, and every sentence it produces is
 * about coordination — who should call whom, and by when. There is no path
 * here that reaches a diagnosis, a medicine, or a change to a patient record,
 * and the capability grant in the registry makes that a guarantee rather than
 * a promise: it may read referrals and write proposals, nothing else.
 *
 * The reasoning is ordinary code, deliberately. A model can be dropped into
 * `assess` later; having the shape settled and deterministic first means the
 * approval machinery is trustworthy before anything unpredictable sits inside it.
 */

const CLOSED = ['completed', 'declined', 'lapsed', 'redirected'];

const hoursOverdue = (dueBy, now) => Math.max(0, Math.round((now - new Date(dueBy)) / 36e5));

/**
 * Turns one stalled referral into a problem, a severity and an owner.
 *
 * The four cases are the four ways a referral dies in practice, and each has a
 * different person who can actually fix it — which is the part that matters.
 * A hospital that never replied is not the ASHA's problem to solve; a patient
 * who could not afford the bus is not the hospital's.
 */
function assess(referral, now) {
    const overdueHours = hoursOverdue(referral.dueBy, now);
    const urgent = referral.priority === 'emergency' || referral.priority === 'urgent_24h';
    const patientName = referral.patientId?.name || 'The patient';
    const code = referral.referralId;

    // Severity from the promise that was made, not from any clinical judgement.
    let concern = 'low';
    if (urgent || overdueHours >= 72) concern = 'high';
    else if (overdueHours >= 24) concern = 'medium';

    const lateLine = `Past its ${String(referral.priority).replace(/_/g, ' ')} deadline by ${overdueHours} hour(s).`;

    switch (referral.status) {
        /**
         * Nobody at the receiving end has answered. The patient has not failed
         * to do anything — the destination has — so the work belongs there.
         */
        case 'created':
            return {
                problem: 'not_acknowledged',
                concern: urgent ? 'high' : concern,
                reasoning: [
                    `Referral ${code} was sent to ${referral.toFacilityId?.name || 'the destination'} and has not been acknowledged.`,
                    lateLine,
                    'Until the destination responds the patient has no appointment and nobody is expecting them.'
                ],
                owner: 'destination',
                action: {
                    taskType: 'referral_acknowledge',
                    title: `Acknowledge referral ${code} for ${patientName}`,
                    summary: 'Review this incoming referral and either accept it with an appointment or decline it with a reason so the referring facility can send the patient elsewhere.',
                    priority: urgent ? 'high' : 'medium',
                    dueInDays: 1
                }
            };

        /** Accepted, then left without a date. Still the destination's move. */
        case 'acknowledged':
            return {
                problem: 'not_scheduled',
                concern,
                reasoning: [
                    `Referral ${code} was acknowledged by ${referral.toFacilityId?.name || 'the destination'} but no appointment has been set.`,
                    lateLine,
                    'The patient cannot travel without a date to travel for.'
                ],
                owner: 'destination',
                action: {
                    taskType: 'referral_chase',
                    title: `Give ${patientName} an appointment for referral ${code}`,
                    summary: 'This referral was accepted but never scheduled. Set a date and time, or decline it so the referring facility can act.',
                    priority: concern === 'high' ? 'high' : 'medium',
                    dueInDays: 1
                }
            };

        /**
         * The appointment came and went with nothing recorded. Ambiguous — the
         * patient may have attended and nobody updated it — so the task asks
         * for the fact rather than assuming the worst.
         */
        case 'scheduled':
            return {
                problem: 'not_attended',
                concern,
                reasoning: [
                    `The appointment for referral ${code} has passed and no attendance has been recorded.`,
                    lateLine,
                    'It is not yet known whether the patient attended, so the referral status may simply be out of date.'
                ],
                owner: 'destination',
                action: {
                    taskType: 'referral_chase',
                    title: `Confirm whether ${patientName} attended referral ${code}`,
                    summary: 'Check whether this patient was seen. Mark the referral attended if they were, or missed with a reason if they were not.',
                    priority: concern === 'high' ? 'high' : 'medium',
                    dueInDays: 2
                }
            };

        /**
         * The patient did not come. This is the one that needs somebody who
         * can knock on a door, so it goes to the health worker who covers
         * their village — and the recorded reason shapes what they are asked
         * to find out.
         */
        case 'missed': {
            const reason = referral.missedReason
                ? String(referral.missedReason).replace(/_/g, ' ')
                : null;

            const barrier = {
                no_transport: 'The recorded reason suggests a transport barrier rather than a change in the patient\'s condition.',
                no_money: 'The recorded reason suggests cost is the obstacle.',
                family_refused: 'The recorded reason suggests the household needs to be spoken to.',
                felt_better: 'The patient reported feeling better, which does not by itself mean the referral is no longer needed.',
                went_elsewhere: 'The patient may have sought care elsewhere; this needs confirming.'
            }[referral.missedReason];

            return {
                problem: 'missed_referral',
                concern: 'high',
                reasoning: [
                    `${patientName} did not attend referral ${code} at ${referral.toFacilityId?.name || 'the destination'}.`,
                    reason ? `Recorded reason: ${reason}.` : 'No reason was recorded for the non-attendance.',
                    ...(barrier ? [barrier] : []),
                    'A missed referral does not resolve itself; somebody has to make contact.'
                ],
                owner: 'catchment_worker',
                action: {
                    taskType: 'referral_chase',
                    title: `Follow up with ${patientName} about missed referral ${code}`,
                    summary: reason
                        ? `Contact the household, confirm why the visit did not happen (recorded as: ${reason}), and establish whether rescheduling or practical support is needed. Update the referral with what you find.`
                        : 'Contact the household, find out why the visit did not happen, and establish whether rescheduling or practical support is needed. Update the referral with what you find.',
                    priority: 'high',
                    dueInDays: 2
                }
            };
        }

        default:
            return null;
    }
}

/**
 * Resolves the proposal's owner to a real person or facility.
 *
 * Only ever picks somebody the system already knows: the health worker whose
 * catchment covers the patient's village, or the facility on one end of the
 * referral. No new role is invented, and where no catchment worker exists the
 * proposal falls back to the referring facility rather than to nobody.
 */
async function resolveOwner(ctx, kind, referral) {
    if (kind === 'destination') {
        return {
            ownerId: null,
            ownerName: referral.toFacilityId?.name || '',
            ownerRole: 'hospital',
            ownerFacilityId: referral.toFacilityId?._id || referral.toFacilityId
        };
    }

    const patient = referral.patientId;
    const worker = patient?.village
        ? await actions.read(ctx, 'worker.findForCatchment', { village: patient.village })
        : null;

    if (worker) {
        return {
            ownerId: worker._id,
            ownerName: worker.name,
            ownerRole: 'health_worker',
            ownerFacilityId: worker.hospitalId
        };
    }

    // Nobody covers that village. The referring facility keeps it rather than
    // the proposal quietly having no owner.
    return {
        ownerId: null,
        ownerName: referral.fromFacilityId?.name || '',
        ownerRole: 'hospital',
        ownerFacilityId: referral.fromFacilityId?._id || referral.fromFacilityId
    };
}

export default async function referralFollowupAgent(ctx) {
    const now = Date.now();

    // Same read the observer makes, through the same interface, with the
    // delegated actor's scope applied by the referral service unchanged.
    const referrals = await actions.read(ctx, 'referral.list', { overdue: 'true', limit: 200 });
    const open = referrals.filter(r => !CLOSED.includes(r.status));

    const recommendations = [];
    let proposed = 0, duplicates = 0, previewed = 0;

    for (const referral of open) {
        const finding = assess(referral, now);
        if (!finding) continue;

        const owner = await resolveOwner(ctx, finding.owner, referral);

        const recommendedAction = { ...finding.action, ...owner };
        const dedupeKey = `${ctx.agentId}:${referral._id}:${finding.problem}`;

        /**
         * Persisting is a write, so the dry-run guard in the action interface
         * stops it without this agent having to check. A dry run therefore
         * produces exactly the same analysis and stores none of it.
         */
        const outcome = await actions.invoke(ctx, 'recommendation.propose', {
            agentId: ctx.agentId,
            agentRunId: ctx.agentRunId,
            referralId: referral._id,
            patientId: referral.patientId?._id || referral.patientId,
            scopeFacilityIds: [
                referral.fromFacilityId?._id || referral.fromFacilityId,
                referral.toFacilityId?._id || referral.toFacilityId
            ],
            problem: finding.problem,
            concern: finding.concern,
            reasoning: finding.reasoning,
            dedupeKey,
            recommendedAction
        }, { model: 'Referral', id: referral._id });

        if (outcome.status === 'recommended') previewed++;
        else if (outcome.ok) (outcome.result?.created ? proposed++ : duplicates++);

        recommendations.push({
            referralId: referral._id,
            code: referral.referralId,
            patient: referral.patientId?.name || null,
            village: referral.patientId?.village || null,
            from: referral.fromFacilityId?.name || null,
            to: referral.toFacilityId?.name || null,
            status: referral.status,
            priority: referral.priority,
            dueBy: referral.dueBy,
            overdueHours: hoursOverdue(referral.dueBy, now),
            problem: finding.problem,
            concern: finding.concern,
            reasoning: finding.reasoning,
            recommendedAction,
            // Persisted, already queued, or preview-only.
            persisted: outcome.status === 'performed' ? (outcome.result?.created ? 'created' : 'already_pending') : 'preview',
            recommendationId: outcome.result?.recommendation?._id || null
        });
    }

    const rank = { high: 0, medium: 1, low: 2 };
    recommendations.sort((a, b) => rank[a.concern] - rank[b.concern] || b.overdueHours - a.overdueHours);

    const byProblem = {};
    for (const r of recommendations) byProblem[r.problem] = (byProblem[r.problem] || 0) + 1;

    const summary = recommendations.length === 0
        ? 'No referrals need follow-up within this account\'s scope.'
        : ctx.dryRun
            ? `${recommendations.length} referral(s) would be proposed for follow-up (preview only, nothing saved).`
            : `${recommendations.length} referral(s) need follow-up: ${proposed} new recommendation(s), ${duplicates} already awaiting review.`;

    return {
        summary,
        observed: {
            referralsInspected: referrals.length,
            needingFollowUp: recommendations.length,
            byProblem,
            proposed,
            duplicatesSkipped: duplicates,
            previewOnly: previewed
        },
        recommendations,
        note: ctx.dryRun
            ? 'Preview only. Nothing was saved and no task was created.'
            : 'Recommendations are pending human review. No task is created until somebody approves one.'
    };
}
