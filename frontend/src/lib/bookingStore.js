import { BOOKING, emptyDraft } from './bookingFlow'

/**
 * The booking conversation, held outside the component that runs it.
 *
 * It used to be `useState` inside AssistantChat, which quietly broke the whole
 * flow: the first booking turn *navigates* — to the doctor list — and the
 * launcher closes the sheet when that happens. With mounting tied to the sheet
 * being open, closing it unmounted the chat, and the selected doctor, the day,
 * the fetched sessions and the pending question all went with it. The patient's
 * next sentence then arrived at a brand-new state machine that had never heard
 * of the appointment they were half-way through arranging.
 *
 * A module-level store fixes that for every instance at once: the launcher's
 * chat and the assistant page's chat read the same conversation, so navigating
 * between them continues it instead of restarting it.
 *
 * Deliberately not a context. The value has to be readable *synchronously*
 * immediately after a write — one turn sets the doctor and then reads it back
 * to decide whether to fetch sessions — and a context read is a render behind.
 */

const initial = () => ({
    status: BOOKING.IDLE,
    draft: emptyDraft(),
    confirmedFp: null,
    dateWord: null,
    doctors: [],
    offer: null,
    pendingDoctors: null
})

let state = initial()
const listeners = new Set()

/** Always the committed value, never one render behind. */
export const getBooking = () => state

export function setBooking(next) {
    state = typeof next === 'function' ? next(state) : next
    for (const listener of listeners) listener()
    return state
}

export function subscribeBooking(listener) {
    listeners.add(listener)
    return () => listeners.delete(listener)
}

/** A booking is under way and the chat must not be torn down. */
export const bookingIsActive = () =>
    state.status !== BOOKING.IDLE && state.status !== BOOKING.BOOKED

export const resetBookingStore = () => setBooking(initial())
