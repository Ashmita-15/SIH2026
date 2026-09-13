/**
 * One way to ask the device where it is — used by Nearby, SOS and facility
 * sign-up, which previously each had their own copy and each collapsed every
 * failure into the same "couldn't detect your location".
 *
 * The causes need different fixes from the person holding the phone: a
 * blocked permission is fixed in site settings, a timeout by turning GPS on,
 * an insecure page not at all. So failures are typed, and nothing here ever
 * substitutes a guessed or default position.
 */

export const LOCATION_ERROR = {
  UNSUPPORTED: 'unsupported',
  INSECURE: 'insecure',
  DENIED: 'denied',
  UNAVAILABLE: 'unavailable',
  TIMEOUT: 'timeout'
}

/** Beyond this, a fix is a neighbourhood, not a doorstep — worth telling the user. */
export const LOW_ACCURACY_METRES = 1000

export class LocationError extends Error {
  constructor(code) {
    super(code)
    this.name = 'LocationError'
    this.code = code
  }
}

function request(options) {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, options)
  })
}

function fromPositionError(err) {
  if (err?.code === 1) return new LocationError(LOCATION_ERROR.DENIED)
  if (err?.code === 3) return new LocationError(LOCATION_ERROR.TIMEOUT)
  return new LocationError(LOCATION_ERROR.UNAVAILABLE)
}

/**
 * @param {Object} [options]
 * @param {number} [options.maximumAge] - ms a cached fix may be reused on the first try
 * @returns {Promise<{lat: number, lng: number, accuracy: number|null}>}
 * @throws {LocationError}
 */
export async function getCurrentLocation({ maximumAge = 0 } = {}) {
  // Browsers only expose geolocation on https (or localhost).
  if (typeof window !== 'undefined' && window.isSecureContext === false) {
    throw new LocationError(LOCATION_ERROR.INSECURE)
  }
  if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
    throw new LocationError(LOCATION_ERROR.UNSUPPORTED)
  }

  let position
  try {
    position = await request({ enableHighAccuracy: true, timeout: 12000, maximumAge })
  } catch (err) {
    // A refusal is final — asking again would only repeat it.
    if (err?.code === 1) throw fromPositionError(err)
    // GPS off, indoors, or a desktop with no GPS: a network-based fix
    // usually still works, and is far better than nothing.
    try {
      position = await request({ enableHighAccuracy: false, timeout: 15000, maximumAge: Math.max(maximumAge, 60000) })
    } catch (fallbackErr) {
      throw fromPositionError(fallbackErr)
    }
  }

  const { latitude, longitude, accuracy } = position.coords
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new LocationError(LOCATION_ERROR.UNAVAILABLE)
  }
  return {
    lat: latitude,
    lng: longitude,
    accuracy: Number.isFinite(accuracy) ? Math.round(accuracy) : null
  }
}

/** Translation key for whatever getCurrentLocation threw. */
export function locationErrorKey(err) {
  const known = Object.values(LOCATION_ERROR).includes(err?.code)
  return `location.errors.${known ? err.code : LOCATION_ERROR.UNAVAILABLE}`
}
