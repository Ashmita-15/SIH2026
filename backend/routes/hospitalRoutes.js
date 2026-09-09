import { Router } from 'express';
import { authRequired, authorizeRoles } from '../middleware/authMiddleware.js';
import {
    createHospitalProfile,
    getHospitalProfile,
    updateHospitalProfile,
    addDoctorToHospital,
    removeDoctorFromHospital,
    addHealthWorkerToHospital,
    removeHealthWorkerFromHospital,
    getHealthWorkersInHospital,
    addPharmacyToHospital,
    removePharmacyFromHospital,
    getDoctorsInHospital,
    getPharmaciesInHospital
} from '../controllers/hospitalController.js';

const router = Router();

// Hospital profile routes
router.post('/create', authRequired, authorizeRoles('hospital'), createHospitalProfile);
router.get('/my/profile', authRequired, authorizeRoles('hospital'), getHospitalProfile);
router.put('/my/profile', authRequired, authorizeRoles('hospital'), updateHospitalProfile);

// Doctor management routes
router.post('/doctors/add', authRequired, authorizeRoles('hospital'), addDoctorToHospital);
router.delete('/doctors/remove', authRequired, authorizeRoles('hospital'), removeDoctorFromHospital);
router.get('/doctors', authRequired, authorizeRoles('hospital'), getDoctorsInHospital);

// Pharmacy management routes
router.post('/pharmacies/add', authRequired, authorizeRoles('hospital'), addPharmacyToHospital);
router.delete('/pharmacies/remove', authRequired, authorizeRoles('hospital'), removePharmacyFromHospital);
router.get('/pharmacies', authRequired, authorizeRoles('hospital'), getPharmaciesInHospital);

// Frontline workers. Same shape as the doctor routes above.
router.post('/health-workers/add', authRequired, authorizeRoles('hospital'), addHealthWorkerToHospital);
router.delete('/health-workers/remove', authRequired, authorizeRoles('hospital'), removeHealthWorkerFromHospital);
router.get('/health-workers', authRequired, authorizeRoles('hospital'), getHealthWorkersInHospital);

export default router;