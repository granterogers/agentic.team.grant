/**
 * Did this job fail because the office could not THINK, rather than badly?
 *
 * Kept in a module of its own, with no import of a database executor, so a unit test can import it without the
 * session runner's top level demanding a production credential and ending the process (deep systems audit, test
 * hermeticity): `scripts/sessions/run.ts` re-exports this and is the only thing that needs a token.
 *
 * Exported so it can be shown the real failure strings in a unit test. A predicate that decides what counts as a
 * product failure and has never been shown a string it must REFUSE is the found-nothing shape: it would read as working
 * whether it matched everything or nothing.
 *
 * The two halves it must separate, taken from every session job ever recorded:
 *
 *   weather      37 x "handler threw: provider openrouter is unavailable: its
 *                      circuit breaker is open"
 *   the office    9 x "incoherent output metadata: body" - the coherence gate
 *                      refusing an answer the office could not stand behind,
 *                      which is a behavioural outcome and must stay a FAILURE
 *
 * Narrow on purpose, and the asymmetry is what makes narrow safe: too narrow and an outage still reads as a failure,
 * which is exactly today's behaviour and costs nothing new; too broad and a real product failure is hidden, which is
 * unrecoverable.
 */
export const weather = (reason: string): boolean =>
  /provider \S+ is unavailable|circuit breaker is open/i.test(reason)
