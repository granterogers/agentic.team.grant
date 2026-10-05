-- 0898. Only a PERSON office is offered a Slack channel.
--
-- The public Sample Office (0897) opened with a question on its first project list: "Create the Slack channel
-- #unnamed for 'Unnamed'?" - raised for the catch-all project the office creates for itself, by the sweep that
-- offers every active office a room for every project that has been there fifteen minutes.
--
-- That sweep asks about every ACTIVE office, and a sample, a test and the system office are active offices too. A
-- sample has no Slack to put a room in (the visitor is a guest and nothing outside the page is reachable from it),
-- so the question can never be answered usefully and shows a stranger an internal prompt on the one screen that is
-- meant to look finished. The class is "an office that is not a person's is offered a person's integration", not
-- the one row, so the filter is on the office's kind and the row is settled separately by the sanctioned answer.
--
-- The body is spliced from the live definition with ONE added predicate.

create or replace function app.provision_missing_channels()
 returns jsonb
 language sql
 security definer
 set search_path to 'public', 'pg_catalog'
as $function$
  with want as (
    select p.project_id, p.office_id, p.name
      from public.projects p
     where p.status = 'active'
       and exists (select 1 from public.offices o
                    where o.office_id = p.office_id and o.state = 'active' and o.kind = 'person')
       and not p.is_fixture
       -- Fifteen minutes. A suite's subject is gone long before this; a
       -- project Grant made is still here.
       and p.created_at < app.now_utc() - interval '15 minutes'
       -- ADR-0014: an active project reads from and writes to somewhere real.
       -- One with nothing attached is half-made and does not need a room yet.
       and exists (
         select 1 from public.project_attachments a
          where a.project_id = p.project_id and a.enabled)
       and not exists (
         select 1 from public.slack_channel_map m
          where m.project_id = p.project_id and m.active)
       /*
         Once a day, whatever the reason (0477).

         Without this the sweep re-asks on every tick, and a project whose
         desired name is taken by somebody else's channel can never succeed -
         740 jobs in twelve hours, each one an API call and each one announcing
         a failure.
       */
       and not exists (
         select 1 from public.jobs j
          where j.project_id = p.project_id
            and j.kind = 'office.provision_channels'
            and j.created_at > app.now_utc() - interval '24 hours')
       /*
         And not at all while Grant is being asked about it. A blocker is the
         office saying "somebody has to choose"; asking again tomorrow while
         the question is still open is asking twice.
       */
       and not exists (
         select 1 from public.blockers b
          where b.project_id = p.project_id
            and b.state = 'open'
            and b.requested_action like '%Slack channel%')
  ),
  queued as (
    insert into public.jobs
      (office_id, correlation_id, project_id, idempotency_key, kind, requested_by, priority)
    select w.office_id, gen_random_uuid(), w.project_id, format('provision-%s', w.project_id),
           'office.provision_channels', 'hq', 300
      from want w
    on conflict (office_id, idempotency_key) where state in ('queued','running','retrying') do nothing
    returning project_id
  )
  select jsonb_build_object(
    'wanted', (select count(*)::int from want),
    'queued', (select count(*)::int from queued),
    'projects', coalesce((select jsonb_agg(w.name order by w.name) from want w), '[]'::jsonb)
  )
$function$;
