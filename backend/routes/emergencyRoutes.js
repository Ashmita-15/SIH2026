import { Router } from 'express';
import { authRequired, authorizeRoles } from '../middleware/authMiddleware.js';
import {
    alertNearestHospital,
    listFacilityEmergencies,
    getEmergency,
    updateEmergencyStatus
} from '../controllers/emergencyController.js';

const router = Router();

// Only authenticated patients can trigger an emergency alert.
router.post('/alert-nearest', authRequired, authorizeRoles('patient'), alertNearestHospital);

// Facility inbox. Declared before /:id so "facility" is never read as an id.
router.get('/facility', authRequired, authorizeRoles('hospital'), listFacilityEmergencies);

// Ownership (patient) or facility routing (hospital) is checked in the controller.
router.get('/:id', authRequired, authorizeRoles('patient', 'hospital'), getEmergency);
router.patch('/:id/status', authRequired, authorizeRoles('hospital'), updateEmergencyStatus);

export default router;
