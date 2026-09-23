-- Dedupe on what the message is ABOUT, not on what it says (#360).
--
-- 0584 stopped a duty repeating itself by fingerprinting the body. That works
-- for a body composed in code and is defeated entirely by one composed by a
-- model, which CLAUDE.md's own lesson from that pass says in as many words and
-- which nothing then did anything about:
--
--   "A model rewording an unchanged fact defeats every text-based witness."
--
-- office.slack_rotate is the live proof. Slack token rotation has been failing
-- since 18 September -- five of five runs on the 23rd -- and the branch that
-- reports it calls sayAs, so Grant gets five or six differently-worded
-- sentences a day all saying the same thing: rotation failed, no action needed.
-- 46 deliveries, 30 distinct bodies. 0584 sees 30 changes and speaks 30 times.
--
-- So a handler may now name the TOPIC: a short stable key for what the message
-- is about, independent of how it happens to be phrased this time. When it is
-- given, that is what is fingerprinted; when it is not, the body still is, so
-- every existing caller keeps exactly the behaviour 0584 gave it.
--
-- BOTH FORMS ARE KEPT, and the three-argument one takes NO DEFAULT.
--
-- A default there would make app.say_once(uuid, text) callable on both, and
-- Postgres refuses an ambiguous call -- the overload trap CLAUDE.md records
-- about create-or-replace with a changed argument list. Without the default,
-- each arity resolves to exactly one function.
--
-- Keeping the two-argument form is what makes this safe to apply in either
-- order relative to a deploy: the worker running right now calls it with two
-- arguments and is unaffected, and a worker deployed later can pass a topic.
-- A migration is not a deploy, and this repository has already paid for
-- assuming the two land together.

create or replace function app.say_once(
  p_job_id uuid,
  p_body   text,
  p_topic  text
)
returns boolean
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_kind text;
  v_project uuid;
  v_is_duty boolean;
  v_print text;
  v_prev text;
  v_said timestamptz;
begin
  select kind, coalesce(project_id, app.unnamed_project())
    into v_kind, v_project
    from public.jobs where job_id = p_job_id;

  if v_kind is null then
    return true;
  end if;

  -- Only the clock repeats itself. A person asking twice deserves two answers.
  select exists (select 1 from public.responsibilities r where r.job_kind = v_kind)
    into v_is_duty;
  if not v_is_duty then
    return true;
  end if;

  -- The topic when the handler named one, the body when it did not. Prefixed
  -- so a topic can never collide with the md5 of some body.
  v_print := case
               when coalesce(trim(p_topic), '') <> ''
                 then 'topic:' || trim(p_topic)
               else 'body:' || md5(coalesce(p_body, ''))
             end;

  select fingerprint, said_at into v_prev, v_said
    from public.duty_said
   where job_kind = v_kind and project_id = v_project;

  if v_prev is distinct from v_print
     or v_said < app.now_utc() - interval '20 hours' then
    insert into public.duty_said
      (job_kind, project_id, fingerprint, said_at, repeats, last_seen_at)
    values (v_kind, v_project, v_print, app.now_utc(), 0, app.now_utc())
    on conflict (job_kind, project_id) do update
      set fingerprint = excluded.fingerprint,
          said_at = excluded.said_at,
          repeats = 0,
          last_seen_at = excluded.last_seen_at;
    return true;
  end if;

  update public.duty_said
     set repeats = repeats + 1,
         last_seen_at = app.now_utc()
   where job_kind = v_kind and project_id = v_project;
  return false;
end
$function$;

-- The old arity, kept as one line over the new one so there is a single
-- implementation. 0584's callers keep 0584's behaviour exactly.
create or replace function app.say_once(p_job_id uuid, p_body text)
returns boolean
language sql
security definer
set search_path to ''
as $wrap$
  select app.say_once(p_job_id, p_body, null::text)
$wrap$;

comment on function app.say_once(uuid, text, text) is
  'Whether a job should announce. True when what it is ABOUT changed, when '
  'nothing was said before, or when a day has passed. p_topic is a stable key '
  'a handler gives when a model writes the words, so a rewording of one '
  'unchanged fact is not mistaken for news (#360). Always true for a kind no '
  'responsibility schedules, so conversation is untouched.';

-- Drive it. The new case is the one worth proving: two DIFFERENT bodies under
-- one topic must speak once, which is exactly what 0584 could not do.
do $$
declare
  v_duty uuid;
  v_chat uuid;
  v_a boolean; v_b boolean; v_c boolean;
  v_body1 boolean; v_body2 boolean;
  v_conv boolean;
begin
  begin
    select job_id into v_duty from public.jobs
     where kind = 'office.slack_rotate' order by created_at desc limit 1;
    select job_id into v_chat from public.jobs
     where kind = 'office.instruction' order by created_at desc limit 1;
    if v_duty is null or v_chat is null then
      raise exception 'no subject to drive with';
    end if;

    delete from public.duty_said where job_kind = 'office.slack_rotate';

    -- Reworded every time, one topic. Speaks once.
    v_a := app.say_once(v_duty, 'Slack token rotation failed (internal_error).',
                        'slack.rotation_failed');
    v_b := app.say_once(v_duty, 'Rotation of the Slack token did not succeed this time.',
                        'slack.rotation_failed');
    v_c := app.say_once(v_duty, 'The Slack credential could not be rotated just now.',
                        'slack.rotation_failed');

    if not v_a then raise exception 'the first report was silenced'; end if;
    if v_b or v_c then
      raise exception 'a reworded repeat still spoke, which is the whole defect';
    end if;

    -- A DIFFERENT topic is news and must speak.
    if not app.say_once(v_duty, 'Rotated cleanly.', 'slack.rotated') then
      raise exception 'a genuinely different topic was silenced';
    end if;

    -- WITHOUT a topic, 0584's behaviour is unchanged: body decides. Driven
    -- through the TWO-ARGUMENT form on purpose, because that is what the
    -- worker running right now calls, and a migration is not a deploy.
    delete from public.duty_said where job_kind = 'office.slack_rotate';
    v_body1 := app.say_once(v_duty, 'Same words.');
    v_body2 := app.say_once(v_duty, 'Same words.');
    if not v_body1 or v_body2 then
      raise exception 'the body fallback stopped behaving as 0584 left it';
    end if;

    -- THE CONTROL that matters most: conversation is untouched, topic or not.
    v_conv := app.say_once(v_chat, 'The margin is 35 percent.', 'margin');
    if not v_conv or not app.say_once(v_chat, 'The margin is 35 percent.', 'margin') then
      raise exception 'conversation was silenced, which this must never do';
    end if;

    raise exception 'ROLLBACK_FIXTURES';
  exception when others then
    if sqlerrm <> 'ROLLBACK_FIXTURES' then raise; end if;
  end;
end $$;
