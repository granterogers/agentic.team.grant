/**
 * The held-out corpus fingerprint, recorded at freeze time.
 *
 * In its own file so `npm run shadow:freeze -- --check` compares against a
 * committed value rather than against itself, and so re-freezing is a
 * one-line diff that shows up plainly in review.
 *
 * ## Re-frozen once, on 21 September, and here is exactly why
 *
 * `27f3b93972980a66` was the first freeze. It was superseded because the
 * GENERATOR changed, not because a number was inconvenient:
 * `roughen.ts` was misspelling the operators that take something back -
 * `igore`, `ignoore`, `actuallly`, `atually` - so the corpus was testing the
 * harness's own spelling on the one class Grant ranks highest, and reporting
 * the result as the office executing a withdrawn clause. The protected-word
 * list is derived from the office's own `CANCELS` and `BARE_PIVOTS` now, so
 * the sentences changed and the fingerprint with them.
 *
 * The change was proved to be the ONLY cause: reverting `roughen.ts` alone
 * returns the recorded value exactly, so neither the seventeen new arcs nor
 * the evaluator nor the retraction fix touches the frozen text.
 *
 * ## What this costs, stated rather than glossed
 *
 * Any comparison across this boundary is invalid, which is what the
 * fingerprint exists to say. The 21 September numbers taken against
 * `27f3b93972980a66` are not comparable to anything taken after it, and
 * reaching for the old number because it is the one written down is the
 * mistake `frozen.ts` warns about in its own header.
 *
 * The new reference, measured immediately after re-freezing and BEFORE any
 * further production change: understanding 84%, context 96%, agency 88%,
 * safety 100%, over 132 turns and 66 families.
 */
export const RECORDED_FINGERPRINT = 'b98b6cf030e75970'

/** The freeze this one replaced, kept so the boundary is visible. */
export const SUPERSEDED_FINGERPRINTS = ['27f3b93972980a66'] as const
