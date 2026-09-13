import { Router } from 'express';
import { authRequired } from '../middleware/authMiddleware.js';
import {
    createReferral,
    listDestinations,
    getReferral,
    listReferrals,
    updateReferralStatus,
    completeReferral
} from '../controllers/referralController.js';

const router = Router();

/**
 * No authorizeRoles here on purpose.
 *
 * Who may act on a referral depends on which facility the account belongs to,
 * not only on its role — a doctor at the referring PHC and a doctor at the
 * destination hospital have different rights over the same document. That is a
 * per-referral decision, so the service makes it. authRequired still keeps
 * anonymous callers out.
 */
router.post('/', authRequired, createReferral);
router.get('/', authRequired, listReferrals);
// Declared before /:id so "destinations" is never read as a referral id.
router.get('/destinations', authRequired, listDestinations);
router.get('/:id', authRequired, getReferral);
router.patch('/:id/status', authRequired, updateReferralStatus);
router.post('/:id/complete', authRequired, completeReferral);

export default router;
