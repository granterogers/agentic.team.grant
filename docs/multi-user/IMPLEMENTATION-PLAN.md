# Implementation plan

> Design only. Baseline `41de1965`. Each phase below is independently verifiable and ends in a state where production
> is **consistent and safe to leave**. The one hard rule across all of them: **no second real office exists in
> production before Phase 12 is verified** (MIGRATION-PLAN §0.2). Phases 0–11 can only ever have Grant's office, a
> test office and, from Phase 10, the Sample office — and the Sample office cannot act outside (Phase 10 comes after
> containment).
>
> The sizing is from counted repository evidence (below), not from optimism. Where a number is not yet known, the plan
> says which phase measures it and does not guess.

## Counted evidence behind the sizing

| Quantity | Value | Source |
|---|---:|---|
| carriers needing `office_id` | 50 (41 new columns + 9 replacing text `owner`) | `TABLE-REVIEW-399.md` |
| tables to put RLS on | 46 (+ 56 office policies, replacing 116 `true` policies) | catalogue |
| gateway functions | 152 (92 id-taking, 60 listing), all `SECURITY DEFINER` | gateway map × `pg_proc` |
| `app` functions | 588 (518 definer); **the converted set is not yet derived** | P0 produces it |
| views | 14 (none `security_invoker`) | `pg_class` |
| `execute(` sites in `src/` | 502 in 95 files; 72 files name `public.` tables | grep |
| hard-coded `'grant'` sites | at least 9 (`pager.ts:86`, `vault-export.ts:61`, `progress.ts:101,329`, `preference-store.ts:45,146`, `telegram-webhook:501`, `voice:54`, config key `telegram.direct_to_grant`) | agent inventory, re-verified for `voice:54` |
| edge functions touched | 8 of 9 (`worker`, `hq-api`, `slack-events`, `telegram-webhook`, `voice`, `voice-token`, `signin`, `mcp`) | `supabase/functions` |
| job-creating SQL functions | 5 | grep of `src`+`supabase` |
| unique indexes to re-scope | 14 | `pg_indexes` |
| attacks / sabotages / positive tests | 30 + 29b / 19 / 10 | `ACCEPTANCE-PLAN.md` |

## Phase map

```
P0 spike ──┬─ P1 hotfix (E1,E2)  [independent; can ship first]
           └─ P2 offices ── P3 columns+backfill+constraints ──┬─ P4 RLS (#399)
                                                              ├─ P5 job creation + authority ── P6 retrieval
                                                              │                              └─ P7 gateway+views
                                                              └─ P8 channels + voice sessions
              P9 isolation suite  (begins at P2, completes after P8)
              P10 containment + Sample provisioning + acceptance      (needs P5–P9)
              P11 per-office credentials                               (needs P7)
              P12 contract + legacy retirement                         (needs P10 green)
```

---

## P0 — Spike and preconditions (no production change)

- **Objective.** Retire the assumptions the design rests on *before* anything is built, on the isolated replica.
- **Code.** Extend `scripts/isolated/` with two auth users and a gateway emulator that injects `p_office`; a throwaway
  scratch directory, not committed to the gate.
- **Proves, each as a pass/fail with evidence:**
  1. composite `MATCH SIMPLE` FK on `jobs` accepts the 7,243-style null-project job and rejects a cross-office one;
  2. PostgREST resolves `p_office`-first overloads next to the old ones by argument names (no ambiguity error);
  3. the append-only trigger suspension inside one transaction works and re-enables (`tgenabled='O'`);
  4. `EXPLAIN` of `search_documents` with `(office_id, …)` indexes is not slower than today on production-sized data;
  5. **E6**: read `src/mcp` and `supabase/functions/mcp` and `signin` for caller-supplied project/office handling
     (the one thing the research could not read);
  6. whether `track_functions` can be enabled, else the `events`-wrapper alternative;
  7. **derive the converted-function set**: a transitive call-graph query from the gateway map, the adapters and the
     worker's `app.*` calls over `pg_proc`/`pg_depend` bodies; the output is the baseline `check:office-scoped` holds;
  8. whether the worker's model seam (`src/providers/router.ts`) can host a recording provider for canary tests;
  9. the count of suites that depend on Grant's real data (decides D1's cost).
- **Migrations.** none. **Rollback.** delete the scratch. **Risk.** low.
- **Acceptance.** a written spike report; every assumption marked proven / disproven; the converted-set list exists.
  If (1) or (2) is disproven the design is revised *here*, at the cost of a document.
- **Safe to stop.** trivially.

## P1 — Hotfix track: close E1 and E2 (independent of `offices`)

- **Objective.** The two weaknesses that exist today and get worse the moment a second person is invited.
- **Code.** `voice-token`: require a valid session JWT (reuse `voice`'s `allowed()`); drop the `*` CORS default;
  build `instructions` from state the caller is entitled to. `voice`: replace `VOICE_SUBJECT` with the verified
  member's own `owner_key`. Both use the *existing* `office_member` lookup — no schema change.
- **Tests.** attack 29 (no token → 401), attack 17 (a second member's note is not attributed to Grant), a regression
  that `voice-token` with a valid session still mints.
- **Migrations.** none. **Deploy.** `npm run deploy:voice` (probes itself). **Rollback.** redeploy the previous version.
- **Risk.** low–medium: the standalone voice page and any phone shortcut that called `voice-token` unauthenticated will
  stop working — find them first (P0) and give them a session.
- **Acceptance.** E1 attack returns 401 against the deployed function with a real-origin probe.
- **Dependencies.** none. **This phase should not wait for the rest.** Safe to stop after it.

## P2 — Offices and Grant's binding (M1)

- **Code.** `provision_office` operator script (`npm run office:provision`); `check:office-integrity` skeleton with its
  positive control.
- **Migrations.** M1. **Tests.** unique binding; Grant and `verify-operator` bound; second binding rejected.
- **Rollback.** drop `offices`. **Risk.** low (nothing reads it). **Acceptance.** `offices` has the 2 expected rows.
- **Safe to stop.** yes — the table is unread.

## P3 — Columns, backfill, constraints (M2–M6)

- **Objective.** Every row owned, structurally.
- **Migrations.** M2, M3a/b/c, M4, M5, M6 (each separately applied and verified, in that order).
- **Code.** none in services except where the `dedupe_key` index change ships with P5.
- **Tests.** characterisation assertions inside each migration; per-table count snapshots before/after;
  `check:office-integrity` over every FK edge; **a backfill rehearsal on a replica loaded with a copy of production
  row *shapes*** (no data leaves production: the replica is built from migrations and populated by a generator that
  mirrors the measured distributions, plus a read-only characterisation run against production itself).
- **Rollback.** per MIGRATION-PLAN §6; all reversible.
- **Risk.** **HIGH — the one place a mistake is permanent in an append-only ledger.** Mitigations: aborts on unknown,
  rehearsal, the trigger-suspension assertion, `office_id` immutable only after the backfill is verified.
- **Acceptance.** zero null `office_id` on `NOT NULL` carriers; unbound channel rows are exactly the expected set;
  **`npm run gate` green and `check:leaks` unchanged**; old worker (still deployed) keeps running through every step.
- **Safe to stop.** after any migration.

## P4 — RLS for #399 (M7)

- **Migrations.** M7. **Code.** `app.act_as`, `app.current_office`; `check:anon-exposure` extended.
- **Tests.** `set role ai_team_app` with no `act_as` reads zero rows from every `SC` table; with `act_as(A)` reads A's;
  attacks 1, 2, 3, 8, 9, 19 on the RLS path; `check:anon-exposure` green.
- **Rollback.** restore saved policies. **Risk.** low (service paths bypass RLS) — and that is the reason to do it
  early: it carries the least blast radius of anything here and closes #399.
- **Acceptance.** all 46 tables RLS-on; 56 `SC` have the office policy; 73 `SO` have none; 0 tables reachable by a public key.

## P5 — Job creation and authority (M9.1, M9.2) — the centre of gravity

- **Code.** `JobContext` with a branded `OfficeId` (`src/jobs/context.ts`) constructed only from a database row;
  `dequeue_job` returns and filters on office state; the five job-creating functions stamp `office_id` and
  `enqueue_child` validates `p_project`; `hq_answer_blocker`, delivery press, undo, resume, standing grant/revoke and
  autonomy take `p_office`; `check:office-scope` ratchet baseline for `src/`.
- **Migrations.** M9.1, M9.2 (+ the three `dedupe_key` indexes from M6). **Deploy.** worker, then gateway.
- **Tests.** attacks 4, 5, 6, 7, 11, 12, 14, 20, 21, 25, 26, 27, 28 on the function path; P5/P6; the existing suites
  that touch jobs and approvals (`verify:addressing`, `approver-identity`, `exactly-once`, `fan-in-waits`,
  `recovery-matrix`, `approval-race.sh`) green against the new functions.
- **Rollback.** drop the new overloads; redeploy the previous worker (old overloads still serve it).
- **Risk.** **HIGH** — this is where "ownership survives the lifecycle" is proven or not; a wrong `where` is silent
  (N1). Every converted function gets an attack before it is merged.
- **Acceptance.** every child/retry/resume/recovery keeps its office; an answer from the wrong office is refused.

## P6 — Retrieval and model context (M9.3)

- **Code.** `search_documents`, `sibling_projects`, `projects_named_in`, `mail_for_project`, `project_knowledge`,
  `lessons_for`, `conversation_before`, `voice_state`/`voice_lookup`, and their TypeScript callers (`retrieve`,
  `retrieveAcrossOffice`, `guidanceFor`) take `JobContext`. A recording provider in the router for canary tests.
- **Tests.** attacks 9, 19, 30, P4, P7, P8; **canary test with its positive control**; the existing retrieval suites
  (`verify:unified`, the held-out routing corpora) green.
- **Rollback.** drop new overloads. **Risk.** medium–high: retrieval is the model-context boundary; a regression is
  quiet (a worse answer, not an error). Run the intelligence corpus (`tier1:fast`) before and after.
- **Acceptance.** zero foreign canary in any recorded request body; settled project-first policy behaviour unchanged.

## P7 — Gateway, views, remaining functions (M9.4, M9.5)

- **Code.** session → `offices` by auth uid with fail-closed `403 no_office`; **delete and overwrite** client-supplied
  office fields; cache stores `{office_id, kind}`; machine key requires `x-office-id`; the 60 listing functions and 14
  views converted; `check:office-scoped` in the gate; the page stops reading `hq.token`.
- **Migrations.** M9.4, M9.5. **Deploy.** `deploy:hq` (page + hq-api); note #399.1: `VERCEL_TOKEN` is absent in the
  build session, so the page deploy needs the operator.
- **Tests.** attacks 1–3, 8, 24, 28, 29, 29b on the gateway path; the full existing UI gate (`verify:hq`, `verify:ui`,
  `verify:wired`) since nearly every screen's data path changes — **this is a UX-QA Level 2 trigger** (auth/connection
  flows and the data layer of every screen change).
- **Rollback.** redeploy the previous gateway/page; old overloads still serve it.
- **Risk.** **HIGH** in breadth (152 functions), medium in depth (mechanical). **Acceptance.** every gateway function
  is on the derived list as scoped or reasoned-system.

## P8 — Channels and sessions (M9.6, voice)

- **Code.** `subject_identities.office_id`; `telegram_chat_for(p_office, …)` with no `or subject is null`; the nine
  hard-coded `'grant'` sites replaced by the requester on the job/output; per-office `telegram.direct_to_grant` /
  `only_chief_speaks` via `office_settings`; Slack "workspace office = sender office"; `voice_sessions` and
  `voice_state(p_office)`; the Slack lifecycle-event workspace check (E4).
- **Tests.** attacks 15, 16, 17, 18 with a Slack/Telegram **edge emulator** (`scripts/isolated/edge-emulator.ts`
  already refuses every URL that is not the replica); `check:leaks` and `check:chatter` unchanged.
- **Rollback.** per function. **Risk.** medium. **Acceptance.** an unknown Slack/Telegram sender is dropped and
  audited; Grant's own Slack/Telegram/voice behave exactly as before (acceptance-plan P9).

## P9 — The isolation suite (starts at P2, completes after P8)

- **Code.** `scripts/verify/user-isolation.ts` (L1 replica, L2 live); `--prove-it` automating the break/red/restore/green
  loop; the 19 sabotages as scripted edits that **print proof they landed**; `check:uniqueness-scoped`.
- **Built incrementally:** each of P3–P8 adds its attacks and sabotages in the same commit as the code it protects, so
  no converted function ever exists without an attack that can fail it.
- **Acceptance.** 31 attacks defeated, 10 positives pass, 19/19 sabotages red, `--prove-it` green.

## P10 — Containment, Sample, acceptance (M10)

- **Code.** `may_act_outside` + `offices.kind`; `provision_office` for `sample`; `npm run sample:provision|reset|verify`;
  `app.seed_age`, `app.purge_sample_office` and the narrow ledger exceptions; recording-provider canary flow.
- **Migrations.** M10. **Tests.** attacks 22, 23; reset controls; the Sample → Claire → Specialist → Result chain.
- **Rollback.** `purge_sample_office`; restore `may_act_outside`. **Risk.** medium: the ledger exception (N4) is the
  one deliberate hole in evidence tables; its control test must be red when pointed at a `person` office.
- **Acceptance.** `SAMPLE-ACCOUNT-DESIGN.md` §4 chain green; Grant's office has zero new rows across the run.

## P11 — Per-office credentials (M8, M9.7)

- **Code.** `office_credentials`, `office_secret`; move Google/Notion/Vikunja/NotebookLM/Slack/GitHub-read secrets
  behind refs for Grant (**operator-confirmed**, D4); stop reading fixed names for per-office integrations.
- **Why late.** Neither Grant nor the Sample needs it to be correct today; a *second real human* does. It is the gate
  before inviting one. **Risk.** medium (it touches live credentials). **Rollback.** fixed names retained until M11.
- **Acceptance.** attack 13 defeated; a test office connects a fake provider without touching Grant's slot.

## P12 — Contract and retirement (M11)

- **Preconditions** are mechanical (MIGRATION-PLAN M11). **Code.** remove the legacy-token path, `VOICE_SUBJECT`,
  `telegram.direct_to_grant`, `office_members`. **Risk.** the only irreversible step; snapshot first.
- **Acceptance.** the suite and the gate green with the old overloads gone; seven days of no old-overload calls.
- **Safe to stop.** this is the end.

---

## Estimate (by phase and risk, not hours)

Sizes are relative effort in *focused implementation sessions* of the kind this repository already runs, with the
uncertainty stated. They are dominated by the function-conversion phases because those are where the unmeasured set is.

| Phase | Size | Risk | Dominant uncertainty |
|---|:-:|:-:|---|
| P0 spike | S (1) | low | whether the overload and `MATCH SIMPLE` assumptions hold |
| P1 hotfix | S (1) | low–med | callers of `voice-token` that rely on no auth |
| P2 offices | S (1) | low | — |
| P3 backfill + constraints | **L (3–4)** | **high** | the "else abort" residue: unknown until the characterisation runs against each table's real rows |
| P4 RLS | M (2) | low | 56 policies are mechanical; the `exists` helpers' performance |
| P5 jobs + authority | **XL (4–6)** | **high** | size of the derived function set; raw SQL in handlers |
| P6 retrieval | **L (3)** | med–high | quiet regressions in answer quality |
| P7 gateway + views | **XL (4–6)** | **high** (breadth) | 152 functions + 14 views + a UX-QA Level 2 |
| P8 channels + voice | L (3) | med | Slack/Telegram edge cases in the emulator |
| P9 suite | L (3, spread across the above) | med | making 19 sabotages each demonstrably red |
| P10 Sample | M (2) | med | the ledger exception; aging |
| P11 credentials | M (2) | med | live-credential moves |
| P12 contract | S (1) | high but gated | 7-day evidence |
| **Total** | **≈ 30–40 sessions** | | the range is honest: it is a *count of work packages with a stated range*, and P0 narrows it. |

**What would make the estimate wrong:** the converted-function set is far larger than the 152 gateway functions imply
(it is *derived* in P0 precisely because it is the largest unknown); the characterisation finds unclassifiable
historical rows in a ledger (P3 stalls on a human decision, not on work); a UX-QA Level 2 finds regressions in screens
whose data path changed (P7).

**What to do if time forces a cut.** Stop after **P4 + P5 + P6**: that closes #399, makes ownership structural, and
scopes the model's context, with no second human yet — a strictly safer system than today, and nothing later is blocked.
Do **not** invite a second real person before P8, P9, P11 and P12.
