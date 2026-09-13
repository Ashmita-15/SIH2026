import mongoose from 'mongoose';
import Hospital from '../models/Hospital.js';
import User from '../models/User.js';
import EmergencyAlert, { ACTIVE_EMERGENCY_STATUSES } from '../models/EmergencyAlert.js';
import { isValidLatLon } from '../services/geocode.js';
import {
    notifyEmergencySOS,
    notifyEmergencyStatusChanged
} from '../services/notifications/notificationService.js';

const envInt = (value, fallback, min, max) => {
    if (value === undefined || value === '') return fallback;
    const n = Math.round(Number(value));
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

/**
 * How far an SOS looks. This was written as `10000_000` next to a "100 km"
 * comment — ten thousand kilometres, so any patient anywhere in India was
 * routed to whichever hospital happened to exist, however far away.
 */
const MAX_RADIUS_KM = envInt(process.env.SOS_MAX_RADIUS_KM, 100, 1, 500);
/** Several nearby facilities, because the nearest one may not be watching. */
const MAX_FACILITIES = envInt(process.env.SOS_MAX_FACILITIES, 3, 1, 5);
/** A second press while an alert is still open returns that alert. */
const REPEAT_WINDOW_MS = 2 * 60 * 1000;
const REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;

const TRANSITIONS = {
    acknowledged: ['open'],
    resolved: ['open', 'acknowledged']
};

function haversineKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const toRad = deg => deg * (Math.PI / 180);
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const round1 = n => Math.round(n * 10) / 10;

/** [lng, lat] that is in range and not the 0,0 an unset form produces. */
const hasUsablePoint = coords =>
    Array.isArray(coords) && coords.length === 2 &&
    isValidLatLon(coords[1], coords[0]) && !(coords[0] === 0 && coords[1] === 0);

/** What the patient who raised the alert sees. No other patient data. */
function patientView(alert, { duplicate = false } = {}) {
    const facilities = alert.facilities.map(f => ({
        name: f.name, phone: f.phone, distanceKm: f.distanceKm, reached: f.reached
    }));
    return {
        alertId: String(alert._id),
        status: alert.status,
        duplicate,
        createdAt: alert.createdAt,
        acknowledgedAt: alert.acknowledgedAt,
        resolvedAt: alert.resolvedAt,
        radiusKm: MAX_RADIUS_KM,
        facilities,
        delivery: {
            confirmed: Boolean(alert.delivery?.confirmed),
            facilitiesReached: facilities.filter(f => f.reached).length
        },
        // Read by app versions still cached on phones from before this change.
        hospital: facilities[0] ? { name: facilities[0].name, distanceKm: facilities[0].distanceKm } : null,
        emailSent: (alert.delivery?.emailsAccepted || 0) > 0
    };
}

/**
 * What an alerted facility sees: enough to reach the person — name, a
 * callback number, where they are — and nothing from their health record.
 */
function facilityView(alert, patient, ownIds) {
    const [longitude, latitude] = alert.location.coordinates;
    const own = alert.facilities.find(f => ownIds.has(String(f.hospitalId)));
    return {
        alertId: String(alert._id),
        status: alert.status,
        createdAt: alert.createdAt,
        acknowledgedAt: alert.acknowledgedAt,
        resolvedAt: alert.resolvedAt,
        patient: patient ? { name: patient.name, phone: patient.phone || '' } : null,
        location: { latitude, longitude, accuracyMetres: alert.accuracyMetres },
        facility: own ? { name: own.name, distanceKm: own.distanceKm } : null
    };
}

/**
 * Loads an alert only for someone entitled to it: the patient who raised it,
 * or the current owner of a facility it was routed to. Everyone else gets the
 * same 404 as a missing id, so ids cannot be probed.
 */
async function loadWithAccess(req) {
    const notFound = { error: 404, message: 'Emergency alert not found' };
    if (!mongoose.isValidObjectId(req.params.id)) return notFound;

    const alert = await EmergencyAlert.findById(req.params.id);
    if (!alert) return notFound;

    if (req.user.role === 'patient' && String(alert.patientId) === String(req.user.id)) {
        return { alert, viewer: 'patient' };
    }
    if (req.user.role === 'hospital') {
        const owned = await Hospital.find({
            _id: { $in: alert.facilities.map(f => f.hospitalId) },
            ownerId: req.user.id
        }).select('_id name').lean();
        if (owned.length) {
            return { alert, viewer: 'facility', owned, ownIds: new Set(owned.map(h => String(h._id))) };
        }
    }
    return notFound;
}

/**
 * POST /api/emergency/alert-nearest   (patient)
 * Body: { latitude, longitude, accuracy?, clientRequestId? }
 *
 * Finds the nearest active hospitals within MAX_RADIUS_KM, records the alert,
 * then notifies each facility's account in-app, by Web Push and by email.
 * The response says what was accepted for delivery, not what was hoped for.
 */
export const alertNearestHospital = async (req, res) => {
    const { latitude, longitude, accuracy, clientRequestId } = req.body || {};

    if (typeof latitude !== 'number' || typeof longitude !== 'number' ||
        !isValidLatLon(latitude, longitude) || (latitude === 0 && longitude === 0)) {
        return res.status(400).json({ message: 'Valid latitude and longitude are required.' });
    }

    const patientId = req.user.id;
    const requestId = typeof clientRequestId === 'string' && REQUEST_ID.test(clientRequestId)
        ? clientRequestId : null;
    const accuracyMetres = typeof accuracy === 'number' && Number.isFinite(accuracy) && accuracy >= 0
        ? Math.min(Math.round(accuracy), 1_000_000) : null;

    try {
        // A retry of a request whose response was lost on a bad connection.
        if (requestId) {
            const same = await EmergencyAlert.findOne({ patientId, clientRequestId: requestId });
            if (same) return res.status(200).json(patientView(same, { duplicate: true }));
        }

        // Repeated presses: facilities were already alerted a moment ago.
        const recent = await EmergencyAlert.findOne({
            patientId,
            status: { $in: ACTIVE_EMERGENCY_STATUSES },
            createdAt: { $gte: new Date(Date.now() - REPEAT_WINDOW_MS) }
        }).sort({ createdAt: -1 });
        if (recent) return res.status(200).json(patientView(recent, { duplicate: true }));

        const patient = await User.findById(patientId).select('name').lean();
        if (!patient) return res.status(404).json({ message: 'Patient not found.' });

        // $near uses the 2dsphere index on Hospital.location and returns nearest first.
        const candidates = await Hospital.find({
            isActive: true,
            location: {
                $near: {
                    $geometry: { type: 'Point', coordinates: [longitude, latitude] }, // GeoJSON is [lng, lat]
                    $maxDistance: MAX_RADIUS_KM * 1000
                }
            }
        }).limit(MAX_FACILITIES * 2).select('name phone email ownerId location').lean();

        const facilities = candidates
            .filter(h => h.ownerId && hasUsablePoint(h.location?.coordinates))
            .slice(0, MAX_FACILITIES)
            .map(h => ({
                hospital: h,
                distanceKm: round1(haversineKm(latitude, longitude, h.location.coordinates[1], h.location.coordinates[0]))
            }));

        let alert;
        try {
            alert = await EmergencyAlert.create({
                patientId,
                clientRequestId: requestId,
                location: { type: 'Point', coordinates: [longitude, latitude] },
                accuracyMetres,
                status: facilities.length ? 'open' : 'no_facility',
                facilities: facilities.map(({ hospital, distanceKm }) => ({
                    hospitalId: hospital._id,
                    name: hospital.name,
                    phone: hospital.phone || '',
                    distanceKm
                }))
            });
        } catch (err) {
            // Two copies of the same request racing each other.
            if (err.code === 11000 && requestId) {
                const same = await EmergencyAlert.findOne({ patientId, clientRequestId: requestId });
                if (same) return res.status(200).json(patientView(same, { duplicate: true }));
            }
            throw err;
        }

        if (!facilities.length) {
            return res.status(404).json({
                code: 'NO_FACILITY',
                alertId: String(alert._id),
                radiusKm: MAX_RADIUS_KM,
                message: `No registered hospital was found within ${MAX_RADIUS_KM} km of you. Please call 108 for an ambulance now.`
            });
        }

        const outcome = await notifyEmergencySOS({ alert, patientName: patient.name, facilities });
        const reached = new Set(outcome.facilities.filter(f => f.reached).map(f => String(f.hospitalId)));
        alert.facilities.forEach(f => { f.reached = reached.has(String(f.hospitalId)); });
        alert.delivery = outcome.delivery;
        try {
            await alert.save();
        } catch (saveErr) {
            // The facilities were already notified; failing the request now
            // would tell the patient the opposite of what happened.
            console.error('[emergency] Could not record delivery outcome:', saveErr.message);
        }

        return res.status(201).json(patientView(alert));
    } catch (e) {
        console.error('[emergency] alertNearestHospital error:', e.message);
        return res.status(500).json({ message: 'Could not send the emergency alert. Please call 108 directly.' });
    }
};

/**
 * GET /api/emergency/facility?status=active   (hospital)
 * Alerts routed to facilities this account owns, newest first.
 */
export const listFacilityEmergencies = async (req, res) => {
    try {
        const owned = await Hospital.find({ ownerId: req.user.id }).select('_id').lean();
        if (!owned.length) {
            return res.status(403).json({ message: 'This account is not linked to a hospital profile yet.' });
        }
        const ids = owned.map(h => h._id);
        const ownIds = new Set(ids.map(String));

        const filter = { 'facilities.hospitalId': { $in: ids } };
        if (req.query.status === 'active') filter.status = { $in: ACTIVE_EMERGENCY_STATUSES };

        const alerts = await EmergencyAlert.find(filter)
            .sort({ createdAt: -1 })
            .limit(50)
            .populate('patientId', 'name')
            .lean();

        return res.json(alerts.map(a => ({
            alertId: String(a._id),
            status: a.status,
            createdAt: a.createdAt,
            acknowledgedAt: a.acknowledgedAt,
            resolvedAt: a.resolvedAt,
            patientName: a.patientId?.name || 'Patient',
            distanceKm: a.facilities.find(f => ownIds.has(String(f.hospitalId)))?.distanceKm ?? null
        })));
    } catch (e) {
        console.error('[emergency] listFacilityEmergencies error:', e.message);
        return res.status(500).json({ message: 'Could not load emergency alerts.' });
    }
};

/** GET /api/emergency/:id   (the patient who raised it, or an alerted facility) */
export const getEmergency = async (req, res) => {
    try {
        const access = await loadWithAccess(req);
        if (access.error) return res.status(access.error).json({ message: access.message });

        if (access.viewer === 'patient') return res.json(patientView(access.alert));

        const patient = await User.findById(access.alert.patientId).select('name phone').lean();
        return res.json(facilityView(access.alert, patient, access.ownIds));
    } catch (e) {
        console.error('[emergency] getEmergency error:', e.message);
        return res.status(500).json({ message: 'Could not load this emergency alert.' });
    }
};

/**
 * PATCH /api/emergency/:id/status   (alerted facility)
 * Body: { status: 'acknowledged' | 'resolved' }
 */
export const updateEmergencyStatus = async (req, res) => {
    const next = req.body?.status;
    if (!TRANSITIONS[next]) {
        return res.status(400).json({ message: 'status must be "acknowledged" or "resolved"' });
    }

    try {
        const access = await loadWithAccess(req);
        if (access.error) return res.status(access.error).json({ message: access.message });
        if (access.viewer !== 'facility') {
            return res.status(403).json({ message: 'Only an alerted facility can update this emergency.' });
        }

        const now = new Date();
        const set = next === 'acknowledged'
            ? { status: next, acknowledgedBy: req.user.id, acknowledgedAt: now }
            : { status: next, resolvedBy: req.user.id, resolvedAt: now };

        // Conditional, so two staff pressing at once cannot both move it.
        const updated = await EmergencyAlert.findOneAndUpdate(
            { _id: access.alert._id, status: { $in: TRANSITIONS[next] } },
            { $set: set },
            { new: true }
        );
        if (!updated) {
            const current = await EmergencyAlert.findById(access.alert._id).select('status').lean();
            return res.status(409).json({ message: `This alert is already ${current?.status || 'closed'}.`, status: current?.status });
        }

        notifyEmergencyStatusChanged({ alert: updated, status: next, facilityName: access.owned[0]?.name }).catch(() => {});

        const patient = await User.findById(updated.patientId).select('name phone').lean();
        return res.json(facilityView(updated, patient, access.ownIds));
    } catch (e) {
        console.error('[emergency] updateEmergencyStatus error:', e.message);
        return res.status(500).json({ message: 'Could not update this emergency alert.' });
    }
};
