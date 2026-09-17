-- 0346 — the thread says which answers never reached him
--
-- Issue #202: *"A person can tell 'not answered yet' from 'could not be
-- delivered' without reading a log."* Those are different states with the same
-- appearance — silence — and the difference matters more than almost anything
-- else on the page: one means wait, the other means act.
--
-- `deliveries` has known this all along. Nothing anybody looks at read it,
-- which is the shape of the trap CLAUDE.md records about `consultations`: a
-- fact recorded and never read back is indistinguishable from a feature that
-- was never built.
--
-- Derived, not stored. `documents.produced_by` and `relations` are both
-- lessons in what a copied fact costs: the copy is the one that rots (0310).
-- The delivery rows are right there and joinable, so the reader joins.

begin;

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
        'job',           o.job_id,
        /*
          Whether this answer actually reached him (#202).

          A LEFT JOIN over the job's deliveries, aggregated — one answer can go
          to several surfaces, and #202 is explicit that one surface failing
          must not stop the others. So this reports the worst outcome across
          them rather than the first: an answer that reached Telegram and not
          Slack is partly delivered, and saying "delivered" would be a claim.

          Null when there are no delivery rows at all, which is the ordinary
          case for an answer read here in the studio — the studio is not a
          delivery, and marking every one of them "undelivered" would be the
          alarming wording for the normal state, which is #119's mistake.
        */
        'delivery',      dstate.worst,
        'undelivered',   coalesce(dstate.failed, 0)
      ) as v
      from public.outputs o
      join public.jobs j on j.job_id = o.job_id
      left join public.staff s on s.staff_id = o.staff_id
      left join lateral (
        select
          count(*) filter (where d.state = 'failed') as failed,
          case
            when count(*) filter (where d.state = 'failed') > 0 then 'failed'
            when count(*) filter (where d.state = 'claimed') > 0 then 'sending'
            when count(*) > 0 then 'sent'
            else null
          end as worst
          from public.deliveries d
         where d.job_id = o.job_id
      ) dstate on true
       -- An OR, not a coalesce: see 0344. A function wrapped around the column
       -- is opaque to the planner and reads every job in the table.
     where (
             j.project_id = p_project_id
             or (j.project_id is null and p_project_id = app.unnamed_project())
           )
       and not j.is_fixture
       and (p_before is null or o.created_at < p_before)
     order by o.created_at desc
     limit (select n from bounded)
  ),
  recent as (
    select at, v
      from (select at, v from said union all select at, v from answered) both_sides
     order by at desc
     limit (select n from bounded)
  )
  -- Named column in the aggregate, per 0306. Ascending, because the window was
  -- taken from the recent end but a conversation is read forwards.
  select coalesce(jsonb_agg(r.v order by r.at), '[]'::jsonb) from recent r
$fn$;

commit;
