import mongoose from 'mongoose';

/**
 * The record of one agent execution.
 *
 * An automated action that cannot be reconstructed afterwards is an automated
 * action nobody can defend, so every run is written down: which agent, why it
 * ran, whose permissions bounded it, what it looked at, what it decided, and
 * whether anything was actually changed.
 *
 * Deliberately holds no clinical detail. Counts, ids and short summaries are
 * enough to answer "what did the agent do", and an audit log that accumulates
 * copies of patient records is a second, unguarded place for them to leak from.
 */

export const AGENT_TRIGGERS = ['manual', 'scheduled', 'event'];
export const AGENT_RUN_STATUSES = ['running', 'succeeded', 'failed'];

/**
 * One thing the agent did or proposed.
 *
 * `recommended` is what a dry run produces — the action it would have taken.
 * `performed` means a service was actually called. `blocked` means the action
 * interface refused it, and the reason says why; those are the interesting
 * ones, because a blocked action is the safety net doing its job.
 */
const agentActionSchema = new mongoose.Schema({
    action: { type: String, required: true },
    status: {
        type: String,
        enum: ['recommended', 'performed', 'skipped', 'blocked', 'failed'],
        required: true
    },
    // What it acted on, by reference only.
    target: {
        model: { type: String },
        id: { type: mongoose.Schema.Types.ObjectId }
    },
    reason: { type: String, default: '' }
}, { _id: false });

const agentRunSchema = new mongoose.Schema({
    agentId: { type: String, required: true },
    agentName: { type: String, default: '' },

    trigger: { type: String, enum: AGENT_TRIGGERS, required: true },
    /**
     * The human who asked for this run, when there was one. Null for a
     * scheduled run, which is precisely the case where the audit trail is the
     * only evidence anything happened.
     */
    triggeredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

    /**
     * Always 'system_agent'. Stored rather than implied so a query for
     * automated activity does not depend on knowing which ids are agents.
     */
    actorType: { type: String, default: 'system_agent' },

    /**
     * The account whose permissions bounded this run.
     *
     * Agents are not exempt from authorization; they borrow a real principal's
     * reach and can never exceed it. Recording which one makes the blast
     * radius of any run answerable after the fact.
     */
    delegatedActorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

    dryRun: { type: Boolean, default: true },
    status: { type: String, enum: AGENT_RUN_STATUSES, default: 'running' },

    startedAt: { type: Date, default: Date.now },
    completedAt: { type: Date },
    durationMs: { type: Number },

    /** One line a person can read. */
    summary: { type: String, default: '' },
    /** Counts only — what the agent looked at, never what it saw. */
    observed: { type: mongoose.Schema.Types.Mixed, default: {} },

    actions: [agentActionSchema],
    error: { type: String, default: '' }
}, { timestamps: true });

// The two questions asked of an audit log: what has this agent been doing,
// and what ran recently.
agentRunSchema.index({ agentId: 1, startedAt: -1 });
agentRunSchema.index({ startedAt: -1 });

export default mongoose.model('AgentRun', agentRunSchema);
