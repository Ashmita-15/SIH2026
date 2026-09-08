import { Router } from 'express';
import { authRequired, authorizeRoles } from '../middleware/authMiddleware.js';
import { getTimeline, getFacilityDashboard, getAvailability, getMyLowStock } from '../controllers/insightsController.js';

/**
 * Three separate mounts rather than one, because they are three different
 * resources with three different audiences. Who may see a particular patient
 * or facility is decided per record inside the services — the guards here are
 * only the outer door.
 */

export const timelineRouter = Router();
// No role list: a patient, their health worker, their doctor and the facility
// treating them all legitimately ask this, and which of them is entitled to
// this patient is a per-patient question.
timelineRouter.get('/:patientId/timeline', authRequired, getTimeline);

export const facilityRouter = Router();
// The facility is taken from the account, so there is no facilityId to guard.
facilityRouter.get('/dashboard', authRequired, authorizeRoles('hospital', 'doctor', 'health_worker'), getFacilityDashboard);

export const medicineRouter = Router();
// Signed in, any care role — knowing where a medicine is stocked is the point.
medicineRouter.get('/availability', authRequired, getAvailability);
medicineRouter.get('/my/low-stock', authRequired, authorizeRoles('pharmacy'), getMyLowStock);
