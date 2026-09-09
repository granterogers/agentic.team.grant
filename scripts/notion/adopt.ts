/**
 * Point a project at a Notion teamspace, by name.
 *
 *   npm run notion:adopt -- --project legacy-coaching-course
 *   npm run notion:adopt -- --project legacy-coaching-course --teamspace "Legacy Coaching Course"
 *
 * ## Why this exists, and why my first answer was worse than it needed to be
 *
 * Grant: *"it's not enough that i simply give the name of the team space to
 * use? more or less"*
 *
 * More or less, yes — and I had over-stated the problem. What is true is that
 * Notion's API exposes no teamspace: probed again before writing this, a data
 * source reports its parent as its container database, the container reports
 * the workspace, and the words `teamspace`, `team_space`, `space_id` and
 * `section` appear nowhere in the payload.
 *
 * But the teamspace id was never the thing that was needed. What a write needs
 * is a **data source id**, and those are perfectly discoverable — every
 * database shared with the integration comes back from `/search` with its
 * title. So "use the Legacy Coaching Course teamspace" is an answerable
 * instruction as long as the databases inside it have been shared, which is a
 * thing he does once in the Notion UI and would have to do anyway.
 *
 * The name is how he refers to it; the ids are how the team writes to it; this
 * converts one into the other, once, and stores the ids.
 *
 * ## The one case where a name genuinely is not enough
 *
 * Two teamspaces each containing a database called "Tasks". Both arrive as
 * `Tasks` with different ids and nothing distinguishes them, so this refuses
 * rather than guessing — and names both, so he can say which. He has one
 * teamspace today, so today the name is enough; this is what stops that
 * silently becoming wrong when he has three.
 */

import { ManagementApiExecutor } from '../../src/db/executor.ts'
import { NotionClient } from '../../src/notion/api.ts'
import { listDataSources, schemaOf } from '../../src/notion/structure.ts'

const arg = (name: string): string | null => {
  const at = process.argv.indexOf(`--${name}`)
  return at === -1 ? null : (process.argv[at + 1] ?? null)
}

const projectSlug = arg('project')
if (projectSlug === null) {
  console.error('usage: npm run notion:adopt -- --project <slug> [--teamspace "<name>"]')
  process.exit(2)
}
const teamspace = arg('teamspace')
const go = process.argv.includes('--go')

const supabase = process.env.SUPABASE_ACCESS_TOKEN
if (supabase === undefined || supabase === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}
const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  supabase,
)
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

const project = (
  await db.execute(`
    select project_id::text as id, name, notion_teamspace_name as ts
      from public.projects where slug = ${lit(projectSlug)} and status = 'active'
  `)
).rows[0] as { id?: string; name?: string; ts?: string | null } | undefined

if (project?.id === undefined) {
  console.error(`No active project called "${projectSlug}".`)
  process.exit(1)
}

const token = String(
  (
    (
      await db.execute(
        `select decrypted_secret v from vault.decrypted_secrets where name = 'notion.integration_token'`,
      )
    ).rows[0] as { v?: string }
  )?.v ?? '',
)
if (token === '') {
  console.error('No Notion token in the vault.')
  process.exit(1)
}

const client = new NotionClient(token)
const shared = await listDataSources(client)

console.log(`Project:   ${String(project.name)} (${projectSlug})`)
console.log(`Teamspace: ${teamspace ?? project.ts ?? '(none given)'}`)
console.log(`\nShared with the integration — ${String(shared.length)} data source(s):`)
for (const s of shared) console.log(`  ${s.title.padEnd(14)} ${s.id}`)

/*
  Which database does which job.

  Matched by name, because that is what Notion's own template calls them and
  what a person would say. The role each plays is ours: a project WRITES its
  tasks and documents, so those are `home` attachments with an artifact kind,
  and the uniqueness index already allows exactly one home per kind per
  project.
*/
const WANTED = [
  { names: ['Projects'], kind: 'artifact', why: 'where Notion Projects go' },
  { names: ['Tasks'], kind: 'task', why: 'where tasks go' },
  { names: ['Docs', 'Documents'], kind: 'document', why: 'where written pages go' },
] as const

const chosen: { title: string; id: string; kind: string; why: string }[] = []
const problems: string[] = []

for (const want of WANTED) {
  const matches = shared.filter((s) =>
    want.names.some((n) => s.title.toLowerCase() === n.toLowerCase()),
  )
  if (matches.length === 0) {
    problems.push(`No database called ${want.names.join(' or ')} is shared — ${want.why}.`)
    continue
  }
  if (matches.length > 1) {
    // The case a name cannot settle. Two teamspaces, two "Tasks", nothing to
    // tell them apart.
    problems.push(
      `${String(matches.length)} databases are called "${matches[0]?.title}" ` +
        `(${matches.map((m) => m.id.slice(0, 8)).join(', ')}). A name cannot choose between ` +
        'them — attach the right one by id on the Projects page.',
    )
    continue
  }
  const only = matches[0]
  if (only !== undefined)
    chosen.push({ title: only.title, id: only.id, kind: want.kind, why: want.why })
}

console.log('\nWould attach:')
for (const c of chosen) console.log(`  ${c.title.padEnd(14)} as ${c.kind.padEnd(9)} — ${c.why}`)
if (problems.length > 0) {
  console.log('\nCannot decide:')
  for (const p of problems) console.log(`  ${p}`)
}

// The schema of each, so a later write does not discover the property names by
// being rejected.
console.log('\nSchemas:')
for (const c of chosen) {
  const schema = await schemaOf(client, c.id)
  const selects = schema.properties
    .filter((p) => p.type === 'select' || p.type === 'status')
    .map((p) => `${p.name}=[${p.options.join('|')}]`)
  const relations = schema.properties.filter((p) => p.type === 'relation').map((p) => p.name)
  console.log(
    `  ${c.title}: title="${schema.titleProperty}"` +
      (selects.length === 0 ? '' : ` ${selects.join(' ')}`) +
      (relations.length === 0 ? '' : ` relations=[${relations.join(', ')}]`),
  )
}

if (!go) {
  console.log('\nNothing was changed. Re-run with --go to attach these.')
  process.exit(chosen.length > 0 ? 0 : 1)
}

for (const c of chosen) {
  await db.execute(`
    insert into public.project_attachments
      (project_id, connector, external_ref, display_name, role, artifact_kind, ref_kind)
    values (${lit(String(project.id))}::uuid, 'notion', ${lit(c.id)}, ${lit(c.title)},
            'home', ${lit(c.kind)}, 'data_source')
    on conflict (project_id, connector, external_ref, role) do update
      set enabled = true, disabled_reason = null, updated_at = app.now_utc()
  `)
}

// The teamspace name, recorded as the label it is. And the prompt cleared,
// since the thing it was asking for has been done.
if (teamspace !== null) {
  await db.execute(`
    update public.projects set notion_teamspace_name = ${lit(teamspace)}, updated_at = app.now_utc()
     where project_id = ${lit(String(project.id))}::uuid
  `)
}
await db.execute(`
  delete from public.project_connector_choices
   where project_id = ${lit(String(project.id))}::uuid and connector = 'notion'
`)

console.log(`\nAttached ${String(chosen.length)} data source(s) to ${String(project.name)}.`)
console.log('The team can now write into them without asking anybody where they are.')
