/**
 * Is this failure the database link, not the page?
 *
 * A Notion sync reads a page from Notion and files it in the database, and either half can fail. They must not be
 * confused: a page Notion will not give us is one page left out and the pass carries on, while a database whose
 * connection is timing out will fail every remaining page in the same way, so recording each as "left out: <the first
 * sixty characters of a driver message>" tells Grant about forty pages that are fine and hides the one thing that is
 * wrong. A link failure ends the run and says what it was.
 *
 * The classification itself is the database's, shared with the worker's failure path (`src/db/link-failure.ts`). What is
 * Notion's own is the exclusion: a Notion failure carries an HTTP status too, and a 502 from Notion is not the database.
 */
import { looksLikeDatabaseLinkFailure } from '../db/link-failure.ts'
import { NotionApiError } from './api.ts'

export const isDatabaseLinkFailure = (error: unknown): boolean =>
  !(error instanceof NotionApiError) && looksLikeDatabaseLinkFailure(error)
