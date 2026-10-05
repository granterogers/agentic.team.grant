/**
 * Person A / Person B application attack suite (multi-user P3).
 *   scripts/isolated/p3-attack.sh && npx tsx scripts/isolated/p3-app-attack.ts p3_attack
 * Runs every file in p3-cases/ in name order. Refuses anything that is not a throwaway p3_attack clone.
 */
import { readdirSync } from 'node:fs'
import { isolated } from './guard.ts'
import { context } from './p3-app-lib.ts'

const target = process.argv[2] ?? 'p3_attack'
if (!/^p3_attack/.test(target)) {
  console.error(`REFUSED: ${target} is not a throwaway clone. Run scripts/isolated/p3-attack.sh`)
  process.exit(2)
}
const only = process.argv[3]
const db = await isolated(target)
const { ctx, results } = await context(db)
const dir = new URL('./p3-cases/', import.meta.url)
for (const f of readdirSync(dir)
  .filter((x) => x.endsWith('.ts'))
  .sort()) {
  if (only !== undefined && !f.includes(only)) continue
  const mod = (await import(new URL(f, dir).href)) as { cases: (c: typeof ctx) => Promise<void> }
  try {
    await mod.cases(ctx)
  } catch (e) {
    ctx.check(false, `${f}: the cases ran to the end`, String((e as Error).message).slice(0, 300))
  }
}
await db.end()
let failed = 0
for (const r of results) {
  if (!r.ok) failed += 1
  console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.what}${r.detail ? ` - ${r.detail}` : ''}`)
}
console.log(`\n${String(results.length - failed)}/${String(results.length)} checks passed`)
process.exitCode = failed === 0 && results.length > 0 ? 0 : 1
