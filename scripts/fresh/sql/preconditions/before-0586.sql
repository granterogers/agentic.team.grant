-- ---------------------------------------------------------------------------
-- HISTORICAL PRECONDITION, applied immediately before migration 0586
--
-- 0586 takes suite traffic off Grant's activity panel, and its control is the
-- half that matters -- a filter that empties the panel is not an improvement:
--
--     if v_real = 0 then
--       raise exception 'the panel has nothing real left on it';
--
-- `public.events` is empty on a blank database. Nothing has happened, so the
-- panel is empty for the honest reason, and the control cannot tell that apart
-- from a filter that removed everything. It is right not to try.
--
-- Part of F-002. One event is scaffolded, on the scaffold project the
-- precondition before 0167 created, with an actor that carries no `verify`
-- label -- so `app.harness_label` leaves it alone and the panel has one row
-- the filter must not take. The actor NAMES itself as scaffolding, which is
-- the most this can honestly be: it is not Grant's activity, and the only
-- claim being made about it is the one the control makes, that something
-- survives the filter.
--
-- The substantive assertion above it is untouched in the direction that
-- matters: `v_harness > 0` still fails if any suite-labelled row reaches the
-- panel, and nothing here writes one.
--
-- Columns read from `pg_constraint`: `reversible` and `reversal_method` are
-- iff each other, `actor_kind` is one of user/agent/system, and `action_type`
-- is constrained to a dotted lower-case shape.
-- ---------------------------------------------------------------------------

/*
  AGAINST NO PROJECT, deliberately.

  0586's feed reads `where p.project_id is null or not p.is_fixture`, so an
  entry belonging to no project is exactly as visible as one on a real project
  -- and `public.events` is append-only, refusing UPDATE and DELETE alike, so
  an entry attached to a scaffold project could never be released again and
  would hold that project alive through `events_project_id_fkey` for ever.
  Anything this replay writes has to be removable by the teardown that follows
  it, and this is the only column that makes that true.
*/
insert into public.events
  (correlation_id, project_id, actor_kind, actor, trigger, action_type,
   occurred_at, rationale_summary, reversible)
select gen_random_uuid(),
       null,
       'system',
       'fresh-install-scaffold',
       'migration',
       'project.attached',
       app.now_utc() - interval '1 hour',
       'fresh-install baseline scaffolding: one entry so the activity panel is not empty',
       false
 where not exists (select 1 from public.events e where e.actor = 'fresh-install-scaffold');
