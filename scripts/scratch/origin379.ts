// Read-only: 0603's origin model, restated inline, over production's recent sends and live jobs.
import { ManagementApiExecutor } from '../../src/db/executor.ts'

const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  process.env.SUPABASE_ACCESS_TOKEN ?? '',
)
const KEY_OK = String.raw`case c.origin_channel::text
    when 'telegram' then (c.dedupe_key ~ '^telegram:message:[0-9]+:-?[0-9]+:[0-9]+$' or c.dedupe_key ~ '^telegram:callback:[0-9]+:[0-9]+$')
                     and exists (select 1 from public.telegram_bots b where b.bot_id = split_part(c.dedupe_key, ':', 3))
    when 'slack' then c.dedupe_key ~ '^slack:message:[CDG][A-Z0-9]{6,}:[0-9]{10}\.[0-9]{6}$'
                   or c.dedupe_key ~ '^slack:(reaction|action):[CDG][A-Z0-9]{6,}:[0-9]{10}\.[0-9]{6}:[UW][A-Z0-9]{6,}:[a-z_]+$'
    when 'voice' then c.dedupe_key ~ '^voice:turn:s[a-z0-9]{1,10}\.[a-z0-9]+$'
    when 'teamhq' then c.dedupe_key ~ '^teamhq:message:[0-9a-f]{32}$'
                    or c.dedupe_key ~ '^asset:[a-z_]+:[0-9a-f-]{36}:[a-z_]+:[0-9]{17}$'
    else false end`
const LEGACY = String.raw`(c.dedupe_key ~ '^telegram:message:-?[0-9]+:[0-9]+$' and c.received_at < '2026-09-07 15:00:00+00' and not c.synthetic)`
const INTERNAL = String.raw`(
    exists (select 1 from public.responsibilities r where rj.requested_by = 'duty:' || r.slug and r.job_kind = rj.kind)
 or exists (select 1 from public.event_triggers t where rj.requested_by = 'trigger:' || t.name and t.job_kind = rj.kind)
 or (rj.requested_by = 'hq' and rj.kind in ('office.provision_channels', 'office.rename_channels'))
 or (rj.requested_by = 'grant' and rj.kind = 'google.revoke')
 or (rj.requested_by = 'connector:register' and rj.kind = 'mcp.discover')
 or exists (select 1 from public.mcp_clients m where rj.requested_by = 'mcp:' || m.client_id and m.enabled and 'write' = any (m.scopes))
 or (rj.kind = 'knowledge.read_source' and exists (select 1 from public.documents d
       where d.document_id::text = rj.pinned_config ->> 'document_id'
         and rj.requested_by = d.connector || ':' || coalesce(d.external_ref, 'source')
         and (d.added_by is null or d.added_by in ('grant', 'the office') or exists (select 1 from public.staff s where s.slug = d.added_by)))))`
const verdict = (jobExpr: string) => `
  with recursive up as (
    select j.job_id, j.parent_job_id, 0 as depth from public.jobs j where j.job_id = ${jobExpr}
    union all select p.job_id, p.parent_job_id, up.depth + 1 from up join public.jobs p on p.job_id = up.parent_job_id where up.depth < 64)
  select case
    when app.harness_job(${jobExpr}) then 'harness'
    when rj.pinned_config ? 'command_id' then
      (select case when c.synthetic or app.harness_label(c.dedupe_key) or app.harness_voice_session(c.dedupe_key) then 'harness'
                   when ${LEGACY} or (${KEY_OK}) then 'trusted' else 'unknown' end
         from public.inbound_commands c where c.command_id = (rj.pinned_config ->> 'command_id')::uuid)
    when ${INTERNAL} then 'internal' else 'unknown' end
  from public.jobs rj where rj.job_id = (select job_id from up where parent_job_id is null order by depth desc limit 1)`
const q = async (s: string) => (await db.execute(s)).rows
console.log('A. deliveries SENT in the last 21 days, by the new verdict vs harness_job:')
console.table(
  await q(`select v.verdict, app.harness_job(d.job_id) as harness_job, d.channel::text, count(*)::int as n,
      max(d.sent_at)::date::text as last, max(rj.requested_by) as sample_by, max(rj.kind) as sample_kind
    from public.deliveries d
    cross join lateral (${verdict('d.job_id')}) as v(verdict)
    join public.jobs rj on rj.job_id = d.job_id
   where d.state = 'sent' and d.sent_at > now() - interval '21 days' and d.job_id is not null
   group by 1, 2, 3 order by 1, 4 desc`),
)
console.log('B. real-by-harness_job sends the new model would REFUSE (last 21 days), in detail:')
console.table(
  await q(`select d.sent_at::text, d.channel::text, left(d.dedupe_key, 50) as key, j.kind, j.requested_by
    from public.deliveries d join public.jobs j on j.job_id = d.job_id
    cross join lateral (${verdict('d.job_id')}) as v(verdict)
   where d.state = 'sent' and d.sent_at > now() - interval '21 days' and not app.harness_job(d.job_id) and v.verdict = 'unknown'
   order by 1 desc limit 40`),
)
console.log('C. jobs still live (not terminal), by verdict:')
console.table(
  await q(`select v.verdict, j.kind, count(*)::int as n from public.jobs j
    cross join lateral (${verdict('j.job_id')}) as v(verdict)
   where j.state not in ('complete', 'cancelled', 'failed') group by 1, 2 order by 1, 3 desc`),
)
