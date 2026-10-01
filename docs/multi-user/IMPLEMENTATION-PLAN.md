# Implementation plan

> **P0 and P1 are done** (`P1-CLOSURE.md`). One change to the plan as written: the P1 guard for fixed-name credentials is
> keyed on *operator or job origin* (`app.deployment_credential`), not on today's principal kind alone, and the worker
> carries the job in an `AsyncLocalStorage` scope; the Google connect flow gained a one-time state. P2 has **not** begun.

> Design only. Baseline `41de1965`. **Rewritten after the two adversarial reviews (`REVIEWS.md`):** the original twelve
> phases are merged into seven, RLS-policy and `voice_sessions` work is removed, and the order changed — the two
> weaknesses that exist *today* (E13 Drive, E14 operator actions) and the voice hotfixes now come **first**, before
> anything is built that a second office would use.
>
> Each phase is independently verifiable and ends in a state where production is consistent and safe to leave. The one
> hard rule across all of them: **no second real office exists in production before Phase 6 is verified**
> (MIGRATION-PLAN §0.2). Before then production holds Grant's office, the `system` office, test offices (which cannot act
> outside) and — from Phase 5 — the Sample office (which cannot either).

## Counted evidence behind the sizing

| Quantity | Value | Source |
|---|---:|---|
| carriers needing `office_id` | **44** (40 new columns + 4 replacing a text `owner`) | `TABLE-REVIEW-399.md` |
| tables to put RLS on | 46 (uniform policy; no office policies in V1) | catalogue |
| gateway functions | 152 (92 id-taking, 60 listing), all `SECURITY DEFINER` | gateway map × `pg_proc` |
| **inline gateway/edge paths outside that map** | `drive`, `googleAccess`, `contact_photo`, `document_upload`, `machine_project_ok`, `mcp`, `voice`, `voice-token` | Review A |
| `app` functions | 588 (518 definer); **the converted set is derived in Phase 0** | |
| **functions that insert jobs** | **12** (not 5) + 3 scripts that insert directly | query + Review A |
| views | 14 (none `security_invoker`) | `pg_class` |
| `execute(` sites in `src/` | 502 in 95 files (not individually converted; `JobContext` + FKs + suite) | grep |
| hard-coded `'grant'` / global-Grant sites | ≥ 9 (`pager.ts:86`, `vault-export.ts:61`, `progress.ts:101,329`, `preference-store.ts:45,146`, `telegram-webhook:501`, `voice:54`, `telegram.direct_to_grant`) | inventory |
| system-wide `OPERATOR_ONLY` actions | 9 | `hq-api` action map |
| fixed-name Vault secrets read without an office | Google (2), Notion, Vikunja, NotebookLM, Slack fixed names, GitHub read | integration inventory |
| unique indexes to re-scope | 14 | `pg_indexes` |
| verify suites that `set local role ai_team_app` | 11 | grep |
| attack classes / mutation families | ≈12 / ≈8 (coverage matrix of 38 attacks) | `ACCEPTANCE-PLAN.md` |

## Phase map

```
P0 spike ──► P1 first fixes ──► P2 offices + backfill + constraints ──► P3 function conversion ──► P4 channels + voice
                                                                              │                          │
                                                          (isolation suite is built inside every phase) ▼
                                                                        P5 containment + Sample + acceptance
                                                                        P6 credentials + contract + retirement
```

---

## P0 — Spike and preconditions (no production change)

- **Objective.** Retire the assumptions the design rests on, on the isolated replica, before building.
- **Proves, each pass/fail with evidence:**
  1. composite `MATCH SIMPLE` FKs accept a null-project job and reject a cross-office one; **a caller naming another
     office's project fails with `23503`** (not silently re-homed — Review A, F4);
  2. PostgREST resolves `p_office`-first overloads next to old ones by argument names;
  3. a transaction can suspend the six `*_reject_update` triggers for the backfill and `tgenabled='O'` afterwards;
  4. `EXPLAIN` of `search_documents` with `(office_id, …)` indexes on production-sized data;
  5. **derive the converted set** — transitive call graph from the gateway map, the **inline gateway paths**,
     `supabase/functions/*`, the adapters and the worker; this list is the baseline `check:office-scoped` holds;
  6. whether `track_functions` can be enabled (else the `events` wrapper);
  7. whether `src/providers/router.ts` can host a recording provider for the canary test;
  8. **count the suites that depend on Grant's real data** (decides how many must use the machine key with an explicit
     office, versus create their fixtures in the test office);
  9. read the values of `calendar.*`, `notion.*`, `slack.subject_user_id` once (ids/emails?);
  10. confirm the product's task writer accepts a past `due_on` (for the Sample's "Late"), and whether a stuck job can
      be produced without waiting (for "Stuck");
  11. which of the 17 duties are system vs person, and whether `office.chores` touches a person's data.
- **Migrations.** none. **Rollback.** delete the scratch. **Risk.** low.
- **Acceptance.** a written spike report; every assumption proven or disproven. If (1) or (2) fails the design is revised
  *here*, at the cost of a document.

## P1 — First fixes: close what is reachable today (no `offices` needed)

These four exist in production **with one office** and each gets worse the moment a second session exists. They are
independent of the ownership model, small, and should ship first — and **E1/E2 can ship before P0 finishes**.

| # | Change | Closes | Tests |
|---|---|---|---|
| 1 | `voice-token` requires a valid session; drop the `*` CORS default; build the brief from state the caller may see | **E1** (HIGH, today) | attack 29 |
| 2 | `voice` uses the verified member's own `owner_key`, not env `VOICE_SUBJECT` | **E2** | attack 17 |
| 3 | **`OPERATOR_ONLY` action set** in `hq-api` (the nine system-wide actions) refused to every session unless the office has `uses_system_integrations`; always allowed to the machine key | **E14** (latent critical) | attack 32 |
| 4 | **`app.system_secret(office, name)`** fronts every fixed-name Vault read (`googleToken`, the `drive` section, Notion, Vikunja, NotebookLM, Slack fixed names, GitHub read); refuses unless the caller may use the deployment's integrations. **Before `offices` exists the guard is keyed on today's principal kind** (a `person` session and the machine key may; a `harness` test member may not); in P2 it switches to `offices.uses_system_integrations` with no change to its callers. | **E13** (latent critical) | attack 31 |
| 5 | drop `office_members.owner_key default 'grant'`; reserved words/staff slugs refused as a subject | E18 | unit |

- **Deploy.** `deploy:voice`, `deploy:hq`, `deploy:worker` (the worker reads the same fixed-name secrets); each probes itself.
- **Rollback.** redeploy the previous version; the migration is a default drop.
- **Risk.** low–medium: the standalone voice page and any phone shortcut that called `voice-token` unauthenticated will
  need a session; any script that used the machine key for a now-`OPERATOR_ONLY` action must be found first (P0 #8).
- **Acceptance.** E1 returns 401 against the deployed function with a real-origin probe; a `harness`-kind session gets
  403 on every `OPERATOR_ONLY` action; `GET ?section=drive` as a non-primary session makes **no Google request**.
- **Safe to stop.** after each item.

## P2 — Offices, backfill, constraints, RLS (M1–M4, M6)

- **Objective.** Every row owned, structurally; #399 closed.
- **Migrations.** M1 (`offices` incl. `system`, immutability triggers, bind Grant and the test principal), M2 (44 nullable
  columns), M3 (per table group, one transaction: characterise → backfill → composite keys/FKs → `NOT NULL`), M4
  (per-office uniqueness), M6 (RLS on for the 46).
- **Code.** `provision_office` operator script; the `check:office-catalogue` check with its control. The Grant-only
  `legacy_office()` bridge.
- **Tests.** characterisation assertions inside each migration (abort on unknown); per-table count snapshots before/after;
  a backfill rehearsal on a replica populated from the *measured shapes* of production (no data leaves production) plus a
  read-only characterisation run against production; `check:anon-exposure` green; the eleven `ai_team_app` suites unchanged.
- **Rollback.** per MIGRATION-PLAN §6; all reversible. **Risk.** **HIGH** — the one place a mistake is permanent in an
  append-only ledger. Mitigations: abort-on-unknown, rehearsal, the trigger-suspension assertion, one transaction per group.
- **Acceptance.** zero null `office_id` on `NOT NULL` carriers; unbound channel rows exactly the expected set;
  **`npm run gate` green, `check:leaks` unchanged**; the old worker (still deployed) runs through every step.

## P3 — Function conversion (M5.1–M5.6) — the centre of gravity

- **Objective.** Ownership survives the lifecycle; the model's context and every press are office-scoped.
- **Waves (each shippable alone):** 5.1 the **12 job inserters** + `enqueue_child` project validation + `unnamed_project(p_office)`
  + the dedupe/idempotency re-scopes · 5.2 approvals and presses (refuse before revealing) · 5.3 retrieval and context ·
  5.4 **MCP** (token → one office; `mcp_job_status(p_office, p_job)`) · 5.5 gateway reads, **inline paths**, views, storage
  ownership-before-write · 5.6 gateway writes + `OPERATOR_ONLY` completion.
- **Code.** `JobContext` with a branded `OfficeId` constructible only from a database row; `dequeue_job` returns/filters on
  office state; the page stops reading `hq.token`; **`hq.api_token` rotated** after Grant's devices are on sessions;
  `check:office-scoped` and the narrow `check:office-scope` in the gate; a recording provider for the canary test.
- **Tests.** the generated id-taking attack suite; the FK matrix; attacks 4–7, 9, 11, 12, 14, 19–21, 24–28, 30, 33, 34, 36–38;
  P1–P10; the existing suites that touch jobs, approvals and retrieval (`approver-identity`, `exactly-once`, `fan-in-waits`,
  `recovery-matrix`, `approval-race.sh`, `verify:unified`, `tier1:fast` before and after).
- **Deploy.** per wave: migrate → worker → gateway/adapters → verify. **UX-QA Level 2** at wave 5.5 (every screen's data
  path changes). `deploy:hq` for the page needs the operator (no `VERCEL_TOKEN` in the build session, #399.1).
- **Overloads** only for functions the worker/gateway call in a loop (5.1, 5.2, `dequeue_job`); the rest in lockstep.
- **Rollback.** drop the new overloads / restore saved bodies. **Risk.** **HIGH** in breadth, medium in depth. Every
  converted function gets a mutation that turns its attack red before it merges.
- **Acceptance.** every function in the derived set is scoped or reasoned-system; `GET`/`POST` for a foreign id and a
  nonexistent id are byte-identical.

## P4 — Channels and voice (M5.7)

- **Code.** `subject_identities.office_id`; `telegram_chat_for(p_office, …)` with no `or subject is null`; **only private
  chats deliverable**; the hard-coded `'grant'` sites replaced by the requester on the job/output; one shared Slack app,
  workspace → office, sender-office equality in `enqueue_inbound`; the Slack lifecycle workspace check (E4); realtime voice:
  office from the JWT on every turn, brief from `voice_state(p_office)`.
- **Tests.** attacks 15–18 with the edge emulator (`scripts/isolated/edge-emulator.ts` refuses every URL that is not the
  replica); `check:leaks` and `check:chatter` unchanged.
- **Rollback.** per function. **Risk.** medium. **Acceptance.** an unknown sender is dropped and audited; Grant's own
  Slack/Telegram/voice behave exactly as before.

## P5 — Containment, Sample, acceptance (M7)

- **Code.** `may_act_outside` + `offices.kind`; `claim_delivery` destination-office check; `kind → principal` mapping
  (`sample`/`test` → `harness`); `provision_office` for `sample`; `npm run sample:provision|reset|verify` where **reset is
  retire-and-re-provision**; the recording-provider canary flow.
- **Tests.** attacks 22, 23, 35; reset controls (counts of every other office unchanged; refused for non-sample); the
  Sample → Claire → Specialist → Result chain; Grant's office gains **zero rows** across the run.
- **Rollback.** retire the office; restore `may_act_outside`. **Risk.** medium (no ledger exception remains).
- **Acceptance.** `SAMPLE-ACCOUNT-DESIGN.md` §4 chain green; the isolation suite green; every mutation family red.

## P6 — Credentials, contract, retirement (M8, M9)

- **Before any second real human:** `office_credentials`, `office_settings`, per-office versions of the operator actions;
  Grant's own secrets moved behind refs (**operator-confirmed**).
- **Contract (M8):** drop the short list of old overloads, `unnamed_project()`, the `legacy_office()` bridge,
  `office_members`, the nine text `owner` columns; remove `VOICE_SUBJECT`, `telegram.direct_to_grant`. Preconditions are
  mechanical (MIGRATION-PLAN M8); snapshot first. **The only irreversible step.**
- **Acceptance.** suite and gate green with the old overloads gone; seven days of no old-overload calls (for the short list).

---

## Estimate (by phase and risk, not hours)

Relative effort in *focused implementation sessions* of the kind this repository already runs, with the uncertainty stated.
The reviews removed work (RLS policies, `voice_sessions`, purge, three tables, one phase) and **added** work (system office,
secondary FKs, `OPERATOR_ONLY`, the credential guard, MCP, inline paths, storage ordering, 12 not 5 job inserters). Net:
the complexity review's 35–45% cut did **not** survive the security review; the honest figure moved from 30–40 to
**≈ 24–34**.

| Phase | Size | Risk | Dominant uncertainty |
|---|:-:|:-:|---|
| P0 spike | S (1) | low | whether the overload and composite-FK assumptions hold |
| P1 first fixes | S–M (2) | low–med | unauthenticated callers of `voice-token`; scripts using the machine key for operator actions |
| P2 offices + backfill | **L (4)** | **high** | the "else abort" residue — unknown until each table's characterisation runs |
| P3 function conversion | **XL (8–11)** | **high** | size of the derived set; inline paths; raw SQL; a UX-QA Level 2 |
| P4 channels + voice | M–L (3) | med | Slack/Telegram edge cases in the emulator |
| P5 Sample + acceptance | M (3) | med | aging "Stuck" without time passing |
| P6 credentials + contract | M (3–4) | med–high (gated) | live-credential moves; the 7-day evidence |
| Suite (inside every phase) | counted above | | making each mutation family demonstrably red |
| **Total** | **≈ 24–34 sessions** | | P0 narrows it |

**What would make the estimate wrong:** the derived function set is much larger than the gateway's 152 (P0 measures it);
the characterisation finds unclassifiable historical rows (P2 stalls on a human decision, not on work); the UX-QA Level 2
at wave 5.5 finds regressions; many suites depend on Grant's real data (P0 #8).

**If time forces a cut.** Ship **P1** alone first — it closes E1, E13 and E14 with no schema change and is a strictly safer
production. Then **P2 + P3 wave 5.1–5.3** (ownership structural, approvals and the model's context scoped). Do **not** invite a
second real person before P4, the full isolation suite, P5 and P6 — and do not provision the Sample before P3's job-creation
wave and the credential guard are in production.
