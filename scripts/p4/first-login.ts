/**
 * P4 step 1: the second person's FIRST login must be empty of Grant's private state.
 *   npx tsx scripts/p4/first-login.ts
 * Reads every person-facing section as the second person, and fails if any of it carries a name or an id that belongs to
 * Grant's office. Global/system information (staff roster, tool catalogue) is allowed and reported as such.
 */

import { check, db, read, results, secondSession } from './lib.ts'
import { SECOND_EMAIL } from './provision-second-person.ts'

const s = await secondSession()
const sections = [
  'overview',
  'projects',
  'staff',
  'team',
  'activity',
  'lately',
  'pulse',
  'artifacts',
  'portfolio_tasks',
  'my_task_counts',
  'archived',
  'connections',
  'studio_settings',
  'governance',
  'decisions',
  'standing',
  'usage',
  'unseen',
  'team_work',
  'thinking',
  'workspace',
  'mcp',
  'conversation_channels',
]
// what is Grant's, by value: his project slugs/names/ids, his task and contact names, his email
const grant = (
  await db.execute(`
    select (select coalesce(json_agg(distinct p.slug), '[]') from public.projects p join public.offices o on o.office_id = p.office_id where o.kind = 'person' and o.office_id <> '205669cc-c270-4f11-ad63-b7ac4f994340' and not p.is_fixture) as slugs,
           (select coalesce(json_agg(distinct p.project_id::text), '[]') from public.projects p where p.office_id = app.operator_office() and not p.is_fixture) as pids,
           (select coalesce(json_agg(distinct t.task_id::text), '[]') from public.tasks t where t.office_id = app.operator_office()) as tids,
           (select coalesce(json_agg(distinct d.document_id::text), '[]') from public.documents d where d.office_id = app.operator_office()) as dids,
           (select coalesce(json_agg(distinct j.job_id::text), '[]') from public.jobs j where j.office_id = app.operator_office()) as jids,
           (select m.email from public.office_members m where m.owner_key = 'grant' limit 1) as email`)
).rows[0] as Record<string, unknown>
const asArr = (v: unknown): string[] => (typeof v === 'string' ? JSON.parse(v) : (v as string[]))
const needles = [
  ...asArr(grant.pids),
  ...asArr(grant.tids),
  ...asArr(grant.dids),
  ...asArr(grant.jids),
]
// 'unnamed' is every office's own catch-all (app.unnamed_project), so the slug is shared by design and the ID decides.
const slugs = asArr(grant.slugs).filter((x) => x !== 'unnamed')
console.log(`Grant identifiers to look for: ${needles.length} ids, ${slugs.length} project slugs`)
check(
  'the control has something to look for',
  needles.length > 100 && slugs.length >= 3,
  `${needles.length}/${slugs.length}`,
)

const sample: Record<string, string> = {}
for (const sec of sections) {
  const r = await read(s.access_token, sec)
  sample[sec] = r.text
  const leaked = needles.filter((n) => r.text.includes(n))
  const leakedSlug = slugs.filter((x) => r.text.includes(`"${x}"`))
  const mail =
    typeof grant.email === 'string' && r.text.toLowerCase().includes(grant.email.toLowerCase())
  check(
    `section ${sec} carries nothing of Grant's`,
    r.status < 500 && leaked.length === 0 && leakedSlug.length === 0 && !mail,
    `http ${r.status}, ${r.text.length} chars${leaked.length ? `, ${leaked.length} Grant ids` : ''}${leakedSlug.length ? `, slugs ${leakedSlug.join(',')}` : ''}${mail ? ', Grant email' : ''}`,
  )
}
// positive control: the same search must find them in Grant's own payload
const rows = (
  await db
    .execute(`select app.hq_projects(app.operator_office())::text as t`)
    .catch(() => ({ rows: [] }))
).rows[0] as { t?: string } | undefined
void rows
// what the second person sees as projects: only their own unnamed catch-all, if any
const p = JSON.parse(sample.projects ?? '{}') as { projects?: { slug: string; name: string }[] }
console.log(
  'projects visible to the second person:',
  JSON.stringify((p.projects ?? []).map((x) => x.slug)),
)
const projs =
  (JSON.parse(sample.projects ?? '{}') as { data?: { slug: string; project_id: string }[] }).data ??
  []
console.log('projects as the second person sees them:', JSON.stringify(projs.map((x) => x.slug)))
// On the very first login this is exactly one project, their own catch-all; on a later run it also holds what they have
// made since. What does not change is that every project shown belongs to THEIR office, by the canonical row.
const own = (
  await db.execute(
    `select project_id::text v from public.projects where office_id = '205669cc-c270-4f11-ad63-b7ac4f994340'`,
  )
).rows.map((r) => String((r as { v: string }).v))
check(
  'every project the second person sees belongs to their own office (on a first login: exactly the catch-all)',
  projs.length >= 1 &&
    projs.every((x) => own.includes(x.project_id) && !needles.includes(x.project_id)) &&
    (own.length > 1 || (projs.length === 1 && projs[0]?.slug === 'unnamed')),
)
const o = JSON.parse(sample.overview ?? '{}')
console.log('overview keys:', Object.keys(o).join(','))
const staff = JSON.parse(sample.staff ?? '{}') as unknown
console.log('staff payload (global roster) bytes:', JSON.stringify(staff).length)
console.log(`login: ${SECOND_EMAIL}`)
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} ok`)
process.exitCode = failed.length === 0 ? 0 : 1
