# Behavioural remediation, 24–25 September 2026 — integration handoff

Branch `claude/jolly-darwin-8rwmp3`, based on `main` at `d1c9247`. **Nothing here
is deployed.** Canonical production was not touched: no migration was applied,
no function or worker was deployed, no secret or allow-list was changed.
Findings, evidence and verdicts: `docs/testing/behavioural-remediation-2026-09-24.md`.

## Deploy order — this matters

1. **Apply the migrations first**, in order: `0592` → `0598`. They were proved
   inside transactions that rolled back; none is in `app.schema_migrations`.
2. **Then deploy the worker** (`npm run deploy:worker`).
3. **Then** deploy the voice function only if you also want the probe renames.
   `scripts/deploy/voice.ts` now names its probe session `verify-deploy-…`.

Why the order:

- **0598 must be in before anyone runs `deploy:voice` from `main`.** On `main`
  the deploy probe posts `deploy<ms>` to the live voice door, and that answer
  reaches Grant's real Telegram and Slack. It has done so 18 times since 13 Sep
  (R37). The branch's copy of the deploy script is already safe without 0598.
- 0592 (retry idempotency) is what stops a gate-refused attempt from writing a
  second copy of a task. It was observed again tonight: one turn, two tasks
  (R43 note).
- 0593's new `my_task_referent` signature is used by the branch.
  `referentCandidates` falls back to the old one if it is absent, so a
  worker-first deploy degrades rather than breaking settles and named changes
  (R42). Migrations-first is still the intended order.
- 0597 must be in before R24 reminders can fire for anything a harness made.

| migration | what it changes | proved |
|---|---|---|
| 0592 | `my_task_add` / `task_add` return the same job's task by title; the same conversation's within 10 min (`repeated`); a harness job's personal task is stamped `verify:grant` | `verify:retry-writes` 6/6 with it, 1/6 live |
| 0593 | `my_task_referent(uuid, interval, p_any_task)` with `candidates`; a harness turn sees harness tasks | `verify:task-state` 8/8; control goes red under sabotage |
| 0594 | `my_tasks` / `my_tasks_counts` treat cancelled as not open | proved in rollback |
| 0595 | `enqueue_child_once` reuses the same parent's complete child | proved in rollback |
| 0596 | `FOR UPDATE` in `hq_answer_blocker` and `decide_suggestion` | `verify:approval-race` reproduces the double answer live |
| 0597 | `reminders_due`, `tasks_to_push` ask `app.harness_task` | proved in rollback |
| 0598 | `app.harness_voice_session`, ORed into `app.harness_job`; the post-guard escapes recorded in `known_escapes` (#354) | rollback: known 22→38, new 0, 6 page sessions stay real; the sabotaged predicate is refused |

## Shared files changed

- `src/handlers/instruction.ts`: many wirings, each commented with its ledger
  row (R1–R43).
- `src/agents/quality.ts`: `claimsToHaveChangedTask`, `readNothing`,
  `wrongWeekday`, derivable dates.
- `src/jobs/worker.ts`: `tasksChanged`, `withoutStrayQuotes`.
- `src/agents/{mine,tasks,extract,calloff,correction,outcome,request,goal,teaching,actions,negation}.ts`.
- New: `derivable`, `remind-at`, `named`, `dictation`, `spoken-answer`,
  `not-a-request`, `stray-quotes`.
- `scripts/check-leaks.ts`: an adapter-shape witness that does not ask
  `harness_job`.
- New gate check: `scripts/check-voice-sessions.ts`.
- `scripts/verify/{escapes,scenario-a,latency}.ts`, `scripts/deploy/{voice,voice-basecamp}.ts`.

No frontend file was changed. The UX branch items are listed in the ledger as
`UX BRANCH HANDOFF:`.

## Before merging, run

```bash
npm run lint && npm run typecheck && npm run test        # 3452 tests at handoff
npm run check:migrations && npm run check:secrets && npm run check:templates
npm run check:voice-sessions && npm run check:leaks      # leaks: expect "N known, 0 new" on both witnesses
```

## Things a reviewer should know

- **This session caused real contact once.** `verify:scenario-a`, run in-process
  at 22:12 on 24 Sep, delivered 6 messages to Grant (4 Slack, 2 Telegram)
  before the class was understood (R37). No other run of this session reached
  anyone. The witness now counts it, and it is kept as evidence.
- **`verify:latency` messages Grant as Grant, by design.** It now refuses
  without `--sends-to-grant` (R41).
- Negative results are recorded rather than shipped: R40 (booking
  overpromise, zero real exposure) and R44 (false absence against a read
  document; the detector measured at ~12/13 false).
