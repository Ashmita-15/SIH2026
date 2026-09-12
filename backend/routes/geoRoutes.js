import { Router } from 'express';
import { reverseGeocode, isValidLatLon } from '../services/geocode.js';

const router = Router();

/**
 * GET /api/geo/reverse?lat=&lon=
 *
 * Public on purpose: it is used on the sign-up screen, before any account
 * exists to authenticate. It exposes nothing about this system — it is a
 * proxy to a public map service that anybody could call directly, and it
 * reads no database and no secret.
 *
 * 502 rather than 200-with-empty when lookup fails, so the sign-up screen can
 * tell "we could not find an address" from "this place has no name".
 */
router.get('/reverse', async (req, res) => {
    const lat = Number(req.query.lat);
    const lon = Number(req.query.lon);
    if (!isValidLatLon(lat, lon)) {
        return res.status(400).json({ message: 'A valid lat and lon are required' });
    }

    const found = await reverseGeocode(lat, lon);
    if (!found) {
        return res.status(502).json({ message: 'Could not look up an address for that location' });
    }
    return res.json({ address: found.address });
});

export default router;
