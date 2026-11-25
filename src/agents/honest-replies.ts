/**
 * Two replies the Cowork test of 24 November 2026 found false (0.117.2).
 *
 * T13: "Book the venue for 14 December" was answered "…give me the venue name… and I'll lock it in." The team cannot make bookings,
 * so the reply is replaced with what is true: nothing has been booked, and the person books it themselves.
 *
 * T05: a summary was promised, "I will come back with what each one actually found", and nothing came back. When no work is still
 * running for the turn, the promise is replaced with what is true.
 */

const BOOKING_ASK = /\b(?:book|reserve|reservation|booking)\b/i
const BOOKING_CLAIM =
  /\b(?:I(?:'|’)ll|I will|I can|I’ll)\s+(?:lock\s+it\s+in|book|reserve|confirm\s+the\s+booking|make\s+the\s+booking|secure)\b/i

export function bookingReplyFor(request: string, reply: string): string | null {
  if (!BOOKING_ASK.test(request) || !BOOKING_CLAIM.test(reply)) return null
  return 'Nothing has been booked. I cannot make bookings or reservations myself. Book it with the venue yourself, and tell me the date and time you agree so I can add it to the schedule.'
}

const COME_BACK =
  /\b(?:I(?:'|’)ll|I will)\s+come\s+back\b|\bcome\s+back\s+(?:to\s+you\s+)?with\s+what\b/i

export function undeliveredPromiseFor(reply: string, pendingActions: number): string | null {
  if (pendingActions > 0 || !COME_BACK.test(reply)) return null
  return 'Nothing else is running on this, so I have nothing further to bring back. Ask again and I will look at it fresh.'
}
