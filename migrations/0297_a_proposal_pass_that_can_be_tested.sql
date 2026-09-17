-- 0297 — a proposal pass that can be tested
--
-- `verify:proposes` could not tear itself down, and the reason is a real
-- constraint rather than a suite bug:
--
--   ERROR: public.job_impediments is append-only: DELETE is never permitted
--          (master spec §6)
--   HINT:  To reverse an action, INSERT a compensating row referencing the
--          original — never UPDATE or DELETE the history.
--
-- The ledger is right. An impediment is history and history is not deleted.
--
-- ## Which leaves a suite with nowhere to stand
--
-- `job_impediments.is_fixture` is inherited from its job by trigger, and
-- `app.impediments_tally` excludes fixtures — so a FIXTURE impediment is
-- permanent and harmless, which is exactly what a suite wants. But
-- `app.raise_proposals` called the tally with `false` hardcoded, so a suite
-- using fixture subjects could never reach the code it was testing, and one
-- using real subjects left permanent rows in Grant's tally proposing nonsense.
--
-- Neither is acceptable, and the fix is already the pattern one function down:
-- `impediments_tally` takes `p_include_fixtures` for precisely this reason.
-- `raise_proposals` gains the same parameter, defaulted the same way. Every
-- production caller passes nothing and behaves identically; the suite passes
-- true and drives the real code path against rows that can never reach him.
--
-- ## The argument list changes, so both halves are dropped first
--
-- CLAUDE.md: `create or replace function` does not replace a function whose
-- argument list changed — it creates a second overload and calls become
-- ambiguous. **Check the public wrapper too**, which is the half that silently
-- drops a new parameter.

begin;

drop function if exists public.raise_proposals(int, int);
drop function if exists app.raise_proposals(int, int);

create or replace function app.raise_proposals(
  p_days             int default 30,
  p_min              int default 3,
  p_include_fixtures boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  t          record;
  v_new      int := 0;
  v_bumped   int := 0;
  v_silent   int := 0;
  v_title    text;
  v_remedy   text;
  v_arg      text;
  v_existed  boolean;
begin
  for t in
    select * from app.impediments_tally(p_days, p_min, coalesce(p_include_fixtures, false))
     where staff_slug is not null
  loop
    /*
      A declined proposal is left completely alone — not reopened, not
      re-counted, not re-delivered. Declining costs Grant one press and buys
      permanent silence on that subject, which is the whole point of the row.
    */
    if exists (
      select 1 from public.proposals
       where staff_slug = t.staff_slug and kind = t.kind and needed = t.needed
         and state = 'declined'
    ) then
      v_silent := v_silent + 1;
      continue;
    end if;

    /*
      Asked BEFORE the upsert. The first version asked afterwards, by looking
      for a row created in the last two seconds — which is a clock reading
      standing in for a fact the statement already knew, and would have
      miscounted a slow pass.
    */
    v_existed := exists (
      select 1 from public.proposals
       where staff_slug = t.staff_slug and kind = t.kind and needed = t.needed
    );

    v_title := format('%s cannot %s', initcap(replace(t.staff_slug, '-', ' ')), t.needed);
    v_remedy := case t.kind
      when 'missing_tool'     then format('Give this agent a tool that can %s.', t.needed)
      when 'missing_skill'    then format('The office has no way to %s at all — it needs building.', t.needed)
      when 'missing_data'     then format('Connect or supply the material needed to %s.', t.needed)
      when 'needs_permission' then format('Grant permission to %s.', t.needed)
      when 'ambiguous'        then format('Say which reading of "%s" is meant.', t.needed)
      else format('Decide whether the office should be able to %s.', t.needed)
    end;
    v_arg := format(
      '%s time(s) in the last %s day(s), across %s project(s). Most recently: %s',
      t.times, p_days, t.projects,
      coalesce(nullif(btrim(t.for_instance), ''), 'no detail recorded'));

    insert into public.proposals
      (staff_slug, kind, needed, title, remedy, argument,
       times_seen, first_seen, last_seen, for_instance)
    values (t.staff_slug, t.kind, t.needed, v_title, v_remedy, v_arg,
            t.times, t.first_seen, t.last_seen, coalesce(t.for_instance, ''))
    on conflict (staff_slug, kind, needed) do update
      set times_seen = excluded.times_seen,
          last_seen  = excluded.last_seen,
          argument   = excluded.argument,
          for_instance = excluded.for_instance
      -- Only while it is still open and unanswered. An approved or done
      -- proposal is history and must not be rewritten under Grant.
      where public.proposals.state = 'open';

    if v_existed then v_bumped := v_bumped + 1; else v_new := v_new + 1; end if;
  end loop;

  return jsonb_build_object('raised', v_new, 'updated', v_bumped, 'left_declined', v_silent);
end;
$$;

create or replace function public.raise_proposals(
  p_days int default 30, p_min int default 3, p_include_fixtures boolean default false)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog
as $$ begin return app.raise_proposals(p_days, p_min, p_include_fixtures); end $$;

grant execute on function app.raise_proposals(int, int, boolean) to ai_team_app;
grant execute on function public.raise_proposals(int, int, boolean) to ai_team_app;

commit;
