# P3 conversion recipe

How a legacy-unscoped function becomes an office-explicit one. Written after the pilot (the task cluster, migrations
0669-0670, `scripts/isolated/p3-cases/10-tasks.ts`) so that further clusters are converted the same way, by anyone.

**The rule.** `IDENTITY -> TRUSTED OFFICE CONTEXT -> RESOURCE CHECK`. A caller-reachable function receives `p_office` from
a trusted component (the gateway from a verified login; the worker from a claimed job) and checks every row it touches
against it. It never receives a resource and *derives* the office from it. A foreign id and a nonexistent id must produce
the same answer.

## 0. Tools

```bash
npx tsx scripts/p3/getdef.ts /tmp/defs app.some_fn public.some_fn   # the LIVE definition, to a file (read-only on production)
npx tsx scripts/p3/callers.ts some_fn                                # DB callers + every repository reference
npx tsx scripts/p3/inventory.ts --json /tmp/inv.json                 # the classification of all functions
scripts/isolated/p3-attack.sh p3_attack_<yourname>                   # a throwaway clone: replica + every migration >= 0654
npx tsx scripts/isolated/p3-app-attack.ts p3_attack_<yourname> [file-fragment]
P3_DB=p3_attack_<yourname> npx tsx scripts/check-office-callers.ts [--fix-suites]
P3_DB=p3_attack_<yourname> npx tsx scripts/check-office-gateway.ts   # (the lead runs --fix after merging; do not edit hq-api)
npx tsx scripts/isolated/office-ownership.ts p3_attack_<yourname>    # the P2 suite: must stay 96/96
```

Never write to production. Reading it (`npm run qq -- "select ..."`, `getdef.ts`, `callers.ts`) is fine.

## 1. Shape of a converted function

```sql
-- app side: the implementation
create function app.thing(p_office uuid, <the old arguments, unchanged, defaults kept>)
...
begin
  perform app.require_office(p_office);                 -- first statement: null / missing / disabled => 'no_office'
  ... every read:   from public.t where t.office_id = p_office and ...
  ... every write:  insert into public.t (office_id, ...) values (p_office, ...)   -- explicit, so the bridge is not used
  ... update/delete: where ... and office_id = p_office
end

-- public side: the door (only if the gateway reaches it)
create function public.thing(p_office uuid, <same arguments>) returns jsonb language sql security definer
  set search_path to 'public','pg_catalog' as $f$ select app.thing(p_office, ...) $f$;
-- then, for EVERY new public function:
revoke all on function public.thing(uuid, ...) from public, anon, authenticated;
grant execute on function public.thing(uuid, ...) to service_role;
-- and revoke app functions from public, anon, authenticated, service_role
drop function public.thing(<old signature>);  drop function app.thing(<old signature>);
```

* `p_office` is FIRST, named exactly `p_office`, **no default**. `check:office-edges` refuses any other shape of
  office-taking public function, and refuses one a browser role can execute.
* Drop the old signatures in the same migration. A second overload makes calls ambiguous and keeps a legacy door open.
  (The release procedure pauses the worker so the drop and the deploy land together.)
* Splice, do not retype, a long function: `getdef.ts`, then a script that applies targeted `replace`s **with a count
  assertion**, as the pilot did. A function rewritten from memory loses behaviours (CLAUDE.md, `app.pause_job`).
* Name arguments at call sites when a signature passes about four.

### Resolving a resource inside the office

```sql
v_project := app.project_in_office(p_office, p_ref);     -- slug or uuid text; null when absent OR another office's
select ... from public.tasks t where t.task_id = v_id and t.office_id = p_office;
```

A foreign row and a missing row must take the same branch and return the same sentence. If the function used to say
"no such X" for a missing id, it says exactly that for a foreign id: do not add a "that belongs to another office" message.
Do not let a `23503` surface as a different answer than "not found".

### Derived tables (no `office_id` column)

Join through the carrier: `join public.projects p on p.project_id = x.project_id and p.office_id = p_office`. A derived
table reached by its own key alone (`where x.id = $1`) is the slug-only lookup this phase exists to remove.

### Internal helpers

* A helper called only by converted functions that already hold a validated `p_office` takes `p_office` too and writes
  `office_id` explicitly. Do not make it derive the office from the row it was handed.
* `app.job_office(job)` is the only way internal code gets an office without being handed one: the worker passes the
  CLAIMED job (`app.job_office(${lit(job.jobId)}::uuid)`), never an id taken from model output or a request.
* `app.office_actor(p_office)` replaces the literal `'grant'` that writers stamped as the actor.
* A literal `'grant'`, a `default 'grant'`, or `coalesce(x, 'grant')` in code you convert is an ambient identity: remove it.
* Shared helpers with many callers (`app.undo_offer`): add the office-explicit overload (done for `undo_offer`), convert
  your callers to it, and leave the old overload for the lead to drop when its last caller moves.

### Dispatchers (`app.hq_undo`)

`hq_undo(p_office, id)` exists and checks the action is the office's. A cluster that owns an undo branch must edit
the branch by **splicing the live definition inside the migration** and asserting the splice landed:

```sql
do $m$ declare v text; begin
  v := pg_get_functiondef('app.hq_undo(uuid,text)'::regprocedure);
  if position('app.hq_rename_project(v_args ->> ''p_slug''' in v) = 0 then raise exception 'splice anchor missing'; end if;
  v := replace(v, 'app.hq_rename_project(v_args', 'app.hq_rename_project(p_office, v_args');
  execute v;
end $m$;
```

## 2. TypeScript and suites

* Worker handlers: `app.fn(app.job_office(${lit(job.jobId)}::uuid), ...)` or `p_office => app.job_office(...)`. tsc finds
  typed callers; `check-office-callers` finds the SQL strings tsc cannot see. Both must be clean.
* Suites and scratch scripts that do not care which office: `check-office-callers.ts --fix-suites` rewrites them to the
  TEST office (`app.test_office()`), which is where harness traffic belongs. A suite that asserts on Grant's data must
  say so explicitly with his office id.
* Tests that read source text and pin an expression are wording locks: update them to assert the property (the office is
  passed from the claimed job), not the characters.
* Do NOT edit `supabase/functions/hq-api/index.ts`: the lead runs `check-office-gateway.ts --fix` after merging, which
  marks every entry whose function now takes `p_office` with `office: true`.

## 3. The attack cases (mandatory, per cluster)

Add `scripts/isolated/p3-cases/NN-<cluster>.ts` exporting `cases(ctx)`. Person A and B already exist (`ctx.A`, `ctx.B`),
each with a project the SAME slug; create what you need in both with different canary text (`ctx.canary.A/.B`). For
every converted function, as A, against B's ids and B's slug:

1. a foreign id and a nonexistent id (`ctx.nobody()`) give byte-identical answers (`ctx.json`);
2. B's rows are unchanged afterwards (`ctx.snapshot(B, [tables])` before/after);
3. a reader's output never contains B's canary (and A's does contain A's: a reader that returns nothing proves nothing);
4. a null office, a nonexistent office: `no_office`;
5. `anon` and `authenticated` cannot execute the public door;
6. the converted writers added no `office_bridge_use` rows (the meter is cumulative, so compare before/after in your clone);
7. the positive control: the same call as the right office WORKS.

**Sabotage.** For each cluster, prove at least two checks can fail: apply a copy of your migration with one
`office_id = p_office` removed (print something that proves the edit landed), run the cases, confirm RED, restore.
A sabotage that did not apply is not a passing control (CLAUDE.md).

## 4. What to hand back

Branch with commits, and a note listing: functions converted (both schemas), migration files, repository call sites
changed, anything deferred and why (e.g. a function reachable only by a deployment-level duty), anything you found that is
a defect in the original, the cases file, sabotage results, and the exact commands you ran with their results. Do not
claim a gate you did not run.

## 5. Things that will bite (from the pilot)

* `create or replace` with a changed argument list makes a second overload; `drop function` by the exact old signature.
  `drop function if exists` with the wrong list matches nothing and says nothing.
* A data-modifying CTE's rows are invisible to the rest of its statement; an unreferenced CTE is not executed (a gate
  CTE that nothing reads gates nothing: put `app.require_office(p_office)` in the predicate).
* `app.test_office()` is the test office. `app.unnamed_project()` has no office argument yet: do not call it from a
  converted function without an office (the lead converts it).
* PostgREST exposes only `public`; every gateway-reachable function needs a public wrapper.
* The Management API returns the FIRST statement's result, `PgExecutor` the LAST.
* No backticks inside comments inside template literals in TypeScript.

## 6. Learned in the first wave (read before you start)

* `check-office-callers.ts` now flags a ZERO-argument call to a name that has no zero-argument form (the old
  `app.hq_studio()` shape) and scans the bodies of database functions too. A first argument written `${...}`, or
  anything mentioning `office`, is still ACCEPTED unseen: grep your function names yourself and read each hit.
* Where a worker handler holds a job, pass `app.job_office(<job id>)`. Never an id taken from a request, a model answer or
  a payload field.
* The unscoped views `public.needs_me`, `today`, `undo_offers`, `delivery_health` were left alone. The office-scoped
  replacements are `app.needs_me_in(p_office)`, `today_in`, `undo_offers_in`, `delivery_health_in` (migration 0750). Use them.
* `app.office_sees_the_deployment(p_office)` is how a function decides whether a deployment-level reading (database size,
  backups, the build log) may be shown: operators and the system/test offices only.
* A CONSTRAINT or a UNIQUE index that is global (a provider's file id, a workspace primary key) is a P2 follow-up: guard your
  `ON CONFLICT DO UPDATE` with the office and report the global key, do not widen the migration to rebuild it.
* Public wrappers left behind for a converted app function are a defect (`public.task_pulled(text,text,jsonb)` called a
  function that no longer existed). After converting, run `psql ... -c "select n.nspname||'.'||p.proname from pg_proc p ..."`
  for every name in your list and confirm each remaining overload either takes `p_office` first or is a deliberate GLOBAL.
* The attack harness's own cases are not idempotent on a used clone: rebuild (`p3-attack.sh <name>`) before a full run.
* Several suites share template loops over many functions; merge conflicts there are likely and are the lead's to resolve.

## 7. Inline SQL in handlers, agents, channels and adapters

* A statement inside a claimed job is confined with `office_id = app.job_office(<job id>)`; a press or workspace uses its own
  office (`c.office_id`, or `workspaceOffice(teamId)`). Derived tables with no `office_id` are reached through a carrier
  (a project of the office, or the workspace `team_id`).
* A statement keyed by the claimed row, or a deployment scan, keeps its SQL and carries a `raw-sql[2|3]: <reason>` comment
  right above it; the baseline entry gets the same reason.
* Never nest one template literal inside another: the ratchet's regex truncates the statement. Precompute the fragment.
* Replace the literal `'grant'` with `app.office_actor(office)`.
* Proof: `scripts/isolated/p3-cases/95-raw-sql-handlers.ts` and `tests/handlers/raw-sql-names-the-claimed-office.test.ts`.
