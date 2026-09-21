/**
 * Provision, inspect or prove the simulated world. `npm run shadow:world`.
 *
 * Idempotent and reused. Not per-run: a fixture project that has gathered a
 * job can never be deleted, so a world built per run is the debris pile
 * CLAUDE.md records being built twice.
 */
import { ManagementApiExecutor } from '../../src/db/executor.ts'
import {
  assertContained,
  provisionWorld,
  sweepHarnessWork,
} from '../../src/simulation/provision.ts'

const token = process.env.SUPABASE_ACCESS_TOKEN
if (token === undefined || token === '') {
  console.log('\n  SUPABASE_ACCESS_TOKEN is not set - the world lives in the live database.\n')
  process.exit(0)
}

const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  token,
)

const check = process.argv.includes('--check')
const sweep = process.argv.includes('--sweep')

console.log('\nShadow Grant - the simulated world\n')

if (!check) {
  const r = await provisionWorld(db)
  console.log(
    `  projects   ${String(r.projects)}   created ${String(r.created.length)}, already there ${String(r.already.length)}`,
  )
  for (const s of r.created) console.log(`    + ${s}`)
  console.log(`  aliases    ${String(r.aliases)}`)
  console.log(`  documents  ${String(r.documents)}`)
}

if (sweep) {
  const r = await sweepHarnessWork(db)
  console.log(`\nSWEEP`)
  console.log(
    `  tasks left by shadow jobs: ${String(r.tasksBefore)} -> ${String(r.tasksAfter)} (${String(r.jobs)} job(s) reversed)`,
  )
  if (r.tasksAfter > 0)
    console.log(
      '  NOTE: what remains is what the office declined to take back, which is correct if a person has touched it.',
    )
}

const problems = await assertContained(db)
console.log('\nCONTAINMENT')
if (problems.length === 0) {
  console.log('  every world project is a fixture, none is visible through the public wrapper,')
  console.log('  none has a Slack channel, and no real project was created for the world.\n')
} else {
  for (const p of problems) console.log(`  PROBLEM  ${p}`)
  console.log()
  process.exit(1)
}
