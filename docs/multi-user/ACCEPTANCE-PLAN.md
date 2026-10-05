# Acceptance plan — the `user-isolation` suite, its sabotage plan, and the Sample acceptance

> Design only. Nothing here exists yet. Baseline `41de1965`.
>
> **Amended after the adversarial reviews (`REVIEWS.md`).** The RLS attack layer, `act_as` and the purge sabotage are gone;
> eight attacks are added (31–38); the id-taking attacks are *generated* from the derived function list and the
> sabotages run as mutation families; and the suite now also attacks the **inline gateway paths**, which are outside
> any function map.
>
> **The principle this plan is built on** (CLAUDE.md, repeated eleven times in different words): *a check that has only
> ever passed is indistinguishable from a check that cannot fail.* So every attack below has (a) a positive control
> that proves the attacker can do the same thing to **their own** data, and (b) a named sabotage that must turn it red.
> An attack with no sabotage that reddens it is not accepted into the suite.

## 1. Shape of the suite

`npm run verify:user-isolation`, in the gate, in two levels — the same split the repository already uses
(`scripts/isolated/` and the live `verify:*`):

| Level | Where | What it may do |
|---|---|---|
| **L1 — replica** | the isolated Postgres built from migrations (`scripts/isolated/replica.sh`, with the real role shapes: `service_role` BYPASSRLS, `ai_team_app` non-bypass, stub `auth.uid()`), a gateway emulator, an edge emulator | everything, including destructive sabotage |
| **L2 — live** | production through the deployed gateway | **read-only attacks and refused-write attacks only.** Write attacks target a *fixture* project in Grant's office, never a real object (§5) |

**Principals.** `A` and `B` are two `kind='test'` offices created by the suite with real auth users, seeded with
**deliberately colliding content**: the same project name and slug, the same task titles, identical document titles and
keywords, the same alias, the same Slack channel name and Telegram display name, different `office_id`. Each carries
unique canary strings (`CANARY-A-<run>`, `CANARY-B-<run>`). `S` is the Sample office. `G` is Grant's real office,
touched only by L2 reads and refused writes.

**Two attack paths per target** (the RLS path was dropped: nothing connects as a non-bypass role):
1. *Function path* — direct SQL as `service_role` calling the converted function with A's `p_office` and B's ids. This
   is what a bug in a service-role caller looks like, and it is where the protection actually is. **Generated** from the
   derived function list for every id-taking function.
2. *Gateway path* — HTTP with A's session, B's ids in the body — **once per class of input** (body, query string,
   header, the machine key with `x-office-id`), to prove the gateway deletes and overwrites client office fields, plus
   one test for each **inline path** (`drive`, `googleAccess`, `contact_photo`, `document_upload`,
   `machine_project_ok`, `mcp`).

**Containment of the suite itself.** It declares its origins before knocking (`test_origins`, 0605), uses test offices
(so effects are refused structurally), and asserts `check:leaks` is unchanged. It never writes a real destination.

## 2. The thirty attacks

`✓` = defeated at that layer. The RLS column is kept only as a record of where an office policy *would* bite if one is ever built; V1 does not exercise it. **Sabotage** names the experiment in §4 that must turn it red.

| # | Attack | Expected | Gateway | Function | RLS *(deferred; not exercised in V1)* | Structural | Sabotage |
|--:|---|---|:-:|:-:|:-:|:-:|---|
| 1 | A reads B's project (by id, by slug, by name) | `not_found`, identical to a nonexistent id | ✓ | ✓ | ✓ | | S3, S1 |
| 2 | A updates B's project (rename, archive, icon) | refused; B unchanged | ✓ | ✓ | ✓ | | S3, S1 |
| 3 | A deletes B's project | refused; row and dependents intact | ✓ | ✓ | ✓ | | S3, S1 |
| 4 | A guesses B's job id (read output, trace, plan) | `not_found`; no timing difference vs a miss | ✓ | ✓ | | | S3 |
| 5 | A answers B's open question | refused; blocker still `open` | ✓ | ✓ | | | S7 |
| 6 | A presses B's delivery (retry / mark / reply) | refused; delivery state unchanged | ✓ | ✓ | | | S7 |
| 7 | A approves / declines B's action (plan step, standing grant, tool request) | refused; no `approved_by` written | ✓ | ✓ | | | S7 |
| 8 | A reads B's document / file / signed URL | `not_found`; storage path 403 | ✓ | ✓ | ✓ | | S3, S1 |
| 9 | A retrieves B's document through search (same keywords, same project name, same alias) | zero B rows in the result set | ✓ | ✓ | ✓ | | S6 |
| 10 | A creates a task whose `project_id` is B's | FK violation `23503` | | | | ✓ | S2 |
| 11 | A creates a child job under B's parent (or retargets a child's project, E3) | FK violation | | | | ✓ | S5 |
| 12 | A resumes / pauses / stops B's job | refused; job state unchanged | ✓ | ✓ | | | S3 |
| 13 | A uses B's integration (resolve B's credential ref, post through B's Slack app, read B's Notion token) | `office_secret(A, …)` returns nothing for B's slot; no outbound call | | ✓ | | | S14 |
| 14 | A uses B's standing authorization / autonomy | `autonomy_for(A, p)` ignores B; B's global grant does not make A's action `proceed` | | ✓ | | | S3 |
| 15 | Slack event resolves to the wrong office (A's user in B's workspace; B's user in A's) | dropped, audited, nothing stored | | ✓ | | | S13 |
| 16 | Telegram sender resolves to the wrong office (null-subject chat; `telegram_chat_for` for A returns B's chat) | no row; delivery goes only to A's chat | | ✓ | | | S12 |
| 17 | Voice **note** resolves to the wrong office (`VOICE_SUBJECT` regression; A's audio becomes B's turn) | turn carries A's `office_id` and A's subject | ✓ | ✓ | | | S16 |
| 18 | **Realtime** voice resolves to the wrong office (B's session id presented by A; expired id; guessed id) | refused | ✓ | ✓ | | | S9 |
| 19 | B's attachment reaches A (a file attached in B's project appears in A's chat context or search) | absent from A's context and results | | ✓ | ✓ | | S6 |
| 20 | A service call arrives with no office context | refused, never defaults | | ✓ | | | S4 |
| 21 | A scheduled duty crosses offices (A's duty creates a job under B; B's duty's delivery targets A) | job `office_id` = the duty's; delivery to its own office only | | ✓ | | ✓ | S5 |
| 22 | Sample reaches Grant (any delivery, post, mail, contact, Telegram, Slack) | **zero** effects; refusal recorded | | ✓ | | ✓ | S10 |
| 23 | Sample loses its classification (retry, child, resume, recovery, restart, grandchild) | `kind` still `sample`; still refused | | ✓ | | ✓ | S10, S11 |
| 24 | Cache collision (gateway `seen`, voice `seenSessions`: A's token served B's office; alias/name cache) | each token resolves to its own office; cache never keyed by name | ✓ | | | | S8 |
| 25 | Retry changes owner (`UPDATE jobs SET office_id`) | trigger refuses | | | | ✓ | S11 |
| 26 | Child changes owner (insert a child with a different `office_id` than its parent) | FK violation | | | | ✓ | S5, S11 |
| 27 | Stale worker crosses owner (a worker holding job J of A finishes/continues after J is re-claimed; a worker handed a job of B writes A's id) | `claim_gen` fence holds; output lands in J's office only | | ✓ | | ✓ | S5 |
| 28 | Caller-supplied user contradicts durable owner (`p_office`, `office_id`, `owner_key`, `x-office-id`, `p_by` in the body) | the gateway deletes and overwrites them; a function given a `p_office` that disagrees with the job's refuses | ✓ | ✓ | | | S4 |
| 29 | Unauthenticated caller reaches private data (no token; expired; a webhook with a bad signature; **the `voice-token` endpoint with no JWT** — E1) | 401/403; nothing in the body | ✓ | | | | S17 |
| 29b | A **disabled** office keeps working | gateway refuses within the cache TTL; `dequeue_job` skips its jobs | ✓ | ✓ | | | S18 |
| 30 | Retrieval places B's content in A's **model context** | the recorded provider request bodies for A's run contain no `CANARY-B-<run>` (control: B's run contains it) | | ✓ | | | S6 |
| 31 | **Fixed-name credential reached by a non-primary office** (`GET ?section=drive`, the worker's Drive read, the Notion/Vikunja/NotebookLM/Slack fixed names) — Review A F1 | refused by `system_secret`; no Google call is made; truthful "not connected" | ✓ | ✓ | | | S20 |
| 32 | **System-wide action by a Sample/test/non-primary session** (`set_setting`, `routing_set`, `bot_assign`, `staff_hire/update/retire`, `set_slack_credentials`, `disconnect`, `forget_google`) — F2 | `403 operator_only`; `system_config`, staff rows, credentials unchanged | ✓ | | | | S21 |
| 33 | **MCP cross-office**: a token for A calls `mcp_job_status(B's job)`, `mcp_search` with no project, `mcp_projects`, `read_document` — F3 | A's results only; B's job/doc is `not_found`; absent project = A's projects | | ✓ | | | S22 |
| 34 | **Storage written before ownership** (`contact_photo`, `document_upload` with B's project/contact ids) — F12 | refused **before** any storage write; B's object bytes unchanged | ✓ | | | | S24 |
| 35 | **Delivery to another office's destination** (a delivery whose `target_ref` is B's chat) — F10 | `claim_delivery` refuses; nothing sent | | ✓ | | | S25 |
| 36 | **`relations` / polymorphic edge** to a foreign id; error text probes existence — F8 | refused; the message is identical for foreign and nonexistent | | ✓ | | ✓ | S26 |
| 37 | **Foreign id vs nonexistent id** return the **same status and same body** (not 200-vs-502) — F14 | byte-identical responses | ✓ | ✓ | | | S27 |
| 38 | **`unnamed_project` per office**; a second office's null-project command and retrieval | lands in *its* Unnamed project; never another office's | | ✓ | | ✓ | S28 |

Each attack is repeated with **colliding names** (so a name-based lookup that picks "the first match" returns the wrong
office's row) and with **an id copied from B's response into A's request** (so "A knows B's identifiers").

## 3. Positive tests — one user, many projects

These prove the isolation did not buy safety by breaking the product (CLAUDE.md: *"a suite made only of refusals
passes against a system that refuses everything"*).

| # | Test | Expected |
|--:|---|---|
| P1 | A lists projects | all of A's, none of B's, ordering unchanged from today |
| P2 | A opens A1, switches to A2, returns to A1 | each shows its own tasks, chat, documents; `project_switches` rows are A's |
| P3 | A creates a task in A1 with a subtask; moves it to A2 | state and parent consistent, office unchanged |
| P4 | A asks a question in A1 that matches a document in A2 | the answer cites A2 **as another project** with provenance (settled policy), and cites no B document |
| P5 | A delegates in A1: Claire → specialist → child | one tree, one office; the result appears in A1's thread |
| P6 | A's approval in A2 resolves; A's standing grant in A1 does not apply to A2 unless office-global | exactly as today |
| P7 | A's office-global `lessons` reach all of A's projects, none of B's | |
| P8 | A and B each create a project with the **same name**: both succeed; alias resolution is per office | no "name taken" across offices |
| P9 | A's duty fires; its message goes to A's channel identity only | |
| P10 | **Grant's existing behaviour is unchanged**: the existing gate (`npm run gate`) and its suites pass against Grant's office after migration | no regression of an existing guarantee |

## 4. The sabotage plan

Rule from this repository: **print something from the sabotage that proves it landed** before reading the check
(`grep -c`, `changed: True`). A sabotage that did not apply is not a passing control; it has been mistaken for one
twice.

| ID | Sabotage (in the L1 replica, never committed) | Must turn red |
|---|---|---|
| S1 | *(removed: RLS office policies are not built in V1)* | — |
| S2 | drop `tasks_project_same_office` (and each other composite FK in turn) | attack 10 and the matching row of the FK matrix |
| S3 | make a converted function ignore `p_office` (`where id = $1` only) — for a read, an update and a delete function | attacks 1–4, 8, 12, 14 |
| S4 | gateway stops deleting a client-supplied `p_office`; and: a function gains a default `p_office := <any office>` | attacks 20, 28 |
| S5 | drop the `jobs_parent_same_office` / `jobs_root_same_office` FKs; and: make `enqueue_child` use `coalesce(p_project, …)` without a check | attacks 11, 21, 26, 27 |
| S6 | remove the office predicate from `search_documents`; remove it from `sibling_projects`; remove it from `lessons_for` (each) | attacks 9, 19, 30, P7 inverse |
| S7 | `hq_answer_blocker` / `press_delivery` / `undo` look up by id only | attacks 5, 6, 7 |
| S8 | key the gateway `seen` cache by a constant; and: cache alias resolution by phrase only | attack 24 |
| S9 | take the office from the *session id* instead of the JWT on a voice turn | attack 18 |
| S10 | make `may_act_outside` ignore `offices.kind` | attacks 22, 23 |
| S11 | drop the `office_id` immutability trigger | attacks 23, 25, 26 |
| S12 | restore `or subject is null` in `telegram_chat_for` | attack 16 |
| S13 | remove "workspace office = sender office" in the Slack path | attack 15 |
| S14 | `office_secret` resolves by `(service, slot)` without the office | attack 13 |
| S15 | *(removed: there is no purge; reset retires an office)* | — |
| S16 | put `VOICE_SUBJECT='grant'` back | attack 17 |
| S17 | remove the JWT requirement from `voice-token` | attack 29 (E1) |
| S18 | gateway stops checking `offices.state` | attack 29b |
| S20 | route a fixed-name secret read around `system_secret` (the `drive` section, then the worker's Drive read) | attack 31 |
| S21 | remove an action from `OPERATOR_ONLY`; and: map `kind='sample'` to `person` instead of `harness` | attack 32 |
| S22 | `mcp_job_status` back to `(p_job_id)` only; `mcp_search` null project back to every project | attack 33 |
| S23 | derive a row's office from the **project the caller named** (the F4 tautology) instead of failing the FK | attacks 10, 11 |
| S24 | write storage before the ownership check | attack 34 |
| S25 | drop the destination-office check in `claim_delivery` | attack 35 |
| S26 | `relations_of` joins the other end with no office filter | attack 36 |
| S27 | let an FK violation surface as 502 instead of the friendly response | attack 37 |
| S28 | `unnamed_project(p_office)` back to the global slug lookup | attack 38 |
| S19 | **harness-of-the-harness:** make a retrieval function return everything, and a policy `using (true)` — and confirm the *positive* controls stay green while the *negative* ones go red | proves the suite distinguishes "refuses everything" from "isolates correctly" |

**Mutation families, not 28 hand-written cases.** S3/S6/S7/S14/S22/S26/S28 are one mutation — *drop the office predicate from
function X* — run automatically over the derived function list; S2/S5/S11/S23 are one — *drop or weaken a structural
constraint* — run over the FK matrix. What is hand-written is the small set of structural and channel cases. Roughly
**12 attack classes and 8 mutation families**, each with a positive control.

**Acceptance of the suite itself:** every mutation family produces a red; each sabotaged run prints its proof-of-landing
line; the run with no sabotage is green; `--prove-it` (as `check:backend-ref` has) automates the loop *break → watch
red → restore → watch green*. Any sabotage that leaves its row green means the corresponding test is inadequate and the
suite is not accepted.

## 5. Level 2 (live) — what is safe against production

Allowed: Sample (or a throwaway test office) attacks **Grant's** office with **reads** (expect `not_found` for real
objects) and with **writes against a fixture project/job in Grant's office** (the 59 fixture projects that carry real
jobs are the existing #45 convention; a refused write leaves them unchanged and a sabotaged write damages only
harness data). Never: a write attempt against a real project, a real standing authorization, or a real credential.
Before every live write attempt the suite asserts `is_fixture` on the target, then asserts the target's before/after
hash is identical.

## 6. Sample acceptance (separate from the suite)

Runs after the suite is green. Steps are in `SAMPLE-ACCOUNT-DESIGN.md` §4 (Sample → Claire → Specialist → Result),
§7 (voice) and §5 (reset). Pass criteria: the chain assertions hold; Grant's office has **zero new rows** in every
table across the run (per-table count snapshots, compared); `check:leaks` and `check:chatter` unchanged; realtime-voice
conversation is a manual step recorded as such.

## 7. New standing checks (in the gate)

| Check | Asserts | Positive control |
|---|---|---|
| `check:office-scoped` | every function on the derived reachable set has a required `p_office` or derives from a job/command, or is on a reasoned system list | an unscoped fixture function is reported |
| `check:office-scope` | **inline paths in the edge functions** (`hq-api`, `mcp`, `voice`, `voice-token`, `slack-events`, `telegram-webhook`) that read the Vault, write storage or call an RPC directly must carry the resolved office; baseline only shrinks. Not applied to the 502 `execute(` sites in `src/` | a deliberately unscoped inline path is reported |
| `check:office-catalogue` | every carrier has `NOT NULL office_id` and an immutability trigger; every FK edge in ARCHITECTURE §4 exists; **no unique index on a carrier omits `office_id`** (merges the old integrity and uniqueness checks; a mismatch row is unstorable after the constraints, so only the *constraints* are checked) | drop a constraint in a rolled-back transaction → found |
| `check:anon-exposure` (existing) | extended: no table or function reachable by `anon`/`authenticated` | already has controls |

## 8. Exit criterion for "isolation works"

All 38 attacks (incl. 29b) defeated; P1–P10 pass; every mutation family red; `--prove-it` green; L2 clean;
Sample acceptance clean; `check:leaks` and `npm run gate` unchanged from baseline.
