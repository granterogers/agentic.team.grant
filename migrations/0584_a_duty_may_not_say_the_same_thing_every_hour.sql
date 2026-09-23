-- A duty may not tell him the same thing every hour (#355).
--
-- Grant's Google refresh token was revoked on 15 September. Every hour after
-- that, google.read_mail and google.read_calendar each failed to read and each
-- TOLD HIM SO -- byte for byte the same sentence:
--
--   "I could not read the mail: Google refused the stored refresh token
--    (invalid_grant) ... Press Connect Google again, and publish the app to
--    stop it recurring."
--
-- 194 identical messages in four days: 65 to Telegram and 65 to Slack for the
-- mail, 64 to Slack for the calendar. One distinct body across all 194.
-- office.notion_sync has the same shape and hides it better -- 137 sends, 128
-- DISTINCT bodies, because a model rewords "nothing changed and these four
-- empty pages are still empty" every two hours, so it reads as news each time
-- and no text-based witness can see the repetition.
--
-- NOTHING COULD CATCH IT. check:chatter's ceiling is a hundred a day per kind
-- and this peaked at about 36. app.recurring_failures and app.notice's
-- failure_repeats branch both read FAILED jobs -- and these jobs COMPLETED
-- SUCCESSFULLY while reporting a failure, which makes them invisible to every
-- failure mechanism the office has. A duty that succeeds at saying it failed is
-- a gap between two correct halves.
--
-- The condition recurs by construction: the message itself says the OAuth app
-- is in testing mode, where refresh tokens expire after seven days.
--
-- WHAT THIS CHANGES. A duty speaks when what it has to say CHANGES, and at most
-- once a day when it does not. Not "never repeat": he should still be told
-- daily that his mail has been unreadable for a week. Once an hour is not
-- telling him, it is teaching him to swipe the notification away -- which is
-- the cost CLAUDE.md already records about a health reading that cries wolf.
--
-- SCOPED TO DUTIES, and derived rather than listed: a kind named by
-- public.responsibilities is scheduled by the office, so a repeat is the clock
-- talking. office.instruction is NOT in that table, so if Grant asks the same
-- question twice he gets two answers -- which he should, and which a blanket
-- rule would have taken away.

create table if not exists public.duty_said (
  job_kind      text primary key,
  fingerprint   text not null,
  said_at       timestamptz not null default app.now_utc(),
  repeats       integer not null default 0,
  last_seen_at  timestamptz not null default app.now_utc()
);

comment on table public.duty_said is
  'The last thing each scheduled duty actually said, so it can say it again '
  'when it CHANGES rather than every time it runs (#355). repeats counts the '
  'runs that were kept quiet, which is the number worth looking at: a large '
  'one means a condition nobody has fixed.';

create or replace function app.say_once(p_job_id uuid, p_body text)
returns boolean
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_kind text;
  v_is_duty boolean;
  v_print text;
  v_prev text;
  v_said timestamptz;
begin
  select kind into v_kind from public.jobs where job_id = p_job_id;
  if v_kind is null then
    return true;
  end if;

  -- Only the clock repeats itself. A person asking twice deserves two answers.
  select exists (select 1 from public.responsibilities r where r.job_kind = v_kind)
    into v_is_duty;
  if not v_is_duty then
    return true;
  end if;

  v_print := md5(coalesce(p_body, ''));

  select fingerprint, said_at into v_prev, v_said
    from public.duty_said where job_kind = v_kind;

  -- Changed, or never said, or a day has passed: say it and remember it.
  if v_prev is distinct from v_print
     or v_said < app.now_utc() - interval '20 hours' then
    insert into public.duty_said (job_kind, fingerprint, said_at, repeats, last_seen_at)
    values (v_kind, v_print, app.now_utc(), 0, app.now_utc())
    on conflict (job_kind) do update
      set fingerprint = excluded.fingerprint,
          said_at = excluded.said_at,
          repeats = 0,
          last_seen_at = excluded.last_seen_at;
    return true;
  end if;

  update public.duty_said
     set repeats = repeats + 1,
         last_seen_at = app.now_utc()
   where job_kind = v_kind;
  return false;
end
$function$;

comment on function app.say_once(uuid, text) is
  'Whether a job should announce. True when the body CHANGED, when nothing was '
  'said before, or when a day has passed; false when a scheduled duty is about '
  'to repeat itself inside 20 hours. Always true for a kind no responsibility '
  'schedules, so conversation is untouched (#355).';

-- Drive it, in both directions, inside a subtransaction so the fixtures go.
do $$
declare
  v_duty uuid;
  v_chat uuid;
  v_first boolean;
  v_again boolean;
  v_changed boolean;
  v_conv1 boolean;
  v_conv2 boolean;
begin
  begin
    select job_id into v_duty from public.jobs
     where kind = 'google.read_mail' order by created_at desc limit 1;
    select job_id into v_chat from public.jobs
     where kind = 'office.instruction' order by created_at desc limit 1;

    if v_duty is null or v_chat is null then
      raise exception 'no subject to drive with';
    end if;

    delete from public.duty_said where job_kind = 'google.read_mail';

    v_first   := app.say_once(v_duty, 'I could not read the mail.');
    v_again   := app.say_once(v_duty, 'I could not read the mail.');
    v_changed := app.say_once(v_duty, 'I read 4 new messages.');

    -- THE CONTROL. Conversation must be untouched: the same answer twice is
    -- two legitimate answers, and a rule that silenced the second would be
    -- worse than the defect it fixes.
    v_conv1 := app.say_once(v_chat, 'The margin is 35 percent.');
    v_conv2 := app.say_once(v_chat, 'The margin is 35 percent.');

    if not v_first then raise exception 'the first time was not said'; end if;
    if v_again then raise exception 'the duty repeated itself within the hour'; end if;
    if not v_changed then raise exception 'a CHANGED body was silenced'; end if;
    if not v_conv1 or not v_conv2 then
      raise exception 'conversation was silenced, which this must never do';
    end if;

    raise exception 'ROLLBACK_FIXTURES';
  exception
    when others then
      if sqlerrm <> 'ROLLBACK_FIXTURES' then
        raise;
      end if;
  end;
end $$;
