import { Router } from 'express';
import { reverseGeocode, forwardGeocode, isValidLatLon } from '../services/geocode.js';

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

/**
 * GET /api/geo/search?q=
 *
 * The manual fallback. A device with no GPS radio, or an indoor lookup that
 * times out, must not be the end of a real clinic's registration — so a typed
 * address is resolved to coordinates here instead.
 *
 * 404 when nothing matches, so a typo reads as "we could not find that"
 * rather than silently producing a pin somewhere plausible.
 */
router.get('/search', async (req, res) => {
    const q = String(req.query.q || '').trim();
    if (q.length < 4) {
        return res.status(400).json({ message: 'Enter a fuller address to search' });
    }

    const found = await forwardGeocode(q);
    if (!found) {
        return res.status(404).json({ message: 'No place matched that address' });
    }
    return res.json(found);
});

export default router;
