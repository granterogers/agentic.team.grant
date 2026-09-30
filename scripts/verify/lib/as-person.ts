/**
 * A signed-in PERSON's press, for a suite that has no person (#385).
 *
 * The gateway wants a signed-in person for anything that decides, speaks, connects or attaches, and the office key
 * is a machine (0614). A suite holds the key; production has exactly one person and a suite must not borrow them.
 * So a suite that must exercise such an action does what the gateway does for a person - calls the database
 * function the action is routed to, named in the gateway's own action map, with the same named arguments - as the
 * operator. `refusedForTheKey` is the other half: that the DOOR turns the key away by name, which is what stops
 * this shortcut being available to anything but a suite.
 *
 * Read the action map from the source rather than restating it: a second list of `action -> function` is a list
 * that will disagree with the first.
 */
import { readFile } from 'node:fs/promises'
import type { SqlExecutor } from '../../../src/db/executor.ts'

const lit = (v: string) => `'${v.replace(/'/g, "''")}'`

let map: Map<string, string> | null = null
const actionFunctions = async (): Promise<Map<string, string>> => {
  if (map !== null) return map
  const src = await readFile(
    new URL('../../../supabase/functions/hq-api/index.ts', import.meta.url),
    'utf8',
  )
  const found = new Map<string, string>()
  for (const m of src.matchAll(/\n {2}([a-z_]+): \{\s*(?:\/\*[\s\S]*?\*\/\s*)?fn: '([a-z_]+)'/g)) {
    found.set(String(m[1]), String(m[2]))
  }
  map = found
  return found
}

export async function pressAsPerson(
  db: SqlExecutor,
  action: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const fn = (await actionFunctions()).get(action)
  if (fn === undefined) throw new Error(`no gateway action called ${action}`)
  const named = Object.entries(args)
    .map(
      ([k, v]) =>
        `${k} => ${v === null ? 'null' : typeof v === 'boolean' ? String(v) : lit(String(v))}`,
    )
    .join(', ')
  const { rows } = await db.execute(`select to_jsonb(public.${fn}(${named})) as r`)
  const r = (rows[0] as { r?: unknown } | undefined)?.r
  return typeof r === 'string' ? JSON.parse(r) : r
}

/** The door's answer to the office key for an action: `person_required`, by name. */
export async function refusedForTheKey(
  endpoint: string,
  bearer: string,
  action: string,
  args: Record<string, unknown> = {},
): Promise<{ status: number; named: boolean }> {
  const r = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, args }),
  })
  const t = await r.text()
  return { status: r.status, named: t.includes('person_required') }
}
