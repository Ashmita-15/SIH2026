import mongoose from 'mongoose';

/**
 * A doctor's consulting session — "Afternoon OPD, Mon–Fri, 2–5, 20 patients".
 *
 * Additive: `availability` above is free text a doctor typed about themselves
 * and is still shown as-is. This is the machine-readable version, and only
 * doctors who have configured one get session booking; everyone else keeps the
 * hourly slots exactly as before.
 */
const doctorSessionSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true },
    /** 0 = Sunday, matching Date#getUTCDay. */
    days: [{ type: Number, min: 0, max: 6 }],
    startTime: { type: String, required: true },   // "14:00"
    endTime: { type: String, required: true },     // "17:00"
    maxPatients: { type: Number, required: true, min: 1, max: 200 },
    active: { type: Boolean, default: true }
}, { _id: true });

const userSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    passwordHash: { type: String, required: true },
    /**
     * ASHA, ANM and CHO share one role rather than getting three of their own.
     * They differ in what they are trained to do, not in what the server must
     * authorise, so a single role keeps every authorizeRoles() call to one
     * string and gives them one dashboard instead of three near-identical ones.
     * The distinction that matters is kept in workerType below.
     */
    role: { type: String, enum: ['patient', 'doctor', 'pharmacy', 'hospital', 'health_worker'], required: true },
    workerType: { type: String, enum: ['asha', 'anm', 'cho'] },
    age: { type: Number },
    gender: { type: String, enum: ['female', 'male', 'other'] },
    village: { type: String },
    specialization: { type: String },
    qualification: { type: String },
    availability: { type: String },
    /** Configured consulting sessions. Empty for every non-doctor account. */
    sessions: { type: [doctorSessionSchema], default: [] },
    profilePicture: { type: String, default: '' },
    bio: { type: String, default: '' },
    phone: { type: String },
    /**
     * Which facility this account belongs to. Already used for doctors, and it
     * means the same thing for a health worker — the sub-centre or PHC they
     * report to — so there is no separate facilityId.
     */
    hospitalId: { type: mongoose.Schema.Types.ObjectId, ref: 'Hospital' },
    /**
     * The villages a health worker covers. This is what scopes their patient
     * list, and later what decides how much data their phone needs offline.
     */
    catchmentVillages: [{ type: String }],
    /** ABDM health account, when the person has one. Stored, never invented. */
    abhaAddress: { type: String, default: '' }
}, { timestamps: true });

export default mongoose.model('User', userSchema);


