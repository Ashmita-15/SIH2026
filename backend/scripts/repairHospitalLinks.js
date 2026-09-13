/**
 * Gives every hospital account the facility record it should always have had.
 *
 *   node scripts/repairHospitalLinks.js          # report only
 *   node scripts/repairHospitalLinks.js --apply  # create the missing records
 *
 * Hospital sign-up used to create only the `users` row. `User.hospitalId` was
 * never set and no `hospitals` document was ever made, so `resolveFacilityActor`
 * refused every request with "Your account is not attached to a facility" — the
 * dashboard, the referral inbox and the SOS search were all unreachable for
 * accounts created that way. Sign-up creates both now; this repairs the ones
 * made before it did.
 *
 * Nothing is invented. The facility is built from what the account already
 * holds, and an account with no address or coordinates yields a record marked
 * `isActive: false` — it exists so its owner can sign in and finish it, but it
 * is not routable until somebody supplies a real location.
 *
 * Safe to re-run: accounts that already have a facility are left alone.
 */
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import User from '../models/User.js';
import Hospital from '../models/Hospital.js';

dotenv.config();

const apply = process.argv.includes('--apply');
const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
if (!uri) {
    console.error('MONGO_URI is not set.');
    process.exit(1);
}

await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });

const accounts = await User.find({ role: 'hospital' }).select(
    'name email phone hospitalId facilityAddress facilityLocation'
).lean();

let repaired = 0;
let adopted = 0;
let incomplete = 0;
let alreadyFine = 0;

for (const user of accounts) {
    if (user.hospitalId && await Hospital.exists({ _id: user.hospitalId })) {
        alreadyFine++;
        continue;
    }

    /**
     * A facility record may already exist under the same email — seeded, or
     * left behind by a half-finished sign-up. Adopting it is right and
     * creating a second one is not: `email` is unique on the collection, so a
     * blind create would fail, and two records for one hospital would split
     * its referrals across an inbox nobody reads.
     */
    const existing = await Hospital.findOne({
        $or: [{ ownerId: user._id }, { email: user.email }]
    }).select('_id name');

    if (existing) {
        console.log(`ADOPT    ${user.email} -> existing facility "${existing.name}"`);
        if (apply) {
            await User.updateOne({ _id: user._id }, { hospitalId: existing._id });
            if (!(await Hospital.exists({ _id: existing._id, ownerId: user._id }))) {
                await Hospital.updateOne({ _id: existing._id }, { ownerId: user._id });
            }
        }
        adopted++;
        continue;
    }

    const hasLocation = Array.isArray(user.facilityLocation?.coordinates)
        && user.facilityLocation.coordinates.length === 2;
    const routable = Boolean(hasLocation && user.facilityAddress);
    if (!routable) incomplete++;

    console.log(
        `${routable ? 'CREATE  ' : 'CREATE* '}${user.email} -> "${user.name}"` +
        (routable ? '' : '  (no location yet — created inactive, owner must complete it)')
    );

    if (apply) {
        const doc = await Hospital.create({
            name: user.name,
            email: user.email,
            ...(user.phone ? { phone: user.phone } : {}),
            ...(user.facilityAddress ? { address: user.facilityAddress } : {}),
            ...(hasLocation ? { location: user.facilityLocation } : {}),
            ownerId: user._id,
            // Not routable until it can be found. SOS and referrals read this.
            isActive: routable
        });
        await User.updateOne({ _id: user._id }, { hospitalId: doc._id });
    }
    repaired++;
}

console.log(
    `\n${accounts.length} hospital accounts: ${alreadyFine} already linked, ` +
    `${adopted} adopted an existing facility, ${repaired} needed a new one ` +
    `(${incomplete} of those incomplete).`
);
if (!apply && (repaired || adopted)) console.log('Nothing was written. Re-run with --apply.');

await mongoose.disconnect();
