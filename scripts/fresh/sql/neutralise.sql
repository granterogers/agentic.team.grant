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

-- ---------------------------------------------------------------------------
-- The scaffold projects, and the one project that is NOT scaffolding
--
-- `public.projects` looked like personal data and is not entirely. One row in
-- it is the product: `unnamed`, the project every message lands in before
-- anybody has said which project it is about. `inbound_commands.project_id` is
-- NOT NULL and defaults to `app.unnamed_project()`, so without that row a
-- brand-new office cannot accept a single message — the first instruction a new
-- person sends is refused with
-- `23502: null value in column "project_id"`, which names a column and not a
-- cause.
--
-- Found by running `npm run fresh:first-use` against an install built from an
-- earlier baseline that excluded the whole table. It is the clearest argument
-- for §22's rule that a deployment is not proven until a real instruction has
-- gone through: every other check was green over an office that could not be
-- spoken to.
--
-- So the scaffolding goes and `unnamed` stays, with the alias and attachment
-- that make it resolvable and activatable.
--
-- ADR-0014's order is ARCHIVE, then attachments, then the project, and the
-- order is not advice: the trigger fires on the attachment delete and refuses
-- to leave an ACTIVE project reading from nowhere. Deleting the attachment
-- first is refused with *"project ... is active with no enabled attachment"*,
-- which is the rule working. CLAUDE.md states the order and the first draft of
-- this did it anyway.
-- ---------------------------------------------------------------------------
delete from public.documents
 where project_id in (select project_id from public.projects
                       where slug in ('baseline-scaffold-do-not-use', 'legacy-coaching-course'));

delete from public.artifacts
 where project_id in (select project_id from public.projects
                       where slug in ('baseline-scaffold-do-not-use', 'legacy-coaching-course'));

update public.projects set status = 'archived'
 where slug in ('baseline-scaffold-do-not-use', 'legacy-coaching-course');

delete from public.project_aliases
 where project_id in (select project_id from public.projects
                       where slug in ('baseline-scaffold-do-not-use', 'legacy-coaching-course'));

delete from public.project_attachments
 where project_id in (select project_id from public.projects
                       where slug in ('baseline-scaffold-do-not-use', 'legacy-coaching-course'));

-- ---------------------------------------------------------------------------
-- AND THE REFERENCES THE SCAFFOLD JOBS AND ENTRIES HOLD.
--
-- 32 foreign keys point at `public.projects` and only nine cascade, so a
-- project that anything still references cannot be deleted -- the same refusal
-- `app.project_delete` turns into a sentence. The replay's own preconditions
-- now attach work to the two scaffold projects: a `drive.watch` job on each
-- (0585 needs two projects saying the same thing) and a `notebook.generate`
-- job (0591).
--
-- They are POINTED AWAY rather than deleted, and the distinction matters.
-- `jobs` is not in the baseline's seed allow-list, so none of them reaches a
-- fresh install whatever is done here -- and a job cannot be deleted at all:
-- `job_state_transitions` holds it, which is the rule that protects Grant's
-- history and applies to a replay's history too. Nulling the column is the
-- smallest change that lets ADR-0014's order finish.
--
-- `public.events` is not in this list because nothing can move it: the ledger
-- is append-only and refuses UPDATE as well as DELETE. The precondition before
-- 0586 records its one activity entry against NO project instead, which is
-- what 0586's own reader already allows.
-- ---------------------------------------------------------------------------
update public.jobs set project_id = null
 where project_id in (select project_id from public.projects
                       where slug in ('baseline-scaffold-do-not-use', 'legacy-coaching-course'));

delete from public.projects
 where slug in ('baseline-scaffold-do-not-use', 'legacy-coaching-course');

-- And prove the one that must survive did. A neutralise that removed the inbox
-- would be indistinguishable from one that worked, until somebody said hello.
do $$
begin
  if not exists (select 1 from public.projects where slug = 'unnamed') then
    raise exception 'neutralise removed the unnamed project — a fresh office could not accept a message';
  end if;
  if exists (select 1 from public.projects where slug <> 'unnamed') then
    raise exception 'neutralise left a project behind: %',
      (select string_agg(slug, ', ') from public.projects where slug <> 'unnamed');
  end if;
end $$;
