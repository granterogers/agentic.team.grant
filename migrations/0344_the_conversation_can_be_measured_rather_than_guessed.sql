-- 0344 — the conversation's growth, measured; and a reader that stays bounded
--
-- Issue #204, which asked three specific questions rather than for a retention
-- policy for its own sake. Its own instruction was to wait until Slack (#193)
-- and Telegram (#194) were syncing so the rate came from real two-surface
-- traffic. They are, so here are the answers.
--
-- 1. WHAT IS THE GROWTH RATE?  Measured on 13 September 2026:
--
--      slack     117 rows over 10 days   11.7 a day
--      voice      87 rows over  5 days   17.4 a day
--      telegram   75 rows over  9 days    8.3 a day
--      teamhq      2 rows                 1.0 a day
--
--    281 inbound rows in 368 kB, so about 1.3 kB each; 2,253 outputs in
--    856 kB, about 0.4 kB each. Call it 38 messages a day and 100 kB a day
--    with both halves, which is 36 MB a year. The database is 48 MB of the
--    free tier's 500 MB.
--
--    So the honest answer to "does anything need deleting" is NO, and not
--    marginally: at today's rate the conversation alone would take more than a
--    decade to become a problem. Writing a deletion policy now would be
--    inventing work and risking the record.
--
-- 2. CAN ANYTHING BE DELETED ANYWAY?  Largely not, and that is by design.
--    `outputs` hangs off `jobs`, and a job can never be deleted because
--    `job_state_transitions` is append-only under §6. So even if the rate
--    turned, "delete old messages" is not a lever this schema offers for the
--    office's half. That makes #204 a question about the READER'S WINDOW, not
--    about deletion — which is what this migration acts on.
--
-- 3. WHAT DOES THE READER DO AT VOLUME?  This is the one real finding.
--
--    The office's half was written `coalesce(j.project_id, app.unnamed_project())
--    = p_project_id`. A function call inside coalesce on the left of the
--    comparison is not sargable, so `jobs_project_state_idx` cannot be used and
--    the planner reads every job in the table. Today that is 4,538 rows and
--    invisible; it is the definition of unbounded.
--
--    And both halves were unioned in full before the LIMIT, so the sort grew
--    with the project's whole history rather than with the window asked for.
--
--    Both are fixed below. The predicate is written as an OR so the common
--    branch is an index condition, and each half takes its own window before
--    the union, so the sort sees at most 2N rows however long the
--    conversation is.
--
-- Nothing about what the reader RETURNS changes. Same shape, same ordering,
-- same fields — this is the plan, not the answer.

begin;

/*
  Dropped by exact signature first.

  `create or replace` does not replace a function whose argument list changed,
  it creates a second overload and calls become ambiguous. The list is
  unchanged here, so replace would work — but the habit is what saves the time,
  and the public wrapper below is the half that silently drops a parameter.
*/
drop function if exists app.conversation_history(uuid, integer, timestamptz);

create function app.conversation_history(
  p_project_id uuid,
  p_limit integer default 50,
  p_before timestamptz default null
) returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $fn$
  with bounded as (select greatest(1, least(coalesce(p_limit, 50), 200)) as n),
  said as (
    select
      c.received_at as at,
      jsonb_build_object(
        'message_id',   c.command_id,
        'kind',         'said',
        'at',           c.received_at,
        'from',         'grant',
        'name',         'Grant',
        -- A voice note's transcript IS the message; the instruction column
        -- holds a placeholder for one. 0089's six-messages-in-43-seconds.
        'body',         coalesce(nullif(btrim(c.transcript), ''), c.instruction),
        'surface',      c.origin_channel,
        'addressed_to', c.addressed_to,
        'spoken',       c.voice_file_id is not null,
        -- 0340. Reconstructed history is marked so a reader can say so.
        'backfilled',   coalesce((c.context->>'backfilled')::boolean, false)
      ) as v
      from public.inbound_commands c
      left join public.jobs j on j.job_id = c.job_id
     where c.project_id = p_project_id
       and coalesce(j.is_fixture, false) = false
       and (p_before is null or c.received_at < p_before)
     order by c.received_at desc
     limit (select n from bounded)
  ),
  answered as (
    select
      o.created_at as at,
      jsonb_build_object(
        'message_id',    o.output_id,
        'kind',          'answered',
        'at',            o.created_at,
        'from',          coalesce(s.slug, 'the-office'),
        'name',          coalesce(s.name, 'The team'),
        'body',          o.body,
        'confidence',    o.confidence::text,
        'evidence',      o.evidence::text,
        'deterministic', o.deterministic,
        'job',           o.job_id
      ) as v
      from public.outputs o
      join public.jobs j on j.job_id = o.job_id
      left join public.staff s on s.staff_id = o.staff_id
       /*
         An OR, not a coalesce (#204).

         `coalesce(j.project_id, app.unnamed_project()) = p_project_id` means
         the same thing and cannot use an index: a function call wrapped around
         the column is opaque to the planner, so every job in the table is
         read. Written this way the first branch is a plain index condition on
         `jobs_project_state_idx`, and the null branch — jobs belonging to no
         project, which land in the reserved Unnamed one (0334) — is evaluated
         only when that is the project being asked for.
       */
     where (
             j.project_id = p_project_id
             or (j.project_id is null and p_project_id = app.unnamed_project())
           )
       and not j.is_fixture
       and (p_before is null or o.created_at < p_before)
     order by o.created_at desc
     limit (select n from bounded)
  ),
  /*
    Each half took its own window above, so this sorts at most 2N rows however
    long the conversation is. Before, the union was materialised in full and
    the sort grew with the project's entire history — which is the thing #204
    calls "unbounded", and it was in the SORT rather than in the storage.
  */
  recent as (
    select at, v
      from (select at, v from said union all select at, v from answered) both_sides
     order by at desc
     limit (select n from bounded)
  )
  /*
    Named column in the aggregate, per 0306: jsonb_agg(x) where x is a subquery
    alias aggregates the ROW, not the payload, and the result is the right
    LENGTH with every field null - which throws nothing and renders as a card
    with nothing in it.

    Ascending, because the window was taken from the recent end but a
    conversation is read forwards.
  */
  select coalesce(jsonb_agg(r.v order by r.at), '[]'::jsonb) from recent r
$fn$;

/*
  And the measurement itself, so #204's first question never has to be asked of
  an agent again.

  This is the standing instruction that outranks most others: "I want to reduce
  my dependence on Claude or another coding interface for maintaining and
  extending the system." A number somebody had to run a script to get is a
  number Grant does not have. This one is a function, it is wrapped for
  PostgREST, and the studio reads it.

  Reports per surface: how many, over how many days, how many a day, and what
  that projects to against the free tier's remaining room. Fixtures excluded —
  harness traffic reported as growth is the trap this repository already has a
  whole paragraph about.
*/
drop function if exists app.conversation_growth();

create function app.conversation_growth()
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $fn$
  with per_surface as (
    select
      c.origin_channel as surface,
      count(*) as rows,
      min(c.received_at) as first_seen,
      max(c.received_at) as last_seen,
      -- At least one day, so a surface that started this morning reports its
      -- own count rather than dividing by zero and claiming infinity.
      greatest(
        1,
        ceil(extract(epoch from (max(c.received_at) - min(c.received_at))) / 86400.0)
      ) as days
      from public.inbound_commands c
      left join public.jobs j on j.job_id = c.job_id
     where coalesce(j.is_fixture, false) = false
     group by c.origin_channel
  ),
  sizes as (
    select
      pg_total_relation_size('public.inbound_commands') as inbound_bytes,
      pg_total_relation_size('public.outputs') as outputs_bytes,
      pg_database_size(current_database()) as db_bytes,
      (select count(*) from public.inbound_commands) as inbound_rows,
      (select count(*) from public.outputs) as output_rows
  ),
  rate as (
    select
      coalesce(sum(p.rows / p.days), 0) as messages_a_day
      from per_surface p
  )
  select jsonb_build_object(
    'measured_at', now(),
    'surfaces', coalesce(
      (select jsonb_agg(jsonb_build_object(
          'surface',   p.surface,
          'rows',      p.rows,
          'first_seen', p.first_seen,
          'last_seen',  p.last_seen,
          'a_day',     round((p.rows / p.days)::numeric, 1)
        ) order by p.rows desc)
         from per_surface p),
      '[]'::jsonb),
    'messages_a_day', round((select messages_a_day from rate)::numeric, 1),
    'bytes_a_message', case
      when (select inbound_rows + output_rows from sizes) = 0 then 0
      else round(
        ((select inbound_bytes + outputs_bytes from sizes)::numeric
          / (select inbound_rows + output_rows from sizes)::numeric), 0)
    end,
    'db_bytes', (select db_bytes from sizes),
    'tier_bytes', 500 * 1024 * 1024,
    /*
      Years of room at the CURRENT rate, which is the only honest projection —
      a rate measured over ten days cannot be extrapolated with a growth curve
      it has never demonstrated. Two message rows per message (his and the
      answer) is the assumption, and it is stated rather than buried.
    */
    'years_of_room', case
      when (select messages_a_day from rate) <= 0 then null
      else round(
        ((500 * 1024 * 1024 - (select db_bytes from sizes))::numeric
          / greatest(1,
              (select messages_a_day from rate)::numeric * 2
              * greatest(1, case
                  when (select inbound_rows + output_rows from sizes) = 0 then 1
                  else ((select inbound_bytes + outputs_bytes from sizes)::numeric
                        / (select inbound_rows + output_rows from sizes)::numeric)
                end)
              * 365)
        ), 1)
    end
  )
$fn$;

-- PostgREST only exposes `public`, so every app.* RPC needs a public wrapper.
drop function if exists public.conversation_growth();
create function public.conversation_growth()
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $fn$ select app.conversation_growth() $fn$;

grant execute on function public.conversation_growth() to anon, authenticated, service_role;

comment on function app.conversation_growth() is
  'Issue #204. How fast the conversation is growing, per surface, and how much '
  'room is left at that rate. Measured rather than guessed, and readable '
  'without an agent.';

commit;
