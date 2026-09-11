import { Router } from 'express';
import { authRequired, authorizeRoles } from '../middleware/authMiddleware.js';
import {
    getMySessions, createSession, updateSession, deleteSession,
    getDoctorSessions, getMySessionQueues
} from '../controllers/sessionController.js';

const router = Router();

// Static paths before the parameterised one.
router.get('/mine', authRequired, authorizeRoles('doctor'), getMySessions);
router.get('/mine/queue', authRequired, authorizeRoles('doctor'), getMySessionQueues);
router.post('/', authRequired, authorizeRoles('doctor'), createSession);
router.put('/:sessionId', authRequired, authorizeRoles('doctor'), updateSession);
router.delete('/:sessionId', authRequired, authorizeRoles('doctor'), deleteSession);

// Any signed-in user may see what a doctor is offering.
router.get('/doctor/:doctorId', authRequired, getDoctorSessions);

export default router;
