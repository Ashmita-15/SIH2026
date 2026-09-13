import User from '../models/User.js';
import bcrypt from 'bcryptjs';

const OBJECT_ID = /^[a-f0-9]{24}$/i;

/**
 * A user's own profile. Only the account itself may read it: it carries
 * email, phone, village and — for a patient — details nobody else should be
 * able to fetch by id. Other people's public doctor profiles are served by
 * getDoctorProfile below.
 */
export const getUserProfile = async (req, res) => {
    try {
        const userId = req.params.id;
        if (!OBJECT_ID.test(String(userId))) {
            return res.status(400).json({ message: 'Invalid user id' });
        }
        if (String(req.user.id) !== String(userId)) {
            return res.status(403).json({ message: 'You can only view your own profile' });
        }
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
 * Doctors, as everyone else is allowed to see them.
 *
 * These endpoints used to return only doctors with an active session, for
 * every caller. Booking is session-only, so that suited the booking picker —
 * but the same list backs the patient's "Find a doctor" page, a hospital
 * adding a doctor to its staff, and a health worker requesting an assisted
 * consultation (which books by slot, not session). All of those showed only
 * the doctors who happened to have configured a session, which is why a
 * database with many doctors displayed one.
 *
 * Now every doctor is listed with `bookable` saying whether a patient can
 * book them right now, and the booking flow asks for `?bookable=true`.
 * `sessions.active` is matched with $elemMatch: a plain
 * `{'sessions.active': true}` is satisfied by any element.
 *
 * The response is an explicit projection — the full user document carried
 * email, facility location and other fields a patient has no need for. A
 * hospital account also receives email, because adding a doctor to its staff
 * is done by the email the doctor registered with.
 */
const PUBLIC_DOCTOR_FIELDS = 'name specialization qualification availability profilePicture bio hospitalId sessions';

function publicDoctor(doctor, { includeEmail = false } = {}) {
    return {
        _id: doctor._id,
        name: doctor.name,
        specialization: doctor.specialization || '',
        qualification: doctor.qualification || '',
        availability: doctor.availability || '',
        profilePicture: doctor.profilePicture || '',
        bio: doctor.bio || '',
        hospitalId: doctor.hospitalId || null,
        bookable: (doctor.sessions || []).some(s => s.active),
        ...(includeEmail ? { email: doctor.email } : {})
    };
}

async function findDoctors(req) {
    const includeEmail = req.user?.role === 'hospital';
    const filter = { role: 'doctor' };
    if (String(req.query.bookable) === 'true') {
        filter.sessions = { $elemMatch: { active: true } };
    }
    const doctors = await User.find(filter)
        .select(PUBLIC_DOCTOR_FIELDS + (includeEmail ? ' email' : ''))
        .sort({ name: 1 })
        .lean();
    return doctors.map(d => publicDoctor(d, { includeEmail }));
}

export const getDoctors = async (req, res) => {
    try {
        res.json(await findDoctors(req));
    } catch (e) {
        res.status(500).json({ message: e.message });
    }
};

export const getDoctorsBySpecialization = async (req, res) => {
    try {
        const doctors = await findDoctors(req);

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

/**
 * GET /api/users/doctor/:id — one doctor's public profile.
 *
 * Previously this was the generic profile handler, so any signed-in user could
 * read any account — a patient included — by putting its id here, and a
 * malformed id surfaced as a 500.
 */
export const getDoctorProfile = async (req, res) => {
    try {
        const { id } = req.params;
        if (!OBJECT_ID.test(String(id))) {
            return res.status(400).json({ message: 'Invalid doctor id' });
        }
        const doctor = await User.findOne({ _id: id, role: 'doctor' }).select(PUBLIC_DOCTOR_FIELDS).lean();
        if (!doctor) {
            return res.status(404).json({ message: 'Doctor not found' });
        }
        res.json(publicDoctor(doctor));
    } catch (e) {
        res.status(500).json({ message: e.message });
    }
};
