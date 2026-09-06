/**
 * Which bot speaks for whom.
 *
 * §12 gives Telegram one interrupting voice — the Chief of Staff bot, the
 * pager. A staff bot is a different thing: it speaks *as* a person, in the chat
 * that person's counterpart opened with them, and it does not get to interrupt.
 * Conflating the two would be seven ways to be woken up.
 *
 * The registry is `public.telegram_bots` (0054). This module is the reading
 * side, and it exists so that "which token do I send this with" is answered in
 * one place rather than by a string template at every call site — a template
 * has nowhere to record that a bot is turned off, which §17 requires.
 */

import type { SqlExecutor } from '../db/executor.ts'

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

export interface StaffBot {
  readonly staffSlug: string | null
  readonly botId: string
  readonly username: string
  readonly token: string
}

export interface RosterEntry {
  readonly staffSlug: string | null
  readonly botId: string
  readonly username: string
  readonly enabled: boolean
  readonly hasToken: boolean
  readonly isPager: boolean
  readonly disabledReason: string | null
}

/**
 * The bot a staff member speaks with, or null when they have none.
 *
 * Null is a normal answer, not a failure: two of the seven bots the roster
 * names do not exist yet, and a resolver that threw would make "Grant has not
 * made that bot" indistinguishable from "the database is broken".
 */
export async function botForStaff(db: SqlExecutor, staffSlug: string): Promise<StaffBot | null> {
  const { rows } = await db.execute(
    `select bot_id, username, token from app.telegram_bot_for(${lit(staffSlug)})`,
  )
  const row = rows[0] as { bot_id?: string; username?: string; token?: string } | undefined
  if (row?.token === undefined || row.token === null || row.token === '') return null
  return {
    staffSlug,
    botId: String(row.bot_id),
    username: String(row.username),
    token: row.token,
  }
}

/** The pager: the one bot §12 permits to interrupt. */
export async function pagerBot(db: SqlExecutor): Promise<StaffBot | null> {
  const { rows } = await db.execute(`
    select staff_slug, bot_id, username, app.resolve_secret(token_ref) as token
      from public.telegram_bots
     where is_pager and enabled and token_ref is not null
  `)
  const row = rows[0] as
    | { staff_slug?: string | null; bot_id?: string; username?: string; token?: string }
    | undefined
  if (row?.token === undefined || row.token === null || row.token === '') return null
  return {
    staffSlug: row.staff_slug ?? null,
    botId: String(row.bot_id),
    username: String(row.username),
    token: row.token,
  }
}

/** Every bot the roster names, existing or not. For status, not for sending. */
export async function roster(db: SqlExecutor): Promise<readonly RosterEntry[]> {
  const { rows } = await db.execute(`
    select staff_slug, bot_id, username, enabled, is_pager,
           token_ref is not null as has_token, disabled_reason
      from public.telegram_bots
     where expected
     order by is_pager desc, staff_slug
  `)
  return (
    rows as {
      staff_slug: string | null
      bot_id: string
      username: string
      enabled: boolean
      is_pager: boolean
      has_token: boolean
      disabled_reason: string | null
    }[]
  ).map((r) => ({
    staffSlug: r.staff_slug,
    botId: r.bot_id,
    username: r.username,
    enabled: r.enabled,
    hasToken: r.has_token,
    isPager: r.is_pager,
    disabledReason: r.disabled_reason,
  }))
}
