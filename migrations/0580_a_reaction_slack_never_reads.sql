-- A reaction Slack records and nothing reads.
--
-- Every Telegram message carries a thumbs up and a thumbs down by default
-- (src/telegram/transport.ts), and Slack maps :+1: and :-1: to the same two
-- actions (src/slack/events.ts). A press writes public.feedback and moves
-- public.notification_events past delivered.
--
-- Neither is read. public.feedback has no reader at all: no TypeScript outside
-- the insert, no SQL function, no view, no operator command. notification_events
-- has exactly one reader, app.notification_patterns, and that function has no
-- caller -- it is recorded in the check:callers baseline, whose stated reason
-- (that npm run levels and the learning page answer the question) is false:
-- neither names it.
--
-- One half of it does work, and only one. A thumbs DOWN on TELEGRAM replies
-- asking what he would have preferred and takes the answer as an instruction.
-- askForTheCorrection returns early unless origin_channel is telegram, so on
-- Slack both signals do nothing whatever.
--
-- And app.hq_studio_settings tells him, on the Connections card for Slack:
-- "Reacting with a thumbs up or down is read as feedback." On the one surface
-- that sentence describes, it is entirely untrue.
--
-- This migration fixes the CLAIM, which is the half that is unambiguous. It does
-- not build a consumer: public.feedback holds seven rows, every one positive,
-- none since 6 September, and a mechanism built over a table with no signal in
-- it is the public.contacts trap CLAUDE.md already records. The loop is filed
-- instead, so the decision about what a reaction should DO is made once and
-- deliberately rather than guessed at here.
--
-- The replacement says what is true and what he can do instead, because a
-- settings card that merely withdraws a promise leaves him with less than he
-- had. Replying in the channel IS read: a Slack message becomes an
-- inbound_command and reaches the instruction handler like any other.

do $$
declare
  v_def  text;
  v_next text;
  v_old  constant text :=
    'Reacting with a thumbs up or down is read as feedback.';
  v_new  constant text :=
    'A thumbs up or down here is recorded but not yet acted on. To correct '
    || 'an answer, reply in the channel and it is taken as an instruction.';
begin
  select pg_get_functiondef('app.hq_studio_settings'::regproc) into v_def;

  if position(v_old in v_def) = 0 then
    raise exception
      'the sentence this migration replaces is not in app.hq_studio_settings';
  end if;

  v_next := replace(v_def, v_old, v_new);

  if v_next = v_def then
    raise exception 'the replacement changed nothing';
  end if;

  execute v_next;
end $$;

-- Drive it. A migration that applies cleanly is not a function that works.
do $$
declare
  v_txt text;
begin
  select app.hq_studio_settings()::text into v_txt;

  if position('is read as feedback' in v_txt) > 0 then
    raise exception 'the false claim survived';
  end if;

  if position('not yet acted on' in v_txt) = 0 then
    raise exception 'the honest sentence is not being served';
  end if;
end $$;
