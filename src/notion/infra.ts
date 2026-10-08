/**
 * Is this failure the database link, not the page?
 *
 * A Notion sync reads a page from Notion and files it in the database, and either half can fail. They must not be
 * confused: a page Notion will not give us is one page left out and the pass carries on, while a database whose
 * connection is timing out will fail every remaining page in the same way, so recording each as "left out: <the first
 * sixty characters of a driver message>" tells Grant about forty pages that are fine and hides the one thing that is
 * wrong. A link failure ends the run and says what it was.
 *
 * What the two executors raise (both wrap the cause in a `SqlExecutionError`, so the TYPE says nothing and the text is
 * the evidence):
 *   - the edge worker's postgres.js: `Failed to run sql query: write CONNECT_TIMEOUT host:5432`, `CONNECTION_CLOSED`,
 *     `CONNECTION_DESTROYED`, `CONNECTION_ENDED`, `read ECONNRESET`;
 *   - node-postgres: the SQLSTATE is prefixed (`57P01: terminating connection due to administrator command`);
 *   - the Management API: an HTTP status with no SQLSTATE (429 and 5xx are the platform, not the statement).
 *
 * Deliberately a property of the TEXT and the status, not a list of one driver's classes, and deliberately narrow in the
 * safe direction: a statement the database REFUSES (a check violation, a NUL byte in text) is a property of that one
 * page and must stay "left out", because treating it as a link failure would let one bad page stop every other.
 */
import { NotionApiError } from './api.ts'

const LINK_TEXT =
  /CONNECT_TIMEOUT|CONNECTION_(?:CLOSED|DESTROYED|ENDED)|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|ENOTFOUND|EAI_AGAIN|connection (?:terminated|timeout|timed out|refused|reset)|terminating connection|too many (?:clients|connections)|remaining connection slots|statement timeout|canceling statement due to/i

/** SQLSTATE classes that are about the server or the connection, never about a row: 08 connection exception, 53 resources, 57 operator intervention. */
const LINK_SQLSTATE = /(?:^|[\s:])(?:08[0-9A-Z]{3}|53[0-9A-Z]{3}|57P0[1-3]|57014)(?::|\s|$)/

export const isDatabaseLinkFailure = (error: unknown): boolean => {
  if (typeof error !== 'object' || error === null) return false
  // A Notion failure carries an HTTP status too, and a 502 from Notion is not the database.
  if (error instanceof NotionApiError) return false
  const e = error as { message?: unknown; status?: unknown; code?: unknown }
  const message = typeof e.message === 'string' ? e.message : ''
  if (typeof e.code === 'string' && LINK_TEXT.test(e.code)) return true
  if (LINK_TEXT.test(message) || LINK_SQLSTATE.test(message)) return true
  // The Management API answers 429 and 5xx when the platform, not the statement, is the problem.
  if (e.status !== null && typeof e.status === 'number') {
    if (e.status === 429 || e.status >= 500) return true
  }
  return false
}
