import mongoose from 'mongoose';

/**
 * The public-health tiers a patient actually moves between, lowest first.
 * Order matters: a referral goes *up* this list, so index position is the
 * rank. Kept as an exported constant so the ordering lives in one place.
 */
export const FACILITY_LEVELS = ['sub_centre', 'phc', 'chc', 'district_hospital'];

/**
 * A controlled vocabulary for what a facility can actually do.
 *
 * This is deliberately not the existing `services` array. That one holds
 * human-facing text a hospital typed about itself ("Obstetrics & Gynecology")
 * and is rendered on the profile page. Matching a referral against free text
 * is guesswork, so capability slugs exist alongside it for the machine.
 */
export const FACILITY_CAPABILITIES = [
    'general_opd', 'teleconsultation', 'anc', 'immunization', 'essential_drugs',
    'lab_basic', 'lab_advanced', 'xray', 'ultrasound',
    'obstetrics', 'pediatrics', 'surgery', 'inpatient',
    'emergency_24x7', 'ambulance', 'blood_bank'
];

const hospitalSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    /**
     * Not required. A facility that signs itself up has a name and an email
     * before it has anything else, and refusing to create its record until it
     * has a phone number is what left self-registered hospitals with no
     * facility at all — and therefore no dashboard, no inbox and no referrals.
     * `isActive` is what gates routing; missing contact details make a record
     * incomplete, not invalid.
     */
    phone: { type: String },
    location: {
        type: {
            type: String,
            enum: ['Point'],
            default: 'Point'
        },
        coordinates: {
            // Same reasoning as `phone`: a record without coordinates cannot be
            // routed to, which `isActive` expresses, but it must still exist so
            // its owner can sign in and complete it.
            type: [Number], // [longitude, latitude]
            default: undefined
        }
    },
    address: { type: String },
    description: { type: String, default: '' },
    image: { type: String, default: '' },
    isActive: { type: Boolean, default: true },
    contactPerson: { type: String },
    website: { type: String },
    services: [{ type: String }],
    /**
     * Where this facility sits in the public-health chain. Records that
     * pre-date this field were all hospitals, so that default is correct
     * for them; the seed sets every level explicitly.
     */
    level: { type: String, enum: FACILITY_LEVELS, default: 'district_hospital' },
    /** Machine-matchable capabilities. See FACILITY_CAPABILITIES above. */
    capabilities: [{ type: String, enum: FACILITY_CAPABILITIES }],
    /** The facility this one refers upward to. Null at the top of the tree. */
    parentFacilityId: { type: mongoose.Schema.Types.ObjectId, ref: 'Hospital', default: null },
    /**
     * Which days this facility actually runs. A PHC with a doctor on Tuesdays
     * only is the normal case, and sending someone there on a Thursday is the
     * wasted trip this whole system exists to prevent.
     */
    operatingDays: [{ type: String, enum: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] }],
    // Reference to the owner user account
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    // References to associated doctors and pharmacies
    doctors: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    pharmacies: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Pharmacy' }]
}, { timestamps: true });

// Create a geospatial index
hospitalSchema.index({ location: '2dsphere' });
// The two lookups the referral destination picker will make.
hospitalSchema.index({ level: 1, isActive: 1 });
hospitalSchema.index({ capabilities: 1 });

// Methods

export default mongoose.model('Hospital', hospitalSchema);