import User from '../models/User.js';
import Hospital, { FACILITY_LEVELS, FACILITY_CAPABILITIES } from '../models/Hospital.js';
import { badRequest, notFound } from './errors.js';

/**
 * Which hospitals can receive a referral, and who exactly receives it.
 *
 * The source of truth is the hospital account: a User whose role is
 * 'hospital'. That account's facility profile is the Hospital document its
 * `hospitalId` points to — the same link the referral inbox, the facility
 * dashboard and staff attachment all read.
 *
 * The Hospital collection on its own is not a directory of recipients. It
 * also holds seeded facilities, records whose owner account no longer exists,
 * and duplicate profiles an account owns but is not linked to. A referral
 * addressed to any of those is stored successfully and then seen by nobody,
 * because no hospital account's inbox reads that facility. So a facility is a
 * valid destination only when both halves of the link agree:
 *   User.role === 'hospital'  AND  User.hospitalId === Hospital._id  AND  Hospital.ownerId === User._id
 * Nothing here ever matches by name.
 */

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const FACILITY_FIELDS = 'name level capabilities operatingDays address isActive ownerId email';

const NOT_READY = 'That hospital has not finished setting up its facility profile, so it cannot receive referrals yet';

/**
 * Hospital accounts that can currently receive referrals, with only what a
 * referring worker needs to choose between them. No email, phone or owner id.
 */
export async function listReferralDestinations({ capability, level, excludeFacilityId } = {}) {
    const facilityFilter = { isActive: true };

    if (level) {
        if (!FACILITY_LEVELS.includes(level)) {
            throw badRequest(`Unknown level. Expected one of: ${FACILITY_LEVELS.join(', ')}`);
        }
        facilityFilter.level = level;
    }
    if (capability) {
        const wanted = String(capability).split(',').map(c => c.trim()).filter(Boolean);
        const unknown = wanted.filter(c => !FACILITY_CAPABILITIES.includes(c));
        if (unknown.length) throw badRequest(`Unknown capability: ${unknown.join(', ')}`);
        facilityFilter.capabilities = { $all: wanted };
    }

    const accounts = await User.find({ role: 'hospital', hospitalId: { $ne: null } })
        .select('_id hospitalId').lean();
    if (!accounts.length) return [];

    const facilities = await Hospital.find({ _id: { $in: accounts.map(a => a.hospitalId) }, ...facilityFilter })
        .select(FACILITY_FIELDS).lean();
    const byId = new Map(facilities.map(f => [String(f._id), f]));

    return accounts
        .map(account => {
            const facility = byId.get(String(account.hospitalId));
            if (!facility || String(facility.ownerId) !== String(account._id)) return null;
            if (excludeFacilityId && String(facility._id) === String(excludeFacilityId)) return null;
            return {
                hospitalUserId: String(account._id),
                facilityId: String(facility._id),
                name: facility.name,
                level: facility.level,
                capabilities: facility.capabilities || [],
                operatingDays: facility.operatingDays || [],
                address: facility.address || ''
            };
        })
        .filter(Boolean)
        .sort((a, b) => {
            const rank = FACILITY_LEVELS.indexOf(b.level) - FACILITY_LEVELS.indexOf(a.level);
            return rank !== 0 ? rank : a.name.localeCompare(b.name);
        });
}

/**
 * Turns what a client sent into a verified recipient, or refuses.
 *
 * `toHospitalUserId` is the identifier. `toFacilityId` alone is still accepted
 * from app versions cached on phones before this change, but only when a
 * hospital account is linked to that facility — never as a way to reach an
 * unlinked record. If both are sent they must agree. There is no fallback
 * hospital: an unusable destination is an error the worker sees.
 *
 * @returns {Promise<{userId: string, facilityId: string, facility: object}>}
 */
export async function resolveHospitalRecipient({ toHospitalUserId, toFacilityId }) {
    const hasUserId = toHospitalUserId !== undefined && toHospitalUserId !== null && toHospitalUserId !== '';
    const hasFacilityId = toFacilityId !== undefined && toFacilityId !== null && toFacilityId !== '';

    if (hasUserId) {
        if (typeof toHospitalUserId !== 'string' || !OBJECT_ID.test(toHospitalUserId)) {
            throw badRequest('toHospitalUserId must be a valid hospital account id');
        }
        const account = await User.findById(toHospitalUserId).select('role hospitalId').lean();
        if (!account) throw notFound('No hospital account exists with that id');
        if (account.role !== 'hospital') throw badRequest('Referrals can only be sent to a hospital account');
        if (!account.hospitalId) throw badRequest(NOT_READY);

        const facility = await Hospital.findOne({ _id: account.hospitalId, ownerId: account._id })
            .select(FACILITY_FIELDS).lean();
        if (!facility) throw badRequest(NOT_READY);
        if (!facility.isActive) throw badRequest('That hospital is not currently accepting referrals');
        if (hasFacilityId && String(toFacilityId) !== String(facility._id)) {
            throw badRequest('toFacilityId does not belong to the selected hospital');
        }
        return { userId: String(account._id), facilityId: String(facility._id), facility };
    }

    if (!hasFacilityId) throw badRequest('toHospitalUserId is required');
    if (typeof toFacilityId !== 'string' || !OBJECT_ID.test(toFacilityId)) {
        throw badRequest('toFacilityId must be a valid id');
    }

    const facility = await Hospital.findById(toFacilityId).select(FACILITY_FIELDS).lean();
    if (!facility) throw notFound('Destination facility not found');
    const account = facility.ownerId
        ? await User.findOne({ _id: facility.ownerId, role: 'hospital', hospitalId: facility._id }).select('_id').lean()
        : null;
    if (!account) {
        throw badRequest('That facility is not linked to a hospital account, so a referral sent there would reach no one. Choose a hospital from the list.');
    }
    if (!facility.isActive) throw badRequest('That hospital is not currently accepting referrals');
    return { userId: String(account._id), facilityId: String(facility._id), facility };
}
