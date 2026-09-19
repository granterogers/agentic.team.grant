/*
  `check:leaks` calls a project removable that nothing can remove.

  0509 taught `app.project_delete` to refuse a project holding a row in
  `public.decisions` — the foreign key is ON DELETE SET NULL, the table is
  append-only by master spec section 6, so the cascade's own UPDATE is refused
  and the project is permanent history. `app.project_debris()` did not learn
  the same thing, so `npm run check:leaks` listed two such projects as LEAKs, a
  sweep tried both, both refused with 0509's sentence, and the check exited 1
  with "2 removable debris project(s) left".

  That is a check that cries wolf on a state nobody can clear, which CLAUDE.md
  is blunt about: a measurement Grant learns to ignore is worse than none. The
  function already has the category — a project carrying a JOB is reported as
  *"history, not a leak"* — and a decision belongs in it for exactly the same
  reason, in the same words: it can never be deleted, so it is not debris
  somebody failed to sweep.

  The `docs`/`jobs` counts are the reason the report can say WHY a project is
  pinned, so `decisions` gets a column of its own rather than being folded into
  the boolean, and the two callers keep working because it is added at the end
  of the row type.
*/

drop function if exists app.project_debris();

create function app.project_debris()
returns table(slug text, status text, docs integer, jobs integer,
              decisions integer, removable boolean)
language sql
stable
security definer
set search_path = ''
as $function$
  select p.slug, p.status,
         (select count(*) from public.documents d where d.project_id = p.project_id)::int,
         (select count(*) from public.jobs j where j.project_id = p.project_id)::int,
         (select count(*) from public.decisions x where x.project_id = p.project_id)::int,
         not exists (select 1 from public.documents d where d.project_id = p.project_id)
           and not exists (select 1 from public.jobs j where j.project_id = p.project_id)
           /*
             0510. A decision pins a project the way a job does: the reference
             can only be cleared by an UPDATE, and `public.decisions` refuses
             one. `app.project_delete` says so in a sentence since 0509; this
             is the same fact on the reporting side, so the sweep never tries.
           */
           and not exists (select 1 from public.decisions x where x.project_id = p.project_id)
    from public.projects p
   where not p.is_fixture
     and p.status = 'archived'
     /*
       The shapes a harness leaves. Deliberately a list rather than "anything
       archived": `ai-learning-two` and `ai-learning-superseded-2026-09-07` are
       real history and must never be swept.
     */
     and (p.slug like 'newsroom-%' or p.slug like 'gate4-probe-%'
          or p.slug like 'clash-%' or p.slug like 'untitled-notebook-%'
          or p.slug like 'dbg-%' or p.slug like 'probe-%')
   order by p.slug
$function$;

grant execute on function app.project_debris() to ai_team_app, service_role;

/*
  Drive it against the two real rows that caused this, without creating
  anything: both are archived `probe-waiting-%` projects holding one decision
  each, and neither may be reported as removable.
*/
do $drive$
declare
  v_bad int;
begin
  select count(*) into v_bad
    from app.project_debris() d
   where d.removable and d.decisions > 0;
  if v_bad > 0 then
    raise exception '0510: % project(s) holding a decision are still called removable', v_bad;
  end if;
  raise notice '0510: no project holding a decision is reported as removable';
end
$drive$;
