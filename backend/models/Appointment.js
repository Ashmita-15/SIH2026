import mongoose from 'mongoose';

/** The ways a consultation can happen. `offline` is an in-person visit. */
export const CONSULTATION_TYPES = ['video', 'chat', 'offline'];

const appointmentSchema = new mongoose.Schema({
    patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    doctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    requestedDate: { type: Date, required: true }, // Date requested by patient
    confirmedDate: { type: Date }, // Date confirmed by doctor (can be same as requested)
    timeSlot: { type: String }, // Time slot assigned by doctor (e.g., "09:00-10:00")
    status: { 
        type: String, 
        enum: ['pending', 'confirmed', 'rejected', 'completed', 'cancelled'], 
        default: 'pending' 
    },
    /**
     * Session booking. A patient books a session, not an hour, and the queue
     * position below is filled in once at the cutoff — never at booking time,
     * so nobody's place depends on how fast they tapped.
     *
     * All optional: appointments booked against the hourly slot grid, and
     * every appointment that already exists, carry none of this and still read
     * and render exactly as before.
     */
    sessionId: { type: mongoose.Schema.Types.ObjectId, default: null },
    sessionName: { type: String, default: null },
    queuePosition: { type: Number, default: null },
    estimatedArrivalTime: { type: Date, default: null },
    queueFinalizedAt: { type: Date, default: null },
    /** 1..maxPatients. Only a capacity guard — it is NOT the queue position. */
    seatNo: { type: Number, default: null },

    symptoms: { type: String }, // Patient's symptoms/reason for visit
    /**
     * `offline` is an in-person visit to the clinic. It books, queues, gets an
     * ETA and completes exactly like the other two — the only difference is
     * that there is no call to join, which is enforced in the UI rather than
     * here so the lifecycle stays identical.
     */
    consultationType: { type: String, enum: CONSULTATION_TYPES, default: 'video' },

    /**
     * Assisted consultation: a health worker sitting with the patient,
     * presenting a case they have already examined.
     *
     * These three fields are what separate it from a patient dialling a doctor
     * alone. The encounter is referenced, never copied — the vitals and danger
     * signs stay the health worker's record, and the doctor reads them as
     * frontline observations rather than as something they wrote.
     */
    encounterId: { type: mongoose.Schema.Types.ObjectId, ref: 'HealthRecord' },
    assistedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    assistedFacilityId: { type: mongoose.Schema.Types.ObjectId, ref: 'Hospital' },

    doctorNotes: { type: String }, // Doctor's notes after confirmation/consultation
    patientNotes: { type: String }, // Patient's notes
    rejectionReason: { type: String }, // Reason if doctor rejects the appointment
    // Media attachments from patient
    attachments: [{
        type: { type: String, enum: ['video', 'audio'], required: true },
        fileName: { type: String, required: true }, // Original filename
        filename: { type: String, required: true }, // Server-generated filename
        filePath: { type: String, required: true },
        fileSize: { type: Number, required: true },
        mimeType: { type: String, required: true },
        uploadedAt: { type: Date, default: Date.now }
    }]
}, { timestamps: true });

/**
 * Session capacity, enforced by the database rather than by a count-then-insert.
 *
 * A session holds N patients and the check for "is it full?" cannot be made
 * safe in application code — two requests can both read N-1 before either
 * writes. Giving every booking a distinct (session, day, seat) key means the
 * database refuses the surplus, exactly as the slot index already does for the
 * hourly grid.
 */
appointmentSchema.index(
    { doctorId: 1, sessionId: 1, requestedDate: 1, seatNo: 1 },
    {
        name: 'session_seat_unique',
        unique: true,
        partialFilterExpression: {
            status: { $in: ['pending', 'confirmed'] },
            sessionId: { $type: 'objectId' },
            seatNo: { $type: 'number' }
        }
    }
);

/**
 * One doctor, one hour, one patient.
 *
 * The availability endpoint has always treated a pending request as holding
 * the slot — offering it to somebody else only creates a clash the doctor has
 * to untangle by hand. Until now nothing enforced that on the way in, so the
 * read side promised an exclusivity the write side never kept, and two
 * simultaneous requests both won.
 *
 * The constraint lives in the database rather than in a check before the
 * insert, because a check-then-insert cannot be made safe: two requests can
 * both read "free" before either writes. The controller still looks first, but
 * only so the answer is a friendly 409 instead of a duplicate-key error.
 *
 * The filter mirrors the lifecycle exactly:
 *   pending, confirmed  → hold the slot
 *   rejected, cancelled, completed → release it, so the hour can be booked again
 *
 * `$type: 'string'` with `$gt: ''` keeps the twenty existing slotless
 * appointments out of it. They predate slot picking, `timeSlot` is still
 * optional, and without this every one of them would collide with the others
 * on a null key.
 */
appointmentSchema.index(
    { doctorId: 1, requestedDate: 1, timeSlot: 1 },
    {
        name: 'active_slot_unique',
        unique: true,
        partialFilterExpression: {
            status: { $in: ['pending', 'confirmed'] },
            timeSlot: { $type: 'string', $gt: '' }
        }
    }
);

export default mongoose.model('Appointment', appointmentSchema);


