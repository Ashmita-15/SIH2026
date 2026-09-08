import mongoose from 'mongoose';

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
    symptoms: { type: String }, // Patient's symptoms/reason for visit
    consultationType: { type: String, enum: ['video', 'chat'], default: 'video' },

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

export default mongoose.model('Appointment', appointmentSchema);


