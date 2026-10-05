/**
 * A digest of what EVERY OTHER office holds, read-only, so a run that touched somebody else's office can be seen.
 *
 * Grant's office is one of them, and so is every other person's. Digests only: no content is read back or printed. Tables
 * are the mutable content the Sample's commands could conceivably reach (projects, tasks, contacts, documents, blockers,
 * lessons, autonomy, tool requests and grants, the calendar cache, appearance).
 *
 * A live office does change while somebody is using it; a difference is a reason to look, and the line names the table.
 */
import type { Fingerprint } from './diff.ts'
import { lit, rows } from './lib.ts'

export { diffFingerprints, type Fingerprint } from './diff.ts'

export const otherOffices = async (sampleOfficeId: string): Promise<Fingerprint> => {
  const O = lit(sampleOfficeId)
  const r = await rows(`
    select o.office_id::text office,
      (select md5(coalesce(string_agg(x.project_id::text || x.status::text || x.name, ',' order by x.project_id), '')) from public.projects x where x.office_id = o.office_id) projects,
      (select md5(coalesce(string_agg(x.task_id::text || x.state || coalesce(x.due_on::text, '') || x.priority::text || x.title, ',' order by x.task_id), '')) from public.tasks x where x.office_id = o.office_id) tasks,
      (select md5(coalesce(string_agg(c.contact_id::text || c.name || coalesce(c.archived_at::text, ''), ',' order by c.contact_id), '')) from public.contacts c join public.projects p on p.project_id = c.project_id where p.office_id = o.office_id) contacts,
      (select md5(coalesce(string_agg(x.document_id::text || x.state || coalesce(x.title, ''), ',' order by x.document_id), '')) from public.documents x where x.office_id = o.office_id) documents,
      (select md5(coalesce(string_agg(x.blocker_id::text || x.state::text, ',' order by x.blocker_id), '')) from public.blockers x where x.office_id = o.office_id) blockers,
      (select md5(coalesce(string_agg(x.lesson_id::text, ',' order by x.lesson_id), '')) from public.lessons x where x.office_id = o.office_id) lessons,
      (select md5(coalesce(string_agg(x.setting_id::text || x.level::text, ',' order by x.setting_id), '')) from public.autonomy_settings x where x.office_id = o.office_id) autonomy,
      (select md5(coalesce(string_agg(x.request_id::text || x.state, ',' order by x.request_id), '')) from public.tool_requests x where x.office_id = o.office_id) tool_requests,
      (select md5(coalesce(string_agg(x.staff_slug || x.tool, ',' order by x.staff_slug, x.tool), '')) from public.staff_tools x where x.office_id = o.office_id) staff_tools,
      (select md5(coalesce(string_agg(x.event_id || x.status, ',' order by x.event_id), '')) from public.calendar_events x where x.office_id = o.office_id) calendar_events,
      (select md5(coalesce(string_agg(x.settings::text, ',' order by x.updated_at), '')) from public.appearance_settings x where x.office_id = o.office_id) appearance
    from public.offices o where o.office_id <> ${O}::uuid order by o.office_id`)
  const out: Fingerprint = {}
  for (const row of r) {
    const { office, ...tables } = row as Record<string, unknown>
    out[String(office)] = Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, String(v)]))
  }
  return out
}
