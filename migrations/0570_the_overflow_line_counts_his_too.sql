-- 0569 taught public.needs_me to leave harness blockers out. Its companion
-- still counted them.
--
-- app.needs_me_pressure answers "how much is being held back, and how old the
-- oldest is" -- #272 -- and the morning briefing prints it as "N more sit on
-- the dashboard". It read public.blockers directly with no filter, so the view
-- and the overflow line were about two different populations from the moment
-- 0569 applied: four things waiting on him, and fifty more allegedly behind
-- them.
--
-- Both halves right alone and only their disagreement wrong, which CLAUDE.md
-- records as the hardest kind to see and the reason its rule is to grep for
-- the function that reports the same thing whenever a filter changes.
--
-- Same predicate, same asymmetry: a blocker with no job is kept, because the
-- filter may only ever exclude and must never hide a genuine request.

create or replace function app.needs_me_pressure()
returns table(open_items integer, cap integer, suppressed integer, oldest_days numeric)
language sql
stable
security definer
set search_path to ''
as $fn$
  select
    count(*)::int,
    app.needs_me_cap(),
    greatest(count(*)::int - app.needs_me_cap(), 0),
    coalesce(round(extract(epoch from (app.now_utc() - min(created_at))) / 86400, 1), 0)
  from public.blockers
  where state = 'open'
    and not coalesce(app.harness_job(job_id), false);
$fn$;

comment on function app.needs_me_pressure() is
  'How much is waiting on Grant beyond what the briefing names, and how old the '
  'oldest is (#272). Counts the same population as public.needs_me (0570): '
  'before that they disagreed, and the briefing told him fifty more were behind '
  'four.';

-- Drive it: the two halves must now agree about how many things are his.
do $drive$
declare
  v_view int;
  v_open int;
begin
  select count(*) into v_view from public.needs_me;
  select open_items into v_open from app.needs_me_pressure();
  if v_view <> v_open then
    raise exception 'needs_me shows % and needs_me_pressure counts % -- they must be one population',
      v_view, v_open;
  end if;
  raise notice 'both halves agree: % waiting on him', v_view;
end
$drive$;
