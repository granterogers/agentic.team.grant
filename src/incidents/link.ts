/**
 * A real address inside Team HQ, or nothing (#413).
 *
 * A message that says "tap the button to reconnect Google" is only honest when a button exists and goes somewhere that
 * works. The deployment records its own public address (`web.base_url`); this puts a path inside Team HQ behind it and
 * refuses anything that could point elsewhere, so a notice can never send a person to an address a handler invented.
 *
 * Returns null when there is no usable base, and the caller then words the message without a button.
 */
import type { SqlExecutor } from '../db/executor.ts'

/** Paths a notice may open. Opening Settings on a tab is navigation only: signing in is still required to see anything. */
const OPENABLE = /^\/\?settings=(?:connections|channels|health)$/

export const teamHqUrl = async (db: SqlExecutor, path: string): Promise<string | null> => {
  if (!OPENABLE.test(path)) return null
  let base: string | undefined
  try {
    const { rows } = await db.execute(
      `select value #>> '{}' as base from public.system_config where key = 'web.base_url'`,
    )
    base = (rows[0] as { base?: string } | undefined)?.base
  } catch {
    return null
  }
  return joinBase(base, path)
}

/** Pure half of `teamHqUrl`, so it can be tested without a database. */
export const joinBase = (base: string | undefined | null, path: string): string | null => {
  if (!OPENABLE.test(path)) return null
  if (typeof base !== 'string') return null
  let url: URL
  try {
    url = new URL(base)
  } catch {
    return null
  }
  // https only, no credentials, no path or query of its own: it is an origin and nothing else.
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') return null
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '') return null
  return `${url.origin}${path}`
}
