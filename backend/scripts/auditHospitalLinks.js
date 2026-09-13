/**
 * READ-ONLY audit of hospital accounts, facility records and referral routing.
 *
 *   node scripts/auditHospitalLinks.js
 *
 * Uses MONGO_URI from the environment (or backend/.env). It never writes,
 * updates or deletes anything; it prints what needs a human decision:
 *
 *  - Hospital records no hospital account is linked to (seeded, orphaned or
 *    duplicate profiles). These can no longer receive referrals.
 *  - Hospital accounts with no usable facility profile (cannot receive).
 *  - Accounts that own more than one Hospital record.
 *  - Existing referrals whose destination is an unlinked record — referrals
 *    that were created but never reached any hospital inbox.
 */
import dotenv from 'dotenv';
import mongoose from 'mongoose';

dotenv.config();

const uri = process.env.MONGO_URI;
if (!uri) {
    console.error('MONGO_URI is not set.');
    process.exit(1);
}

await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });
const db = mongoose.connection.db;
const id = v => (v ? String(v) : null);

const [hospitalUsers, facilities, referrals] = await Promise.all([
    db.collection('users').find({ role: 'hospital' }, { projection: { name: 1, email: 1, hospitalId: 1 } }).toArray(),
    db.collection('hospitals').find({}, { projection: { name: 1, email: 1, ownerId: 1, isActive: 1 } }).toArray(),
    db.collection('referrals').find({}, { projection: { referralId: 1, toFacilityId: 1, toHospitalUserId: 1, status: 1, createdAt: 1 } }).toArray()
]);

const facilityById = new Map(facilities.map(f => [id(f._id), f]));
const userById = new Map(hospitalUsers.map(u => [id(u._id), u]));

const isLinked = (f) => {
    const owner = userById.get(id(f.ownerId));
    return Boolean(owner && id(owner.hospitalId) === id(f._id));
};

const unlinkedFacilities = facilities.filter(f => !isLinked(f));
const accountsWithoutFacility = hospitalUsers.filter(u => {
    const f = u.hospitalId && facilityById.get(id(u.hospitalId));
    return !f || id(f.ownerId) !== id(u._id);
});
const ownedCount = new Map();
for (const f of facilities) ownedCount.set(id(f.ownerId), (ownedCount.get(id(f.ownerId)) || 0) + 1);
const multiOwners = hospitalUsers.filter(u => (ownedCount.get(id(u._id)) || 0) > 1);
const unlinkedIds = new Set(unlinkedFacilities.map(f => id(f._id)));
const misrouted = referrals.filter(r => unlinkedIds.has(id(r.toFacilityId)));

const line = (label, rows, fmt) => {
    console.log(`\n${label}: ${rows.length}`);
    rows.slice(0, 200).forEach(r => console.log('  - ' + fmt(r)));
};

console.log(`Hospital accounts: ${hospitalUsers.length} · Hospital records: ${facilities.length} · Referrals: ${referrals.length}`);
line('Hospital records NOT linked to a hospital account (cannot receive referrals)', unlinkedFacilities,
    f => `${f.name} <${f.email}> _id=${id(f._id)} ownerId=${id(f.ownerId)} ownerExists=${userById.has(id(f.ownerId))} active=${f.isActive}`);
line('Hospital accounts with no linked facility profile', accountsWithoutFacility,
    u => `${u.name} <${u.email}> _id=${id(u._id)} hospitalId=${id(u.hospitalId)}`);
line('Hospital accounts owning more than one Hospital record', multiOwners,
    u => `${u.name} <${u.email}> _id=${id(u._id)} owns=${ownedCount.get(id(u._id))} linked=${id(u.hospitalId)}`);
line('Referrals addressed to an unlinked Hospital record (never reached an inbox)', misrouted,
    r => `${r.referralId} status=${r.status} toFacilityId=${id(r.toFacilityId)} (${facilityById.get(id(r.toFacilityId))?.name}) created=${r.createdAt?.toISOString?.()}`);
console.log('\nNothing was changed. Decide per record whether to link, deactivate or remove it.');

await mongoose.disconnect();
