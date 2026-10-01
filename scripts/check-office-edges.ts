/**
 * Ownership is enforced, not just classified (multi-user P2).
 *
 *   npm run check:office-edges                 # production, read-only
 *   npm run check:office-edges -- --replica    # the isolated replica (ISOLATED_PG_DB names the database)
 *
 * The rules are `enforcementProblems` in `src/ownership/enforcement.ts`; this is the I/O around them and the proof
 * that they can fail. It injects NINE defects into the catalogue it just read - drop a composite key, disable the
 * write-once trigger, make office_id nullable, remove a derived table's guard, remove the relations guard, switch row
 * security off, put a global unique key back on projects.slug, leave a carrier's bridge out, and stand up a second real office while an MCP client is enabled - and prints, for each,
 * the problem the predicate raised. A control that raised nothing fails the whole check: a clean result from a
 * predicate that cannot fire says nothing.
 */
import { execFileSync } from 'node:child_process'
import { ManagementApiExecutor } from '../src/db/executor.ts'
import {
  ENFORCEMENT_SQL,
  type EnforcementCatalogue,
  enforcementProblems,
  readEnforcement,
} from '../src/ownership/enforcement.ts'
import { type Manifest } from '../src/ownership/manifest.ts'
import { loadManifest } from './check-ownership.ts'

const fromReplica = (): EnforcementCatalogue => {
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
      ENFORCEMENT_SQL,
    ],
    { encoding: 'utf8' },
  )
  const parsed = JSON.parse(out.trim()) as { enforcement?: unknown }
  return readEnforcement(parsed.enforcement ?? parsed)
}

const fromProduction = async (): Promise<EnforcementCatalogue> => {
  const token = process.env.SUPABASE_ACCESS_TOKEN ?? ''
  if (token === '') {
    console.error('SUPABASE_ACCESS_TOKEN is required (or use --replica)')
    process.exit(2)
  }
  const db = new ManagementApiExecutor(
    process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
    token,
  )
  const rows = (await db.execute(ENFORCEMENT_SQL)).rows as { enforcement: unknown }[]
  return readEnforcement(rows[0]?.enforcement)
}

export const controls = (
  manifest: Manifest,
  cat: EnforcementCatalogue,
): { name: string; raised: string[] }[] => {
  const baseline = new Set(enforcementProblems(manifest, cat))
  const added = (c: EnforcementCatalogue): string[] =>
    enforcementProblems(manifest, c).filter((p) => !baseline.has(p))
  const out: { name: string; raised: string[] }[] = []

  const composite = cat.fks.find(
    (f) => f.columns.at(-1) === 'office_id' && f.columns.length > 1 && f.validated,
  )
  if (composite !== undefined)
    out.push({
      name: `drop ${composite.constraint}`,
      raised: added({ ...cat, fks: cat.fks.filter((f) => f !== composite) }),
    })

  const once = cat.triggers.find((t) => t.name === 'a1_office_write_once')
  if (once !== undefined)
    out.push({
      name: `disable write-once on ${once.table}`,
      raised: added({
        ...cat,
        triggers: cat.triggers.map((t) => (t === once ? { ...t, enabled: false } : t)),
      }),
    })

  const col = cat.officeColumns.find(
    (c) => c.notNull && manifest.tables[c.table]?.class === 'OFFICE_CARRIER',
  )
  if (col !== undefined)
    out.push({
      name: `make ${col.table}.office_id nullable`,
      raised: added({
        ...cat,
        officeColumns: cat.officeColumns.map((c) => (c === col ? { ...c, notNull: false } : c)),
      }),
    })

  const edge = cat.triggers.find((t) => t.name === 'a2_office_edges')
  if (edge !== undefined)
    out.push({
      name: `remove the guard on derived ${edge.table}`,
      raised: added({ ...cat, triggers: cat.triggers.filter((t) => t !== edge) }),
    })

  out.push({
    name: 'remove the relations endpoint guard',
    raised: added({
      ...cat,
      triggers: cat.triggers.filter((t) => t.name !== 'a3_relation_endpoints'),
    }),
  })

  const rls = cat.rls[0]
  if (rls !== undefined)
    out.push({
      name: `switch row security off on ${rls.table}`,
      raised: added({
        ...cat,
        rls: cat.rls.map((r) => (r === rls ? { ...r, enabled: false } : r)),
      }),
    })

  out.push({
    name: 'put a global unique key back on projects.slug',
    raised: added({ ...cat, uniques: [...cat.uniques, { table: 'projects', columns: ['slug'] }] }),
  })

  out.push({
    name: 'a second real office while an MCP client is enabled and the MCP conversion is not done',
    raised: added({
      ...cat,
      transitional: { realOffices: 2, enabledMcpClients: 1, mcpOfficeBound: false },
    }),
  })

  const bridge = cat.triggers.find((t) => t.name === 'a0_office_bridge')
  if (bridge !== undefined)
    out.push({
      name: `remove the bridge from ${bridge.table}`,
      raised: added({ ...cat, triggers: cat.triggers.filter((t) => t !== bridge) }),
    })
  return out
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2)
  const manifest = loadManifest()
  const cat = argv.includes('--replica') ? fromReplica() : await fromProduction()
  const problems = enforcementProblems(manifest, cat)

  if (cat.officeColumns.length === 0 || cat.fks.length === 0) {
    console.log(
      'FAIL the catalogue holds no office columns or no keys, so the check looked at nothing',
    )
    process.exit(1)
  }
  const carriers = Object.values(manifest.tables).filter((e) => e.class === 'OFFICE_CARRIER').length
  const composites = cat.fks.filter((f) => f.columns.length > 1 && f.columns.at(-1) === 'office_id')
  console.log(
    `inspected ${String(cat.officeColumns.length)} office column(s) for ${String(carriers)} carrier(s), ${String(composites.length)} composite key(s) (${String(composites.filter((c) => !c.validated).length)} not validated), ${String(cat.triggers.length)} guard trigger(s), ${String(cat.exceptions.length)} recorded exception(s)`,
  )

  // A real problem is reported as itself. The controls only matter when the result is clean: they are what shows that a
  // clean result came from a predicate that can fire.
  if (problems.length > 0) {
    console.log(`FAIL ${String(problems.length)} problem(s):`)
    for (const p of problems.slice(0, 30)) console.log(`  ${p}`)
    process.exit(1)
  }
  const ctl = controls(manifest, cat)
  const dead = ctl.filter((c) => c.raised.length === 0)
  for (const c of ctl)
    console.log(
      `control: ${c.name} -> ${c.raised.length === 0 ? 'NOT CAUGHT' : `caught: ${c.raised[0]}`}`,
    )
  if (ctl.length < 9 || dead.length > 0) {
    console.log('FAIL a control did not fire, so a clean result would mean nothing')
    process.exit(1)
  }
  console.log('ok   every owned edge is enforced by the database, and every control fired')
}
