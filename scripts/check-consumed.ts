/**
 * A table the product writes and nothing reads.
 *
 * `check:callers` walks database FUNCTIONS, `check:pressable` walks GATEWAY
 * ACTIONS and `check:capabilities` walks HANDLER KINDS. All three ask one
 * question in three vocabularies: is a mechanism that was built actually
 * reachable. Nothing asked it about TABLES, and migration 0274 had already
 * named the shape in its own comment, about `failure_signatures`:
 *
 *   "until this branch existed, failure_signatures was a table nobody read --
 *    the mechanism built and the mouth forgotten, which is #72's shape and
 *    which this repository keeps producing."
 *
 * Pass 27 produced it again. Every Telegram message carries a thumbs up and a
 * thumbs down, Slack maps the same two reactions, and a press writes
 * `public.feedback`, which has no reader anywhere: no TypeScript outside the
 * insert, no SQL function, no view, no operator command. Both Settings cards
 * told Grant the press was read (0580, 0581).
 *
 * WHAT THIS CHECK IS NOT. It does not ask whether a table holds rows -- an
 * empty table with a working reader is a fact about traffic, which is what
 * `public.contacts` is. It asks only whether anything could ever read what the
 * product writes, which is answerable without any traffic at all.
 *
 * THE THREE CORRECTIONS THE SWEEP NEEDED, kept here because each was a false
 * positive that reading disproved and the next version will need the same
 * discipline:
 *
 *   1. VIEW definitions are readers. Without them `notebook_budgets` and
 *      `notebook_capability_probes` both looked dead and neither is.
 *   2. OPERATOR COMMANDS are readers, by #272's rule -- `npm run levels` reads
 *      `preference_instructions`, which is an audit ledger by design and was
 *      flagged until `scripts/` was included.
 *   3. A table nothing writes is not this check's business. `undo_requests` has
 *      no writer in `src/` and holds no rows; a mechanism for a state that never
 *      occurs is `app.suppress_delivery`'s case, not a forgotten mouth.
 */
import '../src/safety/require-production-unless-replica.ts'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { openCatalogue } from './lib/catalogue-db.ts'

const BASELINE = 'docs/testing/consumed-baseline.json'

const walk = (dir: string): string[] => {
  if (!existsSync(dir)) return []
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else if (p.endsWith('.ts')) out.push(p)
  }
  return out
}

const HARNESS = /^(verify:|poc:|gate$|e2e)/
const operatorFiles = new Set<string>()
for (const [name, cmd] of Object.entries(
  JSON.parse(readFileSync('package.json', 'utf8')).scripts as Record<string, string>,
)) {
  if (HARNESS.test(name)) continue
  for (const m of cmd.matchAll(/(scripts\/[\w./-]+\.ts)/g)) operatorFiles.add(m[1] as string)
}

/* A COMMENT IS NOT A CALL (#351), on either side of the fence. */
const withoutComments = (text: string): string =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
    .replace(/--[^\n]*/g, ' ')

const read = (f: string): string => (existsSync(f) ? readFileSync(f, 'utf8') : '')

const appCode = [...walk('src'), ...walk('supabase/functions')].map(read).join('\n')
const operatorCode = [...operatorFiles].map(read).join('\n')

const db = await openCatalogue()

const one = async (sql: string): Promise<string> => {
  const { rows } = await db.execute(sql)
  return String((rows[0] as Record<string, unknown> | undefined)?.t ?? '')
}

const tablesRows = await db.execute(`
  select c.relname as name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
   order by 1
`)
const tables = tablesRows.rows.map((r) => String((r as { name: unknown }).name))

const fnDefs = await one(`
  select coalesce(string_agg(pg_get_functiondef(p.oid), E'\\n'), '') as t
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('app', 'public') and p.prokind = 'f'
`)
const viewDefs = await one(`
  select coalesce(string_agg(pg_get_viewdef(c.oid), E'\\n'), '') as t
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname in ('app', 'public') and c.relkind in ('v', 'm')
`)

/*
  THE FOUND-NOTHING CONTROL, and the reason this check can be believed when it
  reports nothing. A sweep whose corpus failed to load reports every table as
  consumed -- silently, and in the reassuring direction. Four separate entries
  in CLAUDE.md are this exact failure, which is why each side is asserted
  non-empty before any verdict is read from it.
*/
const empty: string[] = []
if (tables.length === 0) empty.push('no tables were listed')
if (fnDefs.length === 0) empty.push('no function definitions were read')
if (viewDefs.length === 0) empty.push('no view definitions were read')
if (appCode.length === 0) empty.push('no application code was read')
if (operatorCode.length === 0) empty.push('no operator commands were read')
if (empty.length > 0) {
  console.error(`check:consumed CANNOT ANSWER — ${empty.join('; ')}`)
  process.exit(1)
}

const corpus = withoutComments(`${fnDefs}\n${viewDefs}\n${appCode}\n${operatorCode}`)

const writes = (t: string): boolean =>
  new RegExp(`insert\\s+into\\s+(public\\.)?${t}\\b`, 'i').test(corpus)

/*
  A READ is anything that names the table other than to insert into it: a
  select, a join, an update's target, a delete. Deliberately generous -- the
  question is whether anything could ever look, and being generous means this
  check reports a table only when NOTHING anywhere names it for any purpose.
*/
const reads = (t: string): boolean =>
  new RegExp(`(from|join|update|delete\\s+from)\\s+(public\\.)?${t}\\b`, 'i').test(corpus) ||
  /*
    A TABLE READ OVER PostgREST IS STILL READ, and a SQL-shaped pattern cannot
    see it. `supabase/functions/slack-events` fetches
    `${DB_URL}/rest/v1/slack_workspaces?team_id=eq...`, which names no FROM and
    no JOIN -- so the first version of this check reported one of the busiest
    tables in the product, 55 rows and an edge function reading it on every
    Slack event, as written and never read. Found by driving the check and
    disbelieving its first finding.
  */
  new RegExp(`/rest/v1/${t}\\b`, 'i').test(corpus) ||
  new RegExp(`\\.from\\(['"\`]${t}['"\`]`, 'i').test(corpus)

const unconsumed = tables.filter((t) => writes(t) && !reads(t))

const baseline = JSON.parse(readFileSync(BASELINE, 'utf8')) as {
  unconsumed: string[]
  why: Record<string, string>
}
const known = new Set(baseline.unconsumed)

const fresh = unconsumed.filter((t) => !known.has(t))
const fixed = [...known].filter((t) => !unconsumed.includes(t))
const unexplained = unconsumed.filter((t) => known.has(t) && !(baseline.why[t] ?? '').trim())

for (const t of unconsumed) {
  console.log(`  public.${t} — written, and nothing reads it`)
}

if (fresh.length === 0 && fixed.length === 0 && unexplained.length === 0) {
  console.log(
    `check:consumed clean — ${String(tables.length)} public table(s); ` +
      `${String(unconsumed.length)} written and never read, each recorded with a reason`,
  )
  process.exit(0)
}

for (const t of fresh) {
  console.error(`NEW: public.${t} is written and nothing reads it.`)
}
for (const t of fixed) {
  console.error(`REACHED: public.${t} now has a reader — remove it from ${BASELINE}.`)
}
for (const t of unexplained) {
  console.error(`NO REASON: public.${t} is baselined with no reason, which is an admission.`)
}
process.exit(1)
