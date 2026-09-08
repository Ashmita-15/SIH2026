import { badRequest, forbidden, notFound } from '../services/errors.js';
import referralOverdueObserver from './referralOverdueObserver.js';
import referralFollowupAgent from './referralFollowupAgent.js';
import highRiskFollowupAgent from './highRiskFollowupAgent.js';

/**
 * Which agents exist, and what each is allowed to do.
 *
 * A plain list rather than a workflow engine. The only thing that matters
 * architecturally is that an agent's permissions are declared here, next to
 * its identity, instead of being decided inside the agent where a future
 * change could quietly widen them.
 */

/**
 * Every agent declares the actions it may invoke. The action interface refuses
 * anything not on this list, so granting an agent a new power is a visible,
 * reviewable edit to this file — never a side effect of changing agent logic.
 */
const AGENTS = [
    {
        id: 'referral_overdue_observer',
        name: 'Referral Overdue Observer',
        description:
            'Reports referrals that have passed their SLA deadline without being completed. ' +
            'Observation only — it does not change referral state, create tasks or notify anyone.',
        enabled: true,
        trigger: 'manual',
        capabilities: ['referral.list'],
        run: referralOverdueObserver
    },
    {
        id: 'referral_followup_agent',
        name: 'Referral Follow-up Agent',
        description:
            'Finds referrals that have stalled or been missed, works out who should chase each one, ' +
            'and proposes a follow-up task for a person to approve. Creates no task by itself.',
        enabled: true,
        trigger: 'manual',
        /**
         * Read referrals, look up the worker covering a village, write a
         * proposal. Notably NOT task.create: the agent can ask for work to be
         * created but cannot create it, and that boundary is this line.
         */
        capabilities: ['referral.list', 'worker.findForCatchment', 'recommendation.propose'],
        run: referralFollowupAgent
    },
    {
        id: 'high_risk_patient_followup_agent',
        name: 'High-Risk Patient Follow-up Agent',
        description:
            'Reviews patients across visits, danger signs, care plans, tasks and referrals to find those ' +
            'whose care appears to have stalled, and proposes a follow-up for a person to approve. ' +
            'Coordination only — it does not diagnose, prescribe, or create work by itself.',
        enabled: true,
        trigger: 'manual',
        /**
         * Four reads and one proposal. No task.create, no referral transition,
         * no record write — so the agent can describe a gap and ask somebody to
         * close it, and that is the whole of what it can do.
         */
        capabilities: [
            'patient.listForFacilityReview',
            'patient.coordinationSnapshot',
            'worker.findForCatchment',
            'recommendation.propose'
        ],
        run: highRiskFollowupAgent
    }
];

const byId = new Map(AGENTS.map(a => [a.id, a]));

/** Metadata only — never the run function, which is not serialisable. */
const describe = ({ id, name, description, enabled, trigger, capabilities }) =>
    ({ id, name, description, enabled, trigger, capabilities });

export function listAgents() {
    return AGENTS.map(describe);
}

/**
 * Looks an agent up for execution.
 *
 * Unknown and disabled are different failures on purpose: an unknown id is a
 * caller mistake, a disabled agent is a deliberate operational decision and
 * saying so is more useful than pretending it does not exist.
 */
export function getAgent(agentId) {
    const agent = byId.get(String(agentId || ''));
    if (!agent) throw notFound(`Unknown agent: ${agentId}`);
    if (!agent.enabled) throw forbidden(`Agent ${agent.id} is disabled`);
    return agent;
}

/** Used by the action interface; does not care whether the agent is enabled. */
export function findAgent(agentId) {
    return byId.get(String(agentId || '')) || null;
}

export function assertTriggerAllowed(agent, trigger) {
    if (agent.trigger !== trigger) {
        throw badRequest(`Agent ${agent.id} is a '${agent.trigger}' agent and cannot be triggered by '${trigger}'`);
    }
}
