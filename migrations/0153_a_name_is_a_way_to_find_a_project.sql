-- A name is a way to find a project.
--
-- Grant, describing a real failure: he referred conversationally to a wellness
-- project when a related one already existed, and the system made a second one.
--
-- The audit found that this was not a bug. It is two deliberate decisions
-- meeting each other:
--
--   1. `app.resolve_project` resolves a project by an explicit UUID, by a Slack
--      channel mapping, or by the scope's current-project switch — and by
--      nothing else. **None of those is a name.** There has never been a path
--      from the words "the wellness project" to a project id.
--
--   2. `app.hq_create_project` treats a name collision as a slug collision and
--      appends a number. Its own comment says so: *"A name someone else already
--      used is a suffix, not an error."*
--
-- So nothing could recognise what he meant, and the create path was built to
-- absorb the collision quietly. `public.projects` still holds the evidence: a
-- live row with the slug `ai-learning-2`.
--
-- This migration adds the missing half — names — and makes the create path
-- ask instead of assume.
--
-- ## Why aliases are a table and not a column
--
-- Grant: *"Money Mastery", "Money Mastery app", "finance app", "personal
-- finance project"* — one project. That is many-to-one, it grows every time he
-- says something a new way, and §18 wants the system to LEARN how he refers to
-- things. A text[] column cannot carry where an alias came from or how much to
-- trust it, and those are the two facts that decide whether a match may resolve
-- silently.
--
-- ## Why trigram and not embeddings
--
-- `pg_trgm` is available here, costs one index, and runs inside the same query
-- as everything else. Embeddings would match "wellness" to "health" and
-- trigrams will not — a real gap, and the seam for closing it is that
-- `resolve_project_by_name` returns scored candidates from a union, so another
-- source of candidates is another branch rather than a rewrite.
--
-- Starting with the cheap thing also keeps the failure honest: a trigram miss
-- returns nothing and the caller asks, which is the behaviour §4 wants anyway.
--
-- ## Nothing here merges anything
--
-- `ai-learning-2` is untouched. Grant: *"you should always check before making
-- any destructive action with me."* Merging two projects moves documents,
-- attachments and history; this migration gives him the means to see the
-- duplicate and nothing that acts on it.

begin;

-- Into `extensions`, which is where every other extension in this project
-- lives (pgcrypto, uuid-ossp, pg_stat_statements). Named explicitly because
-- the connection's search_path would otherwise put it in `public`, and a
-- function that runs with `search_path = ''` — which is all of them here, by
-- §15 — has to qualify the schema it finds `similarity` in either way.
create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------------------
-- What a project is for
-- ---------------------------------------------------------------------------
--
-- §4 wants resolution against "name, aliases, description, purpose". Two of
-- those did not exist. `projects` had eight columns and not one of them said
-- what the project was.

alter table public.projects
  add column if not exists description text,
  add column if not exists purpose text;

comment on column public.projects.description is
  'What this project is, in a sentence or two. Read by name resolution (0153) '
  'and shown on the project page. Null means nobody has said.';
comment on column public.projects.purpose is
  'What it is FOR — the outcome, not the subject matter. Kept apart from the '
  'description because "a personal finance app" and "get my spending under '
  'control" answer different questions and both help resolve a name.';

-- ---------------------------------------------------------------------------
-- Normalising a name
-- ---------------------------------------------------------------------------
--
-- Deliberately conservative. It lowercases, strips punctuation and collapses
-- whitespace, and it drops a leading "the" and a trailing "project" or "app"
-- because those are the words people add and drop without meaning anything by
-- it — "Money Mastery app" and "Money Mastery" are the same thing.
--
-- It does NOT stem, and it does not drop interior words. "Personal finance
-- project" must not normalise to "finance", because "finance" is also a
-- department and a different project could reasonably be called it. Anything
-- looser than this belongs in the trigram step, where it arrives as a SCORE
-- and not as an equality.

create or replace function app.normalise_name(p_text text)
returns text
language sql
immutable
set search_path to ''
as $$
  select nullif(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          trim(lower(coalesce(p_text, ''))),
          '^the\s+', ''
        ),
        '\s+(project|app|application)$', ''
      ),
      '[^a-z0-9]+', ' ', 'g'
    ),
    ''
  )
$$;

comment on function app.normalise_name(text) is
  'Lowercase, de-punctuate, and drop the words people add and drop without '
  'meaning anything by them. Immutable, so a generated column can use it.';

-- ---------------------------------------------------------------------------
-- The aliases
-- ---------------------------------------------------------------------------

create table if not exists public.project_aliases (
  alias_id     uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects(project_id) on delete cascade,
  alias        text not null check (btrim(alias) <> ''),
  -- Generated, so it cannot drift from the alias it normalises. This is the
  -- column the unique index and every lookup use.
  normalised   text generated always as (app.normalise_name(alias)) stored,
  -- Where it came from decides how much to trust it. `grant` is him saying so
  -- and outranks everything; `name` and `slug` are backfilled from what the
  -- project is already called; `inferred` is the system's own guess from a
  -- conversation, which §13 says may be recorded but not acted on silently.
  source       text not null default 'inferred'
                 check (source in ('grant', 'name', 'slug', 'inferred')),
  confidence   numeric not null default 0.5 check (confidence between 0 and 1),
  created_at   timestamptz not null default app.now_utc(),
  unique (project_id, normalised)
);

-- One alias, one project, across the whole table.
--
-- Two projects both answering to "the finance thing" is not a state to store
-- gracefully — it is the ambiguity that produced the duplicate in the first
-- place, and it has to surface at the moment someone tries to create it rather
-- than at the moment work lands in the wrong place. `app.add_project_alias`
-- below catches the violation and reports which project already holds it.
create unique index if not exists project_aliases_normalised_uniq
  on public.project_aliases (normalised);

create index if not exists project_aliases_trgm
  on public.project_aliases using gin (normalised extensions.gin_trgm_ops);

create index if not exists projects_name_trgm
  on public.projects using gin (app.normalise_name(name) extensions.gin_trgm_ops);

alter table public.project_aliases enable row level security;
alter table public.project_aliases force row level security;

-- The same shape every other table in this schema uses: the application role
-- and nothing else. `force` so it applies to the owner too — §15's rule is that
-- a table without a policy is unreachable, not that it is open.
drop policy if exists project_aliases_app on public.project_aliases;
create policy project_aliases_app on public.project_aliases
  for all to ai_team_app using (true) with check (true);

grant select, insert, update, delete on public.project_aliases to ai_team_app;

comment on table public.project_aliases is
  'Every way Grant refers to a project. Many aliases, one project — enforced '
  'globally, because two projects answering to one phrase is the ambiguity '
  'that created the duplicate this table exists to prevent (0153).';

-- ---------------------------------------------------------------------------
-- Backfill: what each project is already called
-- ---------------------------------------------------------------------------
--
-- Its name and its slug, at high confidence, for active projects only. An
-- archived fixture called "Verify 1788904528253" has no business claiming a
-- phrase, and there are hundreds of them.

insert into public.project_aliases (project_id, alias, source, confidence)
select p.project_id, p.name, 'name', 1.0
  from public.projects p
 where p.status = 'active'
   and app.normalise_name(p.name) is not null
on conflict do nothing;

insert into public.project_aliases (project_id, alias, source, confidence)
select p.project_id, replace(p.slug, '-', ' '), 'slug', 0.9
  from public.projects p
 where p.status = 'active'
   and app.normalise_name(replace(p.slug, '-', ' ')) is not null
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Resolving a name to candidates
-- ---------------------------------------------------------------------------
--
-- Returns CANDIDATES, scored and ordered, never a single answer. §4 allows a
-- high-confidence match to resolve automatically, but that is the caller's
-- decision to take against a threshold it can state, not a decision to bury in
-- here where every caller inherits it.
--
-- The `how` column exists so an answer can explain itself: "that is the one you
-- call the finance app" is a very different sentence from "that is the closest
-- name I have", and Grant should be told which he is getting.

create or replace function app.resolve_project_by_name(p_text text)
returns table (
  project_id  uuid,
  slug        text,
  name        text,
  confidence  numeric,
  how         text
)
language sql
stable
security definer
set search_path to ''
as $$
  with asked as (
    select app.normalise_name(p_text) as n
  ),
  scored as (
    -- The slug, typed exactly. The one unambiguous thing a person can say.
    select p.project_id, p.slug, p.name, 1.00::numeric as confidence, 'slug'::text as how
      from public.projects p
     cross join asked a
     where p.status = 'active' and a.n is not null
       and app.normalise_name(p.slug) = a.n

    union all

    -- A name he has used for it, including its own name and slug from the
    -- backfill above. Confidence carries through from the alias, so something
    -- he said himself outranks something the system guessed.
    select p.project_id, p.slug, p.name,
           least(0.99, 0.90 + (al.confidence * 0.09))::numeric,
           case al.source when 'grant' then 'you call it that'
                          when 'name' then 'its name'
                          when 'slug' then 'its slug'
                          else 'a name we picked up' end
      from public.project_aliases al
      join public.projects p on p.project_id = al.project_id
     cross join asked a
     where p.status = 'active' and a.n is not null
       and al.normalised = a.n

    union all

    -- Close, but not the same. Scored by similarity and capped below every
    -- exact route above, so a fuzzy hit can never outrank a real one.
    select p.project_id, p.slug, p.name,
           (0.40 + (0.45 * greatest(
              extensions.similarity(app.normalise_name(p.name), a.n),
              coalesce((select max(extensions.similarity(al2.normalised, a.n))
                          from public.project_aliases al2
                         where al2.project_id = p.project_id), 0),
              -- A description is weaker evidence than a name, so it is scaled
              -- down rather than allowed to win on its own.
              coalesce(extensions.similarity(app.normalise_name(coalesce(p.description, '')), a.n), 0) * 0.6,
              coalesce(extensions.similarity(app.normalise_name(coalesce(p.purpose, '')), a.n), 0) * 0.6
           )))::numeric,
           'a close match on the name'::text
      from public.projects p
     cross join asked a
     where p.status = 'active' and a.n is not null
       and greatest(
             extensions.similarity(app.normalise_name(p.name), a.n),
             coalesce((select max(extensions.similarity(al3.normalised, a.n))
                         from public.project_aliases al3
                        where al3.project_id = p.project_id), 0),
             coalesce(extensions.similarity(app.normalise_name(coalesce(p.description, '')), a.n), 0) * 0.6,
             coalesce(extensions.similarity(app.normalise_name(coalesce(p.purpose, '')), a.n), 0) * 0.6
           ) >= 0.34
  )
  -- One row per project: its best route, not every route it matched by.
  select distinct on (s.project_id)
         s.project_id, s.slug, s.name, round(s.confidence, 3), s.how
    from scored s
   order by s.project_id, s.confidence desc
$$;

comment on function app.resolve_project_by_name(text) is
  'Scored candidates for a phrase, best route per project. Never picks — the '
  'caller applies its own threshold and says which route it took (0153).';

-- A public wrapper, because PostgREST exposes only `public` and the front end
-- and the Edge functions both reach this through PostgREST.
create or replace function public.resolve_project_by_name(p_text text)
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $$
  select coalesce(jsonb_agg(to_jsonb(r) order by r.confidence desc), '[]'::jsonb)
    from app.resolve_project_by_name(p_text) r
$$;

-- ---------------------------------------------------------------------------
-- Teaching it a name
-- ---------------------------------------------------------------------------

create or replace function app.add_project_alias(
  p_project_id uuid,
  p_alias      text,
  p_source     text default 'grant',
  p_confidence numeric default 1.0
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $$
declare
  v_norm  text := app.normalise_name(p_alias);
  v_owner record;
begin
  if v_norm is null then
    return jsonb_build_object('error', 'that is not a name');
  end if;
  if not exists (select 1 from public.projects where project_id = p_project_id) then
    return jsonb_build_object('error', 'no such project');
  end if;

  -- Checked before inserting rather than caught after, so the answer can name
  -- the project that already holds the phrase. A unique violation tells the
  -- caller that something is wrong and not which thing.
  select p.project_id, p.name into v_owner
    from public.project_aliases al
    join public.projects p on p.project_id = al.project_id
   where al.normalised = v_norm and al.project_id <> p_project_id;

  if found then
    return jsonb_build_object(
      'error', format('%L already means %s', p_alias, v_owner.name),
      'conflicts_with', v_owner.project_id
    );
  end if;

  insert into public.project_aliases (project_id, alias, source, confidence)
  values (p_project_id, btrim(p_alias), p_source, p_confidence)
  on conflict (project_id, normalised)
    do update set source = excluded.source, confidence = greatest(public.project_aliases.confidence, excluded.confidence);

  return jsonb_build_object('ok', true, 'alias', btrim(p_alias), 'project_id', p_project_id);
end;
$$;

create or replace function public.add_project_alias(
  p_project_id uuid, p_alias text, p_source text default 'grant', p_confidence numeric default 1.0
) returns jsonb
language sql security definer set search_path to 'public', 'pg_catalog'
as $$ select app.add_project_alias(p_project_id, p_alias, p_source, p_confidence) $$;

-- ---------------------------------------------------------------------------
-- Creating a project stops assuming
-- ---------------------------------------------------------------------------
--
-- The behaviour that produced `ai-learning-2`, replaced. The suffix stays for
-- the case it was written for — two genuinely different projects that happen to
-- share a name — but it is now only reachable once somebody has looked at the
-- candidates and said "no, a new one".
--
-- Grant: *"please don't assume I wish to create a new project? this is large
-- task and should always be confirmed."*

create or replace function app.hq_create_project(
  p_name      text,
  p_connector text,
  p_ref       text,
  p_display   text default null,
  p_force     boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $$
declare
  v_slug   text;
  v_prefix text;
  v_id     uuid;
  v_n      integer := 0;
  v_near   jsonb;
begin
  if coalesce(trim(p_name), '') = '' then
    return jsonb_build_object('error', 'a project needs a name');
  end if;
  if coalesce(trim(p_ref), '') = '' then
    return jsonb_build_object(
      'error', 'a project needs at least one source: a notebook or a Notion database'
    );
  end if;
  if p_connector not in ('notebooklm', 'notion', 'upload') then
    return jsonb_build_object('error', format('%L is not a connector', p_connector));
  end if;

  -- The new step. Anything above 0.55 is close enough to be worth his glance:
  -- an exact name is 0.99, "AI learning" against "AI Learning Two" is a
  -- trigram hit in the 0.6s, and two projects that merely share a common word
  -- fall below it.
  if not p_force then
    select jsonb_agg(jsonb_build_object(
             'project_id', r.project_id, 'slug', r.slug, 'name', r.name,
             'confidence', r.confidence, 'how', r.how) order by r.confidence desc)
      into v_near
      from app.resolve_project_by_name(p_name) r
     where r.confidence >= 0.55;

    if v_near is not null then
      return jsonb_build_object(
        'needs_confirmation', true,
        'candidates', v_near,
        -- Written as a sentence because it is shown to a person, and because
        -- the caller should not have to compose one from a code.
        'question', format(
          'There is already something by that name. Did you mean one of these, '
          'or is %L genuinely new?', trim(p_name))
      );
    end if;
  end if;

  v_slug := left(trim(both '-' from regexp_replace(lower(p_name), '[^a-z0-9]+', '-', 'g')), 60);
  if v_slug = '' then v_slug := 'project'; end if;
  v_prefix := left(v_slug, 48);

  while exists (select 1 from public.projects where slug = v_slug) loop
    v_n := v_n + 1;
    v_slug := left(v_prefix, 56) || '-' || v_n::text;
    if v_n > 50 then
      return jsonb_build_object('error', 'could not find a free slug for that name');
    end if;
  end loop;

  insert into public.projects (slug, name, channel_prefix, status)
  values (v_slug, trim(p_name), v_prefix, 'active')
  returning project_id into v_id;

  insert into public.project_attachments
    (project_id, connector, external_ref, display_name, role)
  values (v_id, p_connector, trim(p_ref),
          coalesce(nullif(trim(coalesce(p_display, '')), ''), trim(p_name)), 'source');

  -- The new project answers to its own name from the moment it exists, so the
  -- next thing said about it resolves.
  perform app.add_project_alias(v_id, trim(p_name), 'name', 1.0);

  return jsonb_build_object('project_id', v_id, 'slug', v_slug, 'name', trim(p_name));
end;
$$;

-- ---------------------------------------------------------------------------
-- Resolution learns to use them
-- ---------------------------------------------------------------------------
--
-- One new step, placed LAST on purpose. A name in a message is weaker evidence
-- than a channel deliberately mapped to a project or a switch somebody made:
-- the phrase "let's look at the finance app" inside the wellness channel should
-- not repoint the channel. It only answers where the old function returned
-- null, which is the case that used to mean "ask" and now sometimes means
-- "obviously that one".
--
-- The threshold is deliberately higher than the create path's. Getting this
-- wrong files work against the wrong project silently, where getting the create
-- path wrong only asks a question.

-- Dropped and recreated rather than replaced, because the signature is wider.
-- `create or replace` with an extra defaulted parameter leaves the THREE-arg
-- function in place as a separate overload, an exact-arity call keeps matching
-- it, and the new step below would silently never run. Every existing caller
-- passes three arguments and continues to work against the default.
drop function if exists app.resolve_project(project_scope_kind, text, uuid);

create or replace function app.resolve_project(
  p_scope_kind project_scope_kind,
  p_scope_ref  text,
  p_explicit   uuid default null,
  p_said       text default null
)
returns uuid
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_mapped uuid;
  v_named  uuid;
  v_count  integer;
begin
  -- 1. What the message itself named.
  if p_explicit is not null then
    return p_explicit;
  end if;

  -- 2. A permanent channel mapping. Outranks a switch made IN that channel:
  --    the map is deliberate configuration, and a passing "let's look at X"
  --    must not silently repoint the team's project channel.
  if p_scope_kind = 'slack_channel' then
    v_mapped := app.project_for_slack_channel(p_scope_ref);
    if v_mapped is not null then
      return v_mapped;
    end if;
  end if;

  -- 3. The scope's current switch.
  v_mapped := app.current_project(p_scope_kind, p_scope_ref);
  if v_mapped is not null then
    return v_mapped;
  end if;

  -- 4. A name in what was actually said, and only when it is unambiguous:
  --    exactly one candidate at 0.9 or better. Two candidates at 0.95 is the
  --    situation this whole migration exists to stop being answered by a coin
  --    toss, so it falls through to null and the caller asks.
  if p_said is not null then
    -- One query, and it answers both halves: `into` over an aggregate always
    -- returns exactly one row, so `v_count = 1` is the unambiguous case and
    -- `v_named` is already the answer to it.
    select count(*), min(r.project_id)
      into v_count, v_named
      from app.resolve_project_by_name(p_said) r
     where r.confidence >= 0.90;

    if v_count = 1 then
      return v_named;
    end if;
  end if;

  -- 5. Null, meaning ASK. Deliberately not "the most recently touched
  --    project", which is how work lands in the wrong place while looking
  --    entirely reasonable.
  return null;
end;
$function$;

-- ---------------------------------------------------------------------------
-- What the front end reads
-- ---------------------------------------------------------------------------
--
-- Aliases and description on the project rows, so the page can show what a
-- project is and what it answers to — and so a duplicate is visible as two
-- cards with confusably similar names rather than as a surprise later.

create or replace function app.hq_projects()
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
  select coalesce(jsonb_agg(x order by x->>'name'), '[]'::jsonb) from (
    select jsonb_build_object(
             'project_id', p.project_id,
             'slug', p.slug,
             'name', p.name,
             'description', p.description,
             'purpose', p.purpose,
             'channel_prefix', p.channel_prefix,
             'status', p.status,
             'documents', (select count(*) from public.documents d where d.project_id = p.project_id),
             'aliases', (select coalesce(jsonb_agg(jsonb_build_object(
                              'alias', a.alias, 'source', a.source) order by a.confidence desc, a.alias), '[]'::jsonb)
                           from public.project_aliases a
                          where a.project_id = p.project_id and a.source <> 'name'),
             'channels', (select coalesce(jsonb_agg(jsonb_build_object(
                              'name', m.channel_name, 'discipline', m.discipline) order by m.channel_name), '[]'::jsonb)
                            from public.slack_channel_map m
                           where m.project_id = p.project_id and m.active),
             'attachments', (select coalesce(jsonb_agg(jsonb_build_object(
                                 'attachment_id', a.attachment_id,
                                 'connector', a.connector,
                                 'external_ref', a.external_ref,
                                 'display_name', a.display_name,
                                 'role', a.role,
                                 'artifact_kind', a.artifact_kind) order by a.role, a.connector), '[]'::jsonb)
                               from public.project_attachments a
                              where a.project_id = p.project_id and a.enabled)
           ) as x
      from public.projects p
     where p.status = 'active'
  ) s
$function$;

commit;
