import { Router } from 'express';
import { authRequired, authorizeRoles } from '../middleware/authMiddleware.js';
import { 
    // Pharmacy Management
    createPharmacy,
    getPharmacy,
    updatePharmacy,
    getAllPharmacies,
    getPharmacyById,
    
    // Medicine Stock Management
    addMedicine,
    updateStock,
    deleteMedicine,
    getPharmacyMedicines,
    getPharmacyMedicinesPublic,
    checkStock,
    
    // Cart Management
    getCart,
    addToCart,
    updateCartItem,
    removeFromCart,
    clearCart,
    
    // Order Management
    createOrder,
    getOrders,
    getPharmacyOrders,
    updateOrderStatus,
    getOrderById,
    
    // Razorpay Payment Management
    createRazorpayOrder,
    verifyRazorpayPayment,
    handleRazorpayWebhook
} from '../controllers/pharmacyController.js';

const router = Router();

// Specific routes (must come before generic parameterized routes)
router.get('/all', getAllPharmacies);
router.get('/search/stock/:medicineName', checkStock);

// Razorpay Payment endpoints
router.post('/payment/create-order', authRequired, authorizeRoles('patient'), createRazorpayOrder);
router.post('/payment/verify', authRequired, authorizeRoles('patient'), verifyRazorpayPayment);
router.post('/payment/webhook', handleRazorpayWebhook);


// Pharmacy management routes (pharmacy role required)
router.post('/create', authRequired, authorizeRoles('pharmacy'), createPharmacy);
router.get('/my/profile', authRequired, authorizeRoles('pharmacy'), getPharmacy);
router.put('/my/profile', authRequired, authorizeRoles('pharmacy'), updatePharmacy);

// Medicine management routes (pharmacy role required)
router.post('/medicines', authRequired, authorizeRoles('pharmacy'), addMedicine);
router.get('/my/medicines', authRequired, authorizeRoles('pharmacy'), getPharmacyMedicines);
router.put('/medicines/:medicineId', authRequired, authorizeRoles('pharmacy'), updateStock);
router.delete('/medicines/:medicineId', authRequired, authorizeRoles('pharmacy'), deleteMedicine);

// Order management for pharmacy
router.get('/my/orders', authRequired, authorizeRoles('pharmacy'), getPharmacyOrders);
router.put('/orders/:orderId/status', authRequired, authorizeRoles('pharmacy'), updateOrderStatus);

// Generic parameterized routes (must come after specific routes)
router.get('/:id', getPharmacyById);
router.get('/:pharmacyId/medicines', getPharmacyMedicinesPublic);

// Patient/Customer routes (patient role required)
router.get('/cart/:pharmacyId', authRequired, authorizeRoles('patient'), getCart);
router.post('/cart/add', authRequired, authorizeRoles('patient'), addToCart);
router.put('/cart/:pharmacyId/:medicineId', authRequired, authorizeRoles('patient'), updateCartItem);
router.delete('/cart/:pharmacyId/:medicineId', authRequired, authorizeRoles('patient'), removeFromCart);
router.delete('/cart/:pharmacyId/clear', authRequired, authorizeRoles('patient'), clearCart);

// Order routes for patients
router.post('/orders', authRequired, authorizeRoles('patient'), createOrder);
router.get('/my/patient-orders', authRequired, authorizeRoles('patient'), getOrders);
router.get('/orders/:orderId', authRequired, getOrderById);

export default router;


