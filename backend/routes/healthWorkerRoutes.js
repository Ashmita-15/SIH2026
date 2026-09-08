import { Router } from 'express';
import { authRequired, authorizeRoles } from '../middleware/authMiddleware.js';
import {
    getMe, listPatients, getPatient, registerPatient,
    createEncounter, listEncounters, getDangerRules,
    requestConsultation, listConsultations, openCarePlan, listCarePlans
} from '../controllers/healthWorkerController.js';

const router = Router();

/**
 * Every route here is health-worker only.
 *
 * The role gate is the outer door; the catchment check inside the service is
 * the one that matters, because two ASHAs share this role and must not share
 * each other's patients. asha, anm and cho all sign in as health_worker —
 * workerType changes what the screen offers them, never what the server allows.
 */
router.use(authRequired, authorizeRoles('health_worker'));

router.get('/me', getMe);
router.get('/danger-rules', getDangerRules);
router.get('/patients', listPatients);
router.post('/patients', registerPatient);
router.get('/patients/:id', getPatient);

// The patient is always in the path, never in the body: the catchment check
// and the record it writes then cannot disagree about who this is for.
router.post('/patients/:patientId/encounters', createEncounter);
router.get('/patients/:patientId/encounters', listEncounters);

// Assisted teleconsultation: an ordinary appointment carrying the encounter,
// the worker and their facility, so the doctor sees a prepared case.
router.post('/patients/:patientId/consultations', requestConsultation);
router.get('/patients/:patientId/consultations', listConsultations);

router.post('/patients/:patientId/care-plans', openCarePlan);
router.get('/patients/:patientId/care-plans', listCarePlans);

export default router;
