import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import Hospital from '../models/Hospital.js';
import { notifyAccountCreated } from '../services/notifications/notificationService.js';
export const register = async (req, res) => {
    try {
        const { name, email, password, role, age, village, specialization, qualification, availability, workerType } = req.body;
        const existing = await User.findOne({ email });
        if (existing) return res.status(400).json({ message: 'Email already registered' });

        /**
         * A health worker is only useful once we know which kind they are and
         * which villages they cover: the worker type decides what their
         * dashboard offers, and the catchment is what scopes every patient
         * query they make. Registering one without those produces an account
         * that signs in successfully and then sees nobody, which reads as a
         * broken app rather than an incomplete profile.
         */
        if (role === 'health_worker') {
            if (!['asha', 'anm', 'cho'].includes(workerType)) {
                return res.status(400).json({ message: 'Choose whether you are an ASHA, ANM or CHO' });
            }
            if (!String(village || '').trim()) {
                return res.status(400).json({ message: 'Your village is required' });
            }
        }

        const passwordHash = await bcrypt.hash(password, 10);

        let user;
        if (role === 'hospital') {
            // Create hospital user
            user = await User.create({ name, email, passwordHash, role });

            // For hospital registration, we need additional info in a separate endpoint
            // since hospital has more fields than what's collected during basic registration
        } else if (role === 'health_worker') {
            user = await User.create({
                name, email, passwordHash, role, workerType,
                village: String(village).trim(),
                // Their own village to begin with. Villages are matched
                // case-insensitively, so the spelling they typed is fine here.
                catchmentVillages: [String(village).trim()]
                // hospitalId is deliberately left unset — see the note in the
                // sign-up screen. A facility attaches them, they do not claim it.
            });
        } else {
            // Regular user registration
            user = await User.create({ name, email, passwordHash, role, age, village, specialization, qualification, availability });
        }
        // Fire-and-forget: a slow or failing mail server must never delay
        // or break the response to a successful registration.
        notifyAccountCreated(user).catch(() => {});
        return res.status(201).json({ id: user._id, name: user.name, email: user.email, role: user.role });
    } catch (e) {
        return res.status(500).json({ message: e.message });
    }
};

export const login = async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email });
        if (!user) return res.status(400).json({ message: 'Invalid credentials' });
        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) return res.status(400).json({ message: 'Invalid credentials' });
        /**
         * The token deliberately still carries only id, role and name.
         *
         * Facility membership decides what a health worker may reach, and a
         * claim baked into a token stays true for seven days after the person
         * has been moved somewhere else. Every check reads it from the database
         * instead; what is returned here is for the interface to render, not
         * for the server to trust.
         */
        const token = jwt.sign({ id: user._id, role: user.role, name: user.name }, process.env.JWT_SECRET || 'dev_secret', { expiresIn: '7d' });
        return res.json({
            token,
            user: {
                id: user._id,
                role: user.role,
                name: user.name,
                ...(user.workerType ? { workerType: user.workerType } : {}),
                ...(user.hospitalId ? { hospitalId: user.hospitalId } : {})
            }
        });
    } catch (e) {
        return res.status(500).json({ message: e.message });
    }
};


