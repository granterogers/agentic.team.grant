# ADR-0043 — Supabase is the task list; a provider is a projection

**Status:** accepted · 20 September 2026 · #259 Phase 2 ·
migrations 0513, 0518–0522

## The decision

`public.tasks` is the task list. Vikunja — or any future provider — holds a
COPY, and the office keeps the copy in step. Four consequences follow, and each
is enforced somewhere rather than written down and hoped for:

1. **A provider is never consulted to answer "what is on Grant's list".** That
   is `app.my_tasks`, always. Nothing in `TaskProvider` returns a canonical id,
   because a provider does not have one.
2. **Sync metadata never touches the canonical row.** `public.task_links` holds
   the external id, the watermark, the state and the error; `public.tasks`
   gains exactly one column for this, `revision`, and it is about the task
   rather than about any provider. `verify:vikunja` asserts no provider field
   has leaked onto a task row.
3. **A genuine conflict is resolved toward the office, and recorded.** When
   both sides changed since the last sync, `app.task_pulled` KEEPS the
   canonical value and sets `sync_state = 'conflict'` with a sentence. It does
   not advance the watermark, so the task is still offered for push and the
   next round resolves it in the direction this ADR requires.
4. **Disconnecting loses nothing.** `app.hq_forget_vikunja` removes the links,
   the address and the credential, stops the duty, and reports how many tasks
   it kept. `verify:vikunja` counts them before and after.

## Why not the other way round

A task manager with a better UI than ours exists, and the tempting shape is to
let it own the data and render it here. Three reasons not to:

- **Everything else the office does joins to `public.tasks`.** The human-action
  bridge (ADR-0041), the reminders duty, the conversational creation path, the
  chores, the job that a blocked handler turns into something Grant can answer.
  A remote list makes every one of those a network call that can fail.
- **A provider Grant stops paying for would take the list with it.** The
  office's memory is the thing that must not be rentable.
- **Two writers and no owner is how a list disagrees with itself.** Somebody
  has to win a tie, and the answer has to be the same every time.

## What this costs, stated

- **A date here is an instant there.** `tasks.due_on` is a `date`; Vikunja's
  `due_date` is a timestamp. The office writes midnight UTC and reads back the
  date part, so a time set inside Vikunja is lost. Losing a time the office has
  nowhere to put beats inventing a `due_on` a day either side of it.
- **A priority set nowhere stays nowhere.** Vikunja's 0 means "nobody said",
  not "lowest", so it is mapped to null and the canonical value is left alone.
- **A tombstone protects only while the deletion is OUTSTANDING.** Once every
  provider has been told, "Grant deleted this" becomes history; a task the
  provider presents afterwards is a new task and is accepted. Matching
  tombstones on TITLE for ever is the alternative, and titles normalise,
  collide, and change.
- **A round is global.** `app.tasks_to_push` takes no scope and should not get
  one — the office runs it for the whole list, and a scope added for a test's
  convenience would be a path nobody runs.

## How it is proved

`npm run vikunja:dev` runs the released Vikunja binary locally on SQLite;
`npm run verify:vikunja` drives the whole contract against it over HTTP —
create, edit, complete, reopen in both directions, idempotency, deletion,
outage, reconnection, conflict, disconnection — and asserts that no task the
run did not create was altered. It is deliberately NOT in the readiness gate:
it needs a server the gate cannot start, and a gate entry that silently skips
is worse than no entry.
