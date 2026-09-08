import bcrypt from 'bcryptjs';
import User from '../models/User.js';
import Hospital from '../models/Hospital.js';
import HealthRecord from '../models/HealthRecord.js';
import Appointment from '../models/Appointment.js';
import { isValidSlot } from '../config/slots.js';
import { detectDangerSigns, dangerSummary } from './dangerSigns.js';
import { createCarePlan, listCarePlansForPatient, refreshRiskForPatient } from './carePlanService.js';
import { badRequest, forbidden, notFound, conflict } from './errors.js';

/**
 * What a frontline health worker is allowed to reach.
 *
 * An ASHA covers a handful of villages, not a district. That boundary is the
 * whole of this file: it decides which patients they can see, which they can
 * open, and where they may register someone new. It is enforced here rather
 * than in the interface, because a hidden row is not an access control — the
 * id is still in the URL.
 *
 * Same context convention as referralService: { actorId }, never a request.
 */

const PATIENT_FIELDS = 'name age gender village phone abhaAddress createdAt';

/** Villages are typed by people. "Rampur Khurd" and "rampur khurd" are one place. */
const normalise = (v) => String(v || '').trim().toLowerCase();

const escapeRegex = (v) => String(v).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Loads the acting worker and their catchment.
 *
 * Read from the database every time. The token says who someone is; it does
 * not get to say where they work.
 */
export async function resolveWorker(ctx) {
    if (!ctx?.actorId) throw forbidden('No acting user supplied');
    const user = await User.findById(ctx.actorId).select('name role workerType hospitalId catchmentVillages');
    if (!user) throw forbidden('Acting user not found');
    if (user.role !== 'health_worker') throw forbidden('This area is for health workers');
    return user;
}

/**
 * The worker's own spelling of a village they cover, or null if they do not.
 *
 * Returning the canonical name rather than a boolean matters on the way in:
 * "rampur khurd" typed by hand and "Rampur Khurd" on the catchment list are
 * one village, and storing the typed version would leave the record looking
 * like it belongs somewhere slightly different from everyone else's.
 */
export function canonicalVillage(worker, village) {
    const wanted = normalise(village);
    if (!wanted) return null;
    return (worker.catchmentVillages || []).find(v => normalise(v) === wanted) || null;
}

/** True when this patient lives in a village the worker covers. */
export function coversVillage(worker, village) {
    return canonicalVillage(worker, village) !== null;
}

/** The village filter, case-insensitively, for use inside a query. */
function catchmentFilter(worker) {
    const villages = worker.catchmentVillages || [];
    // No catchment means no patients — never "all patients".
    if (!villages.length) return null;
    return { $in: villages.map(v => new RegExp(`^${escapeRegex(String(v).trim())}$`, 'i')) };
}

/** Who the worker is, plus the facility and villages they answer for. */
export async function getWorkerProfile(ctx) {
    const worker = await resolveWorker(ctx);
    const facility = worker.hospitalId
        ? await Hospital.findById(worker.hospitalId).select('name level address phone capabilities parentFacilityId')
        : null;

    return {
        id: worker._id,
        name: worker.name,
        role: worker.role,
        workerType: worker.workerType || null,
        facility,
        catchmentVillages: worker.catchmentVillages || [],
        patientCount: await countPatients(worker)
    };
}

async function countPatients(worker) {
    const village = catchmentFilter(worker);
    if (!village) return 0;
    return User.countDocuments({ role: 'patient', village });
}

/**
 * The worker's patients, optionally narrowed by a search term.
 *
 * The catchment filter is applied first and the search second, so a search can
 * only ever narrow the set — it can never reach outside it.
 */
export async function listPatients(filters = {}, ctx) {
    const worker = await resolveWorker(ctx);
    const village = catchmentFilter(worker);
    if (!village) return [];

    const query = { role: 'patient', village };

    if (filters.search) {
        const term = escapeRegex(String(filters.search).trim());
        if (term) {
            query.$or = [
                { name: { $regex: term, $options: 'i' } },
                { phone: { $regex: term, $options: 'i' } }
            ];
        }
    }

    // A filter by village is a narrowing convenience, and only within catchment.
    if (filters.village) {
        if (!coversVillage(worker, filters.village)) {
            throw forbidden('That village is not in your catchment area');
        }
        query.village = new RegExp(`^${escapeRegex(String(filters.village).trim())}$`, 'i');
    }

    return User.find(query)
        .select(PATIENT_FIELDS)
        .sort({ name: 1 })
        .limit(Math.min(Number(filters.limit) || 100, 200));
}

/**
 * One patient, if they are in the worker's catchment.
 *
 * The failure is a 404 rather than a 403 on purpose: a worker who guesses ids
 * should not be able to learn which of them exist.
 */
export async function getPatient(patientId, ctx) {
    const worker = await resolveWorker(ctx);
    const patient = await User.findOne({ _id: patientId, role: 'patient' }).select(PATIENT_FIELDS + ' role');
    if (!patient) throw notFound('Patient not found');
    if (!coversVillage(worker, patient.village)) throw notFound('Patient not found');
    return patient;
}

/**
 * Registers someone the worker met in their own catchment.
 *
 * The record is not an account. A person registered at their door has no email
 * address and has chosen no password, so a placeholder address and an
 * unguessable hash stand in: enough to satisfy the existing User schema,
 * not enough to sign in with. Making those fields optional instead would put a
 * second null into a unique index, which is the failure that capped the
 * hospitals collection at one document.
 */
export async function registerPatient(input, ctx) {
    const worker = await resolveWorker(ctx);

    const name = String(input.name || '').trim();
    const village = String(input.village || '').trim();

    if (!name) throw badRequest('name is required');
    if (!village) throw badRequest('village is required');

    // The boundary. Supplying a village outside the catchment is the bypass
    // this check exists to refuse.
    const canonical = canonicalVillage(worker, village);
    if (!canonical) {
        throw forbidden(`You can only register patients in your catchment: ${(worker.catchmentVillages || []).join(', ') || 'none assigned'}`);
    }

    if (input.age !== undefined && input.age !== null && input.age !== '') {
        const age = Number(input.age);
        if (!Number.isFinite(age) || age < 0 || age > 120) throw badRequest('age must be a number between 0 and 120');
    }
    if (input.gender && !['female', 'male', 'other'].includes(input.gender)) {
        throw badRequest('gender must be female, male or other');
    }

    const phone = input.phone ? String(input.phone).trim() : '';
    if (phone) {
        // Cheapest guard against the same person being registered twice, which
        // is common when a worker is unsure whether they already did it.
        const existing = await User.findOne({ role: 'patient', phone }).select('name village');
        if (existing) throw conflict(`A patient with that phone is already registered (${existing.name}, ${existing.village || 'no village'})`);
    }

    const placeholderEmail = `gs-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}@patient.gramsathi.local`;
    const passwordHash = await bcrypt.hash(`${Math.random()}${Date.now()}`, 10);

    const patient = await User.create({
        name,
        email: placeholderEmail,
        passwordHash,
        role: 'patient',
        // Stored the way the catchment spells it, not the way it was typed.
        village: canonical,
        age: input.age ? Number(input.age) : undefined,
        gender: input.gender || undefined,
        phone: phone || undefined,
        abhaAddress: input.abhaAddress ? String(input.abhaAddress).trim() : ''
    });

    return User.findById(patient._id).select(PATIENT_FIELDS);
}

/* ─────────────────────────── Home visits ─────────────────────────── */

/**
 * What a reading can physically be, not what is healthy.
 *
 * The line matters. A blood pressure of 250/150 is a person in trouble and
 * must be accepted and flagged; 900 is a typo and must be refused. Rejecting
 * alarming-but-possible numbers would quietly discard exactly the visits that
 * needed recording.
 */
const VITAL_RANGES = {
    systolic: [50, 300, 'mmHg'],
    diastolic: [30, 200, 'mmHg'],
    pulse: [20, 250, 'bpm'],
    temperature: [30, 45, '°C'],
    weight: [0.5, 300, 'kg'],
    spo2: [50, 100, '%'],
    hemoglobin: [2, 25, 'g/dL'],
    bloodSugar: [10, 900, 'mg/dL']
};

const VISIT_TYPES = ['home_visit', 'sub_centre', 'follow_up'];

/**
 * Keeps the readings that were actually taken, refuses the impossible ones.
 *
 * Every field is optional. A sub-centre with no pulse oximeter is the normal
 * case, and forcing a number would only get an invented one.
 */
function validateVitals(input = {}) {
    if (typeof input !== 'object' || Array.isArray(input)) throw badRequest('vitals must be an object');
    const vitals = {};

    for (const [field, [min, max, unit]] of Object.entries(VITAL_RANGES)) {
        const raw = input[field];
        if (raw === undefined || raw === null || raw === '') continue;

        const value = Number(raw);
        if (!Number.isFinite(value)) throw badRequest(`${field} must be a number`);
        if (value < min || value > max) {
            throw badRequest(`${field} of ${value}${unit} is outside the possible range (${min}–${max}${unit})`);
        }
        vitals[field] = value;
    }

    // A blood pressure is one reading, so half of one is not usable and the
    // two halves cannot be the wrong way round.
    const hasSys = vitals.systolic !== undefined;
    const hasDia = vitals.diastolic !== undefined;
    if (hasSys !== hasDia) throw badRequest('Blood pressure needs both systolic and diastolic');
    if (hasSys && vitals.systolic <= vitals.diastolic) {
        throw badRequest('Systolic must be higher than diastolic');
    }

    if (input.lmp !== undefined && input.lmp !== null && input.lmp !== '') {
        const lmp = new Date(input.lmp);
        if (Number.isNaN(lmp.getTime())) throw badRequest('lmp must be a valid date');
        if (lmp.getTime() > Date.now()) throw badRequest('lmp cannot be in the future');
        if (Date.now() - lmp.getTime() > 400 * 24 * 3600 * 1000) throw badRequest('lmp is too long ago to be usable');
        vitals.lmp = lmp;
    }

    return vitals;
}

/**
 * Records a visit a health worker made, and reports what the rules found.
 *
 * Nothing about who is writing this is taken from the request. The worker, the
 * facility and the role all come from the resolved account, and the patient is
 * checked against the catchment first — so a body naming another facility or
 * another author changes nothing about what gets stored.
 */
export async function createEncounter(patientId, input = {}, ctx) {
    const worker = await resolveWorker(ctx);
    // Throws 404 when the patient is outside the catchment. Same check, and
    // the same silence about whether the id exists, as reading one.
    const patient = await getPatient(patientId, ctx);

    const type = input.type || 'home_visit';
    if (!VISIT_TYPES.includes(type)) {
        throw badRequest(`Unknown visit type. Expected one of: ${VISIT_TYPES.join(', ')}`);
    }

    const vitals = validateVitals(input.vitals);
    const notes = input.notes ? String(input.notes).trim() : '';

    if (!Object.keys(vitals).length && !notes) {
        throw badRequest('Record at least one measurement or a note — an empty visit is not a record');
    }

    /**
     * When the visit happened, which is not always when the server hears about
     * it. Accepted from the client so a visit made without a signal keeps its
     * real time once it syncs, but bounded: a future timestamp or one from
     * months ago is a broken device clock, not history.
     */
    let occurredAt = new Date();
    if (input.occurredAt) {
        const when = new Date(input.occurredAt);
        if (Number.isNaN(when.getTime())) throw badRequest('occurredAt must be a valid date');
        if (when.getTime() > Date.now() + 5 * 60 * 1000) throw badRequest('occurredAt cannot be in the future');
        if (Date.now() - when.getTime() > 30 * 24 * 3600 * 1000) throw badRequest('occurredAt is more than 30 days ago');
        occurredAt = when;
    }

    const signs = detectDangerSigns(vitals);

    const encounter = await HealthRecord.create({
        patientId: patient._id,
        type,
        // Derived, never accepted. A worker cannot file a visit as someone
        // else or against a facility they do not work at.
        facilityId: worker.hospitalId,
        authorId: worker._id,
        authorRole: 'health_worker',
        vitals: Object.keys(vitals).length ? vitals : undefined,
        dangerSigns: signs.map(s => s.code),
        notes,
        occurredAt
        // diagnosis and prescription stay empty: a health worker observes and
        // escalates, they do not diagnose.
    });

    /**
     * A reading taken this morning should change what tomorrow's worklist
     * looks like, so any active care plan has its risk recomputed now. The
     * rules are deterministic and the plan records which readings raised it.
     * A failure here must not lose the visit that was just recorded.
     */
    try {
        await refreshRiskForPatient(patient);
    } catch (e) {
        console.error('Care plan risk refresh failed:', e.message);
    }

    return {
        encounter: await HealthRecord.findById(encounter._id)
            .populate('authorId', 'name workerType role')
            .populate('facilityId', 'name level'),
        // Labels travel with the response rather than the record, so they stay
        // translatable and a threshold change never contradicts stored text.
        dangerSigns: signs.map(({ code, label, severity }) => ({ code, label, severity })),
        alert: dangerSummary(signs)
    };
}

/* ─────────────────── Assisted teleconsultation ─────────────────── */

/**
 * Asks a doctor to see a patient the health worker is sitting with.
 *
 * This is an ordinary appointment — same model, same confirm/decline flow,
 * same video room — with three things added: who examined the patient, the
 * facility they did it from, and the encounter itself. The encounter is
 * referenced rather than copied, so the vitals stay the health worker's
 * observation and the doctor reads them as history rather than as their own
 * finding.
 */
export async function requestAssistedConsultation(patientId, input = {}, ctx) {
    const worker = await resolveWorker(ctx);
    const patient = await getPatient(patientId, ctx);

    const { doctorId, requestedDate } = input;
    if (!doctorId) throw badRequest('doctorId is required');
    if (!requestedDate) throw badRequest('requestedDate is required');

    const doctor = await User.findById(doctorId).select('role name');
    if (!doctor) throw notFound('Doctor not found');
    if (doctor.role !== 'doctor') throw badRequest('That user is not a doctor');

    const when = new Date(requestedDate);
    if (Number.isNaN(when.getTime())) throw badRequest('requestedDate must be a valid date');

    // The encounter is optional — an urgent request should not wait on
    // paperwork — but if given it must belong to this patient, or the doctor
    // would be shown somebody else's vitals.
    if (input.encounterId) {
        const encounter = await HealthRecord.findById(input.encounterId).select('patientId');
        if (!encounter) throw notFound('Encounter not found');
        if (String(encounter.patientId) !== String(patient._id)) {
            throw badRequest('That encounter belongs to a different patient');
        }
    }

    if (input.timeSlot && !isValidSlot(input.timeSlot)) throw badRequest('Unknown time slot');

    const appointment = await Appointment.create({
        patientId: patient._id,
        doctorId,
        requestedDate: when,
        timeSlot: input.timeSlot || undefined,
        symptoms: input.symptoms ? String(input.symptoms).trim() : '',
        consultationType: 'video',
        status: 'pending',
        encounterId: input.encounterId || undefined,
        // Derived from the account, never from the body.
        assistedBy: worker._id,
        assistedFacilityId: worker.hospitalId
    });

    return Appointment.findById(appointment._id)
        .populate('doctorId', 'name specialization qualification')
        .populate('patientId', 'name age village')
        .populate('assistedBy', 'name workerType')
        .populate('assistedFacilityId', 'name level')
        .populate('encounterId', 'type occurredAt vitals dangerSigns notes');
}

/** The consultations this worker has arranged for this patient. */
export async function listAssistedConsultations(patientId, ctx) {
    const worker = await resolveWorker(ctx);
    await getPatient(patientId, ctx);
    return Appointment.find({ patientId, assistedFacilityId: worker.hospitalId })
        .populate('doctorId', 'name specialization')
        .populate('assistedBy', 'name workerType')
        .populate('encounterId', 'type occurredAt vitals dangerSigns')
        .sort({ createdAt: -1 })
        .limit(50);
}

/** This patient's visits, if the worker may see this patient at all. */
export async function listEncounters(patientId, ctx) {
    await getPatient(patientId, ctx);
    return HealthRecord.find({ patientId })
        .populate('authorId', 'name workerType role specialization')
        .populate('facilityId', 'name level')
        .sort({ occurredAt: -1 })
        .limit(100);
}

/* ─────────────────────────── Care plans ─────────────────────────── */

/** Opening a plan for someone the worker is responsible for. */
export async function openCarePlan(patientId, input, ctx) {
    const worker = await resolveWorker(ctx);
    const patient = await getPatient(patientId, ctx);
    return createCarePlan(input, { actorId: worker._id, facilityId: worker.hospitalId }, patient);
}

/** This patient's plans, if the worker may see this patient at all. */
export async function listCarePlans(patientId, ctx) {
    await getPatient(patientId, ctx);
    return listCarePlansForPatient(patientId);
}
