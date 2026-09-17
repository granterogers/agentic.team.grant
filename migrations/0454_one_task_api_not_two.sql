-- The older task API, which nothing calls (#272).
--
-- There are two families. `app.task_add` is the live one: `hq_task_add` wraps
-- it, the gateway exposes it as the `task_add` action, and the studio's Tasks
-- tab presses it. `app.add_task`, `app.project_tasks` and `app.set_task_state`
-- came first and were superseded — nothing in `src/`, `web/`,
-- `supabase/functions/` or any operator command names them.
--
-- Their PUBLIC wrappers are dropped here. Three doors onto a superseded API
-- are three ways for a future caller to reach the wrong one, and CLAUDE.md
-- already records what two implementations of one concept cost: 0365's
-- pre-check that existed on one of two writers, and `what_i_can_do` in 0452
-- two migrations ago.
--
-- The `app.*` functions are left alone deliberately. They are one grep away
-- from being provably dead, and dropping a function on the same afternoon its
-- wrapper went is how a migration takes something that turns out to be called
-- from a trigger. The wrappers are the part that is certainly unused, because
-- PostgREST is the only thing that can reach them and no caller exists.

drop function if exists public.add_task(uuid, text, text, text, date, text);
drop function if exists public.project_tasks(uuid);
drop function if exists public.set_task_state(uuid, text, text);
