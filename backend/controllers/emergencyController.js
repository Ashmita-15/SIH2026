import Hospital from '../models/Hospital.js';
import User from '../models/User.js';
import { sendMail } from '../services/notifications/mailer.js';
import { emergencyAlertEmail } from '../services/notifications/emailTemplates.js';

/**
 * POST /api/emergency/alert-nearest
 *
 * A patient presses the emergency button, their browser provides live
 * coordinates, and this endpoint finds the nearest active hospital with an
 * email address and sends it an urgent alert containing the patient's name
 * and a Google Maps link to their location.
 *
 * Uses the existing 2dsphere index on Hospital.location — no new indexes
 * or schema changes required.
 */
export const alertNearestHospital = async (req, res) => {
    try {
        const { latitude, longitude } = req.body;

        if (latitude == null || longitude == null ||
            typeof latitude !== 'number' || typeof longitude !== 'number' ||
            latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
            return res.status(400).json({ message: 'Valid latitude and longitude are required.' });
        }

        // Fetch the patient's name from the database
        const patient = await User.findById(req.user.id).select('name').lean();
        if (!patient) {
            return res.status(404).json({ message: 'Patient not found.' });
        }

        // Find the nearest active hospital that has an email address.
        // $near requires the 2dsphere index, which is already on Hospital.location.
        // MongoDB returns results sorted by proximity, so findOne gives us the closest.
        const hospital = await Hospital.findOne({
            isActive: true,
            email: { $exists: true, $ne: '' },
            location: {
                $near: {
                    $geometry: {
                        type: 'Point',
                        coordinates: [longitude, latitude] // GeoJSON is [lng, lat]
                    },
                    $maxDistance: 10000_000 // 100 km — a generous ceiling
                }
            }
        }).select('name email location address').lean();

        if (!hospital) {
            return res.status(404).json({ message: 'No hospital found nearby. Please call emergency services directly.' });
        }

        // Calculate approximate distance (Haversine) for display
        const [hospLng, hospLat] = hospital.location.coordinates;
        const distanceKm = haversineKm(latitude, longitude, hospLat, hospLng);

        // Build and send the email
        const emailData = emergencyAlertEmail({
            patientName: patient.name,
            latitude,
            longitude,
            timestamp: new Date().toISOString()
        });

        const mailResult = await sendMail({
            to: hospital.email,
            subject: emailData.subject,
            html: emailData.html
        });

        res.json({
            message: 'Emergency alert sent successfully.',
            hospital: {
                name: hospital.name,
                address: hospital.address,
                distanceKm: Math.round(distanceKm * 10) / 10
            },
            emailSent: mailResult.sent
        });
    } catch (e) {
        console.error('[emergency] alertNearestHospital error:', e.message);
        res.status(500).json({ message: 'Failed to send emergency alert. Please call emergency services directly.' });
    }
};

/**
 * Haversine formula — returns the great-circle distance in km between two
 * lat/lng points. Good enough for "nearest hospital" display purposes.
 */
function haversineKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRad(deg) { return deg * (Math.PI / 180); }
