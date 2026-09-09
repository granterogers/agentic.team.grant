-- There is no min() of a uuid.
--
-- 0153's fourth resolution step needs two facts about the confident matches for
-- a phrase: how many there are, and — when there is exactly one — which. It
-- asked for both in one query, which was the right instinct:
--
--     select count(*), min(r.project_id) into v_count, v_named
--
-- `min` has no uuid form. Postgres defines it for numbers, text, timestamps and
-- a few more, and not for uuid, so the statement raises at runtime rather than
-- at creation — a plpgsql body is not planned until it runs.
--
-- Two things kept it out of production. The step only executes when `p_said` is
-- non-null, and every caller today passes three arguments; and `verify:identity`
-- exercises it deliberately, which is the entire reason that harness exists.
-- This is the third fault it has found in two migrations, all three of them
-- invisible to the type checker and to 782 unit tests, because all three live
-- in the database rather than in a file.
--
-- `array_agg(...)[1]` instead. An aggregate, so the single-row guarantee that
-- made the one-query form correct still holds, and it is defined for any type.

begin;

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
  --    situation this whole feature exists to stop being answered by a coin
  --    toss, so it falls through to null and the caller asks.
  --
  --    One query for both facts, because `into` over aggregates always returns
  --    exactly one row: `v_count = 1` is the unambiguous case and `v_named` is
  --    already its answer. `array_agg(...)[1]` rather than `min()`, which has
  --    no uuid form (0155).
  if p_said is not null then
    select count(*), (array_agg(r.project_id))[1]
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

commit;
