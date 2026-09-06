/**
 * Where the avatar base URL comes from.
 *
 * One small function, and it exists so there is exactly one answer to "how is a
 * staff photograph addressed". The alternative — each caller reading the config
 * key, or worse, each caller taking a base URL as a constructor argument that
 * defaults to nothing — is how the office ends up showing photographs while the
 * pager shows emoji, with nobody noticing because both are plausible.
 *
 * Returns null when the key is missing or unusable, which `identityFor` then
 * degrades to a per-role emoji for. That is the designed behaviour and not a
 * failure: it is what kept a broken image out of Slack for the three days
 * between the avatars being drawn and being hosted.
 */

import type { SqlExecutor } from '../db/executor.ts'

const KEY = 'staff.avatar_base_url'

export async function avatarBaseUrl(db: SqlExecutor): Promise<string | null> {
  const { rows } = await db.execute(
    `select value #>> '{}' as base from public.system_config where key = '${KEY}'`,
  )
  const base = (rows[0] as { base?: string | null } | undefined)?.base
  if (base === undefined || base === null || base.trim() === '') return null
  // The HTTPS check also lives in `identityFor`, deliberately: this one gives a
  // caller a null it can log, and that one refuses to build a URL it cannot
  // justify. Neither is redundant, because they protect different callers.
  return base.startsWith('https://') ? base : null
}
