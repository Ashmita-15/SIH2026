/**
 * Coordinates to a readable address.
 *
 * Done on the server rather than from the browser so that Nominatim's usage
 * policy can actually be honoured: it asks for an identifying User-Agent and a
 * contact address, which a page cannot set on its own fetch. It also keeps the
 * choice of geocoder in one replaceable place — no API key is involved, and
 * nothing here reads a secret.
 *
 * Every failure is a failure. A geocoder that is down, slow or unsure returns
 * null and the caller says so; an address is never guessed from the numbers,
 * because a wrong address on a facility record is worse than no address.
 */

const NOMINATIM = 'https://nominatim.openstreetmap.org/reverse';
const TIMEOUT_MS = 8000;

/**
 * Identifies this app to Nominatim, as their policy requires.
 *
 * `GEOCODER_CONTACT` should be an address someone actually reads; it is a
 * contact detail, not a credential, and is read from the environment only so
 * that a deployment can set its own.
 */
const userAgent = () =>
    `GramSathi/1.0 (${process.env.GEOCODER_CONTACT || 'support@gramsathi.local'})`;

export const isValidLatLon = (lat, lon) =>
    Number.isFinite(lat) && Number.isFinite(lon) &&
    lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;

/**
 * @returns {Promise<{address: string, raw: object}|null>} null on any failure.
 */
export async function reverseGeocode(lat, lon) {
    if (!isValidLatLon(lat, lon)) return null;

    const url = `${NOMINATIM}?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&zoom=18&addressdetails=1`;

    // An unreachable geocoder must not hold a sign-up open indefinitely.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
        const res = await fetch(url, {
            headers: { 'User-Agent': userAgent(), 'Accept-Language': 'en' },
            signal: controller.signal
        });
        if (!res.ok) return null;
        const body = await res.json();
        const address = String(body?.display_name || '').trim();
        if (!address) return null;
        return { address, raw: body?.address || {} };
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
    }
}
