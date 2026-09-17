/*
  0477 — 740 jobs in twelve hours, asking for a channel that cannot be made

  `identity-proof-mu5ch1z0-1`, a debris project a crashed `verify:identity` run
  left active this morning, holds **740 completed `office.provision_channels`
  jobs** — one a minute from 10:02 until this was found at 22:34. Every one of
  them said the same thing:

      I could not give Identity proof mu5ch1z0 a Slack channel:
      #identity_proof_mu5ch1z0 is taken by a channel that is not ours, so
      somebody has to choose.

  Each one also set `announce: true`. Grant was spared 740 messages by an
  accident — the job had no inbound message to reply to and no Slack
  destination — which is luck rather than design, and the same luck will not
  hold for a REAL project whose name collides.

  ## Two halves that each look right

  `src/handlers/channels.ts` says in its own comment that a conflict is
  "reported rather than retried, because neither gets better on a second
  attempt". It is correct. The enqueuer (0419) knows nothing about that: it
  asks for a channel for every active, attached, fifteen-minute-old project
  that has none, and a project whose channel can never be made is exactly such
  a project, for ever. Both halves right alone; only their disagreement wrong,
  which CLAUDE.md records as the hardest kind to see.

  ## The rule

  One attempt a day per project. A transient Slack failure gets another go
  tomorrow, a permanent conflict costs one job a day instead of 1,440, and the
  handler's blocker (same commit) gives Grant the choice that ends it for good.

  Not "never retry": the reason can genuinely change — Grant renames the
  project, or archives the stranger's channel — and a rule that gave up for
  ever would need a human to notice something nobody is watching.
*/

create or replace function app.provision_missing_channels()
returns jsonb
language sql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
  with want as (
    select p.project_id, p.name
      from public.projects p
     where p.status = 'active'
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
         desired name is taken by somebody else's channel can never succeed —
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
      (correlation_id, project_id, idempotency_key, kind, requested_by, priority)
    select gen_random_uuid(), w.project_id, format('provision-%s', w.project_id),
           'office.provision_channels', 'hq', 300
      from want w
    on conflict (idempotency_key) where state in ('queued','running','retrying') do nothing
    returning project_id
  )
  select jsonb_build_object(
    'wanted', (select count(*)::int from want),
    'queued', (select count(*)::int from queued),
    'projects', coalesce((select jsonb_agg(w.name order by w.name) from want w), '[]'::jsonb)
  )
$function$;

comment on function app.provision_missing_channels() is
  'Enqueue a channel for every active, attached, non-fixture dashboard project '
  'older than fifteen minutes that has none (#187, 0419) — at most once a day '
  'each, and never while a blocker is asking Grant about it (0477).';
