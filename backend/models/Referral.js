import mongoose from 'mongoose';

/**
 * A clinical hand-off from one facility to another.
 *
 * A referral is not a message. It is an obligation: it has a destination, a
 * deadline derived from how urgent it is, a status that can fail, and a trail
 * of who moved it and when. The states that matter most are the ones where it
 * goes wrong — missed, declined, lapsed — because that is where a patient is
 * actually lost, and a system that only models the happy path cannot see it.
 */

/**
 * How long the destination has, in hours, before the referral is overdue.
 * Deterministic and derived once at creation. Rescheduling does not move it:
 * the clock measures the promise made to the patient, not the facility's
 * convenience.
 */
export const PRIORITY_SLA_HOURS = {
    emergency: 2,
    urgent_24h: 24,
    urgent_72h: 72,
    routine_7d: 24 * 7,
    routine_30d: 24 * 30
};

export const REFERRAL_PRIORITIES = Object.keys(PRIORITY_SLA_HOURS);

export const REFERRAL_STATUSES = [
    'created', 'acknowledged', 'scheduled', 'attended', 'completed',
    'missed', 'redirected', 'declined', 'lapsed'
];

/**
 * Why a patient did not attend.
 *
 * Recording this is the point of tracking a missed referral at all. One
 * patient who did not go is a personal problem; forty who did not go because
 * of transport is a block-level finding somebody can act on.
 */
export const MISSED_REASONS = [
    'no_transport', 'no_money', 'family_refused', 'felt_better', 'went_elsewhere', 'other'
];

export const TRANSPORT_NEEDS = ['own', 'ambulance', 'escort'];

/**
 * What the destination sends back when the referral is done.
 *
 * Without this the loop never closes: the facility that referred the patient
 * never learns what happened, which is exactly the break in continuity this
 * whole system exists to fix.
 */
const counterReferralSchema = new mongoose.Schema({
    summary: { type: String, required: true },
    medications: { type: String, default: '' },
    followUpInstructions: { type: String, default: '' },
    issuedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    issuedAt: { type: Date, default: Date.now }
}, { _id: false });

const referralSchema = new mongoose.Schema({
    // Short human-readable code, following the same convention as Order.orderId.
    // A patient carrying a paper slip to a district hospital needs something
    // they can read out; an ObjectId is not that.
    referralId: { type: String, unique: true },

    patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    fromFacilityId: { type: mongoose.Schema.Types.ObjectId, ref: 'Hospital', required: true },
    toFacilityId: { type: mongoose.Schema.Types.ObjectId, ref: 'Hospital', required: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    // The encounter this decision came out of. Optional: an emergency referral
    // can be raised before anyone has had time to write the visit up.
    encounterId: { type: mongoose.Schema.Types.ObjectId, ref: 'HealthRecord' },

    priority: { type: String, enum: REFERRAL_PRIORITIES, required: true },
    reason: { type: String, required: true },
    // Snapshot, not a live join: what the referring clinician knew and chose to
    // send. It must still read correctly years later even if the record moves on.
    clinicalSummary: { type: String, default: '' },
    requiredTests: [{ type: String }],
    transportNeed: { type: String, enum: TRANSPORT_NEEDS, default: 'own' },

    status: { type: String, enum: REFERRAL_STATUSES, default: 'created' },
    dueBy: { type: Date, required: true },

    acknowledgedAt: { type: Date },
    scheduledFor: { type: Date },
    attendedAt: { type: Date },
    completedAt: { type: Date },
    missedReason: { type: String, enum: MISSED_REASONS },

    counterReferral: { type: counterReferralSchema, default: undefined },

    statusHistory: [{
        status: { type: String, required: true },
        timestamp: { type: Date, default: Date.now },
        // Who moved it. An order status can be anonymous; a clinical hand-off
        // cannot.
        by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        note: { type: String, default: '' }
    }]
}, { timestamps: true });

// The three lists the app will actually ask for: this patient's referrals,
// what my facility sent, and what my facility has been sent.
referralSchema.index({ patientId: 1, createdAt: -1 });
referralSchema.index({ fromFacilityId: 1, status: 1, createdAt: -1 });
referralSchema.index({ toFacilityId: 1, status: 1, createdAt: -1 });
// Finding what is overdue, which is what the Step 3 agent will sweep for.
referralSchema.index({ status: 1, dueBy: 1 });

// Same generation pattern as Order.orderId.
referralSchema.pre('save', function (next) {
    if (!this.referralId || this.referralId === '') {
        const timestamp = Date.now().toString(36);
        const random = Math.random().toString(36).substr(2, 5);
        this.referralId = `REF-${timestamp}-${random}`.toUpperCase();
    }

    if (this.statusHistory.length === 0) {
        this.statusHistory.push({
            status: this.status || 'created',
            timestamp: new Date(),
            by: this.createdBy,
            note: 'Referral created'
        });
    }

    next();
});

export default mongoose.model('Referral', referralSchema);
