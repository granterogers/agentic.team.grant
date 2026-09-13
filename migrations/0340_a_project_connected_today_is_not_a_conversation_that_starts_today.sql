begin;

/**
 * A project connected today is not a conversation that starts today.
 *
 * Issue #193's last criterion: historical reconstruction.
 *
 * ## The one thing this must never do
 *
 * A backfilled message is NOT enqueued. `app.enqueue_inbound` is not called,
 * not once, not for the recent ones.
 *
 * Every message in a Slack channel's history is an instruction as far as the
 * router is concerned. Importing six months of #legacy-coaching-course and
 * enqueueing it would have the office wake up and act on every request Grant
 * made since March - re-generating decks, re-reading folders, re-asking
 * questions he answered in April, and messaging him about all of it. The
 * office would appear to have gone mad, and every one of those jobs would be
 * doing exactly what it was told.
 *
 * So this writes history and nothing else. `processed_at` is stamped at
 * insert, which is the existing way of saying "recorded, requires nothing".
 *
 * ## Idempotent for free, because the identity was already right
 *
 * `dedupe_key` is `slack:message:<channel>:<ts>` and
 * `inbound_commands_dedupe` is unique over it. A re-run of the backfill
 * therefore cannot duplicate anything - and unlike #28's five-migration
 * struggle with `documents_one_per_external_ref`, there is nothing nullable in
 * this key and no partial predicate to match. The constraint that makes a
 * redelivered webhook safe (#195) makes a re-run of the import safe too.
 *
 * `on conflict do nothing` rather than an upsert: a message that is already
 * recorded is already correct, and Slack's history endpoint returns edited
 * text for an edited message - overwriting would silently rewrite what Grant
 * originally said.
 *
 * ## Distinguishable from live, because the difference matters
 *
 * `context.backfilled` marks it, and `app.conversation_history` now carries
 * the flag out to the page. Reconstructed history is evidence of a different
 * kind: the office did not see it happen, nothing was routed, and no answer
 * in it came from us. A reader that cannot tell would be claiming the office
 * was present for a conversation it never saw - the same class of dishonesty
 * as #185's output that claimed a database read it had not done.
 */

create or replace function app.record_slack_history(
  p_channel_id text,
  p_ts         text,
  p_user       text,
  p_text       text,
  p_thread_ts  text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_project uuid;
  v_said    text := nullif(btrim(coalesce(p_text, '')), '');
  v_key     text;
  v_id      uuid;
begin
  if coalesce(btrim(p_channel_id), '') = '' or coalesce(btrim(p_ts), '') = '' then
    return jsonb_build_object('ok', false, 'error', 'a channel and a ts are both needed');
  end if;
  if v_said is null then
    -- A join notice or a file share with no comment. Not a message; skipped
    -- rather than refused, because a backfill hits plenty of them.
    return jsonb_build_object('ok', true, 'outcome', 'skipped', 'why', 'no text');
  end if;

  select m.project_id into v_project
    from public.slack_channel_map m
   where m.channel_id = p_channel_id and m.project_id is not null;

  if v_project is null then
    return jsonb_build_object(
      'ok', false, 'error', format('channel %s maps to no project', p_channel_id));
  end if;

  v_key := 'slack:message:' || p_channel_id || ':' || p_ts;

  insert into public.inbound_commands
    (origin_channel, origin_ref, actor, instruction, dedupe_key, project_id,
     processed_at, context)
  values ('slack', p_channel_id || ':' || p_ts, coalesce(nullif(btrim(p_user), ''), 'unknown'),
          v_said, v_key, v_project, app.now_utc(),
          jsonb_build_object('backfilled', true, 'thread_ts', p_thread_ts,
                             'project_id', v_project))
  on conflict (dedupe_key) do nothing
  returning command_id into v_id;

  return jsonb_build_object(
    'ok', true,
    'outcome', case when v_id is null then 'already there' else 'added' end,
    'command', v_id,
    'project', v_project);
end;
$$;

comment on function app.record_slack_history is
  'Import one historical Slack message into a project''s conversation (#193). '
  'NEVER enqueues: every message in a channel''s history is an instruction to '
  'the router, and importing six months of it would have the office act on '
  'every request Grant made since March. Idempotent through the dedupe_key '
  'that already makes a redelivered webhook safe. 0340.';

create or replace function public.record_slack_history(
  p_channel_id text, p_ts text, p_user text, p_text text, p_thread_ts text default null)
returns jsonb language sql security definer set search_path = public, pg_catalog
as $$ select app.record_slack_history(p_channel_id, p_ts, p_user, p_text, p_thread_ts) $$;

grant execute on function app.record_slack_history(text, text, text, text, text) to ai_team_app;
grant execute on function public.record_slack_history(text, text, text, text, text) to ai_team_app;

-- ---------------------------------------------------------------------------
-- The reader says which messages it did not witness
-- ---------------------------------------------------------------------------

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
        'spoken',       c.voice_file_id is not null,
        -- 0340. Reconstructed history is marked so a reader can say so.
        'backfilled',   coalesce((c.context->>'backfilled')::boolean, false)
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
  'traffic excluded through the job. Backfilled messages carry a flag (0340), '
  'because the office did not witness those and should not imply it did. '
  'Page with p_before.';

commit;
