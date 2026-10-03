/**
 * What the Sample Person's office holds, per project, read-only.
 *
 *   npm run sample:inventory
 *
 * Writes nothing and signs nobody in: it resolves the Sample office from the login (refusing anything that is not
 * structurally the Sample's) and reads it. Buckets are the plan's own (plan.ts `bucketOf`), computed here against today, so
 * the same words mean the same thing in the seed, the status and this report.
 */
import { createHash } from 'node:crypto'
import { otherOffices } from './fingerprint.ts'
import { lit, PERSONA, rows, sampleOffice } from './lib.ts'
import { BASELINE_VERSION, BUCKETS, type Bucket, bucketOf } from './plan.ts'

const office = await sampleOffice()
const O = lit(office.officeId)
const today = new Date()
console.log(
  `Sample inventory: ${PERSONA.name} / ${PERSONA.business}   office ${office.officeId.slice(0, 8)}   baseline ${BASELINE_VERSION}   today ${today.toISOString().slice(0, 10)}`,
)

const projects = await rows(
  `select project_id::text id, name, status::text status from public.projects where office_id = ${O}::uuid and not is_fixture order by status, name`,
)
const tasks = await rows(
  `select t.task_id::text id, t.project_id::text project, t.state::text state, t.due_on::text due, t.starts_on::text start,
          t.priority, t.labels, t.is_milestone ms, t.parent_task_id is not null sub, t.assignee_staff is not null agent,
          t.blocked_on <> '' blocked
     from public.tasks t where t.office_id = ${O}::uuid`,
)
const docs = await rows(
  `select project_id::text project, state, coalesce(mime_type, doc_type, '') mime, pinned, length(coalesce(title, '')) tlen, origin
     from public.documents where office_id = ${O}::uuid and state <> 'archived'`,
)
const contacts = await rows(
  `select c.project_id::text project, length(c.name || c.role || c.org || c.note) longest, c.phone <> '' phone, c.email <> '' email, c.note <> '' note
     from public.contacts c join public.projects p on p.project_id = c.project_id
    where p.office_id = ${O}::uuid and c.archived_at is null`,
)
const blockers = await rows(
  `select project_id::text project, state::text state from public.blockers where office_id = ${O}::uuid`,
)
const events = await rows(
  `select project_id::text project, action_type, actor_kind from public.events where office_id = ${O}::uuid`,
)

const tally = (xs: string[]): string => {
  const m = new Map<string, number>()
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1)
  return (
    [...m.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([k, v]) => `${k} ${v}`)
      .join(', ') || 'none'
  )
}

const describe = (label: string, pid: string | null) => {
  const ts = tasks.filter((t) => (pid === null ? t.project === null : t.project === pid))
  const buckets = new Map<Bucket, number>()
  for (const t of ts) {
    const b = bucketOf(t.due === null ? null : String(t.due), String(t.state), today)
    buckets.set(b, (buckets.get(b) ?? 0) + 1)
  }
  const live = ts.filter((t) => t.state !== 'cancelled')
  const labels = new Set(live.flatMap((t) => (Array.isArray(t.labels) ? t.labels.map(String) : [])))
  console.log(`\n${label}`)
  console.log(
    `  tasks ${live.length}   by state: ${tally(live.map((t) => String(t.state)))}   (cancelled ${ts.length - live.length} kept for history)`,
  )
  console.log(`  by due bucket: ${BUCKETS.map((b) => `${b} ${buckets.get(b) ?? 0}`).join(', ')}`)
  console.log(
    `  subtasks ${live.filter((t) => t.sub).length}   milestones ${live.filter((t) => t.ms).length}   spans (start date) ${live.filter((t) => t.start !== null).length}   agent-owned ${live.filter((t) => t.agent).length}   person/unassigned ${live.filter((t) => !t.agent).length}`,
  )
  console.log(
    `  priority below ordinary ${live.filter((t) => Number(t.priority) < 100).length}   blocked with a reason ${live.filter((t) => t.blocked).length}   categories (labels): ${[...labels].sort().join(', ') || 'none'}`,
  )
  if (pid === null) return
  const ds = docs.filter((d) => d.project === pid)
  console.log(
    `  documents ${ds.length}   by type: ${tally(ds.map((d) => String(d.mime)))}   by state: ${tally(ds.map((d) => String(d.state)))}   pinned ${ds.filter((d) => d.pinned).length}   longest name ${Math.max(0, ...ds.map((d) => Number(d.tlen)))} chars`,
  )
  const cs = contacts.filter((c) => c.project === pid)
  console.log(
    `  contacts ${cs.length}   with phone ${cs.filter((c) => c.phone).length}, email ${cs.filter((c) => c.email).length}, note ${cs.filter((c) => c.note).length}`,
  )
  const bs = blockers.filter((b) => b.project === pid)
  const es = events.filter((e) => e.project === pid)
  console.log(
    `  open requests/blockers ${bs.filter((b) => b.state === 'open').length}   events in the activity ledger ${es.length}`,
  )
}

console.log('\nPROJECTS (active, then archived)')
for (const p of projects) describe(`${p.name}  [${p.status}]`, String(p.id))
describe('No project (personal inbox)', null)

const scalar = async (sql: string): Promise<string> => String((await rows(sql))[0]?.v ?? '')
console.log('\nOFFICE')
console.log(
  `  tool requests open ${await scalar(`select count(*) v from public.tool_requests where office_id = ${O}::uuid and state = 'open'`)}   tool grants ${await scalar(`select count(*) v from public.staff_tools where office_id = ${O}::uuid`)}   lessons ${await scalar(`select count(*) v from public.lessons where office_id = ${O}::uuid`)}`,
)
console.log(
  `  open blockers (need a job to exist) ${blockers.filter((b) => b.state === 'open').length}   calendar_events (a Google cache, none seeded) ${await scalar(`select count(*) v from public.calendar_events where office_id = ${O}::uuid`)}`,
)
console.log(
  `  activity ledger, by type: ${tally(events.map((e) => `${e.action_type}(${e.actor_kind})`))}`,
)
console.log(
  `  jobs by state: ${tally((await rows(`select state::text s from public.jobs where office_id = ${O}::uuid`)).map((r) => String(r.s)))}   LIVE (queued, running, retrying): ${await scalar(`select count(*) v from public.jobs where office_id = ${O}::uuid and state in ('queued','running','retrying')`)}`,
)
console.log(
  `  autonomy ${await scalar(`select level::text v from public.autonomy_settings where office_id = ${O}::uuid and project_id is null order by set_at desc, setting_id desc limit 1`)}   palette ${await scalar(`select settings ->> 'palette' v from public.appearance_settings where office_id = ${O}::uuid limit 1`)}`,
)

const others = await otherOffices(office.officeId)
const digest = createHash('sha256').update(JSON.stringify(others)).digest('hex').slice(0, 16)
console.log(`\nOTHER OFFICES: ${Object.keys(others).length} fingerprinted, digest ${digest}`)
if (process.argv.includes('--fingerprint'))
  for (const [o, t] of Object.entries(others))
    console.log(`  ${o.slice(0, 8)} ${JSON.stringify(t)}`)
