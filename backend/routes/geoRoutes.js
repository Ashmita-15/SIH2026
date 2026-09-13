import { Router } from 'express';
import { reverseGeocode, forwardGeocode, isValidLatLon } from '../services/geocode.js';
import { searchNearby, NEARBY_CATEGORIES } from '../services/overpass.js';
import { authRequired } from '../middleware/authMiddleware.js';

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
 * Resolves a typed place name to coordinates. Returns a ranked list: the
 * nearby map lets the user choose between candidates, and facility sign-up
 * takes the first.
 *
 * Deliberately public, unlike /nearby. The manual address fallback on the
 * sign-up screen calls this *before an account exists*, so requiring a token
 * here would make a facility that cannot get a GPS fix unable to register at
 * all. It reads no database and no secret, and proxies a service anyone could
 * call directly.
 *
 * 502 rather than an empty list when the lookup itself failed, so the caller
 * can distinguish "nothing matched" from "the geocoder is down".
 */
router.get('/search', async (req, res) => {
    const q = String(req.query.q || '').trim();
    if (q.length < 3 || q.length > 200) {
        return res.status(400).json({ message: 'Enter at least 3 characters to search' });
    }
    const results = await forwardGeocode(q);
    if (results === null) {
        return res.status(502).json({ message: 'Place search is unavailable right now. Try again, or drop a pin on the map.' });
    }
    return res.json({ results });
});

/**
 * GET /api/geo/nearby?category=doctor|pharmacy|hospital&lat=&lon=
 *
 * 503 with code MAP_DATA_UNAVAILABLE when no Overpass mirror answered, so the
 * page can say "try again" rather than "nothing nearby".
 */
router.get('/nearby', authRequired, async (req, res) => {
    const category = String(req.query.category || '');
    const lat = Number(req.query.lat);
    const lon = Number(req.query.lon);

    if (!NEARBY_CATEGORIES.includes(category)) {
        return res.status(400).json({ message: `category must be one of: ${NEARBY_CATEGORIES.join(', ')}` });
    }
    if (!isValidLatLon(lat, lon)) {
        return res.status(400).json({ message: 'A valid lat and lon are required' });
    }

    try {
        return res.json(await searchNearby(category, lat, lon));
    } catch (err) {
        if (err.code === 'MAP_DATA_UNAVAILABLE') {
            return res.status(503).json({
                code: 'MAP_DATA_UNAVAILABLE',
                message: 'The map data service is busy or unreachable. Please try again in a minute.'
            });
        }
        console.error('[geo/nearby] error:', err.message);
        return res.status(500).json({ message: 'Could not search nearby places' });
    }
});

export default router;
