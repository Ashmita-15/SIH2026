import User from '../models/User.js';
import { forbidden } from '../services/errors.js';

/**
 * Who an agent is, and whose permissions it is borrowing.
 *
 * The distinction this file exists to keep is between identity and authority.
 * The agent has an identity — it is what the audit log names, and what makes an
 * automated action tellable apart from a human one. It does not have authority
 * of its own.
 *
 * Authority comes from delegation: every run is bound to a real account, and
 * the agent can reach exactly what that account could reach and nothing more.
 * Services are handed { actorId, io } — the same shape a controller hands them —
 * so no service needed changing and none of them can tell the difference. That
 * is the point. An agent that services had to be taught about would be an agent
 * that could be taught to skip their checks.
 */

export const ACTOR_TYPES = { HUMAN: 'human', SYSTEM_AGENT: 'system_agent' };

/**
 * Builds the context for one run.
 *
 * `delegatedActorId` is required. There is no anonymous mode and no system
 * superuser: an agent with nobody's permissions would either be useless or be
 * a hole, and the second is likelier.
 */
export async function buildAgentContext({ agent, trigger, triggeredBy, delegatedActorId, dryRun = true, io }) {
    if (!delegatedActorId) {
        throw forbidden('An agent run must be delegated a real account to act within');
    }

    const delegate = await User.findById(delegatedActorId).select('role hospitalId name');
    if (!delegate) throw forbidden('Delegated account not found');

    return {
        agentId: agent.id,
        agentName: agent.name,
        actorType: ACTOR_TYPES.SYSTEM_AGENT,

        trigger,
        triggeredBy: triggeredBy || null,

        /**
         * The permissions boundary. Read by the action interface when it calls
         * a service; never read by the agent itself, so an agent cannot widen
         * its own reach by choosing a different actor mid-run.
         */
        delegatedActorId: String(delegate._id),
        delegate: {
            id: String(delegate._id),
            role: delegate.role,
            facilityId: delegate.hospitalId ? String(delegate.hospitalId) : null
        },

        /**
         * Whether anything is allowed to change. Enforced in the action
         * interface rather than left to each agent to respect, because a
         * dry run that depends on every agent remembering is not a dry run.
         */
        dryRun: Boolean(dryRun),

        startedAt: new Date(),
        io: io || null,

        // Filled in by the action interface as the run proceeds.
        actions: []
    };
}

/** The context a service expects. Deliberately identical to a controller's. */
export function serviceContextFrom(ctx) {
    return { actorId: ctx.delegatedActorId, io: ctx.io };
}
