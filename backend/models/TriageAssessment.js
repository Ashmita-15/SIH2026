import mongoose from 'mongoose';
import { CARE_LEVELS } from '../assistant/triage.js';
import { REFERRAL_PRIORITIES } from './Referral.js';

/**
 * What a patient said about themselves, and how the rule table graded it.
 *
 * Deliberately *not* a HealthRecord. A health record is something a clinician
 * wrote down; this is a patient describing symptoms to an assistant. Keeping
 * the two apart means a self-report can never be mistaken for a finding in the
 * timeline, while still being visible to the worker who needs it.
 *
 * Nothing acts on this on its own. It exists so that when a clinician later
 * refers the same patient, the urgency the patient already described is on
 * screen instead of being asked for a second time — and the clinician still
 * decides.
 */
const triageAssessmentSchema = new mongoose.Schema({
    patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    level: { type: String, enum: CARE_LEVELS, required: true },

    /**
     * Stored rather than recomputed on read, so a referral raised today can be
     * read back exactly as it was graded — a later change to the mapping must
     * not silently rewrite what a patient was told.
     *
     * Null for NEEDS_ASSESSMENT: "we could not grade this" is not a priority.
     */
    referralPriority: { type: String, enum: [...REFERRAL_PRIORITIES, null], default: null },

    symptoms: [{ type: String }],
    reasons: [{ type: String }],
    durationDays: { type: Number, default: null },
    pregnant: { type: Boolean, default: false },

    /** Only one source today. Named anyway, so a clinician-entered one later is distinguishable. */
    source: { type: String, enum: ['self_reported'], default: 'self_reported' }
}, { timestamps: true });

/** The only query this collection serves: the latest for one patient. */
triageAssessmentSchema.index({ patientId: 1, createdAt: -1 });

export default mongoose.model('TriageAssessment', triageAssessmentSchema);
