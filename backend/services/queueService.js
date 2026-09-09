import Appointment from '../models/Appointment.js';
import Referral from '../models/Referral.js';
import CarePlan from '../models/CarePlan.js';
import User from '../models/User.js';
import { SLOTS, slotStart } from '../config/slots.js';

/**
 * Who the doctor should see first, decided by rules.
 *
 * Every ordering decision in this file is arithmetic over data a person
 * already entered: the referral priority a health worker chose, the care plan
 * a clinician opened, the patient's recorded age, the moment the request
 * arrived. No model is consulted and none could be — there is nothing here for
 * one to answer. A queue that reordered patients on the strength of how their
 * symptom text sounded would be making a clinical judgement, and this file
 * exists precisely so that never happens.
 *
 * Red flags are not in this file at all. They escalate; they do not queue.
 *
 * Nothing here writes. The queue is a view over appointments that already
 * exist, so it can be recomputed at any time and never disagrees with them.
 */

/** Lower sorts first. Gaps left deliberately so a modifier has room to move. */
export const TIERS = {
    P1_EMERGENCY: 1,
    P2_URGENT_24H: 2,
    P3_URGENT_72H: 3,
    P4_PRIORITY_GROUP: 4,
    P5_ROUTINE: 5
};

export const TIER_LABEL = {
    1: 'emergency_referral',
    2: 'urgent_24h_referral',
    3: 'urgent_72h_referral',
    4: 'priority_care_group',
    5: 'routine'
};

/** The referral priorities that already exist, mapped onto tiers. */
const REFERRAL_TIER = {
    emergency: TIERS.P1_EMERGENCY,
    urgent_24h: TIERS.P2_URGENT_24H,
    urgent_72h: TIERS.P3_URGENT_72H,
    routine_7d: TIERS.P5_ROUTINE,
    routine_30d: TIERS.P5_ROUTINE
};

/** Care plans that mark somebody as belonging to a priority group. */
const MATERNAL_PLANS = ['anc', 'pnc'];
const CHILD_PLANS = ['child_0_5'];
const CHRONIC_PLANS = ['hypertension', 'diabetes'];

const CHILD_AGE_YEARS = 5;

/**
 * The base tier: whatever a human already decided about this patient.
 *
 * `referral.priority` is set by the health worker or doctor who saw them and
 * is authoritative. With no referral, the request is routine — not because it
 * is trivial, but because nobody clinical has said otherwise, and this code is
 * not entitled to guess.
 */
export function tierFor({ referral }) {
    if (!referral) return TIERS.P5_ROUTINE;
    return REFERRAL_TIER[referral.priority] ?? TIERS.P5_ROUTINE;
}

/**
 * Belonging to a priority care group moves somebody up by one place, once.
 *
 * A modifier rather than a tier of its own, for two reasons. Made into a tier,
 * every pregnant patient would outrank every non-pregnant one indefinitely and
 * routine patients would never be seen. And pregnancy is not an emergency —
 * treating it as one would put an expectant mother ahead of a person with an
 * emergency referral, which is exactly backwards.
 *
 * It can never reach P1: an emergency referral is a clinician's judgement and
 * nothing derived gets to equal it.
 */
export function applyVulnerabilityModifier(tier, groups) {
    if (!groups?.length) return tier;
    if (tier <= TIERS.P2_URGENT_24H) return tier; // already at or above urgent
    return Math.max(TIERS.P2_URGENT_24H, tier - 1);
}

/** Which priority groups this patient is in, from structured records only. */
export async function vulnerabilityFor(patientId, patient) {
    const groups = [];
    const age = Number(patient?.age);
    if (Number.isFinite(age) && age > 0 && age <= CHILD_AGE_YEARS) groups.push('child');

    const plans = await CarePlan.find({ patientId, status: 'active' }).select('type').lean();
    const types = plans.map(p => p.type);
    if (types.some(t => MATERNAL_PLANS.includes(t))) groups.push('maternal');
    if (!groups.includes('child') && types.some(t => CHILD_PLANS.includes(t))) groups.push('child');
    if (types.some(t => CHRONIC_PLANS.includes(t))) groups.push('chronic_care');

    return groups;
}

/**
 * The most relevant open referral for this patient at this doctor's facility.
 *
 * Only referrals that are still live count. One that was completed or declined
 * has stopped being a promise, so it stops conferring priority.
 */
const OPEN_REFERRAL_STATUSES = ['created', 'acknowledged', 'scheduled'];

async function referralsByPatient(patientIds) {
    if (!patientIds.length) return new Map();
    const referrals = await Referral.find({
        patientId: { $in: patientIds },
        status: { $in: OPEN_REFERRAL_STATUSES }
    }).select('patientId priority dueBy status').lean();

    const best = new Map();
    for (const r of referrals) {
        const key = String(r.patientId);
        const current = best.get(key);
        const rank = REFERRAL_TIER[r.priority] ?? TIERS.P5_ROUTINE;
        if (!current || rank < current.rank) best.set(key, { ...r, rank });
    }
    return best;
}

/** Slots that have already started are no longer capacity for today. */
function remainingSlots(date) {
    const now = new Date();
    return SLOTS.filter(slot => slotStart(date, slot) > now);
}

/**
 * The day's queue for one doctor.
 *
 * Ordered by tier, then by when the request arrived. FIFO inside a tier is the
 * whole fairness argument: two people with equally urgent referrals are seen in
 * the order they asked, not by anything the system inferred about them.
 *
 * Confirmed appointments keep their place. A confirmed slot is a promise
 * already made to somebody who arranged their day around it, so priority
 * changes the order of what is still *pending*, never what was agreed.
 */
export async function buildQueue({ doctorId, date }) {
    const dayStart = new Date(date);
    dayStart.setUTCHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

    const appointments = await Appointment.find({
        doctorId,
        status: { $in: ['pending', 'confirmed'] },
        $or: [
            { confirmedDate: { $gte: dayStart, $lt: dayEnd } },
            { confirmedDate: null, requestedDate: { $gte: dayStart, $lt: dayEnd } }
        ]
    }).select('patientId status timeSlot requestedDate confirmedDate createdAt').lean();

    const patientIds = [...new Set(appointments.map(a => String(a.patientId)))];
    const [patients, referralMap] = await Promise.all([
        User.find({ _id: { $in: patientIds } }).select('name age').lean(),
        referralsByPatient(patientIds)
    ]);
    const patientMap = new Map(patients.map(p => [String(p._id), p]));

    const rows = [];
    for (const appt of appointments) {
        const key = String(appt.patientId);
        const patient = patientMap.get(key);
        const referral = referralMap.get(key) || null;
        const groups = await vulnerabilityFor(appt.patientId, patient);

        const base = tierFor({ referral });
        const tier = applyVulnerabilityModifier(base, groups);

        rows.push({
            appointmentId: String(appt._id),
            patientId: String(appt.patientId),
            patientName: patient?.name || 'Patient',
            status: appt.status,
            timeSlot: appt.timeSlot || null,
            tier,
            tierLabel: TIER_LABEL[tier],
            baseTier: base,
            priorityGroups: groups,
            referralPriority: referral?.priority || null,
            requestedAt: appt.createdAt
        });
    }

    /**
     * Confirmed first within a tier: they hold a real slot, and a queue that
     * listed a pending request above a booked one would be describing a
     * position the clinic will not honour.
     */
    rows.sort((a, b) =>
        a.tier - b.tier ||
        (a.status === b.status ? 0 : a.status === 'confirmed' ? -1 : 1) ||
        new Date(a.requestedAt) - new Date(b.requestedAt)
    );

    const free = remainingSlots(dayStart);
    return rows.map((row, i) => ({
        ...row,
        position: i + 1,
        ...estimateWait({ index: i, date: dayStart, timeSlot: row.timeSlot })
    })).map(row => ({
        ...row,
        capacity: { total: SLOTS.length, booked: rows.length, remainingToday: Math.max(0, free.length - rows.length) }
    }));
}

/**
 * Roughly when somebody will be seen — and it says roughly, because it is.
 *
 * A confirmed slot has a real start time and is reported as that. Everyone
 * else gets the start of the nth remaining slot, which assumes consultations
 * keep to the hour they are booked for. They will not always, so the caller is
 * told this is approximate and nothing here is phrased as a promise.
 */
export function estimateWait({ index, date, timeSlot }) {
    if (timeSlot) {
        return { aheadOfYou: index, estimatedAt: slotStart(date, timeSlot).toISOString(), approximate: true };
    }
    const free = remainingSlots(date);
    const slot = free[Math.min(index, free.length - 1)];
    return {
        aheadOfYou: index,
        estimatedAt: slot ? slotStart(date, slot).toISOString() : null,
        approximate: true,
        beyondToday: !slot || index >= free.length
    };
}

/**
 * Where else this patient could be seen, when the day they asked for is full.
 *
 * Every option below is read back out of real availability. Nothing is
 * suggested that the availability endpoint has not just reported free, and
 * nothing is booked — these are offers, and the patient chooses. Automatically
 * moving somebody to a different doctor or a different town is not a
 * convenience, it is a decision that belongs to them.
 */
export async function findAlternatives({ doctorId, date, days = 7, limit = 6 }) {
    const doctor = await User.findById(doctorId).select('name specialization hospitalId').lean();
    if (!doctor) return [];

    const out = [];
    const from = new Date(date);
    from.setUTCHours(0, 0, 0, 0);

    const freeOn = async (docId, day) => {
        const dayStart = new Date(day);
        const dayEnd = new Date(dayStart);
        dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);
        const busy = await Appointment.find({
            doctorId: docId,
            status: { $in: ['pending', 'confirmed'] },
            $or: [
                { confirmedDate: { $gte: dayStart, $lt: dayEnd } },
                { confirmedDate: null, requestedDate: { $gte: dayStart, $lt: dayEnd } }
            ]
        }).select('timeSlot').lean();
        const taken = new Set(busy.map(b => b.timeSlot).filter(Boolean));
        return SLOTS.filter(s => !taken.has(s) && slotStart(dayStart, s) > new Date());
    };

    const iso = (d) => d.toISOString().slice(0, 10);

    // 1 & 2 — the doctor they asked for, today then the next few days.
    for (let i = 0; i < days && out.length < limit; i++) {
        const day = new Date(from);
        day.setUTCDate(day.getUTCDate() + i);
        const slots = await freeOn(doctorId, day);
        if (slots.length) {
            out.push({
                kind: i === 0 ? 'same_doctor_today' : 'same_doctor_later_day',
                doctorId: String(doctorId), doctorName: doctor.name,
                specialization: doctor.specialization || null,
                facilityId: doctor.hospitalId ? String(doctor.hospitalId) : null,
                date: iso(day), slots: slots.slice(0, 3)
            });
            break;
        }
    }

    // 3 & 4 — the same speciality elsewhere. Same facility is offered before
    // another one: a different room is a smaller ask than a different town.
    if (doctor.specialization) {
        const peers = await User.find({
            role: 'doctor', _id: { $ne: doctorId }, specialization: doctor.specialization
        }).select('name specialization hospitalId').lean();

        const sameFacility = peers.filter(p => String(p.hospitalId || '') === String(doctor.hospitalId || ''));
        const otherFacility = peers.filter(p => String(p.hospitalId || '') !== String(doctor.hospitalId || ''));

        for (const peer of [...sameFacility, ...otherFacility]) {
            if (out.length >= limit) break;
            const slots = await freeOn(peer._id, from);
            if (!slots.length) continue;
            out.push({
                kind: String(peer.hospitalId || '') === String(doctor.hospitalId || '')
                    ? 'same_specialization_same_facility'
                    : 'same_specialization_other_facility',
                doctorId: String(peer._id), doctorName: peer.name,
                specialization: peer.specialization || null,
                facilityId: peer.hospitalId ? String(peer.hospitalId) : null,
                date: iso(from), slots: slots.slice(0, 3)
            });
        }
    }

    return out.slice(0, limit);
}
