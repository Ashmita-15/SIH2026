import mongoose from 'mongoose';
import TriageAssessment from '../models/TriageAssessment.js';
import User from '../models/User.js';
import { mayAccessTimeline } from '../services/timelineService.js';

/**
 * Reading back what a patient already described.
 *
 * Authorisation reuses `mayAccessTimeline` rather than inventing a second
 * answer to "may this clinician see this person" — a triage assessment is no
 * less private than the history it would sit beside.
 */

const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * GET /api/triage/latest/:patientId
 *
 * Returns the patient's most recent self-reported triage, or null. Null is a
 * normal answer, not an error: most patients will never have used the
 * assistant, and the referral form has to work identically for them.
 */
export const getLatestForPatient = async (req, res) => {
    try {
        const actor = await User.findById(req.user?.id).select('role hospitalId catchmentVillages');
        if (!actor) return res.status(403).json({ message: 'Acting user not found' });

        // Checked before the query rather than caught after it: an unparseable
        // id must answer exactly like a real id outside this worker's scope,
        // and a cast error escaping as a 500 would tell them the difference.
        if (!mongoose.isValidObjectId(req.params.patientId)) {
            return res.status(404).json({ message: 'Patient not found' });
        }

        const patient = await User.findOne({ _id: req.params.patientId, role: 'patient' })
            .select('_id village');
        // Same reply for "no such patient" and "not yours": an id outside this
        // clinician's scope must not be confirmable by probing.
        if (!patient) return res.status(404).json({ message: 'Patient not found' });
        if (!await mayAccessTimeline(actor, patient)) {
            return res.status(404).json({ message: 'Patient not found' });
        }

        const doc = await TriageAssessment.findOne({ patientId: patient._id })
            .sort({ createdAt: -1 })
            .lean();

        if (!doc) return res.json({ assessment: null });

        return res.json({
            assessment: {
                level: doc.level,
                referralPriority: doc.referralPriority,
                symptoms: doc.symptoms || [],
                durationDays: doc.durationDays ?? null,
                pregnant: Boolean(doc.pregnant),
                createdAt: doc.createdAt,
                // Computed here so every caller agrees on what "old" means.
                stale: Date.now() - new Date(doc.createdAt).getTime() > STALE_AFTER_MS
            }
        });
    } catch (err) {
        return res.status(500).json({ message: err.message });
    }
};
