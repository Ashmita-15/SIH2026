import mongoose from 'mongoose';

/**
 * The ongoing follow-up a patient needs.
 *
 * This is the episode: "this pregnancy", "this person's diabetes". It answers
 * one question — what should happen next, and by when — and it answers it
 * whether or not anybody opens the app, which is the whole point. Rural care
 * does not fail because nobody knew what to do; it fails because the third
 * antenatal visit was nobody's job on any particular day.
 *
 * Deliberately small. The schedules below are coordination timetables, not
 * clinical guidelines, and they exist to put a date on a worklist.
 */

export const CARE_PLAN_TYPES = ['anc', 'pnc', 'child_0_5', 'hypertension', 'diabetes'];

/**
 * When each plan's follow-ups fall due, as days from the day it started.
 *
 * Offsets rather than real gestational or immunisation calendars: the exact
 * dates belong to a protocol engine this prototype is not, and a wrong date on
 * a worklist is more honest as an obviously simple one than as a precise
 * number nobody checked.
 */
export const PLAN_SCHEDULES = {
    anc: [
        { label: 'Antenatal visit 1', offsetDays: 0 },
        { label: 'Antenatal visit 2', offsetDays: 30 },
        { label: 'Antenatal visit 3', offsetDays: 60 },
        { label: 'Antenatal visit 4', offsetDays: 90 }
    ],
    pnc: [
        { label: 'Postnatal check — day 3', offsetDays: 3 },
        { label: 'Postnatal check — day 7', offsetDays: 7 },
        { label: 'Postnatal check — day 42', offsetDays: 42 }
    ],
    child_0_5: [
        { label: 'Growth and immunisation check', offsetDays: 30 },
        { label: 'Growth and immunisation check', offsetDays: 90 },
        { label: 'Growth and immunisation check', offsetDays: 180 }
    ],
    hypertension: [
        { label: 'Blood pressure check', offsetDays: 30 },
        { label: 'Blood pressure check', offsetDays: 60 },
        { label: 'Review consultation', offsetDays: 90 }
    ],
    diabetes: [
        { label: 'Blood sugar check', offsetDays: 30 },
        { label: 'Blood sugar check', offsetDays: 60 },
        { label: 'Review consultation', offsetDays: 90 }
    ]
};

const carePlanSchema = new mongoose.Schema({
    patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: CARE_PLAN_TYPES, required: true },
    status: { type: String, enum: ['active', 'completed', 'defaulted'], default: 'active' },

    /**
     * Risk is decided by rules over recorded observations, never by a model.
     * The flags are kept alongside the level so that "high risk" can always be
     * answered with the reading that made it so.
     */
    riskLevel: { type: String, enum: ['normal', 'high'], default: 'normal' },
    riskFlags: [{ type: String }],

    startedAt: { type: Date, default: Date.now },
    expectedEndAt: { type: Date },

    assignedWorkerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    facilityId: { type: mongoose.Schema.Types.ObjectId, ref: 'Hospital' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

    notes: { type: String, default: '' }
}, { timestamps: true });

// One active plan of a given type per patient — two open pregnancies is a bug.
carePlanSchema.index({ patientId: 1, type: 1, status: 1 });
carePlanSchema.index({ assignedWorkerId: 1, status: 1 });
carePlanSchema.index({ riskLevel: 1, status: 1 });

export default mongoose.model('CarePlan', carePlanSchema);
