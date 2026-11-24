// biome-ignore-all lint/suspicious/noExplicitAny: SQL results are untyped rows
/**
 * A project's address keeps the letters of its name (FUN-12, migration 1114), on the isolated replica only.
 *
 *   bash scripts/isolated/replica.sh && npx tsx scripts/isolated/project-address.ts
 *
 * What is proved, each with a positive control beside the accented case:
 *   1. an accented name keeps its letters in the address: "Café Øresund" becomes cafe-oresund, not caf-resund;
 *   2. a second project with the same accented name gets the next free address, as before;
 *   3. a plain name is unchanged (the control: "Plain Name" is plain-name);
 *   4. the name the person typed is stored exactly, accents and all.
 */
import type { PgExecutor } from '../../src/db/pg-executor.ts'
import { isolated } from './guard.ts'

const DB = process.argv[2] ?? 'post'
const main = await isolated(DB)
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
const run = Date.now().toString(36)
const results: boolean[] = []
const check = (what: string, ok: boolean, detail = ''): void => {
  results.push(ok)
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail === '' ? '' : ` - ${detail}`}`)
}
const one = async (sql: string): Promise<any> =>
  ((await (main as PgExecutor).execute(sql)).rows as Record<string, unknown>[])[0]
const json = (v: unknown): any => (typeof v === 'string' ? JSON.parse(v) : v)

const office = String(
  (await one('select office_id::text o from public.offices order by created_at limit 1')).o,
)

const mk = async (name: string, ref: string): Promise<any> =>
  json(
    (
      await one(
        `select app.hq_create_project(${lit(office)}::uuid, ${lit(name)}, 'upload', ${lit(ref)}, ${lit(name)}, true) as v`,
      )
    ).v,
  )

// The run id makes each name unique, so the proof does not depend on what an earlier run left in the office.
const accentedName = `Café Øresund ${run}`
const accented = await mk(accentedName, `address-${run}-a`)
check(
  'an accented name keeps its letters in the address',
  accented.slug === `cafe-oresund-${run}`,
  `slug ${String(accented.slug)}`,
)

const again = await mk(accentedName, `address-${run}-b`)
check(
  'a second project with the same accented name gets the next free address',
  again.slug === `cafe-oresund-${run}-1`,
  `slug ${String(again.slug)}`,
)

const plain = await mk(`Plain Name ${run}`, `address-${run}-c`)
check(
  'a plain name is unchanged (control)',
  plain.slug === `plain-name-${run}`,
  `slug ${String(plain.slug)}`,
)

const stored = await one(
  `select name from public.projects where slug = ${lit(String(accented.slug))} and office_id = ${lit(office)}::uuid`,
)
check(
  'the name is stored exactly as typed, with its accents',
  String(stored?.name) === accentedName,
  `name ${String(stored?.name)}`,
)

const passed = results.filter(Boolean).length
console.log(`\n${String(passed)} of ${String(results.length)} checks passed`)
process.exit(passed === results.length ? 0 : 1)
