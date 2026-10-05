/**
 * Every table in `public` has an ownership class, and a derived table proves its owner (multi-user P0).
 *
 *   npm run check:ownership                 # production, read-only
 *   npm run check:ownership -- --replica    # the isolated replica (scripts/isolated/replica.sh)
 *   npm run check:ownership -- --suggest    # a starting point for each unclassified table
 *   npm run check:ownership -- --prove-it   # break it on purpose, watch it go red, restore, watch it go green
 *
 * The rules live in `src/ownership/manifest.ts` and the decisions in
 * `docs/multi-user/ownership-manifest.json`. This is only the I/O around them.
 *
 * ## Its own control
 *
 * A check whose happy path is "found nothing" must first prove it looked at something and can fire.
 * It asserts the catalogue is non-empty and that FIVE synthetic defects are each refused by the same
 * predicate: a table with no entry, a derived path that is nullable, a shared table with no reason,
 * an unacknowledged edge between two owned tables, and a derived table whose parent is not owned.
 * `--prove-it` runs them and prints, for each, the problem that was raised - never a count alone
 * (a sabotage that did not apply is not a passing control).
 */
import '../src/safety/require-production-checks.ts'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { ManagementApiExecutor } from '../src/db/executor.ts'
import {
  CATALOGUE_SQL,
  type Catalogue,
  type Manifest,
  readCatalogue,
  suggest,
  validate,
} from '../src/ownership/manifest.ts'

// OWNERSHIP_MANIFEST names another manifest file; only the sabotage proofs use it, to show a misclassification is caught.
const MANIFEST_PATH =
  process.env.OWNERSHIP_MANIFEST === undefined
    ? new URL('../docs/multi-user/ownership-manifest.json', import.meta.url)
    : new URL(`file://${process.env.OWNERSHIP_MANIFEST}`)

export const loadManifest = (): Manifest =>
  JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as Manifest

const fromReplica = (): Catalogue => {
  const out = execFileSync(
    'psql',
    [
      '-h',
      process.env.ISOLATED_PG_SOCKET ?? '/tmp/pgs',
      '-p',
      process.env.ISOLATED_PG_PORT ?? '55432',
      '-U',
      'postgres',
      '-d',
      process.env.ISOLATED_PG_DB ?? 'post',
      '-q',
      '-t',
      '-A',
      '-c',
      CATALOGUE_SQL,
    ],
    { encoding: 'utf8' },
  )
  const parsed = JSON.parse(out.trim()) as { catalogue?: unknown }
  return readCatalogue(parsed.catalogue ?? parsed)
}

const fromProduction = async (): Promise<Catalogue> => {
  const token = process.env.SUPABASE_ACCESS_TOKEN ?? ''
  if (token === '') {
    console.error('SUPABASE_ACCESS_TOKEN is required (or use --replica)')
    process.exit(2)
  }
  const db = new ManagementApiExecutor(
    process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
    token,
  )
  const rows = (await db.execute(CATALOGUE_SQL)).rows as { catalogue: unknown }[]
  return readCatalogue(rows[0]?.catalogue)
}

/** Five synthetic defects. Each must be refused; the control reports WHAT was raised. */
export const controls = (
  manifest: Manifest,
  cat: Catalogue,
): { name: string; raised: string[] }[] => {
  const baseline = new Set(validate(manifest, cat))
  /** Only problems the injected defect ADDED count: a control that fires on pre-existing noise proves nothing. */
  const added = (m: Manifest, c: Catalogue): string[] =>
    validate(m, c).filter((p) => !baseline.has(p))
  const clone = (): Record<string, Manifest['tables'][string]> => ({ ...manifest.tables })
  const derivedTable = Object.entries(manifest.tables).find(([, e]) => e.class === 'OFFICE_DERIVED')
  const globalTable = Object.entries(manifest.tables).find(([, e]) => e.class === 'GLOBAL')
  const out: { name: string; raised: string[] }[] = []

  const unclassified = clone()
  const victim = Object.keys(unclassified).find((t) => unclassified[t]?.class === 'OFFICE_CARRIER')
  if (victim !== undefined) delete unclassified[victim]
  out.push({
    name: `delete the entry for ${victim ?? '?'}`,
    raised: added({ ...manifest, tables: unclassified }, cat),
  })

  if (derivedTable !== undefined) {
    const [t, e] = derivedTable
    const first = e.path?.[0]
    const nullable: Catalogue = {
      ...cat,
      fks: cat.fks.map((f) =>
        f.child === t && f.constraint === first?.constraint
          ? { ...f, columns: f.columns.map((c) => ({ ...c, notNull: false })) }
          : f,
      ),
    }
    out.push({ name: `make ${t}'s derivation path nullable`, raised: added(manifest, nullable) })

    const parentOf = first?.parent ?? ''
    const unowned = clone()
    const parentEntry = unowned[parentOf]
    if (parentEntry !== undefined)
      unowned[parentOf] = {
        class: 'SYSTEM',
        why: 'synthetic control: pretend the parent is not owned',
      }
    out.push({
      name: `reclassify ${parentOf} (the parent of ${t}) as SYSTEM`,
      raised: added({ ...manifest, tables: unowned }, cat),
    })
  }

  if (globalTable !== undefined) {
    const reasonless = clone()
    reasonless[globalTable[0]] = { class: 'GLOBAL', why: '' }
    out.push({
      name: `remove the reason from GLOBAL ${globalTable[0]}`,
      raised: added({ ...manifest, tables: reasonless }, cat),
    })
  }

  const edge = Object.entries(manifest.tables).find(([, e]) => (e.cross ?? []).length > 0)
  if (edge !== undefined) {
    const unacknowledged = clone()
    unacknowledged[edge[0]] = { ...edge[1], cross: [] }
    out.push({
      name: `forget to acknowledge a cross edge on ${edge[0]}`,
      raised: added({ ...manifest, tables: unacknowledged }, cat),
    })
  }
  return out
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2)
  const manifest = loadManifest()
  const cat = argv.includes('--replica') ? fromReplica() : await fromProduction()
  const problems = validate(manifest, cat)
  const counts = Object.values(manifest.tables).reduce<Record<string, number>>((n, e) => {
    n[e.class] = (n[e.class] ?? 0) + 1
    return n
  }, {})

  if (cat.tables.length === 0) {
    console.log('FAIL the catalogue is empty, so the check looked at nothing')
    process.exit(1)
  }
  console.log(
    `inspected ${String(cat.tables.length)} table(s), ${String(cat.fks.length)} foreign key(s); manifest: ${Object.entries(
      counts,
    )
      .map(([k, v]) => `${k} ${String(v)}`)
      .join(', ')}`,
  )

  if (argv.includes('--suggest')) {
    const known = new Set(Object.keys(manifest.tables))
    for (const t of cat.tables.filter((x) => !known.has(x)))
      console.log(`suggest ${suggest(t, manifest, cat)}`)
  }
  if (problems.length > 0) {
    console.log(`FAIL ${String(problems.length)} problem(s):`)
    for (const p of problems.slice(0, 25)) console.log(`  ${p}`)
    process.exit(1)
  }
  // The controls only matter once the result is clean; a real problem is reported as itself.
  const ctl = controls(manifest, cat)
  const dead = ctl.filter((c) => c.raised.length === 0)
  for (const c of ctl) {
    console.log(
      `control: ${c.name} -> ${c.raised.length === 0 ? 'NOT CAUGHT' : `caught: ${c.raised[0]}`}`,
    )
  }
  if (ctl.length < 5 || dead.length > 0) {
    console.log('FAIL a control did not fire, so a clean result would mean nothing')
    process.exit(1)
  }

  console.log('ok   every table is classified and every derived table proves its owner')
}
