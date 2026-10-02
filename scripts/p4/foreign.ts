/**
 * P4 step 3: a foreign id and an id that does not exist must be INDISTINGUISHABLE to the second person, through the real
 * authenticated gateway - same status, same body once the id itself is masked - for reads AND writes, and a refused write
 * must leave the foreign row byte-identical.
 *   npx tsx scripts/p4/foreign.ts
 * Reads use Grant's REAL ids. Writes use ids of FIXTURE rows in Grant's office, so that if the boundary ever failed the
 * damage would be to harness data, never to something of his. A control proves the comparison can tell two answers apart.
 */
import { act, check, db, read, results, secondSession } from './lib.ts'

const T = (await secondSession()).access_token
const NONE = '00000000-0000-4000-8000-00000000dead'
const one = async (sql: string): Promise<string> =>
  String(((await db.execute(sql)).rows[0] as Record<string, unknown> | undefined)?.v ?? '')
const op = 'app.operator_office()'
const ids = {
  realProject: await one(`select project_id::text v from public.projects where office_id=${op} and not is_fixture and slug<>'unnamed' order by created_at limit 1`),
  realSlug: await one(`select slug v from public.projects where office_id=${op} and not is_fixture and slug<>'unnamed' order by created_at limit 1`),
  realTask: await one(`select task_id::text v from public.tasks where office_id=${op} and not is_fixture limit 1`),
  realDoc: await one(`select document_id::text v from public.documents d where office_id=${op} and exists (select 1 from public.projects p where p.project_id=d.project_id and not p.is_fixture) limit 1`),
  realJob: await one(`select job_id::text v from public.jobs where office_id=${op} and not is_fixture and state='complete' limit 1`),
  // WRITE targets live in the TEST office: it is foreign to the second person exactly as Grant's is, and a boundary
  // that failed would damage harness data, never something of his.
  fxTask: await one(`select task_id::text v from public.tasks where office_id=app.test_office() limit 1`),
  fxProject: await one(`select project_id::text v from public.projects where office_id=app.test_office() and status='active' order by created_at desc limit 1`),
  fxSlug: await one(`select slug v from public.projects where office_id=app.test_office() and status='active' order by created_at desc limit 1`),
  fxDoc: await one(`select document_id::text v from public.documents where office_id=app.test_office() limit 1`),
  fxContact: await one(`select c.contact_id::text v from public.contacts c join public.projects p using (project_id) where p.office_id=app.test_office() limit 1`),
  fxJob: await one(`select job_id::text v from public.jobs where office_id=app.test_office() and state in ('complete','failed') limit 1`),
}
console.log(JSON.stringify(Object.fromEntries(Object.entries(ids).map(([k, v]) => [k, v === '' ? '(none)' : `${v.slice(0, 8)}…`]))))

const mask = (t: string, id: string): string => t.split(id).join('<ID>').replace(/"(at|generated_at|exported_at)":"[^"]*"/g, '')
const same = (a: { status: number; text: string }, b: { status: number; text: string }, ida: string, idb: string): boolean =>
  a.status === b.status && mask(a.text, ida) === mask(b.text, idb)

// control: two different answers must be told apart
const c1 = await read(T, 'document', `&id=${NONE}`)
const c2 = await read(T, 'overview')
check('control: the comparison can tell two different answers apart', !same(c1, c2, NONE, NONE))

// ---- reads
const reads: [string, string, string, string][] = [
  ['document', 'id', ids.realDoc, 'document'],
  ['job_progress', 'id', ids.realJob, 'job'],
  ['conversation', 'id', ids.realProject, 'conversation of a project'],
  ['plane', 'id', ids.realProject, 'plane of a project'],
  ['history', 'id', ids.realProject, 'history of a project'],
  ['project_team', 'id', ids.realProject, 'project team'],
  ['project_export', 'id', ids.realProject, 'project export'],
  ['review', 'id', ids.realProject, 'review queue of a project'],
  ['project_artifacts', 'id', ids.realProject, 'project artifacts'],
  ['assigned', 'id', ids.realProject, 'staff on a project'],
  ['output', 'id', ids.realJob, 'output'],
]
for (const [sec, , real, label] of reads) {
  if (real === '') {
    check(`foreign ${label} equals nonexistent`, false, 'no real object to use')
    continue
  }
  const fake = real.length === 36 ? NONE : 'p4-no-such-project-zzz'
  const a = await read(T, sec, `&id=${encodeURIComponent(real)}`)
  const b = await read(T, sec, `&id=${encodeURIComponent(fake)}`)
  check(`foreign ${label} equals nonexistent`, a.status < 500 && same(a, b, real, fake), `${a.status}/${b.status} ${a.text.slice(0, 70)}`)
}

// ---- writes against FIXTURE rows of Grant's office, with the row's state fingerprinted before and after
const fingerprint = async (): Promise<string> =>
  one(`select md5(concat_ws('|',
      (select string_agg(t::text, ',' order by task_id) from public.tasks t where task_id = '${ids.fxTask}'),
      (select string_agg(c::text, ',' order by contact_id) from public.contacts c where contact_id = '${ids.fxContact}'),
      (select string_agg(d.title || d.state, ',') from public.documents d where document_id = '${ids.fxDoc}'),
      (select string_agg(p.name || p.status, ',') from public.projects p where p.slug = '${ids.fxSlug}'))) v`)
const before = await fingerprint()
const writes: [string, Record<string, unknown>, Record<string, unknown>, string][] = [
  ['task_state', { p_task_id: ids.fxTask, p_state: 'done' }, { p_task_id: NONE, p_state: 'done' }, ids.fxTask],
  ['task_update', { p_task_id: ids.fxTask, p_title: 'p4 takeover' }, { p_task_id: NONE, p_title: 'p4 takeover' }, ids.fxTask],
  ['my_task_set', { p_task_id: ids.fxTask, p_title: 'p4 takeover' }, { p_task_id: NONE, p_title: 'p4 takeover' }, ids.fxTask],
  ['my_task_delete', { p_task_id: ids.fxTask }, { p_task_id: NONE }, ids.fxTask],
  ['contact_update', { p_contact_id: ids.fxContact, p_name: 'p4 takeover' }, { p_contact_id: NONE, p_name: 'p4 takeover' }, ids.fxContact],
  ['contact_archive', { p_contact_id: ids.fxContact }, { p_contact_id: NONE }, ids.fxContact],
  ['document_rename', { p_document: ids.fxDoc, p_title: 'p4 takeover' }, { p_document: NONE, p_title: 'p4 takeover' }, ids.fxDoc],
  ['document_discard', { p_document: ids.fxDoc }, { p_document: NONE }, ids.fxDoc],
  ['document_approve', { p_document: ids.fxDoc }, { p_document: NONE }, ids.fxDoc],
  ['project_archive', { p_slug: ids.fxSlug }, { p_slug: 'p4-no-such-project-zzz' }, ids.fxSlug],
  ['rename_project', { p_slug: ids.fxSlug, p_name: 'p4 takeover' }, { p_slug: 'p4-no-such-project-zzz', p_name: 'p4 takeover' }, ids.fxSlug],
  ['say', { p_project_id: ids.fxProject, p_text: 'p4 takeover' }, { p_project_id: NONE, p_text: 'p4 takeover' }, ids.fxProject],
  ['stop_job', { p_job: ids.fxJob }, { p_job: NONE }, ids.fxJob],
  ['task_add', { p_project: ids.fxSlug, p_title: 'p4 takeover' }, { p_project: 'p4-no-such-project-zzz', p_title: 'p4 takeover' }, ids.fxSlug],
  ['contact_add', { p_project: ids.fxSlug, p_name: 'p4 takeover' }, { p_project: 'p4-no-such-project-zzz', p_name: 'p4 takeover' }, ids.fxSlug],
]
for (const [action, foreign, none, mark] of writes) {
  if (mark === '') {
    check(`foreign ${action} equals nonexistent`, false, 'no fixture row to use')
    continue
  }
  const a = await act(T, action, foreign)
  const b = await act(T, action, none)
  const ok = a.status < 500 && same(a, b, mark, mark === ids.fxSlug ? 'p4-no-such-project-zzz' : NONE)
  check(`foreign ${action} equals nonexistent`, ok, `${a.status}/${b.status} ${a.text.slice(0, 80)} | ${b.text.slice(0, 60)}`)
}
const after = await fingerprint()
check('every refused write left the foreign rows byte-identical', before === after, `${before.slice(0, 8)} -> ${after.slice(0, 8)}`)
const stray = await one(
  `select ((select count(*) from public.tasks where title = 'p4 takeover') + (select count(*) from public.contacts where name = 'p4 takeover') + (select count(*) from public.projects where name = 'p4 takeover') + (select count(*) from public.documents where title = 'p4 takeover'))::text v`,
)
check("nothing named 'p4 takeover' exists anywhere", stray === '0', stray)

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} ok`)
process.exitCode = failed.length === 0 ? 0 : 1
