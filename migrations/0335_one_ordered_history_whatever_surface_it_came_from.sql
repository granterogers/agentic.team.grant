begin;

/**
 * One ordered history, whatever surface it arrived on.
 *
 * Issue #192, the first piece of Phase 7 (#191).
 *
 * Grant's brief asks for "canonical server-side conversation history". The
 * data has been canonical since 0011 and 0014 - every message he has ever sent
 * is in `inbound_commands`, copied at receipt, and 0014's claim is that the
 * application could be rebuilt from Postgres with an empty Slack workspace.
 *
 * What has never existed is anything that reads the two halves as ONE thing.
 * His side is `inbound_commands`. The office's side is `outputs`, reachable
 * only through `jobs`. Nothing joins them, so there is no such object as "the
 * conversation" for anything to point at - and #193, #194, #195 and #199 all
 * need one.
 *
 * ## Why there is no `conversations` table
 *
 * The obvious build is a `conversations` table and a `conversation_messages`
 * join. This deliberately does neither, and the reason is on the record.
 *
 * CLAUDE.md: "Do not store a fact you can already read." `public.relations` is
 * the cautionary tale - the typed edge table the IA document calls the point of
 * the whole model, which never held a single row, while six columns held those
 * same facts all along. 0310's answer was to DERIVE the edges a column holds
 * and store only what no column expresses.
 *
 * Applied here: a conversation is a project's conversation. #26 puts one Chat
 * tab in each project; the IA document puts conversation inside the project.
 * So conversation and project are one-to-one today, and a `conversations` table
 * would hold exactly one row per project, duplicating `projects` and adding a
 * key every reader has to carry.
 *
 * The day a project needs several named threads, that table earns its place and
 * this reader gains a parameter. Building it now would be `relations` again:
 * an abstraction with nothing in it that later readers must still join through.
 *
 * ## What no column expressed, and now does
 *
 * `inbound_commands` had no `project_id`. It has `job_id`, and a job has a
 * project - but 57 of 251 commands have no job at all (callbacks, and messages
 * that failed before enqueue), so more than a fifth of what Grant has ever said
 * could not be attributed to anywhere. That is the one genuinely missing fact,
 * and it is the only thing this migration stores.
 *
 * ## The default is the reserved project, and that is deliberate
 *
 * `project_id` defaults to `app.unnamed_project()` (0334, ADR-0024) rather than
 * being NOT NULL with no default.
 *
 * The alternative - refuse the insert - is the `addressed_to` trap exactly.
 * That column references `staff`, so a slug naming nobody does not route badly:
 * the INSERT fails and the whole turn comes back "could not record what you
 * said". What Grant typed is gone because of a secondary attribute. An adapter
 * that cannot resolve a project must still record the message; filing it under
 * Unnamed is translation failing honestly, which is what §5 asks of an adapter.
 */

-- ---------------------------------------------------------------------------
-- The one fact no column expressed
-- ---------------------------------------------------------------------------

alter table public.inbound_commands
  add column if not exists project_id uuid references public.projects(project_id);

-- Backfill through the job, which is where the answer already was.
update public.inbound_commands c
   set project_id = j.project_id
  from public.jobs j
 where j.job_id = c.job_id
   and c.project_id is null
   and j.project_id is not null;

-- Everything else - no job, or a job with no project - is unattributed, which
-- is precisely what the reserved project is for.
update public.inbound_commands
   set project_id = app.unnamed_project()
 where project_id is null;

alter table public.inbound_commands
  alter column project_id set default app.unnamed_project(),
  alter column project_id set not null;

comment on column public.inbound_commands.project_id is
  'Which dashboard project this message belongs to. Defaults to the reserved '
  'Unnamed project (ADR-0024) rather than refusing the insert: a message must '
  'never be lost because its project could not be resolved. #192.';

/*
  The reader always filters by project and orders by time, so the index carries
  both. DESC because a conversation is read from the recent end.
*/
create index if not exists inbound_commands_by_project
  on public.inbound_commands (project_id, received_at desc);

-- ---------------------------------------------------------------------------
-- The reader
-- ---------------------------------------------------------------------------

/**
 * One project's conversation, both sides, in order.
 *
 * Project isolation is structural rather than promised: both halves filter on
 * `p_project_id` in their own WHERE clause, so there is no path by which a row
 * from another project can reach the result. #192 asks for a check rather than
 * a comment claiming it, and `verify:conversation` is that check.
 *
 * Fixture traffic is excluded through the JOB, because `inbound_commands` has
 * no `is_fixture` of its own and `jobs.is_fixture` is GENERATED from
 * `requested_by`. A command with no job is treated as real - Grant typed it.
 *
 * §12: confidence and evidence are never shown apart, so they travel together
 * on every answered message or not at all.
 */
create or replace function app.conversation_history(
  p_project_id uuid,
  p_limit      int default 50,
  p_before     timestamptz default null)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  with said as (
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
        'spoken',       c.voice_file_id is not null
      ) as v
      from public.inbound_commands c
      left join public.jobs j on j.job_id = c.job_id
     where c.project_id = p_project_id
       and coalesce(j.is_fixture, false) = false
       and (p_before is null or c.received_at < p_before)
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
     where coalesce(j.project_id, app.unnamed_project()) = p_project_id
       and not j.is_fixture
       and (p_before is null or o.created_at < p_before)
  ),
  recent as (
    select at, v
      from (select at, v from said union all select at, v from answered) both_sides
     order by at desc
     limit greatest(1, least(coalesce(p_limit, 50), 200))
  )
  /*
    Named column in the aggregate, per 0306: `jsonb_agg(x)` where x is a
    subquery alias aggregates the ROW, not the payload, and the result is the
    right LENGTH with every field null - which throws nothing and renders as a
    card with nothing in it.

    Ascending, because the window was taken from the recent end but a
    conversation is read forwards.
  */
  select coalesce(jsonb_agg(r.v order by r.at), '[]'::jsonb) from recent r
$$;

comment on function app.conversation_history is
  'One project''s conversation - what Grant said and what the office answered - '
  'as one ordered list, whatever surface each message arrived on. Derived from '
  'inbound_commands and outputs rather than stored twice (#192). Fixture '
  'traffic excluded through the job. Page with p_before.';

create or replace function public.conversation_history(
  p_project_id uuid,
  p_limit      int default 50,
  p_before     timestamptz default null)
returns jsonb language sql stable security definer
set search_path = public, pg_catalog
as $$ select app.conversation_history(p_project_id, p_limit, p_before) $$;

grant execute on function app.conversation_history(uuid, int, timestamptz) to ai_team_app;
grant execute on function public.conversation_history(uuid, int, timestamptz) to ai_team_app;

commit;
