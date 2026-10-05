/**
 * What the office key (`hq.api_token`) can still reach that silently means "Grant" (multi-user P1.5, #400).
 *
 *   npm run check:machine-key        # production catalogue, read-only
 *
 * The key is a machine's: it names nobody (#385), so a function it reaches that DEFAULTS its person to 'grant'
 * attributes the machine's write to him. With one human that is invisible. With two it is the second person's
 * preference, task or reading written to the first one's name.
 *
 * Two readings, both derived from code and catalogue rather than listed here:
 *   1. every action on the gateway's SERVICE_MAY list, resolved to the database function it calls, and which of
 *      that function's parameters default to an ambient person ('grant' / 'chief-of-staff');
 *   2. the pinned list of those that are KNOWN, each with the reason it is acceptable today and what replaces it.
 *
 * A SERVICE_MAY action that reaches a defaulted-person function and is not pinned fails the gate: adding one is
 * a decision somebody writes down. A pin that no longer matches anything also fails (a stale excuse is worse
 * than a gap). The phase that introduces offices replaces every default with a required office parameter and
 * deletes this list.
 *
 * Its own controls: an injected unpinned reach is refused, an injected stale pin is refused, and the scan finds
 * the pinned ones - so "clean" cannot mean "found nothing".
 */
import '../src/safety/require-production-checks.ts'
import { readFileSync } from 'node:fs'
import { ManagementApiExecutor } from '../src/db/executor.ts'

export type Reach = { action: string; fn: string; param: string; default: string }

/** Known, and why that is acceptable until offices exist. */
/**
 * Empty since multi-user P3: every gateway door takes an explicit office, and the machine key resolves to the TEST office
 * rather than to a person, so no reach of an ambient person remains to excuse. A reach that reappears fails the gate
 * until somebody pins it here with a reason.
 */
export const PINNED: Readonly<Record<string, string>> = {}

const body = (source: string, from: string, to: string): string => {
  const a = source.indexOf(from)
  const b = source.indexOf(to, a)
  if (a < 0 || b < 0) throw new Error(`could not find ${from}`)
  return source.slice(a, b)
}

/** SERVICE_MAY action -> database function, read from the gateway's own source. */
export const serviceActions = (source: string): Map<string, string> => {
  const actions = body(source, 'const ACTIONS', '\n}\n')
  const fnOf = new Map<string, string>()
  for (const m of actions.matchAll(/^ {2}([a-z_0-9]+): \{\s*(?:\n\s*)?fn: '([a-z_0-9]+)'/gm)) {
    fnOf.set(m[1] as string, m[2] as string)
  }
  const out = new Map<string, string>()
  for (const m of body(source, 'const SERVICE_MAY', '])\n').matchAll(/^ {2}'([a-z_0-9]+)',?$/gm)) {
    const fn = fnOf.get(m[1] as string)
    if (fn !== undefined) out.set(m[1] as string, fn)
  }
  return out
}

export const reaches = (
  actions: ReadonlyMap<string, string>,
  defaults: readonly { fn: string; param: string; default: string }[],
): Reach[] =>
  [...actions.entries()].flatMap(([action, fn]) =>
    defaults
      .filter((d) => d.fn === fn)
      .map((d) => ({ action, fn, param: d.param, default: d.default })),
  )

export const problems = (
  found: readonly Reach[],
  pinned: Readonly<Record<string, string>>,
): string[] => {
  const out: string[] = []
  const seen = new Set(found.map((r) => r.action))
  for (const r of found) {
    if (pinned[r.action] === undefined) {
      out.push(
        `${r.action} (${r.fn}) defaults ${r.param} to ${r.default} for the machine key and is not pinned`,
      )
    }
  }
  for (const name of Object.keys(pinned)) {
    if (!seen.has(name)) out.push(`pin for ${name} matches nothing - a stale excuse; remove it`)
  }
  return out
}

export const DEFAULTS_SQL = (fns: readonly string[]): string => `
  select p.proname as fn, a.name as param, a.def as "default"
    from pg_proc p
    cross join lateral (
      select split_part(trim(x), ' ', 1) as name,
             substring(x from '(?i)default ''([a-z-]+)''') as def
        from unnest(string_to_array(pg_get_function_arguments(p.oid), ',')) x) a
   where p.pronamespace = 'public'::regnamespace
     and p.proname in (${fns.map((f) => `'${f}'`).join(', ')})
     and a.def in ('grant', 'chief-of-staff')`

export const controls = (): { name: string; ok: boolean; detail: string }[] => {
  const real: Reach[] = [
    { action: 'appearance_set', fn: 'hq_appearance_set', param: 'p_owner', default: 'grant' },
  ]
  const injected: Reach[] = [
    ...real,
    { action: 'task_add', fn: 'hq_task_add', param: 'p_by', default: 'grant' },
  ]
  // The controls use a pin of their own: the real list is empty, and a control with nothing to be wrong about proves nothing.
  const pins = { appearance_set: 'a pin the control supplies, long enough to read as a reason' }
  const unpinned = problems(injected, pins)
  const stale = problems(real, { ...pins, ghost_action: 'a pin for something that is gone' })
  return [
    {
      name: 'a new unpinned reach is refused',
      ok: unpinned.some((p) => p.startsWith('task_add')),
      detail: unpinned[0] ?? 'nothing raised',
    },
    {
      name: 'a stale pin is refused',
      ok: stale.some((p) => p.startsWith('pin for ghost_action')),
      detail: stale[0] ?? 'nothing raised',
    },
    {
      name: 'a pinned reach is accepted',
      ok: problems(real, pins).filter((p) => p.startsWith('appearance_set')).length === 0,
      detail: 'appearance_set is pinned',
    },
  ]
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const token = process.env.SUPABASE_ACCESS_TOKEN ?? ''
  if (token === '') {
    console.error('SUPABASE_ACCESS_TOKEN is required')
    process.exit(2)
  }
  const db = new ManagementApiExecutor(
    process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
    token,
  )
  const actions = serviceActions(readFileSync('supabase/functions/hq-api/index.ts', 'utf8'))
  const fns = [...new Set(actions.values())]
  const defaults = (await db.execute(DEFAULTS_SQL(fns))).rows as {
    fn: string
    param: string
    default: string
  }[]
  const found = reaches(actions, defaults)
  console.log(
    `${String(actions.size)} machine-key action(s) -> ${String(fns.length)} function(s); ${String(found.length)} reach an ambient person`,
  )
  for (const r of found) console.log(`  ${r.action} -> ${r.fn}(${r.param} default ${r.default})`)
  const ctl = controls()
  for (const c of ctl) console.log(`control: ${c.name} -> ${c.ok ? 'ok' : 'WRONG'}`)
  if (actions.size < 20 || ctl.some((c) => !c.ok)) {
    console.log('FAIL the scan looked at too little or a control misbehaved')
    process.exit(1)
  }
  const bad = problems(found, PINNED)
  if (bad.length > 0) {
    console.log(`FAIL ${String(bad.length)} problem(s):`)
    for (const p of bad) console.log(`  ${p}`)
    process.exit(1)
  }
  console.log('ok   every machine-key reach of an ambient person is pinned with a reason')
}
