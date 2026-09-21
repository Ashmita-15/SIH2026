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
// Fewer, larger steps than before: every step is another chance for a busy
// public server to fail, and rural areas used to walk through all four.
const RADII_M = [4000, 12000, 30000];
const MIN_RESULTS = 10;        // most places returned
const WIDEN_BELOW = 5;         // widen the search only when fewer than this were found
const ATTEMPT_TIMEOUT_MS = 14_000;
const HEDGE_AFTER_MS = 3_500;  // start the next mirror if the current one is this slow
const TOTAL_BUDGET_MS = 40_000;
const CACHE_TTL_MS = 10 * 60 * 1000;
const EMPTY_CACHE_TTL_MS = 2 * 60 * 1000;  // an empty answer is the one most worth re-checking
const STALE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // last good answer, served only when every mirror is down
const CACHE_MAX = 200;

const DEFAULT_ENDPOINTS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.private.coffee/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter'
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

// The mirror that answered last is tried first.
let preferred = 0;
const cache = new Map();
const inflight = new Map();

/**
 * Overpass reports some failures with HTTP 200: when a query runs out of time
 * or memory it returns whatever it had — often nothing — plus a `remark`.
 * Treating that as "no results" is what made searches say "Nothing found"
 * (and cache it) whenever a public server was merely busy.
 */
function assertComplete(body) {
    if (!Array.isArray(body?.elements)) throw new Error('Malformed Overpass response');
    const remark = String(body.remark || '');
    if (/runtime error|timed out|out of memory|too many requests|rate.?limit/i.test(remark)) {
        throw new Error(`Overpass remark: ${remark.slice(0, 120)}`);
    }
}

async function queryMirror(url, query, timeoutMs, outerSignal) {
    const controller = new AbortController();
    const onOuterAbort = () => controller.abort();
    outerSignal.addEventListener('abort', onOuterAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, {
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
        // A mirror that is down often serves an HTML error page: json() throws, which is a failure too.
        const body = await res.json();
        assertComplete(body);
        return body.elements;
    } finally {
        clearTimeout(timer);
        outerSignal.removeEventListener('abort', onOuterAbort);
    }
}

/**
 * Asks the mirrors in turn, but does not wait for a slow one to fail: the next
 * mirror is started after HEDGE_AFTER_MS (or at once if the current one errors),
 * the earlier ones keep running, and the first complete answer wins.
 */
function runQuery(query, deadline) {
    const list = endpoints();
    const winner = new AbortController();

    return new Promise((resolve, reject) => {
        let started = 0;
        let pending = 0;
        let settled = false;
        let lastError = null;
        let hedgeTimer = null;

        const finish = (fn, value) => {
            if (settled) return;
            settled = true;
            clearTimeout(hedgeTimer);
            winner.abort(); // stop the losers
            fn(value);
        };

        const startNext = () => {
            clearTimeout(hedgeTimer);
            const remaining = deadline - Date.now();
            if (settled) return;
            if (started >= list.length || remaining < 1000) {
                if (pending === 0) finish(reject, new MapDataUnavailableError(lastError?.message));
                return;
            }
            const index = (preferred + started) % list.length;
            started++;
            pending++;
            queryMirror(list[index], query, Math.min(ATTEMPT_TIMEOUT_MS, remaining), winner.signal)
                .then(elements => {
                    preferred = index;
                    finish(resolve, elements);
                })
                .catch(err => {
                    if (settled) return;
                    lastError = err;
                    console.warn(`[overpass] ${new URL(list[index]).host} failed: ${err.name === 'AbortError' ? 'timeout' : err.message}`);
                    pending--;
                    startNext(); // a failure moves on immediately
                });
            hedgeTimer = setTimeout(startNext, HEDGE_AFTER_MS); // a slow answer moves on too
        };

        startNext();
    });
}

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

    // Two people searching the same spot at once share one upstream request.
    if (inflight.has(key)) return inflight.get(key);

    const job = (async () => {
        try {
            const value = await searchUncached(category, lat, lon);
            const ttl = value.places.length ? CACHE_TTL_MS : EMPTY_CACHE_TTL_MS;
            if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
            cache.set(key, { value, expires: Date.now() + ttl, savedAt: Date.now() });
            return value;
        } catch (err) {
            // Every mirror is down: an older real answer beats an error page.
            if (err.code === 'MAP_DATA_UNAVAILABLE' && hit?.value && Date.now() - hit.savedAt < STALE_MAX_AGE_MS) {
                return { ...hit.value, stale: true };
            }
            throw err;
        } finally {
            inflight.delete(key);
        }
    })();
    inflight.set(key, job);
    return job;
}

async function searchUncached(category, lat, lon) {
    const deadline = Date.now() + TOTAL_BUDGET_MS;
    let best = null;

    for (const radius of RADII_M) {
        let elements;
        try {
            elements = await runQuery(buildQuery(category, lat, lon, radius), deadline);
        } catch (err) {
            // Results from a smaller radius are still real results.
            if (best && best.places.length) return { ...best, partial: true };
            throw err;
        }
        best = {
            places: toPlaces(elements, category, lat, lon).slice(0, MIN_RESULTS),
            radiusMetres: radius,
            partial: false,
            source: 'openstreetmap'
        };
        if (best.places.length >= WIDEN_BELOW) break;
    }
    return best;
}