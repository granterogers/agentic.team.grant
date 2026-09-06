-- 0070 — a channel per project per discipline
--
-- Grant: *"suppose I'm asking my team to do five different projects — for each
-- project there should be like a subdirectory or subchannels that contain the
-- various aspects of the project, each one corresponding to the agent, whether
-- it's marketing, whether it's legal, whatever."*
--
-- ## Slack has no subchannels, and this is the honest substitute
--
-- Checked rather than assumed: Slack's channel list is flat. The sidebar
-- "sections" people mean by subchannels are a per-user client feature on paid
-- plans, with no API — a bot cannot create one, and one Grant made by hand
-- would be his alone. So the grouping has to come from the name, which is
-- exactly the fallback he named.
--
-- The convention is **project first**:
--
--     money-mastery              ← the lobby: cross-discipline, sorts first
--     money-mastery-research
--     money-mastery-finance
--     money-mastery-quality
--     website-rebuild
--     website-rebuild-growth
--
-- Alphabetical sorting then does the grouping for free, in every client, with
-- no configuration. Discipline-first (`research-money-mastery`) would group by
-- agent instead, which is the wrong axis: Grant thinks in projects and the team
-- is the same eight people on all of them.
--
-- ## Lazily, not forty channels on day one
--
-- Eight disciplines across five projects is forty channels, most of which would
-- never see a message. A discipline channel is created the first time that
-- staff member actually has something to say about that project. A project's
-- lobby is created with the project.
--
-- The cost is that the sidebar grows over time rather than arriving complete.
-- The alternative is a sidebar that is mostly empty on day one, which is worse:
-- an empty channel teaches you to ignore the section.

begin;

alter table public.slack_channel_map
  -- Which staff member's channel this is. Null for a lobby, which belongs to
  -- the project rather than to a person.
  add column discipline text references public.staff (slug);

create unique index slack_channel_map_one_per_discipline
  on public.slack_channel_map (project_id, discipline)
  where active and purpose = 'project' and discipline is not null;

-- A project has one lobby, not several.
create unique index slack_channel_map_one_lobby
  on public.slack_channel_map (project_id)
  where active and purpose = 'project' and discipline is null;

comment on column public.slack_channel_map.discipline is
  'The staff member whose work goes here, or null for the project lobby. '
  'Slack has no subchannels - the sidebar sections people mean by that are a '
  'per-user client feature with no API - so grouping comes from the name, and '
  'this column is what the name is built from.';

-- --------------------------------------------------------------------------
-- The name a project's channels are built from
-- --------------------------------------------------------------------------
--
-- Separate from `projects.name` on purpose. Grant asked for the project name to
-- be *"definable within the front end"* while defaulting from wherever it was
-- imported — and a display name and a channel prefix want different things: a
-- name can be "Money Mastery (Q3 relaunch)" and a channel prefix cannot.
--
-- Held here so renaming a project in the front end can rename its channels
-- without the two definitions of "the name" drifting apart.

alter table public.projects
  add column channel_prefix text;

comment on column public.projects.channel_prefix is
  'The Slack-legal stem every one of this project''s channels is built from. '
  'Derived from the name when a project is created and editable afterwards, '
  'because a display name may contain what a channel name may not.';

-- Backfill from the existing name, using the same rules the code applies:
-- lowercase, non-alphanumerics to hyphens, collapsed, trimmed, and short
-- enough to leave room for the longest discipline suffix.
update public.projects
   set channel_prefix = left(
         trim(both '-' from regexp_replace(lower(coalesce(name, slug)), '[^a-z0-9]+', '-', 'g')),
         48
       )
 where channel_prefix is null;

update public.projects set channel_prefix = left(slug, 48)
 where coalesce(channel_prefix, '') = '';

-- --------------------------------------------------------------------------
-- Where a staff member's work for a project should go
-- --------------------------------------------------------------------------

create or replace function app.channel_for(p_project uuid, p_staff_slug text default null)
returns table (channel_id text, channel_name text, exists_already boolean)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select m.channel_id, m.channel_name, true
    from public.slack_channel_map m
   where m.project_id = p_project
     and m.active
     and m.purpose = 'project'
     and m.discipline is not distinct from p_staff_slug
   limit 1
$$;

comment on function app.channel_for is
  'The channel a staff member''s work for a project belongs in, or no row when '
  'it has not been created yet. No row is a normal answer: channels are made '
  'the first time someone has something to say, not forty at a time.';

revoke all on function app.channel_for(uuid, text) from public;
grant execute on function app.channel_for(uuid, text) to ai_team_app;

commit;
