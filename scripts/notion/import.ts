/**
 * Put a project's material into Notion, from a terminal.
 *
 *   npm run notion:import -- --project legacy-coaching-course
 *
 * The office runs the same handler as `office.notion_import`; this is how a
 * person runs it deliberately and how it gets debugged — the same relationship
 * `notion/adopt.ts` has to `office.notion_adopt`.
 */

import '../../src/safety/require-production-writes.ts'
import { ManagementApiExecutor } from '../../src/db/executor.ts'
import { notionImportHandler } from '../../src/handlers/notion-import.ts'
import { ProviderRouter } from '../../src/providers/router.ts'

const arg = (name: string): string | null => {
  const at = process.argv.indexOf(`--${name}`)
  return at === -1 ? null : (process.argv[at + 1] ?? null)
}

const slug = arg('project')
if (slug === null) {
  console.error('usage: npm run notion:import -- --project <slug>')
  process.exit(2)
}

const supabase = process.env.SUPABASE_ACCESS_TOKEN ?? ''
if (supabase === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}
const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  supabase,
)

const row = (
  await db.execute(
    `select project_id::text as id from public.projects
      where slug = '${slug.replace(/'/g, "''")}' and status = 'active'`,
  )
).rows[0] as { id?: string } | undefined

if (row?.id === undefined) {
  console.error(`No active project called "${slug}".`)
  process.exit(1)
}

const orKey = process.env.OPENROUTER_API_KEY ?? ''
const handler = notionImportHandler({
  db,
  router: orKey === '' ? null : new ProviderRouter(db, orKey),
})

const out = await handler.handle(
  {
    jobId: '00000000-0000-0000-0000-000000000000',
    kind: 'office.notion_import',
    correlationId: '00000000-0000-0000-0000-000000000000',
    projectId: row.id,
    idempotencyKey: `notion-import:${slug}`,
    attempt: 1,
  },
  db,
)

console.log(out.body)
