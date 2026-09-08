import mongoose from 'mongoose';

/**
 * A piece of work somebody has to do for a patient.
 *
 * One model for every kind of follow-up work rather than one per feature: a
 * referral that needs chasing, an antenatal visit that has come due and a
 * missed appointment are the same thing from the worker's side — something on
 * a list, with a person attached and a date it should have happened by. The
 * worklist is then one query instead of three, and the next thing added to the
 * system joins it for free.
 */

export const TASK_TYPES = [
    'follow_up_visit',      // a care plan says this person is due
    'referral_acknowledge', // a destination facility has been sent someone
    'referral_chase',       // the patient did not go, or nobody responded
    'vitals_check',         // measure something specific again
    'appointment_reminder',
    'review_counter_referral'
];

export const TASK_STATUSES = ['open', 'in_progress', 'done', 'cancelled'];
export const TASK_PRIORITIES = ['high', 'medium', 'low'];

const taskSchema = new mongoose.Schema({
    patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

    /**
     * A task can be aimed at one person or at whoever is on duty.
     *
     * A visit belongs to the ASHA who knows the family, so it names them. A
     * referral waiting to be acknowledged belongs to a facility rather than to
     * any individual there, so it names a role and a facility instead — and
     * still gets done when that person is away.
     */
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    assignedRole: { type: String, enum: ['health_worker', 'doctor', 'hospital'] },
    facilityId: { type: mongoose.Schema.Types.ObjectId, ref: 'Hospital' },

    type: { type: String, enum: TASK_TYPES, required: true },
    title: { type: String, required: true },
    description: { type: String, default: '' },

    dueAt: { type: Date, required: true },
    priority: { type: String, enum: TASK_PRIORITIES, default: 'medium' },
    status: { type: String, enum: TASK_STATUSES, default: 'open' },

    /**
     * Where this came from. 'protocol' means a care plan put it here, so it
     * exists whether or not anyone opened the app; 'clinician' means a person
     * asked for it. 'agent' is unused for now and is the seam the follow-up
     * agent will write through later.
     */
    source: { type: String, enum: ['protocol', 'clinician', 'system', 'agent'], default: 'system' },
    sourceRef: {
        model: { type: String, enum: ['Referral', 'CarePlan', 'Appointment', 'HealthRecord'] },
        id: { type: mongoose.Schema.Types.ObjectId }
    },

    /**
     * Names the job so it cannot be raised twice while still open.
     *
     * Set only where repetition is possible and wrong — a referral can be
     * marked missed more than once, and four identical chase tasks is a list
     * people stop reading. Left unset where several tasks legitimately share a
     * source: the four visits in an antenatal plan are one plan but four
     * different jobs on four different dates.
     */
    dedupeKey: { type: String },

    /**
     * The agent proposal this task came from, when one did.
     *
     * `source: 'agent'` already says an agent suggested it; this says which
     * proposal, which run, and — through the recommendation — who approved it.
     * Without it a task created this way could be traced to "an agent" but not
     * to the person who agreed to it.
     */
    recommendationId: { type: mongoose.Schema.Types.ObjectId, ref: 'AgentRecommendation' },

    completionNote: { type: String, default: '' },
    completedAt: { type: Date },
    completedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    // The visit that closed this task, when closing it meant seeing someone.
    completedEncounterId: { type: mongoose.Schema.Types.ObjectId, ref: 'HealthRecord' }
}, { timestamps: true });

// The worklist: my open tasks, soonest first.
taskSchema.index({ assignedTo: 1, status: 1, dueAt: 1 });
taskSchema.index({ facilityId: 1, assignedRole: 1, status: 1, dueAt: 1 });
taskSchema.index({ patientId: 1, createdAt: -1 });
// Used to avoid raising a second identical task while one is still open.
taskSchema.index({ dedupeKey: 1, status: 1 });
taskSchema.index({ 'sourceRef.id': 1, status: 1 });

export default mongoose.model('Task', taskSchema);
