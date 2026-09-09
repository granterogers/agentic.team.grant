-- The message named the thing.
--
-- Grant sent the Chief of Staff a brief that opens:
--
--     Take the "Legacy Coaching Course" notebook in our Google notebook account
--     (id 8c9022a1-d2bc-4231-b2c6-5adf363929ec, 12 sources)
--
-- and the work was filed against "AI learning", because that was the current
-- project for his Telegram chat. The message contained the exact identifier of
-- an attached resource and the resolver never looked at it.
--
-- 0153 added name resolution and put it LAST, below the channel map and the
-- switch, on the argument that a passing mention must not repoint a channel.
-- That argument is right about names and wrong about identifiers. "Let's look
-- at the finance app" is a phrase; a UUID that matches a row in
-- `project_attachments` is not a mention of a project, it is a reference to
-- one, and there is nothing passing about it.
--
-- ## Where it goes in the order
--
-- Second, directly under the explicit project id and above everything else —
-- above the Slack channel map, which is the part worth defending. A notebook
-- id pasted into a project's own channel is somebody talking about that
-- notebook, and the channel is the weaker signal precisely because it is
-- ambient. The id was typed on purpose.
--
-- ## Only references we already hold
--
-- A UUID that matches nothing resolves to nothing. This never invents a
-- project, never creates one, and never guesses: it is a lookup in
-- `project_attachments` for a ref the system is already attached to. If two
-- projects somehow share a ref it declines rather than picking, the same way
-- name resolution does.

begin;

-- ---------------------------------------------------------------------------
-- Every external reference in a piece of text, matched against what we hold
-- ---------------------------------------------------------------------------
--
-- Three shapes, because three connectors name things differently:
--
--   notebooklm  a bare UUID, which is how Google identifies a notebook
--   notion      a 32-hex id, usually inside a notion.so URL
--   github      owner/name, from a URL or typed directly
--
-- Notion's ids are UUIDs with the hyphens removed, so the hex form is
-- normalised both ways before comparing — a ref stored hyphenated must still
-- match a URL that is not.

create or replace function app.references_in(p_text text)
returns table (project_id uuid, slug text, name text, connector text, external_ref text)
language sql
stable
security definer
set search_path to ''
as $$
  with found as (
    -- UUIDs, hyphenated or not.
    select lower(m[1]) as ref
      from regexp_matches(
             coalesce(p_text, ''),
             '([0-9a-fA-F]{8}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{12})',
             'g'
           ) as m
    union
    -- owner/repo, from a GitHub URL or typed bare.
    select lower(m[1] || '/' || m[2])
      from regexp_matches(
             coalesce(p_text, ''),
             '(?:github\.com[/:])?([A-Za-z0-9][\w-]{0,38})/([\w.-]{1,100}?)(?:\.git)?(?=[\s,)\]]|$)',
             'g'
           ) as m
  ),
  -- Hyphens are cosmetic in a Notion id and load-bearing in nothing, so both
  -- forms of every candidate and every stored ref are compared.
  candidates as (
    select ref from found
    union
    select replace(ref, '-', '') from found
  )
  select distinct p.project_id, p.slug, p.name, a.connector, a.external_ref
    from public.project_attachments a
    join public.projects p on p.project_id = a.project_id
   where p.status = 'active'
     and a.enabled
     and (
       lower(a.external_ref) in (select ref from candidates)
       or replace(lower(a.external_ref), '-', '') in (select ref from candidates)
     )
$$;

comment on function app.references_in(text) is
  'Projects named by an external identifier appearing in a piece of text — a '
  'notebook UUID, a Notion id, an owner/repo. Only references already attached: '
  'this looks things up, it never invents or creates (0162).';

-- ---------------------------------------------------------------------------
-- And the resolver uses it, second
-- ---------------------------------------------------------------------------

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
  -- 1. What the caller already resolved.
  if p_explicit is not null then
    return p_explicit;
  end if;

  -- 2. An identifier for something we are attached to, appearing in the words
  --    themselves. Above the channel map on purpose: a notebook id pasted into
  --    a project's own channel is somebody talking about that notebook, and
  --    the channel is the weaker signal because it is ambient. The id was
  --    typed. Declines when two projects match, like every other step here.
  if p_said is not null then
    select count(*), (array_agg(r.project_id))[1]
      into v_count, v_named
      from (select distinct project_id from app.references_in(p_said)) r;
    if v_count = 1 then
      return v_named;
    end if;
  end if;

  -- 3. A permanent channel mapping. Outranks a switch made IN that channel:
  --    the map is deliberate configuration, and a passing "let's look at X"
  --    must not silently repoint the team's project channel.
  if p_scope_kind = 'slack_channel' then
    v_mapped := app.project_for_slack_channel(p_scope_ref);
    if v_mapped is not null then
      return v_mapped;
    end if;
  end if;

  -- 4. The scope's current switch.
  v_mapped := app.current_project(p_scope_kind, p_scope_ref);
  if v_mapped is not null then
    return v_mapped;
  end if;

  -- 5. A NAME in what was said, and only when it is unambiguous. Below the
  --    switch, unlike an identifier above it: a name is a phrase and a phrase
  --    can be in passing.
  if p_said is not null then
    select count(*), (array_agg(r.project_id))[1]
      into v_count, v_named
      from app.resolve_project_by_name(p_said) r
     where r.confidence >= 0.90;
    if v_count = 1 then
      return v_named;
    end if;
  end if;

  -- 6. Null, meaning ASK. Deliberately not "the most recently touched
  --    project", which is how work lands in the wrong place while looking
  --    entirely reasonable.
  return null;
end;
$function$;

commit;
