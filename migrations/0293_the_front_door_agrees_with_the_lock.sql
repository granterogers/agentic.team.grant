-- 0293 — the front door agrees with the lock
--
-- Found by `verify:identity` while fixing #177's neighbouring failure.
--
-- 0282 replaced the global unique index on `project_aliases.normalised` with a
-- trigger that checks uniqueness **among ACTIVE projects only**, and said what
-- that was for:
--
--   > *#45. Uniqueness among projects Grant can actually be routed to. An
--   > archived project keeps its aliases as history and no longer blocks a live
--   > one — which releases 561 phrases without deleting a single row.*
--
-- It does not release them. `app.add_project_alias` — the sanctioned writer,
-- the one `hq-api`, the router and every suite actually call — does its own
-- pre-flight conflict check, and that check has no `status` filter:
--
--     select p.project_id, p.name into v_owner
--       from public.project_aliases al
--       join public.projects p on p.project_id = al.project_id
--      where al.normalised = v_norm and al.project_id <> p_project_id;
--
-- So a phrase held by a retired probe is refused before the trigger is ever
-- consulted, and the answer names a project Grant cannot be routed to. The
-- constraint was loosened and the front door was left locked; 0282's headline
-- benefit has been unreachable since the day it shipped.
--
-- This is #72's shape — the mechanism built and the mouth forgotten — in the
-- one place it is hardest to notice, because both halves are correct on their
-- own and only their disagreement is wrong.
--
-- ## Why the pre-flight check stays
--
-- It is not redundant with the trigger and 0282 did not make it so. Its comment
-- says why:
--
--   > *Checked before inserting rather than caught after, so the answer can
--   > name the project that already holds the phrase. A unique violation tells
--   > the caller that something is wrong and not which thing.*
--
-- That is still true and still worth having. It simply has to ask the same
-- question the trigger asks. One predicate, in two places, agreeing — rather
-- than one place deciding and the other pretending to.
--
-- ## And it says something useful about the archived holder
--
-- Taking a phrase from an archived project is now allowed, so the interesting
-- case is no longer a refusal. It is worth saying that it happened: a phrase
-- silently changing which project it routes to is the ambiguity #44 was about,
-- and the person doing it should be able to see it in the answer.

begin;

create or replace function app.add_project_alias(
  p_project_id uuid,
  p_alias      text,
  p_source     text default 'grant',
  p_confidence numeric default 1.0
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_norm  text := app.normalise_name(p_alias);
  v_owner record;
  v_from  record;
begin
  if v_norm is null then
    return jsonb_build_object('error', 'that is not a name');
  end if;
  if not exists (select 1 from public.projects where project_id = p_project_id) then
    return jsonb_build_object('error', 'no such project');
  end if;

  /*
    Checked before inserting rather than caught after, so the answer can name
    the project that already holds the phrase. A unique violation tells the
    caller that something is wrong and not which thing.

    `status <> 'archived'` since 0293, matching `app.alias_is_free_among_active`
    exactly. Without it this refused on behalf of retired projects the trigger
    had already stopped protecting, and 0282's release of 561 phrases could
    never actually happen.
  */
  select p.project_id, p.name into v_owner
    from public.project_aliases al
    join public.projects p on p.project_id = al.project_id
   where al.normalised = v_norm
     and al.project_id <> p_project_id
     and p.status <> 'archived';

  if found then
    return jsonb_build_object(
      'error', format('%L already means %s', p_alias, v_owner.name),
      'conflicts_with', v_owner.project_id
    );
  end if;

  /*
    An ARCHIVED project may still hold this phrase, and taking it is allowed —
    that is the whole point of 0282. But it is worth saying so: a phrase
    quietly changing which project it routes to is the ambiguity #44 was about,
    and the caller should be able to see it rather than discover it later.
  */
  select p.name into v_from
    from public.project_aliases al
    join public.projects p on p.project_id = al.project_id
   where al.normalised = v_norm
     and al.project_id <> p_project_id
     and p.status = 'archived'
   limit 1;

  insert into public.project_aliases (project_id, alias, source, confidence)
  values (p_project_id, btrim(p_alias), p_source, p_confidence)
  on conflict (project_id, normalised)
    do update set source = excluded.source,
                  confidence = greatest(public.project_aliases.confidence, excluded.confidence);

  return jsonb_build_object('ok', true, 'alias', btrim(p_alias), 'project_id', p_project_id)
    || case when v_from.name is null then '{}'::jsonb
            else jsonb_build_object('taken_from_archived', v_from.name) end;
end;
$function$;

comment on function app.add_project_alias is
  'Give a project a routing phrase. Refuses one already held by a project Grant '
  'can be routed to, and NAMES it — a unique violation says something is wrong '
  'and not which thing. An archived holder does not refuse (0282, #45); the '
  'answer says which project the phrase was taken from (0293).';

commit;
