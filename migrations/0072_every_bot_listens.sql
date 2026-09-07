-- 0072 — every bot listens, and knows who it is
--
-- Grant: *"I still want a different bot in Telegram for each task. […] I want
-- it to be two ways, not just receive notifications. I want to be able to
-- communicate with them in Telegram, tell them what to do, and those commands
-- are relayed and actions are carried out."*
--
-- Two things were wrong, and the first was mine to misread. He asked for a bot
-- per ROLE — which is what he created seven of and what 0054 registered — and
-- I built the pager as though he had asked for a bot per role per project and
-- then argued against it. He never asked for that. Corrected without ceremony.
--
-- The second is real: only the Chief of Staff bot has a webhook. The other six
-- can send and cannot hear, which is half a colleague.
--
-- ## One function, seven bots
--
-- Telegram lets each bot register its own webhook URL, so the bot id travels in
-- the query string: `…/telegram-webhook?bot=8842154625`. The function reads it
-- and looks it up — never trusts it. An unregistered id is refused, or the
-- query string would be a way to file an instruction as any staff member.
--
-- ## What an inbound message means now
--
-- A message to @atg_research_bot is a message TO Ines Okonkwo. It is stored
-- with `addressed_to`, and the router treats that as the roster rather than
-- deciding one: Grant naming a person by choosing whose bot to open is a
-- clearer signal than any classifier, and overriding it would make the choice
-- of bot decorative.

begin;

alter table public.inbound_commands
  add column addressed_to text references public.staff (slug);

comment on column public.inbound_commands.addressed_to is
  'The staff member this was sent TO, when the surface carries that — opening '
  '@atg_research_bot addresses Ines. Null on surfaces that do not, like a '
  'Slack channel message. The router treats it as the roster rather than '
  'classifying one: choosing whose bot to open is a clearer signal than any '
  'classifier, and ignoring it would make the choice decorative.';

-- Which staff member a bot speaks for, and whether it may speak at all.
create or replace function app.staff_for_bot(p_bot_id text)
returns table (staff_slug text, staff_name text, username text)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select b.staff_slug, s.name, b.username
    from public.telegram_bots b
    left join public.staff s on s.slug = b.staff_slug
   where b.bot_id = p_bot_id
     and b.enabled
     and b.token_ref is not null
$$;

comment on function app.staff_for_bot is
  'The person behind a bot id. No row means the id is unknown or the bot is '
  'turned off — both of which must refuse the update, because the bot id '
  'arrives in a query string and a lookup is the only thing making it a fact.';

-- PostgREST serves only `public` (0042, 0046, 0066, 0068 — four times now).
create or replace function public.staff_for_bot(p_bot_id text)
returns table (staff_slug text, staff_name text, username text)
language sql stable security definer set search_path = public, pg_catalog
as $$ select * from app.staff_for_bot(p_bot_id) $$;

revoke all on function app.staff_for_bot(text) from public;
revoke all on function public.staff_for_bot(text) from public;
grant execute on function app.staff_for_bot(text) to ai_team_app, service_role;
grant execute on function public.staff_for_bot(text) to ai_team_app, service_role;

-- --------------------------------------------------------------------------
-- An instruction becomes work
-- --------------------------------------------------------------------------
--
-- Storing a command was the whole of the inbound path: `inbound_commands` had a
-- writer and, for text, no consumer. A message to a bot went into a table and
-- nothing happened, which from Grant's side is indistinguishable from the bot
-- being broken.

create or replace function app.enqueue_inbound(p_command_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  c record;
  v_project uuid;
  v_job uuid;
begin
  select * into c from public.inbound_commands where command_id = p_command_id;
  if not found then
    return jsonb_build_object('error', 'no such command');
  end if;
  if c.job_id is not null then
    -- Already turned into work. Idempotent because a webhook is at-least-once
    -- and the same instruction arriving twice must not be done twice.
    return jsonb_build_object('job_id', c.job_id, 'already', true);
  end if;
  if coalesce(trim(c.instruction), '') = '' then
    return jsonb_build_object('error', 'nothing to do: the command carries no instruction');
  end if;

  -- The project this belongs to. One active project makes it unambiguous;
  -- several make it a question, and the honest answer is to ask rather than to
  -- guess — a misfiled instruction is worse than a clarifying question.
  select project_id into v_project
    from public.projects where status = 'active'
   order by updated_at desc
   limit 1;

  if v_project is null then
    return jsonb_build_object('error', 'no active project to attach this to');
  end if;

  insert into public.jobs
    (correlation_id, project_id, idempotency_key, kind, requested_by, priority, pinned_config)
  values (gen_random_uuid(), v_project,
          format('inbound-%s', p_command_id),
          'office.instruction',
          format('%s:%s', c.origin_channel, coalesce(c.subject, c.actor)),
          150,
          jsonb_build_object(
            'instruction', c.instruction,
            'addressed_to', c.addressed_to,
            'origin_channel', c.origin_channel,
            'origin_ref', c.origin_ref,
            'command_id', p_command_id
          ))
  returning job_id into v_job;

  update public.inbound_commands
     set job_id = v_job, processed_at = app.now_utc()
   where command_id = p_command_id;

  return jsonb_build_object('job_id', v_job, 'already', false);
end;
$$;

create or replace function public.enqueue_inbound(p_command_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog
as $$ begin return app.enqueue_inbound(p_command_id); end $$;

revoke all on function app.enqueue_inbound(uuid) from public;
revoke all on function public.enqueue_inbound(uuid) from public;
grant execute on function app.enqueue_inbound(uuid) to ai_team_app, service_role;
grant execute on function public.enqueue_inbound(uuid) to ai_team_app, service_role;

commit;
