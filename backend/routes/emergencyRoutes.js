import { Router } from 'express';
import { authRequired, authorizeRoles } from '../middleware/authMiddleware.js';
import { alertNearestHospital } from '../controllers/emergencyController.js';

const router = Router();

// Only authenticated patients can trigger an emergency alert.
router.post('/alert-nearest', authRequired, authorizeRoles('patient'), alertNearestHospital);

export default router;
