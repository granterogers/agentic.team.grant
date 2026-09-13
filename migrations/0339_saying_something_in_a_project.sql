begin;

/**
 * Saying something in a project, without an asset to hang it on.
 *
 * Issues #26 and #193. The studio's half of a conversation.
 *
 * ## What was missing
 *
 * `app.send_to_agent` (#27) has existed for a while and does a specific thing:
 * take a document, task, contact or collection, and send THAT to somebody with
 * a named action. Every field of it is about the asset — p_kind, p_id, the
 * title looked up from whichever table it lives in.
 *
 * There was no way to simply say something. #26's composer — ask one agent,
 * ask several, ask everyone — had no backend at all: `web/studio/chat.js`
 * stores messages in localStorage and marks the replies `pending`, honestly,
 * because there was nothing behind them.
 *
 * So the studio could act on a thing and could not talk.
 *
 * ## Why this is not a new channel
 *
 * `origin_channel` is 'teamhq'. 0313 tried 'studio' and was refused by
 * `inbound_origin_channel_known` — ADR-0019 changed which FILES serve the web
 * dashboard, it did not make it a different surface, and `DeliveryChannel`,
 * `CHANNELS`, the callback router and the preference store all say 'teamhq'.
 * Two words for one surface is what 0311 was spent undoing.
 *
 * ## The addressee is validated, and a bad one does not lose the message
 *
 * `inbound_commands.addressed_to` is a foreign key to `staff`. CLAUDE.md
 * records what that costs when a client writes it: a slug naming nobody does
 * not route badly, the INSERT fails, and the whole turn comes back "could not
 * record what you said". What Grant typed is gone because of who he addressed
 * it to.
 *
 * So the slug is checked against the active roster first and dropped if it
 * names nobody, and the response SAYS it was dropped. The message survives;
 * the addressing is what degrades. That is the same trade the Slack adapter
 * makes, and the same one #47 makes when it cannot classify an instruction.
 *
 * ## The project is stated twice, deliberately
 *
 * Once as `project_id` on the row (0335) and once in `context` (#27). They are
 * read by different steps of `enqueue_inbound`'s resolution and the context is
 * the more specific of the two, so a caller naming a project gets it whichever
 * step is consulted. This is not the denormalisation trap: neither is a copy of
 * the other for a reader's convenience, they are two inputs to one decision,
 * and 0336 makes the function write its answer back to the row so they agree
 * afterwards.
 */

create or replace function app.say_in_project(
  p_project_id   uuid,
  p_text         text,
  p_addressed_to text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_said     text := nullif(btrim(coalesce(p_text, '')), '');
  v_to       text := nullif(btrim(coalesce(p_addressed_to, '')), '');
  v_dropped  text := null;
  v_key      text;
  v_command  uuid;
  v_queued   jsonb;
begin
  if p_project_id is null
     or not exists (select 1 from public.projects where project_id = p_project_id) then
    return jsonb_build_object('ok', false, 'error', 'no such project');
  end if;

  -- `inbound_commands_says_something` would refuse this anyway; saying so here
  -- means the studio gets a sentence rather than a constraint name (§25).
  if v_said is null then
    return jsonb_build_object('ok', false, 'error', 'there is nothing to say');
  end if;

  /*
    An addressee nobody on the roster answers to is dropped rather than fatal.
    Checked against ACTIVE staff: a retired person is not a valid addressee,
    and the roster is the thing that decides who exists (#65).
  */
  if v_to is not null
     and not exists (select 1 from public.staff where slug = v_to and active) then
    v_dropped := v_to;
    v_to := null;
  end if;

  /*
    Shaped as `<surface>:<kind>:<id>` by `inbound_dedupe_key_shaped`. The id is
    a fresh uuid rather than a hash of the text: two identical messages sent a
    minute apart are two messages, and a person repeating themselves because
    the first one seemed to go nowhere is the case that must not be swallowed.
  */
  v_key := 'teamhq:message:' || replace(gen_random_uuid()::text, '-', '');

  insert into public.inbound_commands
    (origin_channel, origin_ref, actor, instruction, addressed_to,
     dedupe_key, project_id, context)
  values ('teamhq', v_key, 'grant', v_said, v_to, v_key, p_project_id,
          jsonb_build_object('project_id', p_project_id))
  returning command_id into v_command;

  v_queued := app.enqueue_inbound(v_command);

  return jsonb_build_object(
    'ok', true,
    'command', v_command,
    'job', v_queued->>'job_id',
    'project', p_project_id,
    'addressed_to', v_to,
    -- Named rather than silent. A composer that quietly ignores who you picked
    -- is worse than one that says it could not find them.
    'addressee_dropped', v_dropped);
end;
$$;

comment on function app.say_in_project is
  'Say something in a project''s conversation from the studio (#26, #193). '
  'Free text, unlike send_to_agent which needs an asset. An addressee naming '
  'nobody active is dropped and reported rather than losing the message, which '
  'is what the foreign key on addressed_to would otherwise do.';

create or replace function public.say_in_project(
  p_project_id uuid, p_text text, p_addressed_to text default null)
returns jsonb language sql security definer set search_path = public, pg_catalog
as $$ select app.say_in_project(p_project_id, p_text, p_addressed_to) $$;

grant execute on function app.say_in_project(uuid, text, text) to ai_team_app;
grant execute on function public.say_in_project(uuid, text, text) to ai_team_app;

commit;
