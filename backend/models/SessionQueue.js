import mongoose from 'mongoose';

/**
 * The finalised order for one session on one day.
 *
 * This exists to make finalisation happen exactly once. The scheduler runs on
 * every server instance and on every tick, a restart can replay a tick that
 * was already half-done, and a queue computed twice would email every patient
 * a second position. The unique key below turns "has this already run?" from a
 * question the code has to remember into one the database answers: the second
 * insert loses with a duplicate-key error and simply stops.
 *
 * It is also the snapshot. Once written, positions are read from here rather
 * than recomputed, so a cancellation after the cutoff cannot quietly move
 * somebody who has already been told to arrive at 2:40.
 */

const entrySchema = new mongoose.Schema({
    appointmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Appointment', required: true },
    patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    position: { type: Number, required: true },
    estimatedArrivalTime: { type: Date, required: true },
    /** Kept for the doctor's view and for audit; never sent to a patient. */
    tier: { type: Number, required: true },
    priorityGroups: [{ type: String }],
    referralPriority: { type: String, default: null },
    requestedAt: { type: Date }
}, { _id: false });

const sessionQueueSchema = new mongoose.Schema({
    doctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    facilityId: { type: mongoose.Schema.Types.ObjectId, ref: 'Hospital' },

    sessionId: { type: mongoose.Schema.Types.ObjectId, required: true },
    sessionName: { type: String },
    /** "YYYY-MM-DD" — the day the session ran. */
    date: { type: String, required: true },
    /** `${sessionId}:${date}` — see the unique index below. */
    sessionKey: { type: String, required: true },

    startsAt: { type: Date, required: true },
    endsAt: { type: Date, required: true },
    cutoffAt: { type: Date, required: true },

    entries: { type: [entrySchema], default: [] },
    totalPatients: { type: Number, default: 0 },

    finalizedAt: { type: Date, default: Date.now },

    /**
     * Notifications are tracked separately from finalisation so a mail server
     * being down for one tick does not mean the queue is computed again — the
     * order stands, and only the sending is retried.
     */
    patientsNotifiedAt: { type: Date, default: null },
    doctorNotifiedAt: { type: Date, default: null },
    notifyAttempts: { type: Number, default: 0 }
}, { timestamps: true });

/** The whole idempotency guarantee, in one line. */
sessionQueueSchema.index({ sessionKey: 1 }, { unique: true });
sessionQueueSchema.index({ doctorId: 1, date: 1 });
sessionQueueSchema.index({ patientsNotifiedAt: 1, doctorNotifiedAt: 1 });

export default mongoose.model('SessionQueue', sessionQueueSchema);
