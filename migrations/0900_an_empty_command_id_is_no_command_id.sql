-- 0900. An empty command_id is no command_id.
--
-- A job that was handed on by another job (a specialist bringing in a second one, or a standing instruction's fan-out) is
-- created with `pinned_config.command_id = ''` when the job it came from had no command of its own: the TypeScript writes
-- `String(payload.command_id ?? '')`. Four database functions then read that value as `(pinned_config ->> 'command_id')::uuid`,
-- and `''::uuid` raises 22P02, so each of them THROWS for that job:
--
--   app.harness_job   - the canonical "is this nobody's real work" question, asked at every commit, delivery and read
--   app.job_origin    - what may act outside
--   app.owed_a_word   - who is owed a sentence when a job fails
--   app.readings      - the "what did he ask" list
--
-- What it looked like from outside: in the public Sample (5 October 2026) every request that made a specialist bring in a
-- second one ended `failed` after its children had been created, with `handler threw: invalid input syntax for type uuid: ""`
-- on the fourth attempt, and the office's own apology as the only output. Three parents failed that way in an hour, one of
-- them the weekly automation. Nothing else in the repository's history had hit it because production barely fans out
-- ("none has ever convened two", 0562) - the defect is old (0598 wrote the cast) and only waited for the first office that
-- delegated. My own 0899 made `app.studio_requests` ask `harness_job`, so it would also have broken the Agentic Team page of
-- any project holding such a child: that is the same defect reaching one more reader, and this fixes the class.
--
-- The fix is the value, not the callers: '' means "no command", exactly as an absent key does, so the cast is
-- `nullif(..., '')::uuid`. Behaviour for every job that has a real command id is unchanged. For one with '':
--   harness_job   - no command to be harness through: falls to the job's other signals (its parent, its flags);
--   job_origin    - reads as no command, i.e. the branch for a root without one (internal if it is, else 'unknown'), which
--                   is the SAFE direction: 'unknown' is not allowed to act outside;
--   owed_a_word   - falls to the root's own command, as it does for a key that is absent;
--   readings      - joins nothing, so that child is not listed as something he asked.
--
-- All four bodies are spliced from the live definitions with only the cast changed.

create or replace function app.harness_job(p_job_id uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public', 'pg_catalog'
as $function$
  select coalesce(
    (select j.synthetic or j.is_fixture or coalesce(p.is_fixture, false)
              or (j.pinned_config ->> 'origin_namespace') = 'verify'
              or exists (
                   select 1 from public.inbound_commands c
                    where c.command_id = nullif(j.pinned_config ->> 'command_id', '')::uuid and c.office_id = j.office_id
                      and (app.harness_label(c.dedupe_key)
                           or app.harness_voice_session(c.dedupe_key)
                           -- A sample visitor's question: nobody's real work (0897).
                           or c.context ->> 'visitor' is not null))
              or (j.parent_job_id is not null and app.harness_job(j.parent_job_id))
       from public.jobs j
       left join public.projects p on p.project_id = j.project_id
      where j.job_id = p_job_id),
    false)
$function$;

create or replace function app.job_origin(p_job_id uuid)
 returns text
 language sql
 stable security definer
 set search_path to ''
as $function$
  with recursive up as (
    select j.job_id, j.parent_job_id, j.pinned_config, j.origin_kind, j.origin_class, j.office_id, 0 as depth
      from public.jobs j where j.job_id = p_job_id
    union all
    select p.job_id, p.parent_job_id, p.pinned_config, p.origin_kind, p.origin_class, p.office_id, up.depth + 1
      from up join public.jobs p on p.job_id = up.parent_job_id
     where up.depth < 64
  ),
  root as (select * from up where parent_job_id is null order by depth desc limit 1)
  select case
    when not exists (select 1 from up) then 'unknown'
    when app.harness_job(p_job_id) then 'harness'
    when not exists (select 1 from root) then 'unknown'      -- a chain that never ends
    -- Made after 0619: what was recorded when it was created (a child carries its tree's class from that
    -- moment, so a legacy root that later loses its command does not take a frozen child down with it).
    -- A pinned command_id is not read.
    when (select origin_kind from up where depth = 0) is not null then
      case
        when (select origin_class from up where depth = 0) is not null then (select origin_class from up where depth = 0)
        when app.internal_root_ok((select job_id from root)) then 'internal'
        else 'unknown'
      end
    -- Made before 0619: exactly as it was answered before, and no more. The command the root points at is data, so
    -- it counts only when it is the root's OWN office's; any other reads as no command, which is 'unknown'.
    -- 0900: an EMPTY command_id is no command, the same as an absent key.
    when (select nullif(pinned_config ->> 'command_id', '') is not null from root) then
      app.command_origin((select (root.pinned_config ->> 'command_id')::uuid from root
                           where exists (select 1 from public.inbound_commands ic
                                          where ic.command_id = (root.pinned_config ->> 'command_id')::uuid
                                            and ic.office_id = root.office_id)))
    when app.internal_root_ok((select job_id from root)) then 'internal'
    else 'unknown'
  end
$function$;

create or replace function app.owed_a_word(p_job_id uuid)
 returns table(channel text, account_ref text, target_ref text, thread_ref text, kind text)
 language sql
 stable security definer
 set search_path to ''
as $function$
  select c.origin_channel::text,
         split_part(c.origin_ref, ':', 1)::text,
         split_part(c.origin_ref, ':', 1)::text,
         nullif(split_part(c.origin_ref, ':', 2), '')::text,
         j.kind::text
    from public.jobs j
    join public.inbound_commands c
      on c.command_id = coalesce(nullif(j.pinned_config ->> 'command_id', '')::uuid,
                                 (select ic.command_id from public.inbound_commands ic
                                   where ic.job_id = coalesce(j.root_job_id, j.job_id) limit 1))
     -- the command a job points at is data; it is owed a word only on a command of the job's OWN office
     and c.office_id = j.office_id
   where j.job_id = p_job_id
     and (j.state = 'failed'
          or (j.state = 'paused'
              and exists (select 1 from public.job_pauses p
                           where p.job_id = j.job_id and p.resumed_at is null and p.resumable = false)
              and not exists (select 1 from public.blockers b
                               where b.job_id = j.job_id and b.state = 'open')
              and not app.harness_job(j.job_id)))
     and (j.parent_job_id is null or j.state = 'paused')
     and c.origin_channel in ('telegram', 'slack', 'teamhq', 'voice')
     and coalesce(nullif(btrim(c.origin_ref), ''), '') <> ''
     and not exists (select 1 from public.deliveries d where d.job_id = j.job_id)
$function$;

create or replace function app.readings(p_days integer default 7, p_limit integer default 50)
 returns jsonb
 language sql
 stable security definer
 set search_path to ''
as $function$
  select coalesce(jsonb_agg(r order by r.at desc), '[]'::jsonb)
    from (
      select j.job_id as id,
             j.kind,
             j.recipient_agent as who,
             left(coalesce(c.transcript, c.instruction, ''), 300) as asked,
             j.understood_as as understood,
             j.created_at as at
        from public.jobs j
        left join public.inbound_commands c
          on c.command_id = nullif(j.pinned_config ->> 'command_id', '')::uuid
       where not j.is_fixture
         and j.created_at >= app.now_utc() - make_interval(days => greatest(coalesce(p_days, 7), 1))
         and coalesce(btrim(coalesce(c.transcript, c.instruction, '')), '') <> ''
       order by j.created_at desc
       limit greatest(coalesce(p_limit, 50), 1)
    ) r
$function$;
