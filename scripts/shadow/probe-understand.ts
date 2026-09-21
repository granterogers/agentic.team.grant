import { readTeaching } from '../../src/agents/teaching.ts'
import { understand } from '../../src/agents/understand.ts'
import { ManagementApiExecutor } from '../../src/db/executor.ts'
import { ProviderRouter } from '../../src/providers/router.ts'

const db = new ManagementApiExecutor(
  'baujwlzcziasnfhhkchg',
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
