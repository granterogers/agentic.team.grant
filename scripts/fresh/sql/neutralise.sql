-- ---------------------------------------------------------------------------
-- NEUTRALISE — run against the scaffold database immediately before the seed
-- is captured, so no value belonging to one INSTALL reaches the baseline.
-- ---------------------------------------------------------------------------
--
-- `public.system_config` is a product table. Most of its 61 rows are policy the
-- office needs to be itself — lease seconds, breaker thresholds, sync
-- intervals — and a handful are not policy at all. They are answers to "which
-- Supabase project", "which Slack user", "where are the avatars", "where does
-- Google send him back": facts about Grant's installation that happen to live
-- in the same table.
--
-- Blanked to the empty string rather than deleted, deliberately. A missing key
-- looks like a key nobody thought of, and the setup would have to carry its own
-- list of what to ask for — a second place for the truth to rot. An empty key
-- is the question already written down, and `npm run fresh:doctor` reads these
-- to tell a new user what is still missing and how to supply it.
--
-- `''::jsonb` is not valid, so the empty value is a JSON empty string.
-- ---------------------------------------------------------------------------
update public.system_config
   set value = '""'::jsonb,
       description = description || ' [blank on a fresh install — supply your own]'
 where key in (
   'db.project_ref',            -- which Supabase project the tooling talks to
   'staff.avatar_base_url',     -- public storage base for staff avatars
   'google.redirect_uri',       -- must match the Cloud console verbatim
   'slack.subject_user_id'      -- the human to invite into provisioned channels
 )
   and value <> '""'::jsonb;

-- The scaffolding this build invented, which must never be mistaken for
-- product seed. Anything the baseline needs has already been captured by the
-- time this runs.
delete from public.system_config where key like 'fresh-install-scaffold%';

-- ---------------------------------------------------------------------------
-- The staff roster's Telegram usernames
--
-- `public.staff` is product seed — eight people, their titles, expertise and
-- communication styles, none of it about any particular installation. One
-- column is the exception: `telegram_username` holds the bot each person
-- speaks through, and those are Grant's bots. `atg_finance_bot` is a name
-- BotFather gave to one account and will never give to another, so a fresh
-- install that inherited it would name a bot that cannot exist for them.
--
-- Nulled rather than invented. There is no plausible username to guess, and
-- the column is nullable precisely because a staff member may not have a bot
-- yet — which is exactly true of everybody on a fresh install.
-- ---------------------------------------------------------------------------
update public.staff set telegram_username = null where telegram_username is not null;
