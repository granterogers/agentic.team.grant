// Read-only: #381 — sent deliveries by what their ROOT was, including
// authenticated door traffic that a suite produced.
import { ManagementApiExecutor } from '../../src/db/executor.ts'

const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  process.env.SUPABASE_ACCESS_TOKEN ?? '',
)
const q = async (s: string) => (await db.execute(s)).rows
const BASE = String.raw`with recursive d as (
   select d.delivery_id, d.channel::text as channel, d.target_ref, d.dedupe_key, d.sent_at, d.job_id
     from public.deliveries d where d.state = 'sent' and d.job_id is not null),
 up as (select d.delivery_id, j.job_id, j.parent_job_id, 0 as depth from d join public.jobs j on j.job_id = d.job_id
        union all select up.delivery_id, p.job_id, p.parent_job_id, up.depth + 1 from up join public.jobs p on p.job_id = up.parent_job_id where up.depth < 64),
 root as (select delivery_id, job_id from up where parent_job_id is null),
 x as (
 select d.*, rj.job_id as root_job, rj.requested_by, rj.kind as root_kind,
        app.harness_job(d.job_id) as harness,
        coalesce(c.origin_channel::text, rj.pinned_config ->> 'origin_channel') as och,
        coalesce(c.origin_ref, rj.pinned_config ->> 'origin_ref') as oref,
        coalesce(c.instruction, rj.pinned_config ->> 'instruction') as ins,
        c.actor, c.dedupe_key as ckey, (c.command_id is null and rj.pinned_config ? 'command_id') as cmd_deleted
   from d join root r on r.delivery_id = d.delivery_id
   join public.jobs rj on rj.job_id = r.job_id
   left join public.inbound_commands c on c.command_id = (rj.pinned_config ->> 'command_id')::uuid),
 y as (select x.*,
   case
     when harness then 'known_harness'
     when och = 'telegram' and oref ~ '^-?[0-9]+:[0-9]+$' and split_part(oref, ':', 1) not in ('1386648496', '-5444104624')
       then 'auth_test:telegram_fixture_chat'
     when och in ('telegram', 'slack') and ins like 'Give me one sentence on whether we should worry about anything today (%'
       then 'auth_test:latency'
     when och = 'slack' and (coalesce(actor, '') ~ 'VERIFY' or oref like 'C0ECHOVERIFY%')
       then 'auth_test:slack_fixture_actor'
     else 'other'
   end as cls from x)`
console.log('A. every sent delivery, by root class')
console.table(
  await q(`${BASE}
  select cls, och, count(*)::int as sends, count(distinct root_job)::int as roots,
         count(*) filter (where target_ref in ('1386648496'))::int as to_grant_tg,
         min(sent_at)::date::text as first, max(sent_at)::date::text as last
    from y group by 1, 2 order by 1, 3 desc`),
)
console.log('B. authenticated test traffic: destinations')
console.table(
  await q(`${BASE}
  select cls, channel, target_ref, count(*)::int as sends, count(distinct root_job)::int as roots,
         max(sent_at)::date::text as last, min(left(ins, 50)) as sample
    from y where cls like 'auth_test%' group by 1, 2, 3 order by 1, 4 desc`),
)
if (process.argv.includes('--other')) {
  console.log('C. other door roots, with text')
  console.table(
    await q(`${BASE}
    select och, split_part(oref, ':', 1) as conv, actor, count(*)::int as sends, max(sent_at)::date::text as last,
           left(max(ins), 70) as sample, max(left(ckey, 40)) as key
      from y where cls = 'other' and och is not null group by 1, 2, 3, root_job order by 1, 5 desc`),
  )
}
if (process.argv.includes('--relabelled')) {
  console.log('D. known-harness roots that entered through a real door with an adapter-exact key')
  console.table(
    await q(`${BASE}
    select och, split_part(oref, ':', 1) as conv, requested_by, channel, target_ref, count(*)::int as sends,
           count(distinct root_job)::int as roots, max(sent_at)::date::text as last, left(min(ins), 40) as sample
      from y where cls = 'known_harness' and (
            (och = 'telegram' and oref ~ '^-?[0-9]+:[0-9]+$')
         or (och = 'slack' and oref ~ '^[CDG][A-Z0-9]{6,}:[0-9]{10}\\.[0-9]+$')
         or (och = 'voice' and coalesce(ckey, '') ~ '^voice:turn:s[a-z0-9]{1,10}\\.')
         or (och = 'teamhq' and coalesce(ckey, '') ~ '^teamhq:message:[0-9a-f]{32}$'))
     group by 1, 2, 3, 4, 5 order by 6 desc`),
  )
  console.log('E. the teamhq-door roots that are not harness')
  console.table(
    await q(`${BASE}
    select root_job, requested_by, channel, target_ref, sent_at::text, dedupe_key, left(ins, 40) as ins
      from y where cls = 'other' and och = 'teamhq'`),
  )
}
if (process.argv.includes('--consolidated')) {
  const { provenanceSql } = await import('../leak-witness.ts')
  const W = provenanceSql(`'2026-09-01'::timestamptz`, { declarations: false })
  console.log('F. every sent delivery, one class each (disjoint)')
  console.table(
    await q(`${BASE.replace('with recursive d as', () => `with recursive w as (${W}), d as`)}
    , z as (select y.*, w.breach,
       case
         when y.cls like 'auth_test%' then '3 authenticated test impersonating Grant (never marked)'
         when y.cls = 'known_harness' and (
              (och = 'telegram' and oref ~ '^-?[0-9]+:[0-9]+$' and requested_by like 'telegram:%')
           or (och = 'teamhq' and coalesce(ckey, '') ~ '^teamhq:message:[0-9a-f]{32}$'))
           then '2 authenticated door, marked harness only afterwards'
         when y.cls = 'known_harness' or w.breach = 'HARNESS_SENT' then '1 known harness'
         when w.breach in ('UNKNOWN_SENT', 'UNPROVENANCED') then '4 unknown or synthetic origin'
         else '5 real or the office''s own'
       end as klass,
       (y.dedupe_key ~ '^(narration|outcome):') as in_378_narration
      from y left join w on w.delivery_id = y.delivery_id::text)
    select klass, count(*)::int as sends, count(distinct root_job)::int as roots,
           count(*) filter (where channel = 'telegram' and target_ref = '1386648496')::int as to_his_telegram,
           count(*) filter (where channel = 'telegram' and target_ref <> '1386648496')::int as other_telegram,
           count(*) filter (where channel = 'slack')::int as slack,
           count(*) filter (where in_378_narration)::int as of_which_378_narration,
           min(sent_at)::date::text as first, max(sent_at)::date::text as last
      from z group by 1 order by 1`),
  )
}
