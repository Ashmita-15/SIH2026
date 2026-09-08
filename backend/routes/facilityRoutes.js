import { Router } from 'express';
import { authRequired } from '../middleware/authMiddleware.js';
import {
    listFacilities,
    getFacilityTree,
    getFacilityById,
    getFacilityMeta
} from '../controllers/facilityController.js';

const router = Router();

// Signed in, but no role restriction: a doctor choosing a referral
// destination, a health worker checking where a test is done and a patient
// looking for their nearest PHC are all asking the same question.

// Static paths first, or "/tree" is read as an id.
router.get('/meta', authRequired, getFacilityMeta);
router.get('/tree', authRequired, getFacilityTree);
router.get('/', authRequired, listFacilities);
router.get('/:id', authRequired, getFacilityById);

export default router;
