/**
 * Pull everything shared with the Notion integration into a project.
 *
 *   npm run notion:sync                        # into the first active project
 *   npm run notion:sync -- --project=<slug>
 *
 * The token comes from the vault (`notion.integration_token`), never from the
 * environment. §17's kill switch is honoured before anything is fetched: if
 * `knowledge_connectors` says the Notion route is closed, this refuses and says
 * why rather than quietly ignoring the setting.
 */

import { ManagementApiExecutor } from '../../src/db/executor.ts'
import { NotionClient } from '../../src/notion/api.ts'
import { CONNECTOR, syncNotion } from '../../src/notion/sync.ts'
import { officeOfProject } from '../test-office.ts'

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
const args = process.argv.slice(2)
const projectSlug = (args.find((a) => a.startsWith('--project=')) ?? '').slice('--project='.length)

const supabase = process.env.SUPABASE_ACCESS_TOKEN
if (supabase === undefined || supabase === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}
const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  supabase,
)
const one = async (sql: string): Promise<Record<string, unknown> | undefined> =>
  (await db.execute(sql)).rows[0] as Record<string, unknown> | undefined

const route = await one(
  `select enabled, disabled_reason from public.knowledge_connectors
    where connector = ${lit(CONNECTOR)}`,
)
if (route === undefined) {
  console.error(`the ${CONNECTOR} connector is not registered`)
  process.exit(1)
}
if (route.enabled !== true) {
  console.error(`the ${CONNECTOR} connector is turned off: ${String(route.disabled_reason)}`)
  process.exit(1)
}

const token = String(
  (
    await one(
      `select app.resolve_secret(
         (select id from vault.secrets where name = 'notion.integration_token')::app.vault_secret_ref
       ) as t`,
    )
  )?.t ?? '',
)
if (token === '') {
  console.error('no notion.integration_token in the vault')
  process.exit(1)
}

const project = await one(
  projectSlug === ''
    ? `select project_id::text as id, slug, name from public.projects
        where status = 'active' order by created_at limit 1`
    : `select project_id::text as id, slug, name from public.projects
        where slug = ${lit(projectSlug)}`,
)
if (project === undefined) {
  console.error(`no such active project: ${projectSlug === '' ? '(none exist)' : projectSlug}`)
  process.exit(1)
}

const result = await syncNotion(
  db,
  await officeOfProject(db, String(project.id)),
  new NotionClient(token),
  String(project.id),
)

console.log(`project: ${String(project.name)} (${String(project.slug)})`)
console.log(
  `shared with the integration: ${String(result.shared)} object(s)\n` +
    `added ${String(result.added)}, changed ${String(result.changed)}, unchanged ${String(result.unchanged)}`,
)
if (result.skipped.length > 0) {
  console.log(`\nskipped ${String(result.skipped.length)}:`)
  for (const s of result.skipped) console.log(`  ${s}`)
}
if (result.shared === 0) {
  // Said out loud, because "0 shared" and "the sync is broken" look identical
  // from here and only one of them has a fix Grant can apply.
  console.log(
    '\nNothing is shared with the integration yet. In Notion, open a page ->\n' +
      '  ⋯ menu -> Connections -> add "Agentic Team Grant".\n' +
      'Child pages are included automatically; a database needs sharing itself.',
  )
}
