/**
 * The gateway and the database agree about which functions take an office (multi-user P3).
 *
 * A function whose first argument is `p_office uuid` must be reached through a SECTIONS/ACTIONS entry marked
 * `office: true` (so the gateway writes the verified office into it), and an entry marked `office: true` must reach such
 * a function. Either mismatch is a defect: the first calls the function with no office (it fails closed, and the page is
 * broken), the second sends an office to a function that does not read one.
 *
 *   npm run check:office-gateway                 # against production (read only)
 *   P3_DB=p3_attack npx tsx scripts/check-office-gateway.ts [--fix]   # against a clone; --fix marks the entries
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { ManagementApiExecutor, type SqlExecutor } from '../src/db/executor.ts'
import { PgExecutor } from '../src/db/pg-executor.ts'

const FILE = 'supabase/functions/hq-api/index.ts'
const ENTRY = /^ {2}([a-z_0-9]+): \{(\s*(?:\n\s*)?)fn: '([a-z_0-9]+)'([^\n]*)/gm

export type Entry = { name: string; fn: string; office: boolean; index: number; end: number }

/** Every SECTIONS/ACTIONS entry, read from the gateway's own source. */
export const entries = (source: string): Entry[] => {
  const out: Entry[] = []
  for (const m of source.matchAll(ENTRY)) {
    const start = m.index ?? 0
    // The entry runs to the next line that closes it at the same indent, or the end of its first line.
    const rest = source.slice(start)
    const close = rest.search(/\n {2}\},?\n|\n\},?\n/)
    const body =
      m[0].endsWith('}') || m[0].endsWith('},')
        ? m[0]
        : rest.slice(0, close < 0 ? m[0].length : close)
    out.push({
      name: m[1] as string,
      fn: m[3] as string,
      office: /\boffice: true\b/.test(body),
      index: start,
      end: start + body.length,
    })
  }
  return out
}

export const takesOffice = async (db: SqlExecutor): Promise<Set<string>> => {
  const r = await db.execute(`
    select p.proname from pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
       and (pg_get_function_arguments(p.oid) like 'p_office uuid%')`)
  return new Set((r.rows as { proname: string }[]).map((x) => x.proname))
}

export const problems = (list: Entry[], offices: Set<string>): string[] => {
  const bad: string[] = []
  for (const e of list) {
    const needs = offices.has(e.fn)
    if (needs && !e.office)
      bad.push(`${e.name}: ${e.fn} takes an office and the entry is not marked office: true`)
    if (!needs && e.office)
      bad.push(`${e.name}: marked office: true but public.${e.fn} takes no p_office`)
  }
  return bad
}

if (process.argv[1]?.endsWith('check-office-gateway.ts')) {
  const local = process.env.P3_DB
  let db: SqlExecutor
  if (local !== undefined) {
    const pg = new PgExecutor(`postgresql://postgres@/${local}?host=/tmp/pgs&port=55432`)
    await pg.connect()
    db = pg
  } else {
    db = new ManagementApiExecutor(
      process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
      process.env.SUPABASE_ACCESS_TOKEN ?? '',
    )
  }
  const source = readFileSync(FILE, 'utf8')
  const list = entries(source)
  const offices = await takesOffice(db)
  const bad = problems(list, offices)
  if (process.argv.includes('--fix') && bad.length > 0) {
    let out = source
    for (const e of [...list].reverse()) {
      if (offices.has(e.fn) && !e.office) {
        const at = out.indexOf(`fn: '${e.fn}'`, e.index)
        out = `${out.slice(0, at + `fn: '${e.fn}'`.length)}, office: true${out.slice(at + `fn: '${e.fn}'`.length)}`
      }
    }
    writeFileSync(FILE, out)
    console.log(`marked ${String(bad.length)} entr${bad.length === 1 ? 'y' : 'ies'}`)
  } else {
    console.log(
      `${String(list.length)} gateway entries, ${String(offices.size)} public functions take an office`,
    )
    for (const b of bad) console.error(`FAIL ${b}`)
    if (bad.length > 0) process.exitCode = 1
    else console.log('check:office-gateway OK')
  }
  if ('end' in db && typeof (db as PgExecutor).end === 'function') await (db as PgExecutor).end()
}
