import { Router } from 'express';
import { authRequired, authorizeRoles } from '../middleware/authMiddleware.js';
import {
    listRecommendations, getRecommendation, approveRecommendation, rejectRecommendation
} from '../controllers/recommendationController.js';

const router = Router();

/**
 * Facility staff only, matching the agent routes.
 *
 * The role gate is the outer door; which recommendations a given facility may
 * see is decided per row inside the service, from the two ends of the referral
 * the recommendation concerns. Approving one is what creates work, so it runs
 * under the reviewer's own account and not the agent's.
 */
router.use(authRequired, authorizeRoles('hospital'));

router.get('/', listRecommendations);
router.get('/:id', getRecommendation);
router.post('/:id/approve', approveRecommendation);
router.post('/:id/reject', rejectRecommendation);

export default router;
