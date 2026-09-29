/**
 * The containment witnesses that do NOT ask `app.harness_job` (ledger R37).
 *
 * The guard (`app.claim_delivery`) and every other leak check decide "harness"
 * with one predicate, so a harness it cannot see is invisible to all of them
 * at once - which is how `verify:scenario-a` delivered to Grant for sixteen
 * days while `check:leaks` said "0 new". These ask other questions:
 *
 *   OFF_SHAPE     a turn delivered to a real destination whose dedupe key no
 *                 production adapter writes (Telegram numeric chat/message,
 *                 Slack channel/ts, the dashboard page's own voice session);
 *   HARNESS_DOC   a delivery from work a DOCUMENT started, where the document
 *                 was added by a harness writer - the scenario-a child that the
 *                 first witness could not see, because it has no inbound turn.
 *
 * One definition, two callers: `npm run check:leaks` on production and the
 * isolated containment proof, so the proof exercises the witness that ships.
 */
export const ADAPTER_SHAPE = String.raw`^telegram:(message:([A-Za-z0-9_-]+:)?-?[0-9]+:[0-9]+|callback:[A-Za-z0-9_-]+:[0-9]+)$|^slack:(message|reaction|action):[A-Z0-9]+:[0-9.]+$|^voice:turn:s[a-z0-9]{1,10}\.[a-z0-9]+$`

export const offShapeSql = `
  select distinct c.dedupe_key as key, d.delivery_id::text as delivery_id
    from public.inbound_commands c
    join public.jobs j on (j.pinned_config ->> 'command_id')::uuid = c.command_id
    join public.deliveries d on d.job_id = j.job_id
   where d.sent_at is not null
     and d.created_at > app.harness_guard_since()
     and split_part(c.dedupe_key, ':', 1) in ('telegram', 'slack', 'voice')
     and not exists (select 1 from public.known_escapes k where k.delivery_id = d.delivery_id)
     and c.dedupe_key !~ '${ADAPTER_SHAPE}'`

export const harnessDocSql = `
  select d.delivery_id::text as delivery_id, doc.added_by as key
    from public.deliveries d
    join public.jobs j on j.job_id = d.job_id
    join public.documents doc on doc.document_id::text = j.pinned_config ->> 'document_id'
   where d.sent_at is not null
     and d.created_at > app.harness_guard_since()
     and not exists (select 1 from public.known_escapes k where k.delivery_id = d.delivery_id)
     and coalesce(doc.added_by, '') ~ '^(verify|fixture|probe|gate)[-:_.]'`

/*
  #378 — every SENT message reconciled against what caused it, by rules of
  this witness's own.

  The guard and every check above it ask app.harness_job, and the guard only
  ever saw the job a delivery row names. Narration named none, so 381 harness
  narrations reached Slack while the guard allowed them (a null job was not
  refused) and harness_escapes() could not count them (it inner-joins on the
  job). This witness therefore:

    1. attributes a delivery to a job from the row OR from a job id written
       into its dedupe key (narration:<job>, outcome:<job>, ...), so a row
       that forgot its job is still traced;
    2. walks the whole parent chain and applies its OWN harness rules at every
       level - never app.harness_job, never app.deliverable_to, never the
       guard's operator_senders table;
    3. names three breaches:
         HARNESS_SENT  work whose lineage is harness by these rules was sent
                       to a destination not registered for tests;
         UNPROVENANCED a sent message traceable to no job, from a namespace
                       outside this witness's own list of operator senders.
         UNKNOWN_SENT  (#379) not harness by these rules, but its ROOT is not
                       something a production door or the office itself makes,
                       by this witness's own grammar.

  It also reports where it and app.harness_job disagree, which is how the
  next blind spot of either one becomes visible.
*/
export const WITNESS_OPERATOR_NAMESPACES = [
  'build',
  'hello',
  'introduction',
  'mcp-token',
  'hq-token',
]
const HARNESS_NAME = String.raw`(^|:)(verify|fixture|probe|gate|scenario-a|deploy[0-9]+)([-:_.]|$)`
const JOB_IN_KEY = String.raw`[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}`
/*
  #379: what this witness accepts as a root Grant or the office could have
  made. Written independently of app.adapter_key_ok and app.job_origin, on
  purpose looser in digit counts and with a TIME rule for the retired
  four-part Telegram key where the guard uses a snapshot, so a defect in one
  formulation is not automatically a defect in the other.
*/
const WITNESS_DOOR_KEY = String.raw`^(telegram:(message:[0-9]+:-?[0-9]+:[0-9]+|callback:[0-9]+:[0-9]+)|slack:(message:[A-Z][A-Z0-9]+:[0-9]+\.[0-9]+|(reaction|action):[A-Z][A-Z0-9]+:[0-9]+\.[0-9]+:[A-Z][A-Z0-9]+:[a-z_]+)|voice:turn:s[a-z0-9]{1,10}\.[a-z0-9]+|teamhq:message:[0-9a-f]{32}|asset:[a-z_]+:[0-9a-f-]{36}:[a-z_]+:[0-9]+)$`
const WITNESS_ROOT_TRUSTED = `(
  case
    when cmd.command_id is not null then
      (cmd.dedupe_key ~ '${WITNESS_DOOR_KEY}'
         and (split_part(cmd.dedupe_key, ':', 1) = cmd.origin_channel::text
              or (split_part(cmd.dedupe_key, ':', 1) = 'asset' and cmd.origin_channel::text = 'teamhq')))
      or (cmd.dedupe_key ~ '^telegram:message:-?[0-9]+:[0-9]+$' and cmd.received_at < '2026-09-08')
    else
      j.requested_by ~ '^(duty|trigger|mcp):'
      or j.requested_by in ('hq', 'connector:register')
      or (j.requested_by = 'grant' and j.kind = 'google.revoke')
      or (j.kind = 'knowledge.read_source' and exists (
            select 1 from public.documents dd
             where dd.document_id::text = j.pinned_config ->> 'document_id'
               and (dd.added_by is null or dd.added_by in ('grant', 'the office')
                    or exists (select 1 from public.staff st where st.slug = dd.added_by))))
  end)`

/** One row per sent delivery at or after `since` (an SQL timestamptz expression). */
export const provenanceSql = (since: string): string => `
  with recursive sent as (
    select d.delivery_id, d.channel::text as channel, d.target_ref, d.dedupe_key, d.sent_at,
           coalesce(d.job_id, (select j.job_id from public.jobs j
                                where j.job_id = (substring(d.dedupe_key from '${JOB_IN_KEY}'))::uuid)) as job_id,
           d.job_id is not null as named
      from public.deliveries d
     where d.state = 'sent' and d.sent_at >= ${since}
       and not exists (select 1 from public.test_destinations t
                        where t.channel::text = d.channel::text and t.target_ref = d.target_ref)
  ),
  chain as (
    select s.delivery_id, j.job_id, j.parent_job_id, 0 as depth
      from sent s join public.jobs j on j.job_id = s.job_id
    union all
    select c.delivery_id, p.job_id, p.parent_job_id, c.depth + 1
      from chain c join public.jobs p on p.job_id = c.parent_job_id
     where c.depth < 32
  ),
  judged as (
    select c.delivery_id,
           bool_or(
             j.synthetic
             -- The generated column, not the function: independent of app.harness_job.
             or j.is_fixture
             or j.requested_by ~ '${HARNESS_NAME}'
             or coalesce(pr.slug, '') ~ '^(fixture|verify|ledger-proof)-'
             or coalesce(cmd.dedupe_key, '') ~ '${HARNESS_NAME}'
             or (split_part(coalesce(cmd.dedupe_key, ''), ':', 1) in ('telegram', 'slack', 'voice')
                 and cmd.dedupe_key !~ '${ADAPTER_SHAPE}')
           ) as harness,
           bool_or(c.depth = 0 and app.harness_job(c.job_id)) as guard_says_harness,
           bool_or(c.parent_job_id is null and ${WITNESS_ROOT_TRUSTED}) as root_trusted
      from chain c
      join public.jobs j on j.job_id = c.job_id
      left join public.projects pr on pr.project_id = j.project_id
      left join public.inbound_commands cmd on cmd.command_id = (j.pinned_config ->> 'command_id')::uuid
     group by c.delivery_id
  )
  select s.delivery_id::text as delivery_id, s.channel, s.target_ref, left(s.dedupe_key, 80) as key,
         s.sent_at::text as sent_at, s.job_id::text as job_id, s.named,
         coalesce(g.harness, false) as harness,
         coalesce(g.guard_says_harness, false) as guard_says_harness,
         case
           when s.job_id is null and split_part(s.dedupe_key, ':', 1) <> all (array[${WITNESS_OPERATOR_NAMESPACES.map((n) => `'${n}'`).join(', ')}])
             then 'UNPROVENANCED'
           when coalesce(g.harness, false) then 'HARNESS_SENT'
           when s.job_id is not null and not coalesce(g.root_trusted, false) then 'UNKNOWN_SENT'
           else null
         end as breach
    from sent s left join judged g on g.delivery_id = s.delivery_id`
