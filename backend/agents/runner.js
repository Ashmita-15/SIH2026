import AgentRun from '../models/AgentRun.js';
import { getAgent, assertTriggerAllowed, listAgents } from './registry.js';
import { buildAgentContext } from './context.js';

export { listAgents };

/**
 * Runs one agent and writes down what happened.
 *
 * The audit row is opened before the agent executes, not after, so a run that
 * throws or never returns still leaves evidence that it started. An agent that
 * crashes silently would be the one case where the audit trail is most needed
 * and least likely to exist.
 */
export async function runAgent({ agentId, trigger = 'manual', triggeredBy, delegatedActorId, dryRun = true, io }) {
    const agent = getAgent(agentId);
    assertTriggerAllowed(agent, trigger);

    const ctx = await buildAgentContext({ agent, trigger, triggeredBy, delegatedActorId, dryRun, io });

    const run = await AgentRun.create({
        agentId: agent.id,
        agentName: agent.name,
        trigger,
        triggeredBy: triggeredBy || undefined,
        actorType: ctx.actorType,
        delegatedActorId: ctx.delegatedActorId,
        dryRun: ctx.dryRun,
        status: 'running',
        startedAt: ctx.startedAt
    });

    // Proposals must point back at the run that made them, so the id is put
    // on the context once the audit row exists.
    ctx.agentRunId = run._id;

    try {
        const result = await agent.run(ctx);

        run.status = 'succeeded';
        run.summary = result?.summary || '';
        run.observed = result?.observed || {};
        // Recorded by the action interface as the run proceeded, so a blocked
        // action appears here even though it never reached a service.
        run.actions = ctx.actions;
        run.completedAt = new Date();
        run.durationMs = run.completedAt - ctx.startedAt;
        await run.save();

        return { run: run.toObject(), result };
    } catch (e) {
        run.status = 'failed';
        run.error = e.message;
        run.actions = ctx.actions;
        run.completedAt = new Date();
        run.durationMs = run.completedAt - ctx.startedAt;
        await run.save();
        throw e;
    }
}

export async function listRuns(filters = {}) {
    const query = {};
    if (filters.agentId) query.agentId = filters.agentId;
    if (filters.dryRun !== undefined) query.dryRun = String(filters.dryRun) === 'true';

    return AgentRun.find(query)
        .populate('triggeredBy', 'name role')
        .populate('delegatedActorId', 'name role')
        .sort({ startedAt: -1 })
        .limit(Math.min(Number(filters.limit) || 25, 100));
}
