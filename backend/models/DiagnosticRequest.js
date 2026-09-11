import mongoose from 'mongoose';

/**
 * A test a clinician ordered, and whether it actually happened.
 *
 * A referral moves the patient; nothing until now tracked whether the test at
 * the other end was ever done. That gap is the continuity failure the problem
 * statement describes — somebody is told to get an ultrasound and nobody finds
 * out that they didn't.
 *
 * Deliberately small: an order, a lifecycle, and a result. It is not a LIS and
 * it does not model specimens, analysers or reference ranges.
 */

export const DIAGNOSTIC_STATUSES = ['requested', 'scheduled', 'sample_collected', 'completed', 'cancelled'];

/**
 * The only moves allowed. Written as a table rather than checked in the
 * controller so an invalid transition is impossible rather than merely
 * unhandled, and so the whole lifecycle is readable in one place.
 *
 * Terminal states have no exits: a completed test cannot be un-completed, and
 * a cancelled one is re-ordered as a new request rather than revived.
 */
export const ALLOWED_NEXT = {
    requested: ['scheduled', 'cancelled'],
    scheduled: ['sample_collected', 'cancelled'],
    sample_collected: ['completed', 'cancelled'],
    completed: [],
    cancelled: []
};

export const DIAGNOSTIC_PRIORITIES = ['routine', 'urgent'];

const diagnosticSchema = new mongoose.Schema({
    patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

    testName: { type: String, required: true, trim: true },
    reason: { type: String, default: '' },
    priority: { type: String, enum: DIAGNOSTIC_PRIORITIES, default: 'routine' },

    status: { type: String, enum: DIAGNOSTIC_STATUSES, default: 'requested' },

    /**
     * Who ordered it and from where — both derived from the authenticated
     * account, never from the request, exactly as referrals do it.
     */
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    requestedByRole: { type: String, enum: ['doctor', 'health_worker'], required: true },
    facilityId: { type: mongoose.Schema.Types.ObjectId, ref: 'Hospital' },

    /** Set once, on completion. */
    resultSummary: { type: String, default: '' },
    resultNotes: { type: String, default: '' },
    reportUrl: { type: String, default: '' },
    completedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    completedAt: { type: Date, default: null },

    /** Every move, with who made it — the same audit shape referrals keep. */
    statusHistory: [{
        status: { type: String, required: true },
        at: { type: Date, default: Date.now },
        by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        note: { type: String, default: '' }
    }]
}, { timestamps: true });

diagnosticSchema.index({ patientId: 1, createdAt: -1 });
diagnosticSchema.index({ facilityId: 1, status: 1, createdAt: -1 });
diagnosticSchema.index({ requestedBy: 1, status: 1 });

diagnosticSchema.pre('save', function seedHistory(next) {
    if (this.isNew && this.statusHistory.length === 0) {
        this.statusHistory.push({ status: this.status, at: new Date(), by: this.requestedBy });
    }
    next();
});

export default mongoose.model('DiagnosticRequest', diagnosticSchema);
