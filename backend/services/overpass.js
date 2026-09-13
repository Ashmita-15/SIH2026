/**
 * Nearby doctors, pharmacies and hospitals from OpenStreetMap.
 *
 * This used to run in the browser against one public Overpass instance. When
 * that instance was overloaded or unreachable from the user's network, the
 * page caught the error and rendered "Nothing found nearby" — an outage that
 * looked like an empty village. Running it here gives three things the page
 * could not have: an identifying User-Agent (Overpass asks for one), a list
 * of mirrors to fall through, and a failure the caller can tell apart from
 * an empty result.
 *
 * No key or secret is involved. Coordinates are validated before they are
 * interpolated into the query, so nothing a client sends can change its shape.
 */
import { isValidLatLon } from './geocode.js';

export const NEARBY_CATEGORIES = ['doctor', 'pharmacy', 'hospital'];

const FILTERS = {
    doctor: ['["amenity"="doctors"]', '["amenity"="clinic"]', '["healthcare"="doctor"]'],
    pharmacy: ['["amenity"="pharmacy"]'],
    hospital: ['["amenity"="hospital"]']
};

// Small first, widened only while there are too few results. Metres.
const RADII_M = [3000, 8000, 15000, 30000];
const MIN_RESULTS = 10;
const ATTEMPT_TIMEOUT_MS = 12_000;
const TOTAL_BUDGET_MS = 30_000;
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX = 200;

const DEFAULT_ENDPOINTS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.private.coffee/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter'
];

/** `OVERPASS_URLS` (comma-separated, https only) replaces the default list. */
const endpoints = () => {
    const configured = String(process.env.OVERPASS_URLS || '')
        .split(',').map(s => s.trim()).filter(s => s.startsWith('https://'));
    return configured.length ? configured : DEFAULT_ENDPOINTS;
};

const userAgent = () =>
    `GramSathi/1.0 (${process.env.GEOCODER_CONTACT || 'support@gramsathi.local'})`;

export class MapDataUnavailableError extends Error {
    constructor(message = 'Map data service unavailable') {
        super(message);
        this.code = 'MAP_DATA_UNAVAILABLE';
    }
}

// The mirror that answered last is tried first, so one dead instance costs
// one timeout per process rather than one per search.
let preferred = 0;
const cache = new Map();

function buildQuery(category, lat, lon, radius) {
    const la = lat.toFixed(6);
    const lo = lon.toFixed(6);
    const parts = FILTERS[category].map(f => `nwr${f}(around:${radius},${la},${lo});`).join('');
    return `[out:json][timeout:15];(${parts});out center;`;
}

function haversineMetres(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const toRad = d => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const clip = (s, n) => String(s || '').trim().slice(0, n);

async function runQuery(query, deadline) {
    const list = endpoints();
    let lastError = null;

    for (let i = 0; i < list.length; i++) {
        const index = (preferred + i) % list.length;
        const remaining = deadline - Date.now();
        if (remaining < 1000) break;

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), Math.min(ATTEMPT_TIMEOUT_MS, remaining));
        try {
            const res = await fetch(list[index], {
                method: 'POST',
                body: 'data=' + encodeURIComponent(query),
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'User-Agent': userAgent(),
                    Accept: 'application/json'
                },
                signal: controller.signal
            });
            // 429 and 504 are how Overpass says "busy" — the next mirror may not be.
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const body = await res.json();
            if (!Array.isArray(body?.elements)) throw new Error('Malformed Overpass response');
            preferred = index;
            return body.elements;
        } catch (err) {
            lastError = err;
            console.warn(`[overpass] ${new URL(list[index]).host} failed: ${err.name === 'AbortError' ? 'timeout' : err.message}`);
        } finally {
            clearTimeout(timer);
        }
    }
    throw new MapDataUnavailableError(lastError?.message);
}

function toPlaces(elements, category, lat, lon) {
    return elements
        .map(el => {
            // Hospitals are often mapped as building outlines (ways) or campuses
            // (relations); `out center` gives those a usable point.
            const pLat = el.type === 'node' ? el.lat : el.center?.lat;
            const pLon = el.type === 'node' ? el.lon : el.center?.lon;
            if (!isValidLatLon(pLat, pLon)) return null;
            const tags = el.tags || {};
            const phone = clip(tags.phone || tags['contact:phone'], 60).split(';')[0].trim();
            return {
                id: `${el.type}/${el.id}`,
                name: clip(tags.name || tags['name:en'], 120) || null,
                category,
                lat: pLat,
                lng: pLon,
                address: [tags['addr:street'], tags['addr:city']].filter(Boolean).map(s => clip(s, 80)).join(', '),
                phone,
                distanceMetres: Math.round(haversineMetres(lat, lon, pLat, pLon))
            };
        })
        .filter(Boolean)
        .sort((a, b) => a.distanceMetres - b.distanceMetres);
}

/**
 * @returns {Promise<{places: object[], radiusMetres: number, partial: boolean, source: string}>}
 * @throws {MapDataUnavailableError} when no mirror answered and nothing was found at a smaller radius.
 */
export async function searchNearby(category, lat, lon) {
    if (!NEARBY_CATEGORIES.includes(category)) throw new TypeError('Unknown category');
    if (!isValidLatLon(lat, lon)) throw new TypeError('Invalid coordinates');

    // ~110 m buckets: close enough to share, far enough apart to stay correct.
    const key = `${category}:${lat.toFixed(3)}:${lon.toFixed(3)}`;
    const hit = cache.get(key);
    if (hit && hit.expires > Date.now()) return hit.value;

    const deadline = Date.now() + TOTAL_BUDGET_MS;
    let best = null;

    for (const radius of RADII_M) {
        let elements;
        try {
            elements = await runQuery(buildQuery(category, lat, lon, radius), deadline);
        } catch (err) {
            // Results from a smaller radius are still real results.
            if (best) return { ...best, partial: true };
            throw err;
        }
        best = {
            places: toPlaces(elements, category, lat, lon).slice(0, MIN_RESULTS),
            radiusMetres: radius,
            partial: false,
            source: 'openstreetmap'
        };
        if (best.places.length >= MIN_RESULTS) break;
    }

    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
    cache.set(key, { value: best, expires: Date.now() + CACHE_TTL_MS });
    return best;
}
