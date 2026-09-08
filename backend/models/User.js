import mongoose from 'mongoose';

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


