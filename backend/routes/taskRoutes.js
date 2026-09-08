import { Router } from 'express';
import { authRequired, authorizeRoles } from '../middleware/authMiddleware.js';
import { listTasks, getWorklist, getTask, completeTask } from '../controllers/taskController.js';

const router = Router();

/**
 * Tasks are addressed to the people who deliver care. A patient has no work
 * queue and a pharmacy is not part of the coordination loop, so neither role
 * reaches these routes at all; who may see a particular task is then decided
 * per task inside the service.
 */
router.use(authRequired, authorizeRoles('health_worker', 'doctor', 'hospital'));

router.get('/', listTasks);
router.get('/worklist', getWorklist);
router.get('/:id', getTask);
router.patch('/:id/complete', completeTask);

export default router;
