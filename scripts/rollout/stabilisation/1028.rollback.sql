-- ROLLBACK for migration 1028: removes the two functions 1028 ADDED. 1028 changed no existing object, so the predecessor state is
-- "these two functions do not exist". Roll back hq-api FIRST (its `thinking` section calls public.cannot_think): dropping the
-- function while the gateway still calls it would make every thinking read fail. Data: none changes. Apply only with
-- scripts/rollout/step.ts, which refuses unless the gateway no longer references the function.

begin;

drop function if exists public.cannot_think(uuid);
drop function if exists app.cannot_think(uuid);

commit;
