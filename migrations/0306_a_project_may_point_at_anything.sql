begin;

/**
 * A project may point at anything, not only at things we can log into.
 *
 * Issue #35, under #25.
 *
 * ## What was missing
 *
 * The Sources section holds `project_attachments`, and every row of that table
 * has a `connector` that references `knowledge_connectors`. So a project could
 * point at a Notion database, a Drive folder or a notebook — and could not
 * point at a website, an API, a competitor's pricing page, or an application
 * Grant uses that has no integration. Which is most of what his projects
 * actually point at.
 *
 * ## Why a second table rather than a sentinel connector
 *
 * The cheap move is `connector = 'link'`. This repository has already refused
 * that shape once: 0177's argument, recorded in CLAUDE.md, is that **a
 * sentinel satisfies the constraint and lies** — every reader that joins
 * `knowledge_connectors` to get a label, a health state or a capability sheet
 * would then be asking those questions of a thing that has no answers, and
 * getting a fabricated row back rather than nothing.
 *
 * #35 makes the same argument from the product side, and it is the deciding
 * one:
 *
 *   > *"The distinction matters: a connector has health and a last-synced time
 *   > and can fail; a reference is just a pointer and never fails."*
 *
 * A reference has no credential, no sync, no quota, no health. Modelling it as
 * a degenerate connector would mean every one of those columns is null on
 * purpose and every reader has to know that. So: its own table, and
 * `studio_sources` — which has emitted `'kind', 'connector'` on every row
 * since it was written, leaving exactly this seam — unions the two.
 *
 * ## What it deliberately does NOT do
 *
 * It does not fetch the page. A reference is a pointer Grant wrote down, and
 * going and reading it is a job, with a cost and a policy. `documents` already
 * models the read; this models the intention.
 */

-- ---------------------------------------------------------------------------
-- The table
-- ---------------------------------------------------------------------------

create table if not exists public.project_references (
  reference_id  uuid        primary key default extensions.gen_random_uuid(),
  project_id    uuid        not null references public.projects (project_id) on delete cascade,
  /*
    What kind of thing it is, in the vocabulary the specification uses:
    websites, external applications, APIs, other project resources. Not a
    guess about the technology — a statement about what Grant will do with it.
  */
  kind          text        not null default 'website'
                check (kind in ('website', 'api', 'application', 'folder', 'document', 'other')),
  url           text        not null check (btrim(url) <> ''),
  title         text        not null check (btrim(title) <> ''),
  note          text        not null default '',
  added_by      text        not null default 'grant',
  created_at    timestamptz not null default app.now_utc(),
  updated_at    timestamptz not null default app.now_utc()
);

/*
  One row per URL per project, compared on a normalised form.

  Without it, pasting the same link twice — which is what happens when you
  cannot see whether it is already there — silently makes a second row, and
  the Sources section grows duplicates that look like two different things.
  Scheme, "www." and a trailing slash are noise for this purpose.
*/
create or replace function app.normalise_reference_url(p_url text)
returns text
language sql
immutable
set search_path = ''
as $$
  select regexp_replace(
           regexp_replace(
             regexp_replace(lower(btrim(coalesce(p_url, ''))), '^https?://', ''),
             '^www\.', ''),
           '/+$', '')
$$;

create unique index if not exists project_references_one_per_url
  on public.project_references (project_id, app.normalise_reference_url(url));

create index if not exists project_references_by_project
  on public.project_references (project_id, created_at desc);

alter table public.project_references enable row level security;

comment on table public.project_references is
  '#35. Something a dashboard project POINTS AT that we cannot log into — a '
  'website, an API, an application, a folder. Deliberately not a row in '
  'project_attachments with a sentinel connector: a connector has health, a '
  'last-synced time and a capability sheet, and a reference has none of those '
  'and never will. 0306.';

-- ---------------------------------------------------------------------------
-- Adding one, without asking Grant to classify it
-- ---------------------------------------------------------------------------

/**
 * Work out what a link is, so nobody has to be asked.
 *
 * §31 of the frontend prompt: treat an avoidable request for manual
 * configuration as a design failure. A form with a "kind" dropdown and a
 * "title" field is three decisions for something Grant pasted in one gesture,
 * and the URL already contains the answer to two of them.
 *
 * Deliberately coarse. It is a starting label he can correct, not a claim.
 */
create or replace function app.guess_reference_kind(p_url text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_url ~* '/api/|api\.|/v[0-9]+/|\.json$|graphql' then 'api'
    when p_url ~* 'drive\.google\.com/drive/folders|dropbox\.com/home|/folder/' then 'folder'
    when p_url ~* '\.(pdf|docx?|pptx?|xlsx?|csv|md|txt)($|\?)' then 'document'
    when p_url ~* '^[a-z][a-z0-9+.-]*:' and p_url !~* '^https?:' then 'application'
    else 'website'
  end
$$;

/** The host, as a person would name the thing: "stripe.com/docs" over a URL. */
create or replace function app.guess_reference_title(p_url text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(
    btrim(regexp_replace(
      regexp_replace(lower(btrim(coalesce(p_url, ''))), '^https?://(www\.)?', ''),
      '[?#].*$', '')),
    '')
$$;

/**
 * Point a project at something.
 *
 * Takes a SLUG rather than a project id, for the reason `record_consultation`
 * does: the caller — a page, an agent, an adapter — knows the slug and would
 * otherwise have to look the id up, and a caller doing a lookup is a caller
 * that can do it wrong.
 *
 * Refuses rather than duplicates, and says which row already holds the link,
 * because "it is already there" is the useful answer and an error is not.
 */
create or replace function app.add_project_reference(
  p_slug text,
  p_url text,
  p_title text default null,
  p_kind text default null,
  p_note text default null,
  p_by text default 'grant')
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_project uuid;
  v_url     text := btrim(coalesce(p_url, ''));
  v_kind    text;
  v_title   text;
  v_id      uuid;
  v_existing uuid;
begin
  if v_url = '' then
    return jsonb_build_object('ok', false, 'error', 'a reference needs a link');
  end if;

  select project_id into v_project
    from public.projects where slug = p_slug and status <> 'archived';
  if v_project is null then
    return jsonb_build_object('ok', false, 'error', format('no active project called %s', p_slug));
  end if;

  /*
    A bare host is a link. Grant pastes "stripe.com/docs" as often as the full
    thing, and refusing it would be the interface being pedantic about a
    detail it can fix itself.
  */
  if v_url !~* '^[a-z][a-z0-9+.-]*:' then
    v_url := 'https://' || v_url;
  end if;

  v_kind  := coalesce(nullif(btrim(coalesce(p_kind, '')), ''), app.guess_reference_kind(v_url));
  v_title := coalesce(nullif(btrim(coalesce(p_title, '')), ''),
                      app.guess_reference_title(v_url), v_url);

  select reference_id into v_existing
    from public.project_references
   where project_id = v_project
     and app.normalise_reference_url(url) = app.normalise_reference_url(v_url);
  if v_existing is not null then
    return jsonb_build_object(
      'ok', false, 'already', true, 'reference', v_existing,
      'error', format('%s already points at that', p_slug));
  end if;

  insert into public.project_references (project_id, kind, url, title, note, added_by)
  values (v_project, v_kind, v_url, v_title, btrim(coalesce(p_note, '')), p_by)
  returning reference_id into v_id;

  return jsonb_build_object('ok', true, 'reference', v_id, 'kind', v_kind, 'title', v_title);
end;
$$;

/**
 * Stop pointing at it.
 *
 * A plain delete, and that is the whole argument for it: a reference holds
 * nothing. Removing a CONNECTOR is a different act — ADR-0013 keeps the corpus
 * a connector fed, so detaching disables a row rather than dropping it. There
 * is no corpus behind a pointer, so there is nothing to keep.
 */
create or replace function app.remove_project_reference(p_reference_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare v_title text;
begin
  delete from public.project_references
   where reference_id = p_reference_id
  returning title into v_title;
  if v_title is null then
    return jsonb_build_object('ok', false, 'error', 'no such reference');
  end if;
  return jsonb_build_object('ok', true, 'removed', v_title);
end;
$$;

create or replace function public.add_project_reference(
  p_slug text, p_url text, p_title text default null, p_kind text default null,
  p_note text default null, p_by text default 'grant')
returns jsonb language sql security definer set search_path = public, pg_catalog
as $$ select app.add_project_reference(p_slug, p_url, p_title, p_kind, p_note, p_by) $$;

create or replace function public.remove_project_reference(p_reference_id uuid)
returns jsonb language sql security definer set search_path = public, pg_catalog
as $$ select app.remove_project_reference(p_reference_id) $$;

-- ---------------------------------------------------------------------------
-- Both kinds, in one list
-- ---------------------------------------------------------------------------

/*
  `studio_sources` has emitted 'kind', 'connector' on every row since it was
  written. This is the second kind it was leaving room for.

  Connectors first, then references, each in the order they were added. Not
  interleaved by date: they are different things and the section says so, and a
  list that alternates between "Notion, synced 4 minutes ago" and "a pricing
  page Grant bookmarked" reads as one list of unlike things.
*/
create or replace function app.studio_sources(p_project_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(x order by x.ord, x.at), '[]'::jsonb)
    from (
      select 0 as ord, a.created_at as at, jsonb_build_object(
               'kind', 'connector',
               'id', a.attachment_id,
               'connector', a.connector,
               'ref', a.external_ref,
               'url', a.external_url,
               -- The individual thing here, because that is what a Sources row
               -- is for: which notebook, which database, which folder. The
               -- card above says the kind.
               'name', coalesce(nullif(a.display_name, ''), app.connector_label(a.connector)),
               'via', app.connector_label(a.connector),
               'what', a.role,
               'health', case when a.enabled then 'ok' else 'blocked' end,
               'problem', a.disabled_reason,
               'last', case when a.last_synced_at is null then 'never'
                            else to_char(a.last_synced_at, 'FMDD Mon') end,
               'gave', (select count(*)::int from public.documents d
                         where d.project_id = p_project_id
                           and coalesce(d.connector, '') = a.connector)
             ) as v
        from public.project_attachments a
       where a.project_id = p_project_id

      union all

      /*
        A reference carries no `health`, no `last` and no `gave`, and that is
        the point rather than an omission: it is a pointer, it never fails, and
        nothing has read it. A null health is what tells the page to draw it as
        the other kind of thing.
      */
      select 1 as ord, r.created_at as at, jsonb_build_object(
               'kind', 'reference',
               'id', r.reference_id,
               'ref', r.kind,
               'url', r.url,
               'name', r.title,
               'via', case r.kind
                        when 'api' then 'An API'
                        when 'folder' then 'A folder'
                        when 'document' then 'A document'
                        when 'application' then 'An application'
                        when 'website' then 'A website'
                        else 'A reference'
                      end,
               'what', nullif(r.note, ''),
               'health', null,
               'problem', null,
               'last', null,
               'gave', null
             ) as v
        from public.project_references r
       where r.project_id = p_project_id
    ) rows_of_both,
    lateral (select rows_of_both.ord, rows_of_both.at, rows_of_both.v) x(ord, at, v)
$$;

grant execute on function app.add_project_reference(text, text, text, text, text, text) to ai_team_app;
grant execute on function public.add_project_reference(text, text, text, text, text, text) to ai_team_app;
grant execute on function app.remove_project_reference(uuid) to ai_team_app;
grant execute on function public.remove_project_reference(uuid) to ai_team_app;

commit;
