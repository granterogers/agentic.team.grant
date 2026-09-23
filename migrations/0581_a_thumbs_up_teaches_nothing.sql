-- The same false claim, in the other card, phrased so the first search missed it.
--
-- 0580 fixed the Slack sentence by searching app.hq_studio_settings for the word
-- "feedback". The Telegram card makes the same promise in different words --
-- "A thumbs up or down on any reply teaches the office something" -- so it
-- survived, and it was found only by reading the function's live output rather
-- than trusting the grep. That is CLAUDE.md's own rule about grepping for the
-- call rather than the noun, paid for one migration later in the same hour.
--
-- On Telegram the claim is half true, which is why it needs different wording
-- from 0580 rather than the same wording. A thumbs DOWN does teach: it replies
-- asking what he would have preferred and takes the answer as an instruction.
-- A thumbs UP writes public.feedback, which nothing reads, and moves
-- notification_events past delivered, whose only reader has no caller.
--
-- So the card now says which of the two does something, because the useful fact
-- for him is that the down arrow is the one worth pressing.

do $$
declare
  v_def  text;
  v_next text;
  v_old  constant text :=
    'A thumbs up or down on any reply teaches the office something.';
  v_new  constant text :=
    'A thumbs down on any reply asks what you would have preferred and takes '
    || 'your answer as an instruction. A thumbs up is recorded only.';
begin
  select pg_get_functiondef('app.hq_studio_settings'::regproc) into v_def;

  if position(v_old in v_def) = 0 then
    raise exception 'the telegram sentence this migration replaces is not there';
  end if;

  v_next := replace(v_def, v_old, v_new);

  if v_next = v_def then
    raise exception 'the replacement changed nothing';
  end if;

  execute v_next;
end $$;

-- Drive it, and assert the property rather than one sentence: no card may claim
-- a thumbs UP does anything, because nothing reads it on either surface.
do $$
declare
  v_txt text;
begin
  select app.hq_studio_settings()::text into v_txt;

  if position('teaches the office something' in v_txt) > 0 then
    raise exception 'the telegram claim survived';
  end if;

  if position('asks what you would have preferred' in v_txt) = 0 then
    raise exception 'the honest telegram sentence is not being served';
  end if;

  -- 0580 must still hold.
  if position('is read as feedback' in v_txt) > 0 then
    raise exception 'the slack claim came back';
  end if;
end $$;
