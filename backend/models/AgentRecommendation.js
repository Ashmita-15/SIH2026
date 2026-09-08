import mongoose from 'mongoose';

/**
 * Something an agent thinks somebody should do, waiting for a person to agree.
 *
 * This is the gap between an agent noticing a problem and the system acting on
 * it. Nothing here has happened yet: a recommendation is a proposal, and the
 * only thing that turns one into real work is a human approving it. That gap
 * is the whole safety story of an agent that can create work.
 *
 * Holds references and short reasoning rather than clinical detail. A
 * coordination queue is not a place patient records should accumulate.
 */

export const RECOMMENDATION_STATUSES = ['pending', 'approved', 'rejected', 'executed', 'failed'];

/**
 * The problems this agent can recognise. Named rather than free text so the
 * deduplication key is stable and the queue can be filtered.
 */
export const PROBLEM_TYPES = [
    // Referral coordination (Referral Follow-up Agent)
    'not_acknowledged',   // destination never responded
    'not_scheduled',      // acknowledged, never given an appointment
    'not_attended',       // appointment time passed, nobody marked attendance
    'missed_referral',    // patient did not come

    /**
     * Patient coordination (High-Risk Patient Follow-up Agent).
     *
     * Named for the coordination gap, never for a condition. "A critical
     * danger sign was recorded and nothing followed" is an observation about
     * the system's behaviour; "hypertension" would be a claim about the
     * patient, and this agent is not entitled to make one.
     */
    'critical_sign_no_followup',
    'repeated_warning_signs',
    'care_plan_visit_overdue',
    'high_risk_plan_no_contact'
];

const recommendedActionSchema = new mongoose.Schema({
    // Maps onto the existing Task model; nothing new is invented here.
    taskType: { type: String, required: true },
    title: { type: String, required: true },
    summary: { type: String, default: '' },
    priority: { type: String, enum: ['high', 'medium', 'low'], default: 'medium' },
    dueInDays: { type: Number, default: 2 },

    /**
     * Who the agent thinks should do it, resolved when the recommendation was
     * made rather than when it is approved. A reviewer should be approving a
     * concrete, named action — one that quietly resolved to somebody else
     * between review and execution would not really have been reviewed.
     */
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    ownerName: { type: String, default: '' },
    ownerRole: { type: String, enum: ['health_worker', 'doctor', 'hospital'] },
    ownerFacilityId: { type: mongoose.Schema.Types.ObjectId, ref: 'Hospital' }
}, { _id: false });

const agentRecommendationSchema = new mongoose.Schema({
    agentId: { type: String, required: true },
    agentRunId: { type: mongoose.Schema.Types.ObjectId, ref: 'AgentRun', required: true },

    /**
     * What it is about. References only.
     *
     * The patient is always known; the referral is not. A referral problem
     * names one, a patient-level coordination gap usually has no single
     * referral behind it, and encounterId points at the observation that
     * prompted the finding where there was one.
     */
    patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    referralId: { type: mongoose.Schema.Types.ObjectId, ref: 'Referral' },
    encounterId: { type: mongoose.Schema.Types.ObjectId, ref: 'HealthRecord' },

    /**
     * Which facilities may see this.
     *
     * Denormalised from the referral's two ends so the queue can be scoped in
     * one query instead of joining every row back to its referral. A
     * recommendation is visible to exactly the facilities already entitled to
     * the referral it concerns — it creates no new access.
     */
    scopeFacilityIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Hospital' }],

    problem: { type: String, enum: PROBLEM_TYPES, required: true },
    concern: { type: String, enum: ['high', 'medium', 'low'], default: 'medium' },
    /** Short, factual lines. Never a diagnosis or any treatment advice. */
    reasoning: [{ type: String }],

    recommendedAction: { type: recommendedActionSchema, required: true },

    status: { type: String, enum: RECOMMENDATION_STATUSES, default: 'pending' },

    /**
     * Stops the same unresolved problem being proposed again on every run.
     * Unique among rows that are still open; a rejected or executed one no
     * longer blocks a fresh proposal if the problem genuinely recurs.
     */
    dedupeKey: { type: String, required: true },

    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: { type: Date },
    reviewNote: { type: String, default: '' },

    // Set only once a human has approved and the task service has run.
    createdTaskId: { type: mongoose.Schema.Types.ObjectId, ref: 'Task' },
    error: { type: String, default: '' }
}, { timestamps: true });

// The review queue, scoped to a facility.
agentRecommendationSchema.index({ scopeFacilityIds: 1, status: 1, createdAt: -1 });
// The duplicate check.
agentRecommendationSchema.index({ dedupeKey: 1, status: 1 });
agentRecommendationSchema.index({ agentRunId: 1 });
agentRecommendationSchema.index({ referralId: 1 });

export default mongoose.model('AgentRecommendation', agentRecommendationSchema);
