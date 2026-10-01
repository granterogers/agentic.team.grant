/**
 * Person A / Person B / Sample / Test / System attack suite (multi-user P2). See office-ownership-lib.ts.
 *   npx tsx scripts/isolated/office-ownership.ts p2_attack
 */
import { isolated } from './guard.ts'
import { suite } from './office-ownership-lib.ts'

const target = process.argv[2] ?? 'p2_attack'
if (!/^p2_attack/.test(target)) {
  console.error(`REFUSED: ${target} is not a throwaway clone. Run scripts/isolated/p2-attack.sh`)
  process.exit(2)
}
const db = await isolated(target)
const results = await suite(db)
await db.end()
let failed = 0
for (const r of results) {
  if (!r.ok) failed += 1
  console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.what} - ${r.detail}`)
}
console.log(`\n${String(results.length - failed)}/${String(results.length)} checks passed`)
process.exitCode = failed === 0 ? 0 : 1
