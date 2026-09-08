-- The Slack tokens stop living on luck.
--
-- Slack's app-configuration tokens expire twelve hours after they are issued,
-- and the refresh token is single-use. A GitHub Actions cron renewed them
-- until 2026-09-08, when Actions were switched off at Grant's instruction and
-- nothing replaced it.
--
-- Since then they have been renewed by whichever verification run happened to
-- rotate one — `verify:slack` does it as a side effect. That is not a
-- schedule, it is a coincidence, and twelve hours without one puts Grant back
-- at https://api.slack.com/apps regenerating the pair by hand.
--
-- ## The duty was describing the wrong job
--
-- 0133 seeded `slack-rotation` as *"rotate the Slack channel set so old
-- project rooms are archived"*. Its job kind is `office.slack_rotate`, and the
-- module behind that name is `src/slack/rotation.ts`, which rotates TOKENS and
-- has never touched a channel.
--
-- The description is corrected rather than the kind, because tokens are what
-- actually needs a schedule and channel archiving is what actually must not
-- have one: renewing a credential is maintenance, and archiving somebody's
-- rooms while they sleep is destructive. Channel tidying stays where it is,
-- behind `npm run slack:tidy -- --go`, where a human types the `--go`.
--
-- ## Four hours, into a twelve-hour window
--
-- Three chances to notice a failure before the token dies. The handler also
-- asks `shouldRotate` first and does nothing while there is time left, because
-- the refresh token is single-use and a rotation nobody needed still burns
-- one.

begin;

update public.responsibilities
   set enabled = true,
       description =
         'Renew the Slack app configuration tokens before they expire. They '
         'last twelve hours and the refresh token is single-use, so missing '
         'the window means a human regenerating the pair by hand. Channel '
         'archiving is NOT this duty — that is npm run slack:tidy -- --go.'
 where slug = 'slack-rotation';

do $$
declare v_enabled boolean;
begin
  select enabled into v_enabled from public.responsibilities where slug = 'slack-rotation';
  if v_enabled is not true then
    raise exception 'slack-rotation was not enabled';
  end if;
end
$$;

commit;
