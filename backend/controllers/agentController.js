import * as runner from '../agents/runner.js';
import { listActions } from '../agents/actions.js';
import { sendError } from '../services/errors.js';

/** HTTP in front of the agent runner. No agent logic lives here. */

export const listAgents = (req, res) => {
    res.json({ agents: runner.listAgents(), actions: listActions() });
};

/**
 * Runs an agent on behalf of the caller.
 *
 * The delegated actor is the authenticated user, taken from the token and
 * never from the body. That is what keeps an agent from being a way to see
 * further than the person who started it: the services it reaches scope to
 * this account exactly as they would if the user had called them directly.
 *
 * dryRun defaults to true. Automation should have to be asked for.
 */
export const runAgent = async (req, res) => {
    try {
        const dryRun = req.body?.dryRun === undefined ? true : Boolean(req.body.dryRun);
        const { run, result } = await runner.runAgent({
            agentId: req.params.agentId,
            trigger: 'manual',
            triggeredBy: req.user.id,
            delegatedActorId: req.user.id,
            dryRun,
            io: req.io
        });

        res.json({
            agentId: run.agentId,
            dryRun: run.dryRun,
            status: run.status,
            summary: result.summary,
            result,
            // What the action interface actually let through, and what it stopped.
            actions: run.actions,
            run: {
                id: run._id,
                trigger: run.trigger,
                startedAt: run.startedAt,
                completedAt: run.completedAt,
                durationMs: run.durationMs,
                actorType: run.actorType,
                delegatedActorId: run.delegatedActorId
            }
        });
    } catch (e) {
        sendError(res, e);
    }
};

export const listRuns = async (req, res) => {
    try {
        res.json(await runner.listRuns(req.query));
    } catch (e) {
        sendError(res, e);
    }
};
