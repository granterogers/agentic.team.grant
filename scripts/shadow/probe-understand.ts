import { readTeaching } from '../../src/agents/teaching.ts'
import { understand } from '../../src/agents/understand.ts'
import { ManagementApiExecutor } from '../../src/db/executor.ts'
import { resolveProjectRef } from '../../src/fresh/project-ref.ts'
import { ProviderRouter } from '../../src/providers/router.ts'

/*
  The project is resolved, not written down. A literal reference here is one
  office in a probe anybody can run, and `resolveProjectRef` keeps the same
  default every other command has while saying, once, that it used it -- which
  is F-009's decision applied rather than bypassed. Surfaced only by
  integration: `check:fresh` lives on one branch and this file on another, and
  neither is wrong alone.
*/
const db = new ManagementApiExecutor(
  resolveProjectRef({ forWhat: 'the understanding probe' }),
  process.env.SUPABASE_ACCESS_TOKEN ?? '',
)
const router = new ProviderRouter(db, process.env.OPENROUTER_API_KEY ?? '')

for (const said of process.argv.slice(2)) {
  const u = await understand(said, router, {})
  console.log(JSON.stringify(said))
  console.log('   surviving:', JSON.stringify(u.surviving))
  for (const r of u.surviving)
    if (r.kind === 'preference')
      console.log('   readTeaching(clause,true):', JSON.stringify(readTeaching(r.text, true)))
}
