import { Router } from 'express';
import { authRequired, authorizeRoles } from '../middleware/authMiddleware.js';
import { listAgents, runAgent, listRuns } from '../controllers/agentController.js';

const router = Router();

/**
 * Restricted to facility administrators.
 *
 * None of the five existing roles is a system administrator, and inventing one
 * to gate this would have meant changing the authorization model for the sake
 * of a feature. `hospital` is the closest fit: it is already the role trusted
 * with a cross-patient operational view in the facility dashboard.
 *
 * The narrower protection is delegation — a run borrows the caller's own
 * permissions, so a facility admin starting an agent can surface nothing they
 * could not already open themselves.
 */
router.use(authRequired, authorizeRoles('hospital'));

router.get('/', listAgents);
router.get('/runs', listRuns);
router.post('/:agentId/run', runAgent);

export default router;
