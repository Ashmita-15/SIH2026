import Hospital from '../models/Hospital.js';
import User from '../models/User.js';
import Pharmacy from '../models/Pharmacy.js';

/**
 * The facility this hospital account manages.
 *
 * Previously every lookup here was findOne({ ownerId }), while the referral
 * inbox and facility dashboard read User.hospitalId. An account owning more
 * than one Hospital record (a seeded profile plus one created later) could
 * attach its doctors and health workers to one record while its inbox read the
 * other. The linked record wins; ownerId alone is only the fallback for an
 * account that was never linked.
 */
async function ownedHospitalFilter(userId) {
    const user = await User.findById(userId).select('hospitalId').lean();
    if (user?.hospitalId && await Hospital.exists({ _id: user.hospitalId, ownerId: userId })) {
        return { _id: user.hospitalId, ownerId: userId };
    }
    return { ownerId: userId };
}

// Create hospital profile
export const createHospitalProfile = async (req, res) => {
    try {
        const userId = req.user.id;
        const { name, email, phone, address, description, location, contactPerson, website, services } = req.body;
        
        // Check if user is hospital role
        const user = await User.findById(userId);
        if (!user || user.role !== 'hospital') {
            return res.status(403).json({ message: 'Unauthorized to create hospital profile' });
        }
        
        // Check if hospital already exists for this user
        const existingHospital = await Hospital.findOne(await ownedHospitalFilter(userId));
        if (existingHospital) {
            return res.status(400).json({ message: 'Hospital profile already exists' });
        }
        
        // Create hospital
        const hospital = await Hospital.create({
            name,
            email,
            phone,
            address,
            description,
            location: {
                type: 'Point',
                coordinates: location.coordinates
            },
            contactPerson,
            website,
            services,
            ownerId: userId
        });
        
        // Update user with hospitalId
        await User.findByIdAndUpdate(userId, { hospitalId: hospital._id });
        
        res.status(201).json(hospital);
    } catch (e) {
        res.status(500).json({ message: e.message });
    }
};

// Get hospital profile
export const getHospitalProfile = async (req, res) => {
    try {
        const userId = req.user.id;
        
        const hospital = await Hospital.findOne(await ownedHospitalFilter(userId))
            .populate('doctors', 'name email specialization qualification phone')
            .populate('pharmacies', 'name location address contact email');
        
        if (!hospital) {
            return res.status(404).json({ message: 'Hospital profile not found' });
        }
        
        res.json(hospital);
    } catch (e) {
        res.status(500).json({ message: e.message });
    }
};

// Update hospital profile
export const updateHospitalProfile = async (req, res) => {
    try {
        const userId = req.user.id;
        const { name, email, phone, address, description, location, contactPerson, website, services, isActive } = req.body;
        
        const hospital = await Hospital.findOne(await ownedHospitalFilter(userId));
        if (!hospital) {
            return res.status(404).json({ message: 'Hospital profile not found' });
        }
        
        // Update fields
        if (name) hospital.name = name;
        if (email) hospital.email = email;
        if (phone) hospital.phone = phone;
        if (address) hospital.address = address;
        if (description) hospital.description = description;
        if (location && location.coordinates) {
            hospital.location.coordinates = location.coordinates;
        }
        if (contactPerson) hospital.contactPerson = contactPerson;
        if (website) hospital.website = website;
        if (services) hospital.services = services;
        if (isActive !== undefined) hospital.isActive = isActive;
        
        await hospital.save();
        
        res.json(hospital);
    } catch (e) {
        res.status(500).json({ message: e.message });
    }
};

// Add doctor to hospital
export const addDoctorToHospital = async (req, res) => {
    try {
        const userId = req.user.id;
        const { doctorId } = req.body;
        
        // Find hospital
        const hospital = await Hospital.findOne(await ownedHospitalFilter(userId));
        if (!hospital) {
            return res.status(404).json({ message: 'Hospital profile not found' });
        }
        
        // Check if doctor exists and is a doctor role
        const doctor = await User.findById(doctorId);
        if (!doctor || doctor.role !== 'doctor') {
            return res.status(400).json({ message: 'Invalid doctor ID' });
        }
        
        // Check if doctor is already associated with hospital
        if (hospital.doctors.includes(doctorId)) {
            return res.status(400).json({ message: 'Doctor already associated with this hospital' });
        }
        
        // Add doctor to hospital
        hospital.doctors.push(doctorId);
        await hospital.save();
        
        // Update doctor's hospitalId
        await User.findByIdAndUpdate(doctorId, { hospitalId: hospital._id });
        
        res.json({ message: 'Doctor added successfully', hospital });
    } catch (e) {
        res.status(500).json({ message: e.message });
    }
};

// Remove doctor from hospital
export const removeDoctorFromHospital = async (req, res) => {
    try {
        const userId = req.user.id;
        const { doctorId } = req.body;
        
        // Find hospital
        const hospital = await Hospital.findOne(await ownedHospitalFilter(userId));
        if (!hospital) {
            return res.status(404).json({ message: 'Hospital profile not found' });
        }
        
        // Check if doctor is associated with hospital
        if (!hospital.doctors.includes(doctorId)) {
            return res.status(400).json({ message: 'Doctor not associated with this hospital' });
        }
        
        // Remove doctor from hospital
        hospital.doctors = hospital.doctors.filter(id => id.toString() !== doctorId.toString());
        await hospital.save();
        
        // Update doctor's hospitalId
        await User.findByIdAndUpdate(doctorId, { hospitalId: null });
        
        res.json({ message: 'Doctor removed successfully', hospital });
    } catch (e) {
        res.status(500).json({ message: e.message });
    }
};

// Add pharmacy to hospital
export const addPharmacyToHospital = async (req, res) => {
    try {
        const userId = req.user.id;
        const { pharmacyId } = req.body;
        
        // Find hospital
        const hospital = await Hospital.findOne(await ownedHospitalFilter(userId));
        if (!hospital) {
            return res.status(404).json({ message: 'Hospital profile not found' });
        }
        
        // Check if pharmacy exists
        const pharmacy = await Pharmacy.findById(pharmacyId);
        if (!pharmacy) {
            return res.status(400).json({ message: 'Invalid pharmacy ID' });
        }
        
        // Check if pharmacy is already associated with hospital
        if (hospital.pharmacies.includes(pharmacyId)) {
            return res.status(400).json({ message: 'Pharmacy already associated with this hospital' });
        }
        
        // Add pharmacy to hospital
        hospital.pharmacies.push(pharmacyId);
        await hospital.save();
        
        res.json({ message: 'Pharmacy added successfully', hospital });
    } catch (e) {
        res.status(500).json({ message: e.message });
    }
};

// Remove pharmacy from hospital
export const removePharmacyFromHospital = async (req, res) => {
    try {
        const userId = req.user.id;
        const { pharmacyId } = req.body;
        
        // Find hospital
        const hospital = await Hospital.findOne(await ownedHospitalFilter(userId));
        if (!hospital) {
            return res.status(404).json({ message: 'Hospital profile not found' });
        }
        
        // Check if pharmacy is associated with hospital
        if (!hospital.pharmacies.includes(pharmacyId)) {
            return res.status(400).json({ message: 'Pharmacy not associated with this hospital' });
        }
        
        // Remove pharmacy from hospital
        hospital.pharmacies = hospital.pharmacies.filter(id => id.toString() !== pharmacyId.toString());
        await hospital.save();
        
        res.json({ message: 'Pharmacy removed successfully', hospital });
    } catch (e) {
        res.status(500).json({ message: e.message });
    }
};

// Get all doctors in hospital
export const getDoctorsInHospital = async (req, res) => {
    try {
        const userId = req.user.id;
        
        const hospital = await Hospital.findOne(await ownedHospitalFilter(userId)).populate('doctors', 'name email specialization qualification phone availability');
        if (!hospital) {
            return res.status(404).json({ message: 'Hospital profile not found' });
        }
        
        res.json(hospital.doctors);
    } catch (e) {
        res.status(500).json({ message: e.message });
    }
};

// Get all pharmacies in hospital
export const getPharmaciesInHospital = async (req, res) => {
    try {
        const userId = req.user.id;
        
        const hospital = await Hospital.findOne(await ownedHospitalFilter(userId)).populate('pharmacies', 'name location address contact email');
        if (!hospital) {
            return res.status(404).json({ message: 'Hospital profile not found' });
        }
        
        res.json(hospital.pharmacies);
    } catch (e) {
        res.status(500).json({ message: e.message });
    }
};
/**
 * A facility's frontline workers.
 *
 * Mirrors the doctor functions above: the hospital is looked up from the
 * authenticated owner, so a body claiming a different hospitalId reaches
 * nothing. Attachment is written to User.hospitalId, which is the field every
 * referral, encounter and assisted appointment already derives from — there is
 * no second relationship to keep in step.
 */
export const getHealthWorkersInHospital = async (req, res) => {
    try {
        const hospital = await Hospital.findOne(await ownedHospitalFilter(req.user.id));
        if (!hospital) return res.status(404).json({ message: 'Hospital profile not found' });

        const [attached, unattached] = await Promise.all([
            User.find({ role: 'health_worker', hospitalId: hospital._id })
                .select('name email workerType village catchmentVillages').lean(),
            // Offered for attaching. A worker already at another facility is
            // not shown: they belong to one facility, and poaching them here
            // would silently detach them from somewhere else.
            User.find({ role: 'health_worker', $or: [{ hospitalId: null }, { hospitalId: { $exists: false } }] })
                .select('name email workerType village catchmentVillages').lean()
        ]);

        res.json({ attached, unattached });
    } catch (e) {
        res.status(500).json({ message: e.message });
    }
};

export const addHealthWorkerToHospital = async (req, res) => {
    try {
        const { workerId } = req.body;
        const hospital = await Hospital.findOne(await ownedHospitalFilter(req.user.id));
        if (!hospital) return res.status(404).json({ message: 'Hospital profile not found' });

        const worker = await User.findById(workerId).select('role hospitalId name');
        if (!worker || worker.role !== 'health_worker') {
            return res.status(400).json({ message: 'That user is not a health worker' });
        }
        if (worker.hospitalId && String(worker.hospitalId) === String(hospital._id)) {
            return res.status(400).json({ message: 'Already part of this facility' });
        }
        if (worker.hospitalId) {
            return res.status(409).json({ message: 'This worker already belongs to another facility' });
        }

        await User.findByIdAndUpdate(workerId, { hospitalId: hospital._id });
        res.json({ message: 'Health worker added successfully' });
    } catch (e) {
        res.status(500).json({ message: e.message });
    }
};

export const removeHealthWorkerFromHospital = async (req, res) => {
    try {
        const { workerId } = req.body;
        const hospital = await Hospital.findOne(await ownedHospitalFilter(req.user.id));
        if (!hospital) return res.status(404).json({ message: 'Hospital profile not found' });

        const worker = await User.findById(workerId).select('role hospitalId');
        // Only its own. A facility must not be able to detach somebody else's
        // worker by guessing an id.
        if (!worker || worker.role !== 'health_worker' || String(worker.hospitalId || '') !== String(hospital._id)) {
            return res.status(404).json({ message: 'That worker is not part of this facility' });
        }

        await User.findByIdAndUpdate(workerId, { hospitalId: null });
        res.json({ message: 'Health worker removed successfully' });
    } catch (e) {
        res.status(500).json({ message: e.message });
    }
};
