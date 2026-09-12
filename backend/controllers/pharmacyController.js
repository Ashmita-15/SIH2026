import mongoose from 'mongoose';
import Pharmacy from '../models/Pharmacy.js';
import MedicineStock from '../models/MedicineStock.js';
import { findAvailability } from '../services/availabilityService.js';
import { sendError } from '../services/errors.js';
import Cart from '../models/Cart.js';
import Order from '../models/Order.js';
import { 
    notifyPharmacyNewOrder, 
    notifyPharmacyPaymentFailed, 
    notifyPharmacyOrderStatus 
} from '../services/notifications/notificationService.js';
import { validateIndianMobile, normalizeIndianMobile } from '../utils/phoneValidation.js';
import { 
    createRazorpayOrder as createRzpOrder, 
    verifyPaymentSignature, 
    verifyWebhookSignature, 
    getPublicRazorpayKey 
} from '../services/paymentService.js';


// Pharmacy Management
/**
 * What the cart needs to know about a medicine.
 *
 * Defined once because it was written out at four call sites and only one of
 * them was ever updated: prescriptionRequired was missing, so the checkout
 * could not tell that the cart held a prescription-only medicine. The upload
 * box never appeared, and the server then refused the order — leaving the
 * patient no way to comply with a rule the app itself enforced.
 */
const CART_MEDICINE_FIELDS = 'medicineName brand price finalPrice quantity stockStatus image prescriptionRequired';

export const createPharmacy = async (req, res) => {
    try {
        console.log('Creating pharmacy for user:', req.user);
        console.log('Request body:', req.body);
        
        // Validate required fields
        const { name, location, address, contact } = req.body;
        if (!name || !location || !address || !contact) {
            return res.status(400).json({ 
                message: 'Missing required fields: name, location, address, and contact are required' 
            });
        }
        
        // Check if pharmacy already exists for this user
        const existingPharmacy = await Pharmacy.findOne({ ownerId: req.user.id });
        if (existingPharmacy) {
            return res.status(400).json({ message: 'You already have a pharmacy registered' });
        }
        
        const pharmacyData = { ...req.body, ownerId: req.user.id };
        console.log('Creating pharmacy with data:', pharmacyData);
        
        const pharmacy = new Pharmacy(pharmacyData);
        const savedPharmacy = await pharmacy.save();
        
        console.log('Pharmacy created successfully:', savedPharmacy);
        res.status(201).json(savedPharmacy);
    } catch (e) {
        console.error('Error creating pharmacy:', e);
        console.error('Error details:', {
            message: e.message,
            stack: e.stack,
            name: e.name
        });
        
        if (e.name === 'ValidationError') {
            const errors = Object.values(e.errors).map(err => err.message);
            return res.status(400).json({ message: `Validation error: ${errors.join(', ')}` });
        }
        
        res.status(500).json({ message: e.message || 'Internal server error' });
    }
};

export const getPharmacy = async (req, res) => {
    try {
        const pharmacy = await Pharmacy.findOne({ ownerId: req.user.id }).populate('ownerId', 'name email');
        if (!pharmacy) return res.status(404).json({ message: 'Pharmacy not found' });
        res.json(pharmacy);
    } catch (e) {
        res.status(500).json({ message: e.message });
    }
};

export const updatePharmacy = async (req, res) => {
    try {
        const pharmacy = await Pharmacy.findOneAndUpdate(
            { ownerId: req.user.id },
            { $set: req.body },
            { new: true }
        );
        if (!pharmacy) return res.status(404).json({ message: 'Pharmacy not found' });
        res.json(pharmacy);
    } catch (e) {
        res.status(500).json({ message: e.message });
    }
};

export const getAllPharmacies = async (req, res) => {
    try {
        const { location, search } = req.query;
        let query = { isActive: true };
        
        if (location) {
            query.location = new RegExp(location, 'i');
        }
        
        if (search) {
            query.name = new RegExp(search, 'i');
        }
        
        const pharmacies = await Pharmacy.find(query)
            .select('name location address contact description image openingHours deliveryAvailable ratings')
            .sort({ 'ratings.average': -1 });
        res.json(pharmacies);
    } catch (e) {
        res.status(500).json({ message: e.message });
    }
};

export const getPharmacyById = async (req, res) => {
    try {
        const pharmacy = await Pharmacy.findById(req.params.id)
            .populate('ownerId', 'name email phone');
        if (!pharmacy) return res.status(404).json({ message: 'Pharmacy not found' });
        res.json(pharmacy);
    } catch (e) {
        res.status(500).json({ message: e.message });
    }
};

// Medicine Stock Management
export const addMedicine = async (req, res) => {
    try {
        const pharmacy = await Pharmacy.findOne({ ownerId: req.user.id });
        if (!pharmacy) return res.status(404).json({ message: 'Pharmacy not found' });
        
        const medicineData = { ...req.body, pharmacyId: pharmacy._id };
        const medicine = new MedicineStock(medicineData);
        await medicine.save();
        
        // Emit real-time update
        req.io.emit('medicine-added', { pharmacyId: pharmacy._id, medicine });
        
        res.status(201).json(medicine);
    } catch (e) {
        res.status(500).json({ message: e.message });
    }
};

export const updateStock = async (req, res) => {
    try {
        const pharmacy = await Pharmacy.findOne({ ownerId: req.user.id });
        if (!pharmacy) return res.status(404).json({ message: 'Pharmacy not found' });
        
        const { medicineId } = req.params;
        const stock = await MedicineStock.findOneAndUpdate(
            { _id: medicineId, pharmacyId: pharmacy._id },
            { $set: { ...req.body, lastUpdated: new Date() } },
            { new: true }
        );
        
        if (!stock) return res.status(404).json({ message: 'Medicine not found' });
        
        // Emit real-time update
        req.io.emit('stock-updated', { pharmacyId: pharmacy._id, medicine: stock });
        
        res.json(stock);
    } catch (e) {
        res.status(500).json({ message: e.message });
    }
};

export const deleteMedicine = async (req, res) => {
    try {
        const pharmacy = await Pharmacy.findOne({ ownerId: req.user.id });
        if (!pharmacy) return res.status(404).json({ message: 'Pharmacy not found' });
        
        const { medicineId } = req.params;
        const medicine = await MedicineStock.findOneAndDelete({
            _id: medicineId,
            pharmacyId: pharmacy._id
        });
        
        if (!medicine) return res.status(404).json({ message: 'Medicine not found' });
        
        // Emit real-time update
        req.io.emit('medicine-removed', { pharmacyId: pharmacy._id, medicineId });
        
        res.json({ message: 'Medicine deleted successfully' });
    } catch (e) {
        res.status(500).json({ message: e.message });
    }
};

export const getPharmacyMedicines = async (req, res) => {
    try {
        const pharmacy = await Pharmacy.findOne({ ownerId: req.user.id });
        if (!pharmacy) return res.status(404).json({ message: 'Pharmacy not found' });
        
        const { search, category, page = 1, limit = 20 } = req.query;
        let query = { pharmacyId: pharmacy._id, isActive: true };
        
        // Only add text search if search term is provided and text index exists
        if (search) {
            // Use regex search instead of text search to avoid index issues
            query.$or = [
                { medicineName: { $regex: search, $options: 'i' } },
                { genericName: { $regex: search, $options: 'i' } },
                { brand: { $regex: search, $options: 'i' } }
            ];
        }
        
        if (category && category !== 'all') {
            query.category = category;
        }
        
        console.log('Fetching medicines with query:', query);
        
        const medicines = await MedicineStock.find(query)
            .sort({ medicineName: 1 })
            .limit(limit * 1)
            .skip((page - 1) * limit);
            
        const total = await MedicineStock.countDocuments(query);
        
        console.log(`Found ${medicines.length} medicines out of ${total} total`);
        
        res.json({
            medicines,
            totalPages: Math.ceil(total / limit),
            currentPage: parseInt(page),
            total
        });
    } catch (e) {
        console.error('Error fetching pharmacy medicines:', e);
        res.status(500).json({ message: e.message });
    }
};

// Public medicine browsing
export const getPharmacyMedicinesPublic = async (req, res) => {
    try {
        const { pharmacyId } = req.params;
        const { search, category, page = 1, limit = 20 } = req.query;
        
        let query = { pharmacyId, isActive: true };
        
        if (search) {
            // Use regex search instead of text search to avoid index issues
            query.$or = [
                { medicineName: { $regex: search, $options: 'i' } },
                { genericName: { $regex: search, $options: 'i' } },
                { brand: { $regex: search, $options: 'i' } }
            ];
        }
        
        if (category && category !== 'all') {
            query.category = category;
        }
        
        const medicines = await MedicineStock.find(query)
            .populate('pharmacyId', 'name location contact')
            .sort({ medicineName: 1 })
            .limit(limit * 1)
            .skip((page - 1) * limit);
            
        const total = await MedicineStock.countDocuments(query);
        
        res.json({
            medicines,
            totalPages: Math.ceil(total / limit),
            currentPage: page,
            total
        });
    } catch (e) {
        res.status(500).json({ message: e.message });
    }
};

/**
 * Where a medicine is stocked.
 *
 * Returned the whole MedicineStock document, unauthenticated — exact
 * quantities, batch numbers, expiry dates and margins for every pharmacy in
 * the system. It also matched only on an exact name, so a prescription for
 * "Amlodipine 5mg" found nothing at a shop stocking it under a brand.
 *
 * Now shares the availability projection: a category rather than a count, and
 * a loose match so the answer is useful.
 */
export const checkStock = async (req, res) => {
    try {
        const { medicineName } = req.params;
        res.json(await findAvailability(medicineName));
    } catch (e) {
        sendError(res, e);
    }
};

// Cart Management
export const getCart = async (req, res) => {
    try {
        const { pharmacyId } = req.params;
        let cart = await Cart.findOne({ userId: req.user.id, pharmacyId })
            .populate({
                path: 'items.medicineId',
                model: 'MedicineStock',
                select: CART_MEDICINE_FIELDS
            })
            .populate('pharmacyId', 'name location contact');
            
        if (!cart) {
            cart = new Cart({ userId: req.user.id, pharmacyId, items: [] });
            await cart.save();
        }
        
        res.json(cart);
    } catch (e) {
        res.status(500).json({ message: e.message });
    }
};

export const addToCart = async (req, res) => {
    try {
        const { pharmacyId, medicineId, quantity } = req.body;
        
        // Verify medicine exists and has stock
        const medicine = await MedicineStock.findById(medicineId);
        if (!medicine) return res.status(404).json({ message: 'Medicine not found' });
        if (medicine.quantity < quantity) {
            return res.status(400).json({ message: 'Insufficient stock' });
        }
        
        let cart = await Cart.findOne({ userId: req.user.id, pharmacyId });
        
        if (!cart) {
            cart = new Cart({ userId: req.user.id, pharmacyId, items: [] });
        }
        
        const existingItemIndex = cart.items.findIndex(item => 
            item.medicineId.toString() === medicineId
        );
        
        if (existingItemIndex > -1) {
            cart.items[existingItemIndex].quantity += quantity;
        } else {
            cart.items.push({
                medicineId,
                quantity,
                price: medicine.price,
                finalPrice: medicine.finalPrice
            });
        }
        
        await cart.save();
        await cart.populate({
            path: 'items.medicineId',
            model: 'MedicineStock',
            select: CART_MEDICINE_FIELDS
        });
        
        res.json(cart);
    } catch (e) {
        res.status(500).json({ message: e.message });
    }
};

export const updateCartItem = async (req, res) => {
    try {
        const { pharmacyId, medicineId } = req.params;
        const { quantity } = req.body;
        
        if (quantity <= 0) {
            return removeFromCart(req, res);
        }
        
        // Verify stock
        const medicine = await MedicineStock.findById(medicineId);
        if (!medicine) return res.status(404).json({ message: 'Medicine not found' });
        if (medicine.quantity < quantity) {
            return res.status(400).json({ message: 'Insufficient stock' });
        }
        
        const cart = await Cart.findOne({ userId: req.user.id, pharmacyId });
        if (!cart) return res.status(404).json({ message: 'Cart not found' });
        
        const itemIndex = cart.items.findIndex(item => 
            item.medicineId.toString() === medicineId
        );
        
        if (itemIndex === -1) {
            return res.status(404).json({ message: 'Item not found in cart' });
        }
        
        cart.items[itemIndex].quantity = quantity;
        await cart.save();
        
        await cart.populate({
            path: 'items.medicineId',
            model: 'MedicineStock',
            select: CART_MEDICINE_FIELDS
        });
        
        res.json(cart);
    } catch (e) {
        res.status(500).json({ message: e.message });
    }
};

export const removeFromCart = async (req, res) => {
    try {
        const { pharmacyId, medicineId } = req.params;
        
        const cart = await Cart.findOne({ userId: req.user.id, pharmacyId });
        if (!cart) return res.status(404).json({ message: 'Cart not found' });
        
        cart.items = cart.items.filter(item => 
            item.medicineId.toString() !== medicineId
        );
        
        await cart.save();
        
        await cart.populate({
            path: 'items.medicineId',
            model: 'MedicineStock',
            select: CART_MEDICINE_FIELDS
        });
        
        res.json(cart);
    } catch (e) {
        res.status(500).json({ message: e.message });
    }
};

export const clearCart = async (req, res) => {
    try {
        const { pharmacyId } = req.params;
        
        const cart = await Cart.findOne({ userId: req.user.id, pharmacyId });
        if (!cart) return res.status(404).json({ message: 'Cart not found' });
        
        cart.items = [];
        await cart.save();
        
        res.json(cart);
    } catch (e) {
        res.status(500).json({ message: e.message });
    }
};

// Order Management
export const createOrder = async (req, res) => {
    try {
        const { pharmacyId, orderType, deliveryAddress, notes, prescriptionImage } = req.body;
        
        // Validate delivery address and phone if order is for delivery
        if (orderType === 'delivery') {
            if (!deliveryAddress || !deliveryAddress.phone) {
                return res.status(400).json({ message: 'A valid Indian mobile number is required for delivery.' });
            }
            const phoneValidation = validateIndianMobile(deliveryAddress.phone);
            if (!phoneValidation.isValid) {
                return res.status(400).json({ message: phoneValidation.error || 'Please enter a valid 10-digit Indian mobile number.' });
            }
            deliveryAddress.phone = phoneValidation.normalized;
        }

        // Get cart
        const cart = await Cart.findOne({ userId: req.user.id, pharmacyId })
            .populate('items.medicineId');
        
        if (!cart || !Array.isArray(cart.items) || cart.items.length === 0) {
            return res.status(400).json({ message: 'Cart is empty' });
        }
        
        // Verify stock and prepare order items
        const orderItems = [];
        let totalAmount = 0;
        let prescriptionRequired = false;
        
        for (const cartItem of cart.items) {
            const medicine = cartItem.medicineId;
            if (!medicine) {
                return res.status(400).json({ 
                    message: 'One or more medicines in your cart are no longer available. Please review your cart.' 
                });
            }
            if (!cartItem.quantity || cartItem.quantity < 1) {
                return res.status(400).json({ message: 'Invalid quantity in cart' });
            }
            
            if (medicine.quantity < cartItem.quantity) {
                return res.status(400).json({ 
                    message: `Insufficient stock for ${medicine.medicineName}` 
                });
            }
            
            const itemTotal = cartItem.finalPrice * cartItem.quantity;
            orderItems.push({
                medicineId: medicine._id,
                medicineName: medicine.medicineName,
                quantity: cartItem.quantity,
                price: cartItem.price,
                finalPrice: cartItem.finalPrice,
                total: itemTotal
            });
            
            totalAmount += itemTotal;
            if (medicine.prescriptionRequired) {
                prescriptionRequired = true;
            }
        }
        
        // Calculate delivery fee if applicable
        let deliveryFee = 0;
        if (orderType === 'delivery') {
            deliveryFee = totalAmount < 500 ? 50 : 0; // Free delivery above 500
            totalAmount += deliveryFee;
        }
        
        if (prescriptionRequired && !prescriptionImage) {
            return res.status(400).json({
                message: 'A photo of your prescription is needed for one or more of these medicines.',
                code: 'prescription_required'
            });
        }

        /**
         * Reserve stock before the order exists, one medicine at a time and
         * conditionally, so two people checking out the last strip cannot
         * both pass the earlier check and drive the count negative.
         */
        const reserved = [];
        for (const cartItem of cart.items) {
            const taken = await MedicineStock.findOneAndUpdate(
                { _id: cartItem.medicineId._id, quantity: { $gte: cartItem.quantity } },
                { $inc: { quantity: -cartItem.quantity }, lastUpdated: new Date() },
                { new: true }
            );

            if (!taken) {
                for (const done of reserved) {
                    await MedicineStock.findByIdAndUpdate(done.id, { $inc: { quantity: done.quantity } });
                }
                return res.status(409).json({
                    message: `${cartItem.medicineId.medicineName} was just sold out. Please review your cart.`,
                    code: 'out_of_stock'
                });
            }
            reserved.push({ id: cartItem.medicineId._id, quantity: cartItem.quantity, remaining: taken.quantity });
        }

        // Create COD order
        const order = new Order({
            userId: req.user.id,
            pharmacyId,
            items: orderItems,
            orderType,
            deliveryAddress: orderType === 'delivery' ? deliveryAddress : undefined,
            totalAmount,
            deliveryFee,
            prescriptionRequired,
            prescriptionImage: prescriptionImage || '',
            notes,
            paymentMethod: 'cod',
            paymentStatus: 'pending',
            status: 'pending'
        });

        try {
            await order.save();
        } catch (err) {
            // The order failed after stock was taken — release it again.
            for (const done of reserved) {
                await MedicineStock.findByIdAndUpdate(done.id, { $inc: { quantity: done.quantity } });
            }
            throw err;
        }

        for (const cartItem of cart.items) {
            // Emit real-time stock update
            req.io.emit('stock-updated', { 
                pharmacyId, 
                medicineId: cartItem.medicineId._id,
                newQuantity: reserved.find(r => String(r.id) === String(cartItem.medicineId._id))?.remaining
            });
        }
        
        // Clear cart
        cart.items = [];
        await cart.save();
        
        // Populate order for response
        await order.populate([
            { path: 'userId', select: 'name email phone' },
            { path: 'pharmacyId', select: 'name location contact ownerId' }
        ]);
        
        // Emit new order to pharmacy
        req.io.to(`pharmacy_${pharmacyId}`).emit('new-order', order);
        notifyPharmacyNewOrder({ order, pharmacyOwnerId: order.pharmacyId?.ownerId }).catch(() => {});
        
        res.status(201).json(order);
    } catch (e) {
        res.status(500).json({ message: e.message });
    }
};

/**
 * Create a Razorpay Order for Online Payment.
 *
 * Security & Integrity:
 * 1. Never trust amounts sent by the client. Subtotal and delivery fee are
 *    calculated strictly from active database records.
 * 2. Amount is converted to integer paise (e.g. ₹74.50 -> 7450 paise).
 * 3. Validates phone number if order is for delivery.
 * 4. Checks stock and prescription requirement.
 */
export const createRazorpayOrder = async (req, res) => {
    try {
        const { pharmacyId, orderType, deliveryAddress, prescriptionImage } = req.body;

        if (!pharmacyId) {
            return res.status(400).json({ message: 'Pharmacy ID is required' });
        }

        // Validate phone if delivery
        if (orderType === 'delivery') {
            if (!deliveryAddress || !deliveryAddress.phone) {
                return res.status(400).json({ message: 'A valid Indian mobile number is required for delivery.' });
            }
            const phoneValidation = validateIndianMobile(deliveryAddress.phone);
            if (!phoneValidation.isValid) {
                return res.status(400).json({ message: phoneValidation.error || 'Please enter a valid 10-digit Indian mobile number.' });
            }
        }

        // Get and validate cart
        const cart = await Cart.findOne({ userId: req.user.id, pharmacyId })
            .populate('items.medicineId');

        if (!cart || !Array.isArray(cart.items) || cart.items.length === 0) {
            return res.status(400).json({ message: 'Your cart is empty.' });
        }

        let totalAmount = 0;
        let prescriptionRequired = false;

        for (const cartItem of cart.items) {
            const medicine = cartItem.medicineId;
            if (!medicine) {
                return res.status(400).json({
                    message: 'One or more medicines in your cart are no longer available. Please review your cart.'
                });
            }
            if (!cartItem.quantity || cartItem.quantity < 1) {
                return res.status(400).json({ message: 'Invalid quantity in cart.' });
            }
            if (medicine.quantity < cartItem.quantity) {
                return res.status(400).json({
                    message: `Insufficient stock for ${medicine.medicineName}. Only ${medicine.quantity} available.`
                });
            }

            const itemTotal = cartItem.finalPrice * cartItem.quantity;
            totalAmount += itemTotal;
            if (medicine.prescriptionRequired) {
                prescriptionRequired = true;
            }
        }

        if (prescriptionRequired && !prescriptionImage) {
            return res.status(400).json({
                message: 'A photo of your prescription is needed for one or more of these medicines.',
                code: 'prescription_required'
            });
        }

        let deliveryFee = 0;
        if (orderType === 'delivery') {
            deliveryFee = totalAmount < 500 ? 50 : 0;
            totalAmount += deliveryFee;
        }

        // Convert to integer paise (strictly avoiding floating point imprecision)
        const amountInPaise = Math.round(totalAmount * 100);

        if (amountInPaise <= 0) {
            return res.status(400).json({ message: 'Invalid order total.' });
        }

        // Generate receipt identifier (max 40 chars)
        const receipt = `rcpt_${Date.now().toString(36)}_${req.user.id.slice(-6)}`;

        const rzpOrder = await createRzpOrder({
            amountInPaise,
            receipt,
            notes: {
                userId: req.user.id,
                pharmacyId: String(pharmacyId),
                orderType: orderType || 'delivery'
            }
        });

        res.json({
            success: true,
            razorpayOrderId: rzpOrder.id,
            amount: rzpOrder.amount, // in paise
            currency: rzpOrder.currency || 'INR',
            keyId: getPublicRazorpayKey(),
            totalAmount // formatted in rupees for display
        });
    } catch (err) {
        console.error('[createRazorpayOrder] Error:', err);
        res.status(500).json({ message: err.message || 'Failed to initiate Razorpay payment.' });
    }
};

/**
 * Verify Razorpay payment signature and create confirmed pharmacy order.
 *
 * Security & Integrity:
 * 1. Mandatory server-side HMAC-SHA256 signature verification.
 * 2. Idempotency: If an order with this razorpayOrderId already exists, return it safely.
 * 3. Atomically reserves inventory with rollback.
 * 4. Clears cart upon confirmed payment.
 * 5. Notifies pharmacy and patient via unified notification system.
 */
export const verifyRazorpayPayment = async (req, res) => {
    try {
        const {
            razorpayOrderId,
            razorpayPaymentId,
            razorpaySignature,
            pharmacyId,
            orderType,
            deliveryAddress,
            notes,
            prescriptionImage
        } = req.body;

        if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
            return res.status(400).json({
                message: 'Payment verification parameters missing (order ID, payment ID, or signature).'
            });
        }

        // 1. Mandatory HMAC SHA256 Signature Verification
        const isValidSignature = verifyPaymentSignature({
            razorpayOrderId,
            razorpayPaymentId,
            razorpaySignature
        });

        if (!isValidSignature) {
            console.warn('[verifyRazorpayPayment] Tampered or invalid signature attempt:', {
                razorpayOrderId,
                razorpayPaymentId
            });
            return res.status(400).json({
                message: 'Payment verification failed: invalid signature. Your order has not been placed.'
            });
        }

        // 2. Idempotency Check: check if order already created for this Razorpay order
        let existingOrder = await Order.findOne({ razorpayOrderId });
        if (existingOrder) {
            await existingOrder.populate([
                { path: 'userId', select: 'name email phone' },
                { path: 'pharmacyId', select: 'name location contact ownerId' }
            ]);
            return res.status(200).json(existingOrder);
        }

        // 3. Validate Delivery Address & Mobile
        if (orderType === 'delivery') {
            if (!deliveryAddress || !deliveryAddress.phone) {
                return res.status(400).json({ message: 'A valid Indian mobile number is required for delivery.' });
            }
            const phoneValidation = validateIndianMobile(deliveryAddress.phone);
            if (!phoneValidation.isValid) {
                return res.status(400).json({ message: phoneValidation.error || 'Please enter a valid 10-digit Indian mobile number.' });
            }
            deliveryAddress.phone = phoneValidation.normalized;
        }

        // 4. Retrieve cart and items
        const cart = await Cart.findOne({ userId: req.user.id, pharmacyId })
            .populate('items.medicineId');

        if (!cart || !Array.isArray(cart.items) || cart.items.length === 0) {
            return res.status(400).json({ message: 'Cart not found or empty.' });
        }

        const orderItems = [];
        let totalAmount = 0;
        let prescriptionRequired = false;

        for (const cartItem of cart.items) {
            const medicine = cartItem.medicineId;
            if (!medicine) {
                return res.status(400).json({
                    message: 'One or more medicines in your cart are no longer available.'
                });
            }
            if (!cartItem.quantity || cartItem.quantity < 1) {
                return res.status(400).json({ message: 'Invalid quantity in cart.' });
            }
            if (medicine.quantity < cartItem.quantity) {
                return res.status(400).json({
                    message: `Insufficient stock for ${medicine.medicineName}.`
                });
            }

            const itemTotal = cartItem.finalPrice * cartItem.quantity;
            orderItems.push({
                medicineId: medicine._id,
                medicineName: medicine.medicineName,
                quantity: cartItem.quantity,
                price: cartItem.price,
                finalPrice: cartItem.finalPrice,
                total: itemTotal
            });

            totalAmount += itemTotal;
            if (medicine.prescriptionRequired) {
                prescriptionRequired = true;
            }
        }

        let deliveryFee = 0;
        if (orderType === 'delivery') {
            deliveryFee = totalAmount < 500 ? 50 : 0;
            totalAmount += deliveryFee;
        }

        // 5. Reserve stock atomically with rollback
        const reserved = [];
        for (const cartItem of cart.items) {
            const taken = await MedicineStock.findOneAndUpdate(
                { _id: cartItem.medicineId._id, quantity: { $gte: cartItem.quantity } },
                { $inc: { quantity: -cartItem.quantity }, lastUpdated: new Date() },
                { new: true }
            );

            if (!taken) {
                for (const done of reserved) {
                    await MedicineStock.findByIdAndUpdate(done.id, { $inc: { quantity: done.quantity } });
                }
                return res.status(409).json({
                    message: `${cartItem.medicineId.medicineName} was just sold out. Please contact support.`,
                    code: 'out_of_stock'
                });
            }
            reserved.push({ id: cartItem.medicineId._id, quantity: cartItem.quantity, remaining: taken.quantity });
        }

        // 6. Create confirmed Order
        const order = new Order({
            userId: req.user.id,
            pharmacyId,
            items: orderItems,
            orderType,
            deliveryAddress: orderType === 'delivery' ? deliveryAddress : undefined,
            totalAmount,
            deliveryFee,
            prescriptionRequired,
            prescriptionImage: prescriptionImage || '',
            notes,
            paymentMethod: 'online',
            paymentStatus: 'paid',
            status: 'confirmed',
            razorpayOrderId,
            razorpayPaymentId,
            razorpaySignature,
            paymentVerifiedAt: new Date()
        });

        try {
            await order.save();
        } catch (err) {
            // Roll back reserved stock if order save fails
            for (const done of reserved) {
                await MedicineStock.findByIdAndUpdate(done.id, { $inc: { quantity: done.quantity } });
            }
            throw err;
        }

        // 7. Emit real-time stock updates
        for (const cartItem of cart.items) {
            req.io.emit('stock-updated', {
                pharmacyId,
                medicineId: cartItem.medicineId._id,
                newQuantity: reserved.find(r => String(r.id) === String(cartItem.medicineId._id))?.remaining
            });
        }

        // 8. Clear cart
        cart.items = [];
        await cart.save();

        // 9. Populate order details
        await order.populate([
            { path: 'userId', select: 'name email phone' },
            { path: 'pharmacyId', select: 'name location contact ownerId' }
        ]);

        // 10. Emit socket event and notify
        req.io.to(`pharmacy_${pharmacyId}`).emit('new-order', order);
        notifyPharmacyNewOrder({ order, pharmacyOwnerId: order.pharmacyId?.ownerId }).catch(() => {});

        res.status(201).json(order);
    } catch (err) {
        console.error('[verifyRazorpayPayment] Error:', err);
        res.status(500).json({ message: err.message || 'Payment verification failed.' });
    }
};

/**
 * Razorpay Webhook Handler
 *
 * Security & Integrity:
 * 1. Validates signature on raw request body (req.rawBody).
 * 2. Idempotent processing of payment.captured / order.paid / payment.failed.
 * 3. Never throws unhandled errors to avoid infinite webhook retry storms.
 */
export const handleRazorpayWebhook = async (req, res) => {
    try {
        const webhookSignature = req.headers['x-razorpay-signature'];
        if (!webhookSignature || !req.rawBody) {
            console.warn('[Razorpay Webhook] Missing signature or rawBody buffer');
            return res.status(400).json({ message: 'Missing signature or payload buffer' });
        }

        const isValid = verifyWebhookSignature(req.rawBody, webhookSignature);
        if (!isValid) {
            console.warn('[Razorpay Webhook] Invalid webhook signature received');
            return res.status(400).json({ message: 'Invalid webhook signature' });
        }

        const { event, payload } = req.body;
        console.log(`[Razorpay Webhook] Processing event: ${event}`);

        if (event === 'payment.captured' || event === 'order.paid') {
            const paymentEntity = payload?.payment?.entity;
            const rzpOrderId = paymentEntity?.order_id || payload?.order?.entity?.id;
            const rzpPaymentId = paymentEntity?.id;

            if (rzpOrderId) {
                const order = await Order.findOne({ razorpayOrderId: rzpOrderId });
                if (order) {
                    let changed = false;
                    if (order.paymentStatus !== 'paid') {
                        order.paymentStatus = 'paid';
                        if (order.status === 'pending') {
                            order.status = 'confirmed';
                        }
                        order.paymentVerifiedAt = order.paymentVerifiedAt || new Date();
                        changed = true;
                    }
                    if (rzpPaymentId && !order.razorpayPaymentId) {
                        order.razorpayPaymentId = rzpPaymentId;
                        changed = true;
                    }
                    if (changed) {
                        await order.save();
                        console.log(`[Razorpay Webhook] Order ${order.orderId} updated to paid/confirmed.`);
                    }
                }
            }
        } else if (event === 'payment.failed') {
            const paymentEntity = payload?.payment?.entity;
            const rzpOrderId = paymentEntity?.order_id;
            if (rzpOrderId) {
                const order = await Order.findOne({ razorpayOrderId: rzpOrderId });
                if (order && order.paymentStatus !== 'paid') {
                    order.paymentStatus = 'failed';
                    await order.save();
                    notifyPharmacyPaymentFailed({
                        userId: order.userId,
                        orderId: order._id,
                        humanOrderId: order.orderId
                    }).catch(() => {});
                    console.log(`[Razorpay Webhook] Order ${order.orderId} marked as payment failed.`);
                }
            }
        }

        return res.status(200).json({ status: 'ok' });
    } catch (err) {
        console.error('[Razorpay Webhook] Error:', err);
        return res.status(500).json({ message: 'Webhook processing error' });
    }
};


export const getOrders = async (req, res) => {
    try {
        const { status, page = 1, limit = 10 } = req.query;
        
        let query = { userId: req.user.id };
        if (status && status !== 'all') {
            query.status = status;
        }
        
        const orders = await Order.find(query)
            .populate('pharmacyId', 'name location contact')
            .sort({ createdAt: -1 })
            .limit(limit * 1)
            .skip((page - 1) * limit);
            
        const total = await Order.countDocuments(query);
        
        res.json({
            orders,
            totalPages: Math.ceil(total / limit),
            currentPage: page,
            total
        });
    } catch (e) {
        res.status(500).json({ message: e.message });
    }
};

export const getPharmacyOrders = async (req, res) => {
    try {
        const pharmacy = await Pharmacy.findOne({ ownerId: req.user.id });
        if (!pharmacy) return res.status(404).json({ message: 'Pharmacy not found' });
        
        const { status, page = 1, limit = 10 } = req.query;
        
        let query = { pharmacyId: pharmacy._id };
        if (status && status !== 'all') {
            query.status = status;
        }
        
        const orders = await Order.find(query)
            .populate('userId', 'name email phone')
            // The prescription photo is a base64 image. Ten of them in one
            // page of orders is megabytes over a connection that can barely
            // carry the list itself, and most orders do not have one — so it
            // is fetched per order, only when the pharmacist opens it.
            .select('-prescriptionImage')
            .sort({ createdAt: -1 })
            .limit(limit * 1)
            .skip((page - 1) * limit);
            
        const total = await Order.countDocuments(query);
        
        res.json({
            orders,
            totalPages: Math.ceil(total / limit),
            currentPage: page,
            total
        });
    } catch (e) {
        res.status(500).json({ message: e.message });
    }
};

export const updateOrderStatus = async (req, res) => {
    try {
        const pharmacy = await Pharmacy.findOne({ ownerId: req.user.id });
        if (!pharmacy) return res.status(404).json({ message: 'Pharmacy not found' });
        
        const { orderId } = req.params;
        const { status, note } = req.body;
        
        const order = await Order.findOne({ 
            _id: orderId, 
            pharmacyId: pharmacy._id 
        });
        
        if (!order) return res.status(404).json({ message: 'Order not found' });
        
        order.updateStatus(status, note);
        await order.save();
        
        // Emit order status update
        req.io.to(`user_${order.userId}`).emit('order-status-updated', {
            orderId: order._id,
            status,
            note
        });
        
        // Push notification to patient
        notifyPharmacyOrderStatus({ order, status, note }).catch(() => {});
        
        res.json(order);
    } catch (e) {
        res.status(500).json({ message: e.message });
    }
};

export const getOrderById = async (req, res) => {
    try {
        const { orderId } = req.params;
        if (!orderId) return res.status(400).json({ message: 'Order ID is required' });

        const query = mongoose.Types.ObjectId.isValid(orderId)
            ? { _id: orderId }
            : { orderId: String(orderId).toUpperCase() };

        const order = await Order.findOne(query)
            .populate('userId', 'name email phone')
            .populate('pharmacyId', 'name location contact address ownerId');

        if (!order) return res.status(404).json({ message: 'Order not found' });

        const orderUserId = String(order.userId?._id || order.userId);
        const pharmacyOwnerId = String(order.pharmacyId?.ownerId?._id || order.pharmacyId?.ownerId);
        const currentUserId = String(req.user.id);

        const isPatient = orderUserId === currentUserId;
        const isPharmacy = pharmacyOwnerId === currentUserId;

        if (!isPatient && !isPharmacy) {
            return res.status(403).json({ message: 'Access denied' });
        }
        
        res.json(order);
    } catch (e) {
        res.status(500).json({ message: e.message });
    }
};


