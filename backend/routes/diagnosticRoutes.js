import { Router } from 'express';
import { authRequired } from '../middleware/authMiddleware.js';
import { create, list, getOne, updateStatus } from '../controllers/diagnosticController.js';

const router = Router();

// Every route is scoped by the caller's own identity inside the service, so
// no route-level role gate is needed beyond being signed in — a patient
// listing simply sees their own, and cannot reach the status endpoint.
router.post('/', authRequired, create);
router.get('/', authRequired, list);
router.get('/:id', authRequired, getOne);
router.patch('/:id/status', authRequired, updateStatus);

export default router;
