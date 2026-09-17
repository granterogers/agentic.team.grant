-- 0300 — what a connector can do, and what we actually use
--
-- Issue #51. Grant, naming it:
--
--   > *"to also be aware of the components you're dealing with. So what else
--   > they can do with the Google notebook, what they can create, what they can
--   > recover from it, you know, maybe marketing guys need access to particular
--   > tools like social media."*
--
-- `knowledge_connectors.notes` is prose written for a person reading the table.
-- An agent cannot ask prose *"can I recover an audio overview from a notebook"*,
-- and the gap between what a connector CAN do and what the office DOES with it
-- has never been askable at all — which is why the office uses each connector
-- at a fraction of its surface and no agent has ever suggested more.
--
--   > *The gap between "what this can do" and "what we use it for" is then a
--   > query, and that query is where proactive suggestions come from (#52).*
--
-- So: one row per verb, with how it is reached, what it costs, and what in the
-- office uses it. The unused half falls out as a `where used_by = ''`.
--
-- ## `reach` is the column #51 asks for by name
--
--   > *The sheet distinguishes what is reachable programmatically from what is
--   > not.*
--
--   * `api`          — an official, documented interface.
--   * `unofficial`   — reachable, by impersonating a browser session. Works,
--                      and is the behaviour the 2026-09-04 ban named.
--   * `browser_only` — a person has to click it. Real, and not ours.
--   * `none`         — the connector does not do this at all. A NEGATIVE, and
--                      #51 asks for those explicitly: *"The answer may well be
--                      'less than hoped' — that is a finding, and it belongs in
--                      the sheet."*
--
-- ## Exercised, not read
--
--   > *Exercise, do not read. The CORS failure is the standing lesson.*
--
-- `verified_by` records HOW each row is known, and the seed below only claims
-- `probe` or `suite` where something actually ran. Everything else says
-- `declared`, which is the weakest claim and is marked as such — 0298's lesson
-- one table over: a row can assert anything, so the row has to say what backs
-- it.

begin;

create table if not exists public.connector_capabilities (
  connector   text not null references public.knowledge_connectors (connector) on delete cascade,
  verb        text not null,
  returns     text not null default '',
  reach       text not null,
  cost_note   text not null default '',
  -- What in the office uses this. Empty means nothing does — which is the
  -- whole point of the table.
  used_by     text not null default '',
  verified_by text not null default 'declared',
  last_verified timestamptz,
  primary key (connector, verb),

  constraint connector_capability_reach_known
    check (reach in ('api', 'unofficial', 'browser_only', 'none')),
  constraint connector_capability_evidence_known
    check (verified_by in ('probe', 'suite', 'declared')),
  -- A row claiming it was probed or exercised has to say when. `declared` is
  -- allowed to have no date precisely because nothing happened.
  constraint connector_capability_dated_iff_verified
    check ((verified_by = 'declared') or (last_verified is not null))
);

alter table public.connector_capabilities enable row level security;

comment on table public.connector_capabilities is
  '#51. One row per thing a connector can be asked for. `reach` says whether '
  'the office can get at it programmatically; `used_by` says whether it '
  'bothers. The gap between the two is app.unused_capabilities(), which is '
  'where a proactive suggestion comes from (#52) rather than from an opinion.';

-- ---------------------------------------------------------------------------
-- The seed, and only what is actually known
-- ---------------------------------------------------------------------------

insert into public.connector_capabilities
  (connector, verb, returns, reach, cost_note, used_by, verified_by, last_verified)
values
  -- NotebookLM. Every row below is backed by `notebook_capability`, which was
  -- re-probed today: the first three were CALLED, the rest were found on the
  -- adapter without being called (0298's `offers_` distinction).
  ('notebooklm', 'list the notebooks', 'every notebook on the account',
   'unofficial', 'no quota cost', 'job kind notebook.collect', 'probe', app.now_utc()),
  ('notebooklm', 'read the account limits', 'tier, notebook and source ceilings',
   'unofficial', 'no quota cost', 'app.notebook_allowance', 'probe', app.now_utc()),
  ('notebooklm', 'list a notebook''s sources', 'each source and its text',
   'unofficial', 'no quota cost', 'job kind notebook.collect', 'probe', app.now_utc()),
  ('notebooklm', 'create a notebook', 'a new notebook',
   'unofficial', 'counts against the notebook ceiling',
   'job kind office.notion_import and the plan step create_project', 'probe', app.now_utc()),
  ('notebooklm', 'add a source by URL or text', 'the source, indexed',
   'unofficial', 'counts against the source ceiling',
   'job kind notebook.add_source', 'probe', app.now_utc()),
  ('notebooklm', 'ask the notebook a question', 'an answer grounded in the sources',
   'unofficial', 'counts against the five-hour allowance',
   'job kind notebook.ask', 'probe', app.now_utc()),
  ('notebooklm', 'generate an artifact', 'audio overview, mind map, slide deck, report',
   'unofficial', 'counts against the five-hour allowance; needs Grant''s approval first',
   'job kind notebook.generate', 'probe', app.now_utc()),
  ('notebooklm', 'download a generated artifact', 'the file itself',
   'unofficial', 'no quota cost', 'job kind notebook.collect_artifact', 'probe', app.now_utc()),
  ('notebooklm', 'create a note in a notebook', 'a note',
   'unofficial', 'no quota cost', '', 'probe', app.now_utc()),
  /*
    The negatives, which #51 asks for by name. Recorded so an agent asked
    "can you share the notebook with my client" answers from a row rather than
    from what it imagines a Google product does.
  */
  ('notebooklm', 'share a notebook with someone', 'nothing — a person must do this',
   'browser_only', '', '', 'declared', null),
  ('notebooklm', 'read another account''s notebook', 'nothing',
   'none', '', '', 'declared', null),

  -- Notion. Official API, and the specifics that have already cost time are in
  -- CLAUDE.md rather than repeated here.
  ('notion', 'read the pages and databases shared with the integration',
   'each page''s blocks as text', 'api', 'free tier', 'duty:notion-sync',
   'suite', app.now_utc()),
  ('notion', 'create a page in a data source', 'the page',
   'api', 'free tier', 'job kind office.notion_import', 'suite', app.now_utc()),
  ('notion', 'append blocks to a page', 'the updated page',
   'api', 'free tier', 'job kind office.notion_import', 'suite', app.now_utc()),
  ('notion', 'relate one page to another', 'the relation',
   'api', 'free tier', 'job kind office.notion_import', 'suite', app.now_utc()),
  ('notion', 'query a data source', 'matching rows',
   'api', 'free tier', 'duty:notion-sync', 'suite', app.now_utc()),
  ('notion', 'read or create a teamspace', 'nothing — Notion exposes none on any version',
   'none', '', '', 'suite', app.now_utc()),

  -- Drive. Read-only by scope, deliberately.
  ('drive', 'watch a folder for changes', 'the changed files',
   'api', 'free tier', 'job kind drive.watch', 'suite', app.now_utc()),
  ('drive', 'read a file''s text', 'the text',
   'api', 'free tier', 'job kind drive.watch', 'suite', app.now_utc()),
  ('drive', 'write a file into Grant''s Drive', 'nothing — the scope is drive.readonly',
   'none', '', '', 'declared', null),

  -- GitHub. Read-only: github.write is registered at risk 3 and disabled.
  ('github', 'read a repository''s tree, files, issues and releases', 'the content',
   'api', 'free; 60 requests an hour unauthenticated, 5,000 with a token',
   'src/github/api.ts', 'suite', app.now_utc()),
  ('github', 'write to a repository', 'nothing — github.write is disabled at risk 3 (§13)',
   'none', '', '', 'declared', null),

  -- Upload and MCP have no remote surface at all; the rows exist so the sheet
  -- is complete and an agent asking about them gets an answer.
  ('upload', 'accept a file handed to the office', 'a document row',
   'api', 'free', 'hq-api, the studio upload', 'suite', app.now_utc()),
  ('mcp', 'accept a document from an MCP client', 'a document row',
   'api', 'free', 'the MCP server', 'suite', app.now_utc())
on conflict (connector, verb) do nothing;

-- ---------------------------------------------------------------------------
-- The sheet, and the gap
-- ---------------------------------------------------------------------------

/** Everything one connector can be asked for, reachable first. */
create or replace function app.connector_sheet(p_connector text default null)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'connector', c.connector,
           'name', k.name,
           'verb', c.verb,
           'returns', c.returns,
           'reach', c.reach,
           'cost', c.cost_note,
           'we_use_it_for', nullif(c.used_by, ''),
           'how_we_know', c.verified_by
         ) order by c.connector,
           -- Reachable things first: an agent reading its own sheet should
           -- meet what it CAN do before what it cannot.
           case c.reach when 'api' then 0 when 'unofficial' then 1
                        when 'browser_only' then 2 else 3 end,
           c.verb), '[]'::jsonb)
    from public.connector_capabilities c
    join public.knowledge_connectors k on k.connector = c.connector
   where p_connector is null or c.connector = p_connector
$$;

/**
 * What we could do and do not.
 *
 * #51's fourth box, and the reason the table exists: this is a QUERY, not an
 * opinion. A capability that is reachable and that nothing in the office uses
 * is a concrete, checkable suggestion — which is what #52 needs to stop being
 * a model inventing improvements.
 *
 * Excludes the unreachable ones on purpose. "We do not share notebooks" is not
 * an opportunity; it is a fact about Google, and offering it as a suggestion
 * would be the office proposing something nobody can do.
 */
create or replace function app.unused_capabilities()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'connector', c.connector, 'verb', c.verb, 'returns', c.returns,
           'reach', c.reach, 'cost', c.cost_note
         ) order by c.connector, c.verb), '[]'::jsonb)
    from public.connector_capabilities c
    join public.knowledge_connectors k on k.connector = c.connector
   where btrim(c.used_by) = ''
     and c.reach in ('api', 'unofficial')
     and k.enabled
$$;

create or replace function public.connector_sheet(p_connector text default null)
returns jsonb language sql stable security definer set search_path = public, pg_catalog
as $$ select app.connector_sheet(p_connector) $$;

create or replace function public.unused_capabilities()
returns jsonb language sql stable security definer set search_path = public, pg_catalog
as $$ select app.unused_capabilities() $$;

grant execute on function app.connector_sheet(text) to ai_team_app;
grant execute on function public.connector_sheet(text) to ai_team_app;
grant execute on function app.unused_capabilities() to ai_team_app;
grant execute on function public.unused_capabilities() to ai_team_app;
grant select on public.connector_capabilities to ai_team_app;

commit;
