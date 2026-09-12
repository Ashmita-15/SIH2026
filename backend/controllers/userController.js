import User from '../models/User.js';
import bcrypt from 'bcryptjs';

export const getUserProfile = async (req, res) => {
    try {
        const userId = req.params.id;
        const user = await User.findById(userId).select('-passwordHash');
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        res.json(user);
    } catch (e) {
        res.status(500).json({ message: e.message });
    }
};

export const updateUserProfile = async (req, res) => {
    try {
        const userId = req.params.id;
        
        // Ensure user can only update their own profile
        if (req.user.id !== userId) {
            return res.status(403).json({ message: 'Not authorized to update this profile' });
        }
        
        const { name, age, village, specialization, qualification, availability, profilePicture } = req.body;
        
        const updateData = {};
        if (name) updateData.name = name;
        if (age) updateData.age = age;
        if (village) updateData.village = village;
        if (specialization) updateData.specialization = specialization;
        if (qualification) updateData.qualification = qualification;
        if (availability) updateData.availability = availability;
        if (profilePicture) updateData.profilePicture = profilePicture;
        
        const user = await User.findByIdAndUpdate(
            userId,
            { $set: updateData },
            { new: true }
        ).select('-passwordHash');
        
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        
        res.json(user);
    } catch (e) {
        res.status(500).json({ message: e.message });
    }
};

export const updatePassword = async (req, res) => {
    try {
        const userId = req.params.id;
        
        // Ensure user can only update their own password
        if (req.user.id !== userId) {
            return res.status(403).json({ message: 'Not authorized to update this password' });
        }
        
        const { currentPassword, newPassword } = req.body;
        
        // Find the user
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        
        // Verify current password
        const isMatch = await bcrypt.compare(currentPassword, user.passwordHash);
        if (!isMatch) {
            return res.status(400).json({ message: 'Current password is incorrect' });
        }
        
        // Hash new password
        const passwordHash = await bcrypt.hash(newPassword, 10);
        
        // Update password
        user.passwordHash = passwordHash;
        await user.save();
        
        res.json({ message: 'Password updated successfully' });
    } catch (e) {
        res.status(500).json({ message: e.message });
    }
};

/**
 * A doctor is bookable when they have configured at least one active session.
 *
 * Booking is session-only, so a doctor with no session has nothing a patient
 * could book — listing them produces a dead end where the picker shows "no
 * clinic on any day". They are not deleted or deactivated: the account works,
 * and the moment a session is added they appear here.
 *
 * `sessions.active` must be matched with $elemMatch. A plain
 * `{'sessions.active': true}` is satisfied by *any* element, so a doctor whose
 * only session had been switched off would still have counted.
 */
const BOOKABLE_DOCTOR = {
    role: 'doctor',
    sessions: { $elemMatch: { active: true } }
};

export const getDoctors = async (req, res) => {
    try {
        const doctors = await User.find(BOOKABLE_DOCTOR).select('-passwordHash');
        res.json(doctors);
    } catch (e) {
        res.status(500).json({ message: e.message });
    }
};

export const getDoctorsBySpecialization = async (req, res) => {
    try {
        const doctors = await User.find(BOOKABLE_DOCTOR).select('-passwordHash');

        // Group doctors by specialization
        const doctorsBySpecialization = doctors.reduce((acc, doctor) => {
            const specialization = doctor.specialization || 'General';
            if (!acc[specialization]) {
                acc[specialization] = [];
            }
            acc[specialization].push(doctor);
            return acc;
        }, {});
        
        res.json(doctorsBySpecialization);
    } catch (e) {
        res.status(500).json({ message: e.message });
    }
};