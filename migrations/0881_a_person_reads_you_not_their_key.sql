-- The person who taught the office something reads as "you", not as an internal owner key (#418).
--
-- Seen as the Sample on 4 October: Settings > What it has learned said "Learned by p4-second-person" under every rule, and
-- Latest activity said "P4 second person learned something". `lessons.learned_by` and `events.actor` carry the office's
-- owner key (the same string `app.office_actor` returns), which is the right thing to STORE (it is provenance) and the wrong
-- thing to SHOW. Three readers put it on a screen as `who`:
--   * app.hq_governance      Settings > What it has learned (and the rest of the governance page)
--   * app.hq_studio_lately   the home screen's Latest activity
--   * app.studio_activity    a project's Latest activity
-- The derived lines of studio_activity already say "you" for the person (0871: a task or contact the person added); only
-- the ledger path printed the key. Same rule here: the office's own person is "you", a staff member keeps their slug (the
-- page resolves it to a name), and anything else (a duty, a service) is left exactly as it was.
--
-- Presentation only. Nothing stored changes, and the key still travels in the audit trail; a person is only ever "you" to
-- THEMSELVES, because app.office_actor is asked about the office the reader is answering for, never the caller's.
--
-- Spliced from the LIVE definitions (these are long functions with a history of their own), each anchor asserted to occur
-- exactly once, so a definition that has moved on makes this refuse rather than patch something it did not read.

begin;

do $m$
declare
  v_fix record;
  v_def text;
  v_count integer;
begin
  for v_fix in
    select * from (values
      ('app.hq_governance(uuid, integer)',
       $a$'who', l.learned_by,$a$,
       $r$'who', case when l.learned_by is not distinct from app.office_actor(p_office) then 'you' else l.learned_by end,$r$),
      ('app.hq_studio_lately(uuid, integer)',
       $a$'who', k.actor,$a$,
       $r$'who', case when k.actor is not distinct from app.office_actor(p_office) then 'you' else k.actor end,$r$),
      ('app.hq_studio_lately(uuid, integer)',
       $a$'who', f.actor,$a$,
       $r$'who', case when f.actor is not distinct from app.office_actor(p_office) then 'you' else f.actor end,$r$),
      ('app.studio_activity(uuid, integer)',
       $a$select e.actor as who,$a$,
       $r$select case when e.actor in (select slug from staff_slugs) then e.actor
                    when e.actor is not distinct from app.office_actor(proj.office_id) then 'you'
                    else e.actor end as who,$r$)
    ) as t(fn, anchor, repl)
  loop
    select pg_get_functiondef(v_fix.fn::regprocedure) into v_def;
    v_count := (length(v_def) - length(replace(v_def, v_fix.anchor, ''))) / length(v_fix.anchor);
    if v_count <> 1 then
      raise exception '%: expected the anchor % exactly once, found % times', v_fix.fn, v_fix.anchor, v_count;
    end if;
    execute replace(v_def, v_fix.anchor, v_fix.repl);
  end loop;
end
$m$;

commit;
