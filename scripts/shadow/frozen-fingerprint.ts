/**
 * The held-out corpus fingerprint, recorded at freeze time.
 *
 * In its own file so `npm run shadow:freeze -- --check` compares against a
 * committed value rather than against itself, and so re-freezing is a
 * one-line diff that shows up plainly in review.
 */
export const RECORDED_FINGERPRINT = '27f3b93972980a66'
