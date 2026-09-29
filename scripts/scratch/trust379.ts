// Read-only: #379 — the proposed origin grammar measured against production.
import { ManagementApiExecutor } from '../../src/db/executor.ts'

const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  process.env.SUPABASE_ACCESS_TOKEN ?? '',
)
const GRAMMAR = String.raw`case c.origin_channel::text
  when 'telegram' then c.dedupe_key ~ '^telegram:message:([0-9]+|default):-?[0-9]+:[0-9]+$'
                    or c.dedupe_key ~ '^telegram:callback:([0-9]+|default):[0-9]+$'
  when 'slack' then c.dedupe_key ~ '^slack:message:[CDG][A-Z0-9]{6,}:[0-9]{9,}\.[0-9]{1,6}$'
                 or c.dedupe_key ~ '^slack:(reaction|action):[CDG][A-Z0-9]{6,}:[0-9]{9,}\.[0-9]{1,6}:[UW][A-Z0-9]{6,}:[a-z_]+$'
  when 'voice' then c.dedupe_key ~ '^voice:turn:s[a-z0-9]{1,10}\.[a-z0-9]+$'
  when 'teamhq' then c.dedupe_key ~ '^teamhq:message:[0-9a-f]{32}$'
                  or c.dedupe_key ~ '^asset:[a-z_]+:[0-9a-f-]{36}:[a-z_]+:[0-9]{17}$'
  else false end`
const q = async (s: string) => (await db.execute(s)).rows
console.log('A. commands whose job reads REAL today, by grammar verdict:')
console.table(
  await q(`select c.origin_channel::text as ch, (${GRAMMAR}) as grammar_ok,
     split_part(c.dedupe_key, ':', 1) || ':' || split_part(c.dedupe_key, ':', 2) as kind,
     count(*)::int as n, max(c.received_at)::date::text as last, max(left(c.dedupe_key, 60)) as sample
   from public.inbound_commands c
   join public.jobs j on (j.pinned_config ->> 'command_id')::uuid = c.command_id and j.parent_job_id is null
  where not app.harness_job(j.job_id)
  group by 1, 2, 3 order by 1, 2, 4 desc`),
)
console.log('B. sent deliveries, last 30 days, whose ROOT would not be trusted:')
console.table(
  await q(`with recursive d as (
     select d.delivery_id, d.channel::text as channel, d.target_ref, d.dedupe_key, d.sent_at, d.job_id
       from public.deliveries d where d.state = 'sent' and d.sent_at > now() - interval '30 days' and d.job_id is not null),
   up as (select d.delivery_id, j.job_id, j.parent_job_id from d join public.jobs j on j.job_id = d.job_id
          union all select up.delivery_id, p.job_id, p.parent_job_id from up join public.jobs p on p.job_id = up.parent_job_id),
   root as (select delivery_id, job_id from up where parent_job_id is null)
   select coalesce(c.origin_channel::text, '(no command)') as ch,
          case when c.command_id is not null then (${GRAMMAR})::text else 'internal?' end as grammar_ok,
          rj.requested_by, rj.kind, app.harness_job(rj.job_id) as harness, count(*)::int as n,
          max(d.sent_at)::date::text as last
     from d join root r on r.delivery_id = d.delivery_id
     join public.jobs rj on rj.job_id = r.job_id
     left join public.inbound_commands c on c.command_id = (rj.pinned_config ->> 'command_id')::uuid
    group by 1, 2, 3, 4, 5 order by 6 desc`),
)
