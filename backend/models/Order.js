import mongoose from 'mongoose';

const orderItemSchema = new mongoose.Schema({
    medicineId: { type: mongoose.Schema.Types.ObjectId, ref: 'MedicineStock', required: true },
    medicineName: { type: String, required: true },
    quantity: { type: Number, required: true, min: 1 },
    price: { type: Number, required: true },
    finalPrice: { type: Number, required: true },
    total: { type: Number, required: true }
}, { _id: false });

const addressSchema = new mongoose.Schema({
    name: { type: String, required: true },
    phone: { type: String, required: true },
    addressLine1: { type: String, required: true },
    addressLine2: { type: String, default: '' },
    city: { type: String, required: true },
    state: { type: String, required: true },
    pincode: { type: String, required: true },
    landmark: { type: String, default: '' }
}, { _id: false });

const orderSchema = new mongoose.Schema({
    orderId: { type: String, unique: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    pharmacyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Pharmacy', required: true },
    items: [orderItemSchema],
    orderType: { type: String, enum: ['delivery', 'pickup'], required: true },
    deliveryAddress: { type: addressSchema },
    totalAmount: { type: Number, required: true },
    status: { 
        type: String, 
        enum: ['pending', 'confirmed', 'preparing', 'ready', 'dispatched', 'delivered', 'cancelled'], 
        default: 'pending' 
    },
    paymentMethod: { type: String, enum: ['cod', 'online'], default: 'cod' },
    paymentStatus: { type: String, enum: ['pending', 'paid', 'failed'], default: 'pending' },
    razorpayOrderId: { type: String, index: true },
    razorpayPaymentId: { type: String },
    razorpaySignature: { type: String },
    paymentVerifiedAt: { type: Date },
    notes: { type: String, default: '' },
    estimatedDelivery: { type: Date },
    deliveryFee: { type: Number, default: 0 },
    prescriptionRequired: { type: Boolean, default: false },
    prescriptionImage: { type: String, default: '' },
    statusHistory: [{
        status: { type: String, required: true },
        timestamp: { type: Date, default: Date.now },
        note: { type: String, default: '' }
    }]
}, { timestamps: true });

// Indexes for efficient queries
orderSchema.index({ userId: 1, createdAt: -1 });
orderSchema.index({ pharmacyId: 1, createdAt: -1 });
orderSchema.index({ status: 1 });

// Generate order ID
orderSchema.pre('save', function(next) {
    if (!this.orderId || this.orderId === '') {
        const timestamp = Date.now().toString(36);
        const random = Math.random().toString(36).substr(2, 5);
        this.orderId = `ORD-${timestamp}-${random}`.toUpperCase();
    }
    
    // Initialize statusHistory if empty
    if (this.statusHistory.length === 0) {
        this.statusHistory.push({
            status: this.status || 'pending',
            timestamp: new Date(),
            note: 'Order created'
        });
    }
    
    next();
});

// Method to add status to history
orderSchema.methods.updateStatus = function(newStatus, note = '') {
    this.status = newStatus;
    this.statusHistory.push({
        status: newStatus,
        timestamp: new Date(),
        note: note
    });
};

export default mongoose.model('Order', orderSchema);