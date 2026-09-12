import { Router } from 'express';
import { authRequired, authorizeRoles } from '../middleware/authMiddleware.js';
import { getLatestForPatient } from '../controllers/triageController.js';

const router = Router();

// Only the two roles that can raise a referral need this. A patient reading
// their own assessment has no use for it — they were shown it as it happened.
router.get('/latest/:patientId', authRequired, authorizeRoles('doctor', 'health_worker'), getLatestForPatient);

export default router;
