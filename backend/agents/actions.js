import * as referralService from '../services/referralService.js';
import * as taskService from '../services/taskService.js';
import * as recommendationService from '../services/recommendationService.js';
import * as riskReviewService from '../services/riskReviewService.js';
import { findAgent } from './registry.js';
import { serviceContextFrom } from './context.js';
import { forbidden } from '../services/errors.js';

/**
 * The only way an agent may touch the system.
 *
 * Agents do not import models and do not import services. They call this, and
 * this calls the same service functions a controller calls, with the same
 * context shape. Everything the services already enforce — catchment scoping,
 * referral state rules, SLA arithmetic, danger-sign thresholds — therefore
 * applies to agents for free, because none of it has been re-implemented here.
 *
 * Three checks stand between an agent and a service:
 *   1. the action must exist in this catalogue,
 *   2. the agent must have declared it in the registry,
 *   3. a write is refused outright during a dry run.
 */

/**
 * `effect` is the safety-relevant part.
 *
 * 'read' can run in either mode. 'write' is refused whenever dryRun is set,
 * which is what makes a dry run a guarantee rather than a convention each
 * agent has to honour.
 */
const ACTIONS = {
    'referral.list': {
        effect: 'read',
        describe: (input) => `list referrals (${JSON.stringify(input)})`,
        run: (input, svcCtx) => referralService.listReferrals(input, svcCtx)
    },

    /**
     * Which health worker covers a village.
     *
     * A read over data an agent needs to name the right owner for a follow-up.
     * It returns one worker's identity and facility, nothing about patients.
     */
    'worker.findForCatchment': {
        effect: 'read',
        describe: (input) => `find the health worker covering ${input?.village}`,
        run: (input) => taskService.findCatchmentWorker({ village: input?.village })
    },

    /**
     * The patients this facility is entitled to review.
     *
     * Narrow on purpose. It answers one question and returns identities only —
     * no encounters, no vitals, nothing clinical. Membership is the same rule
     * the timeline already uses, so it opens no new door.
     */
    'patient.listForFacilityReview': {
        effect: 'read',
        describe: () => 'list patients connected to this facility',
        run: (input, svcCtx) => riskReviewService.listFacilityPatients(svcCtx)
    },

    /**
     * One patient's coordination picture.
     *
     * The multi-source read this agent reasons over: encounters with the
     * danger signs already computed for them, tasks, care plans, referrals,
     * appointments, and what other agents have proposed. Access is re-checked
     * per patient inside the service, so a guessed id is refused.
     */
    'patient.coordinationSnapshot': {
        effect: 'read',
        describe: (input) => `read the coordination history for patient ${input?.patientId}`,
        run: (input, svcCtx) => riskReviewService.getCoordinationSnapshot(input?.patientId, svcCtx)
    },

    /**
     * Writing a proposal for a human to review.
     *
     * A write, so a dry run refuses it and the agent's analysis stays
     * ephemeral. This is the furthest an agent's own authority reaches: it can
     * ask, and that is all. Turning a proposal into work is a separate,
     * human-authorised call in recommendationService.
     */
    'recommendation.propose': {
        effect: 'write',
        describe: (input) => `propose ${input?.problem} follow-up for referral ${input?.referralId}`,
        run: (input) => recommendationService.proposeRecommendation(input)
    },

    /**
     * Registered but granted to nobody yet.
     *
     * Deliberately granted to no agent, including the follow-up agent. Task
     * creation runs under a reviewer's authority in recommendationService,
     * never under an agent's — createTask performs no authorization of its
     * own, so an agent holding this could put work against any patient.
     */
    'task.create': {
        effect: 'write',
        describe: (input) => `create task "${input?.title}"`,
        run: (input) => taskService.createTask(input)
    }
};

export function listActions() {
    return Object.entries(ACTIONS).map(([action, { effect }]) => ({ action, effect }));
}

/**
 * Runs one action on an agent's behalf, or refuses and says why.
 *
 * A refusal is recorded on the context rather than thrown, so a run that hits
 * a guard still produces a complete audit trail instead of vanishing into an
 * error. Genuine service failures do throw — those are not the agent being
 * stopped, they are something being broken.
 */
export async function invoke(ctx, action, input = {}, target = null) {
    const record = (status, reason) => {
        ctx.actions.push({
            action,
            status,
            ...(target ? { target } : {}),
            reason: reason || ''
        });
        return { ok: status === 'performed', status, reason };
    };

    const definition = ACTIONS[action];
    if (!definition) return record('blocked', `Unknown action: ${action}`);

    const agent = findAgent(ctx.agentId);
    if (!agent) return record('blocked', `Unknown agent: ${ctx.agentId}`);

    // The registry is the grant. An agent cannot widen this at runtime.
    if (!agent.capabilities.includes(action)) {
        return record('blocked', `Agent ${agent.id} is not granted '${action}'`);
    }

    if (definition.effect === 'write' && ctx.dryRun) {
        return record('recommended', `Dry run — would ${definition.describe(input)}`);
    }

    try {
        const result = await definition.run(input, serviceContextFrom(ctx));
        ctx.actions.push({
            action,
            status: 'performed',
            ...(target ? { target } : {}),
            reason: definition.describe(input)
        });
        return { ok: true, status: 'performed', result };
    } catch (e) {
        /**
         * A service refusing the delegated actor is the design working, not a
         * fault. It is recorded as a blocked action so the audit shows the
         * agent tried and was stopped.
         */
        if (e?.name === 'ServiceError') {
            return record('blocked', `Refused by service: ${e.message}`);
        }
        record('failed', e.message);
        throw e;
    }
}

/** Convenience for reads, where the caller wants the data not the envelope. */
export async function read(ctx, action, input = {}) {
    const outcome = await invoke(ctx, action, input);
    if (!outcome.ok) throw forbidden(outcome.reason);
    return outcome.result;
}
