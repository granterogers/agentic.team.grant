-- The proof 0454 said it did not have (#272).
--
-- 0454 dropped three public wrappers over the superseded task API and left the
-- `app.*` functions, on the reasoning that a function is one grep away from
-- provably dead and a migration should not guess.
--
-- `check:callers` then named two of them: with the wrappers gone,
-- `app.project_tasks` and `app.set_task_state` are reached by nothing at all —
-- no application code, no operator command, no other function's body, no
-- trigger. That is the proof, produced by the check rather than by reading,
-- and it is why the wrappers went first.
--
-- `app.add_task` is NOT dropped: it is still named by something, so the same
-- evidence does not exist for it. It stays in the baseline with that reason.

drop function if exists app.project_tasks(uuid);
drop function if exists app.set_task_state(uuid, text, text);
