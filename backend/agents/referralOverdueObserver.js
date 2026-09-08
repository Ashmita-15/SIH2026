import * as actions from './actions.js';

/**
 * Reports referrals that have passed their deadline without being closed.
 *
 * A referral nobody answered is the failure this whole system exists to make
 * visible, and until now it was only visible to whoever happened to open the
 * dashboard. This is the first thing that goes looking.
 *
 * Strictly an observer. It changes no referral, creates no task and notifies
 * nobody — the registry grants it one read and nothing else, so even a bug
 * here could not write. Deciding what to do about an overdue referral stays
 * with the people who can actually do it.
 *
 * The reasoning below is ordinary code. That is deliberate for now: the shape
 * — gather, reason, propose — is what a model would later slot into, and
 * having it deterministic first means the architecture can be trusted before
 * anything unpredictable is put inside it.
 */

const CLOSED = ['completed', 'declined', 'lapsed', 'redirected'];

/** Hours late, positive. */
const hoursOverdue = (dueBy, now) => Math.max(0, Math.round((now - new Date(dueBy)) / 36e5));

/**
 * How much attention this one deserves.
 *
 * Rules, not judgement: an emergency referral an hour late matters more than a
 * routine one a week late, and a patient who was booked and did not arrive is
 * a different problem from a hospital that never replied.
 */
function assess(referral, now) {
    const overdueHours = hoursOverdue(referral.dueBy, now);
    const urgent = referral.priority === 'emergency' || referral.priority === 'urgent_24h';

    let concern = 'low';
    if (urgent || overdueHours >= 72) concern = 'high';
    else if (overdueHours >= 24) concern = 'medium';

    let observation;
    switch (referral.status) {
        case 'created':
            observation = 'Never acknowledged by the destination facility.';
            break;
        case 'acknowledged':
            observation = 'Acknowledged but never given an appointment.';
            break;
        case 'scheduled':
            observation = 'Appointment passed without the patient being marked as attended.';
            break;
        case 'missed':
            observation = referral.missedReason
                ? `Patient did not attend (${String(referral.missedReason).replace(/_/g, ' ')}).`
                : 'Patient did not attend; no reason recorded.';
            break;
        default:
            observation = `Open at status "${referral.status}".`;
    }

    return { overdueHours, concern, observation };
}

/**
 * @param ctx  agent context — carries the delegated actor and dryRun
 * @returns    a summary plus the findings; the runner writes the audit
 */
export default async function referralOverdueObserver(ctx) {
    const now = Date.now();

    /**
     * Read through the action interface, which calls the same listReferrals a
     * controller calls, with the delegated actor's context. The facility
     * scoping inside that service applies unchanged — this agent sees exactly
     * what the account it is running on behalf of would see, and the overdue
     * filter is the one the service already implements.
     */
    const referrals = await actions.read(ctx, 'referral.list', { overdue: 'true', limit: 200 });

    const open = referrals.filter(r => !CLOSED.includes(r.status));

    const findings = open
        .map(r => {
            const { overdueHours, concern, observation } = assess(r, now);
            return {
                referralId: r._id,
                code: r.referralId,
                patient: r.patientId?.name || null,
                village: r.patientId?.village || null,
                from: r.fromFacilityId?.name || null,
                to: r.toFacilityId?.name || null,
                status: r.status,
                priority: r.priority,
                reason: r.reason,
                dueBy: r.dueBy,
                overdueHours,
                concern,
                observation
            };
        })
        .sort((a, b) => {
            const rank = { high: 0, medium: 1, low: 2 };
            return rank[a.concern] - rank[b.concern] || b.overdueHours - a.overdueHours;
        });

    const byConcern = { high: 0, medium: 0, low: 0 };
    for (const f of findings) byConcern[f.concern]++;

    const summary = findings.length === 0
        ? 'No overdue referrals within this account\'s scope.'
        : `${findings.length} overdue referral(s): ${byConcern.high} high, ${byConcern.medium} medium, ${byConcern.low} low concern.`;

    return {
        summary,
        // Counts for the audit; the detail goes back in the response only.
        observed: {
            referralsInspected: referrals.length,
            overdueOpen: findings.length,
            byConcern
        },
        findings,
        /**
         * Said explicitly in the payload rather than left implied, because the
         * next agent built on this foundation will not be read-only and the
         * difference should be obvious in the response, not just the docs.
         */
        note: 'Observation only. This agent does not change referrals, create tasks or notify anyone.'
    };
}
