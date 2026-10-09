/**
 * Is this failure the database LINK, rather than the statement?
 *
 * Two callers need the distinction and must not confuse the halves: a Notion sync (a page Notion will not give us is one page
 * left out; a database whose connection is timing out fails every remaining page the same way) and the worker's failure path
 * (a handler threw, and the write that records it hit a blip: the record is worth a short retry, a statement the database
 * REFUSES is not).
 *
 * What the executors raise (all wrap the cause in a `SqlExecutionError`, so the TYPE says nothing and the text is the evidence):
 *   - the edge worker's postgres.js: `Failed to run sql query: write CONNECT_TIMEOUT host:5432`, `CONNECTION_CLOSED`,
 *     `CONNECTION_DESTROYED`, `CONNECTION_ENDED`, `read ECONNRESET`;
 *   - node-postgres: the SQLSTATE is prefixed (`57P01: terminating connection due to administrator command`);
 *   - the Management API: an HTTP status with no SQLSTATE (429 and 5xx are the platform, not the statement).
 *
 * Narrow in the safe direction: a statement the database REFUSES (a check violation, a NUL byte in text) is a property of that
 * one statement and is never a link failure. An HTTP-shaped failure from a THIRD party (Notion, a model provider) is the
 * caller's to exclude: pass it through `isThirdPartyFailure` rather than letting its 502 read as the database.
 */
const LINK_TEXT =
  /CONNECT_TIMEOUT|CONNECTION_(?:CLOSED|DESTROYED|ENDED)|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|ENOTFOUND|EAI_AGAIN|connection (?:terminated|timeout|timed out|refused|reset)|terminating connection|too many (?:clients|connections)|remaining connection slots|statement timeout|canceling statement due to/i

/** SQLSTATE classes that are about the server or the connection, never about a row: 08 connection exception, 53 resources, 57 operator intervention. */
const LINK_SQLSTATE = /(?:^|[\s:])(?:08[0-9A-Z]{3}|53[0-9A-Z]{3}|57P0[1-3]|57014)(?::|\s|$)/

export const looksLikeDatabaseLinkFailure = (error: unknown): boolean => {
  if (typeof error !== 'object' || error === null) return false
  const e = error as { message?: unknown; status?: unknown; code?: unknown }
  const message = typeof e.message === 'string' ? e.message : ''
  if (typeof e.code === 'string' && LINK_TEXT.test(e.code)) return true
  if (LINK_TEXT.test(message) || LINK_SQLSTATE.test(message)) return true
  // The Management API answers 429 and 5xx when the platform, not the statement, is the problem.
  if (typeof e.status === 'number' && (e.status === 429 || e.status >= 500)) return true
  return false
}

/**
 * Run `step`, trying again after a short wait ONLY when it failed on the database link. Anything else, and the last link failure,
 * is rethrown unchanged. For a write that records what already happened (a failure, a state move): never for a step whose repeat
 * would repeat an effect outside the database.
 */
export const retryOnLinkFailure = async <T>(
  step: () => Promise<T>,
  delaysMs: readonly number[] = [250, 1_000, 2_500],
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<T> => {
  for (let i = 0; ; i += 1) {
    try {
      return await step()
    } catch (error) {
      const wait = delaysMs[i]
      if (wait === undefined || !looksLikeDatabaseLinkFailure(error)) throw error
      await sleep(wait)
    }
  }
}
