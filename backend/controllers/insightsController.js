import * as timelineService from '../services/timelineService.js';
import * as dashboardService from '../services/dashboardService.js';
import * as availabilityService from '../services/availabilityService.js';
import Pharmacy from '../models/Pharmacy.js';
import { sendError } from '../services/errors.js';

/**
 * HTTP for the three read-only views added in this milestone. Every one of
 * them aggregates records that already exist; none of them writes anything.
 */

const context = (req) => ({ actorId: req.user.id });

export const getTimeline = async (req, res) => {
    try { res.json(await timelineService.getTimeline(req.params.patientId, context(req))); }
    catch (e) { sendError(res, e); }
};

export const getFacilityDashboard = async (req, res) => {
    try { res.json(await dashboardService.getFacilityDashboard(context(req))); }
    catch (e) { sendError(res, e); }
};

export const getAvailability = async (req, res) => {
    try {
        const { medicine, medicines } = req.query;
        if (medicines) return res.json(await availabilityService.findAvailabilityForMany(medicines));
        res.json(await availabilityService.findAvailability(medicine));
    } catch (e) { sendError(res, e); }
};

/** A pharmacy's own low stock. Ownership is resolved here, not trusted. */
export const getMyLowStock = async (req, res) => {
    try {
        const pharmacy = await Pharmacy.findOne({ ownerId: req.user.id }).select('_id');
        if (!pharmacy) return res.status(404).json({ message: 'Pharmacy not found' });
        res.json(await availabilityService.lowStockForPharmacy(pharmacy._id));
    } catch (e) { sendError(res, e); }
};
