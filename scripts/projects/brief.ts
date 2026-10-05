/**
 * Generate briefs for projects whose sources have changed.
 *
 *   npm run brief            # every active project that needs one
 *   npm run brief -- --force # regenerate regardless
 *
 * Free inference only: the router refuses anything not measured as zero-cost,
 * and reads come from the Postgres cache, so a full pass over every project
 * costs nothing in money and nothing in Notebook quota.
 */
import '../../src/safety/require-production-checks.ts'
import { ManagementApiExecutor } from '../../src/db/executor.ts'
import { trustedOffice } from '../../src/office/context.ts'
import { generateBrief, NoSourcesError } from '../../src/projects/brief.ts'
import { EmptyCompletionError, ProviderRouter } from '../../src/providers/router.ts'

const token = process.env.SUPABASE_ACCESS_TOKEN
const orKey = process.env.OPENROUTER_API_KEY
if (token === undefined || token === '' || orKey === undefined || orKey === '') {
  console.error('SUPABASE_ACCESS_TOKEN and OPENROUTER_API_KEY are required')
  process.exit(2)
}

const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  token,
)
const router = new ProviderRouter(db, orKey)
const force = process.argv.includes('--force')

// Spend is read from the provider before and after. §11's four enforcement
// layers should make a charge impossible; checking anyway is what turns that
// from a belief into a measurement.
const spend = async (): Promise<number> => {
  const r = await fetch('https://openrouter.ai/api/v1/key', {
    headers: { Authorization: `Bearer ${orKey}` },
  })
  return ((await r.json()) as { data: { usage: number } }).data.usage
}
const before = await spend()

const projects = await db.execute(`
  select p.project_id::text as project_id, p.office_id::text as office_id, p.name,
         count(s.document_id)::int as sources
  from public.projects p
  join public.documents s on s.project_id = p.project_id and s.office_id = p.office_id
  where p.status = 'active' and s.content is not null
  group by p.project_id, p.office_id, p.name
  order by p.name
`)

if (projects.rows.length === 0) {
  console.log('no active project has cached sources yet; nothing to brief.')
  process.exit(0)
}

let generated = 0
let skipped = 0
let failed = 0

for (const row of projects.rows) {
  const projectId = String(row.project_id)
  const name = String(row.name)
  try {
    // Each project is briefed inside the office its own row names; nothing is carried between offices.
    const result = await generateBrief(db, router, trustedOffice(row.office_id), projectId, {
      force,
    })
    if (result.skipped !== null) {
      skipped += 1
      console.log(`- ${name}: skipped (${result.skipped})`)
      continue
    }
    generated += 1
    console.log(
      `✅ ${name}: ${String(result.body.length)} chars from ${String(result.sourcesUsed)} source(s) ` +
        `via ${result.model}`,
    )
    console.log(`   ${result.body.split('\n')[0]?.slice(0, 140)}...`)
  } catch (error) {
    failed += 1
    if (error instanceof NoSourcesError) {
      console.log(`- ${name}: no cached sources`)
    } else if (error instanceof EmptyCompletionError) {
      // The call worked and cost nothing; the model returned nothing usable.
      // Not a provider failure and deliberately not fatal to the whole pass.
      console.log(`- ${name}: the model returned no usable brief (${error.message.slice(0, 90)})`)
    } else {
      console.log(`❌ ${name}: ${(error as Error).name}: ${(error as Error).message.slice(0, 120)}`)
    }
  }
}

const after = await spend()
console.log(
  `\n${String(generated)} generated, ${String(skipped)} skipped, ${String(failed)} failed. ` +
    `Spend ${String(before)} -> ${String(after)}.`,
)
if (after !== before) {
  // A charge means an enforcement layer was bypassed, which is a defect to
  // surface rather than an expense to absorb (§11).
  console.error('MONEY WAS SPENT. An inference guard was bypassed; this is a defect.')
  process.exit(1)
}
