/**
 * The bridge meter, as a delta (multi-user P3). `office_bridge_use` is cumulative, so "has anything started relying on
 * the bridge again" is a difference between two readings.
 *   npx tsx scripts/p3/bridge-delta.ts snapshot [file]     # default docs/multi-user/bridge-baseline.json
 *   npx tsx scripts/p3/bridge-delta.ts delta [file]        # prints every (table, rule) that grew since the snapshot
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { ManagementApiExecutor } from '../../src/db/executor.ts'

const [verb, file = 'docs/multi-user/bridge-baseline.json'] = process.argv.slice(2)
const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  process.env.SUPABASE_ACCESS_TOKEN ?? '',
)
const now = Object.fromEntries(
  (
    (
      await db.execute(
        `select table_name || '/' || rule as k, n::int as n from public.office_bridge_use`,
      )
    ).rows as { k: string; n: number }[]
  ).map((r) => [r.k, r.n]),
)
if (verb === 'snapshot') {
  writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), uses: now }, null, 1))
  console.log(
    `snapshot: ${String(Object.keys(now).length)} (table, rule) pairs, ${String(Object.values(now).reduce((a, b) => a + b, 0))} uses`,
  )
} else if (verb === 'delta' && existsSync(file)) {
  const base = (
    JSON.parse(readFileSync(file, 'utf8')) as { at: string; uses: Record<string, number> }
  ).uses
  const grew = Object.entries(now)
    .filter(([k, n]) => n > (base[k] ?? 0))
    .map(([k, n]) => `${k}: +${String(n - (base[k] ?? 0))}`)
  console.log(
    grew.length === 0
      ? 'bridge delta: none - nothing relied on the bridge since the snapshot'
      : `bridge delta:\n  ${grew.join('\n  ')}`,
  )
  if (grew.length > 0) process.exitCode = 1
} else throw new Error('usage: bridge-delta.ts snapshot|delta [file]')
