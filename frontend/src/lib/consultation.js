/**
 * What kind of consultation an appointment is.
 *
 * `offline` means the patient walks into the clinic. It books, queues, gets an
 * ETA and completes exactly like video and chat — the one thing it must never
 * show is a call to join, because there is no call. That check lives here
 * rather than being repeated as `!== 'offline'` at each button: adding a
 * fourth type later should not mean hunting for every place that assumed there
 * were three.
 */

/** Types that happen over a connection, and therefore have a room to enter. */
export const REMOTE_TYPES = ['video', 'chat']

/** Translation key for each stored type. */
export const CONSULTATION_LABEL = {
  video: 'video',
  chat: 'chat',
  offline: 'offline'
}

/**
 * Can this appointment be joined?
 *
 * Defaults to true for a missing type, because appointments created before
 * `offline` existed have no `consultationType` and were all remote.
 */
export const isRemote = (appointment) =>
  REMOTE_TYPES.includes(appointment?.consultationType || 'video')

export const isOffline = (appointment) => appointment?.consultationType === 'offline'
