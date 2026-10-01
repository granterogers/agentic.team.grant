# P2 - the ownership foundation

Written 1 October 2026. Branch `claude/multi-user-p2`, on top of P1 (`0b682ba2`). Production migrations **0654-0666**.
Read `P1-FINAL-CLOSURE.md` first for how P1 was closed and which suites are red on the baseline.

This phase makes ownership a structure instead of a convention: every private row has an office, the database refuses a
link between two offices whoever the writer is, and the history was assigned by evidence, not by assumption. It does
**not** convert the 878 functions, the 47 ambient-Grant defaults, the channels, the voice path or MCP (P3), and it creates
no second person: production has exactly one person office (Grant), one test office and one system office.

## 1. What now exists

| Thing | Where |
|---|---|
| `public.offices`: immutable `office_id`; `auth_user_id` unique and nullable; `kind` person / sample / test / system; `name`; `state`; `timezone`; created / disabled. `kind` and `auth_user_id` immutable, never deleted, a system office may not have a login, exactly one system office. **No `uses_system_integrations` column**: the credential resolver (0648) already decides integration use from operator authority and job origin, and a flag on an office that grants deployment-wide reach is the conflation the design warns about. | 0654 |
| `office_id uuid not null references offices`, indexed, write-once, on all **52** carriers | 0655 + waves 0657-0659 |
| Composite `(parent_id, office_id)` keys on **56** owned-to-owned edges: 55 validated, one left `NOT VALID` on purpose (section 4) | 0657-0659 |
| Guard triggers on **all 45 derived tables and one carrier** (`browser_actions`): a derived row cannot move offices, and the 10 derived tables with a second edge (plus `browser_actions`) cannot name a row of another office | 0660 (generated: `scripts/p2/gen_derived_edges.py`) |
| Polymorphic `relations`: both endpoints resolved to their table, must exist, must be in the relation's office | 0661 |
| Per-office private names | 0662 |
| Row security on all 46 tables that lacked it | 0663 |
| The guards run as their owner, not as the writer | 0664 |
| `office_backfill_report`, `office_repair_log`, `office_edge_exceptions`, `office_bridge_use` | 0654, 0656 |

Gates added: **`npm run check:office-edges`** (in the 73-entry gate, now 74): every owned edge is enforced, with ten
controls that each inject a defect and must be caught. `check:ownership` is unchanged in rule and now reads 136 tables.

## 2. Classification (the manifest is authoritative)

The manifest classes **136 tables**: **52 OFFICE_CARRIER / 45 OFFICE_DERIVED / 14 GLOBAL / 25 SYSTEM**. That is the P0 131
(52 / 45 / 14 / 20) plus five SYSTEM tables this phase created: `offices`, `office_backfill_report`, `office_repair_log`,
`office_edge_exceptions`, `office_bridge_use`. The research drafts' 44 / 85 split is not used. The catalogue was
re-read from production before any migration was generated; `check:ownership` fails on an unclassified table (control:
five synthetic defects, each caught), and `check:office-edges` fails if a carrier lacks any part of its structure.
A derived table proves its owner through a `NOT NULL` path (asserted in 0660 for all 45 before any trigger was made).

## 3. Offices created

| Kind | Production | Isolated replica (attack suite only) |
|---|---|---|
| person | 1 (Grant) | + Person A, Person B |
| sample | 0 | + 1 |
| test | 1 (the test principal and the quarantine for harness traffic) | the same one |
| system | 1 (no login, ever) | the same one |

Person A, Person B and the sample exist only in a throwaway database (`p2_attack`) that refuses to be anywhere but a marked
local replica. **No second real person was created in production.**

## 4. The Grant backfill

Every row was assigned by a rule that cites evidence, in tiers, strongest first; a table with one unproved row aborts its
wave and names itself. There is no rule that maps "unknown" to the person.

1. **Link**: the project, job or sibling row it names already has an owner. A job tree has one office: that of the
   project its own `project_id` names, else the projects named by the rows it produced or was asked in, else the root's
   rule. A harness tree's rows count only through the job's own project column, never through the scope a command
   happened to carry.
2. **Principal**: the owner key that acted, or the registered destination a message went to.
3. **Pointer**: an id inside the payload that names rows of one office.
4. **Harness**: a run token or a suite's own name in the row.
5. **UNATTRIBUTABLE history** (system, fail-closed): terminal history nothing can attribute. Only append-only rows that
   nothing reads to decide behaviour are eligible; anything live that is not proved aborts.

Result, production, 63,803 rows across the 52 carriers:

| Office | Rows | |
|---|---|---|
| person (Grant) | 29,928 | |
| test | 24,248 | |
| system | 9,627 | 5 duties, deployment infrastructure credentials, and the UNATTRIBUTABLE history below |
| **unresolved** | **0** | |

By table (person / test / system): jobs 10,068 / 9,938 / 529; events 7,580 / 2,092 / 546; inference_usage 3,388 / 4,327 /
8,115; deliveries 3,269 / 985 / 28; inbound_commands 1,532 / 1,410 / 0; projects 7 / 1,845 / 0; the full table is in
`office_backfill_report` (rule by rule, 123 rows) and the per-office counts above come from
`select ... group by office kind` over the 52 carriers.

**UNATTRIBUTABLE, to the system office (fail-closed, counted):** 8,099 model calls made with no job; 345 settled undo offers
that name no row; 22 ledger lines whose subject was deleted; 18 `document.added` signals whose document no longer exists.
A person's view fails closed rather than absorbing rows nobody can prove are theirs. This is a decision, not a gap: ADR-0061.

**Harness rows that are in Grant's office anyway, and why (flagged, counted, not hidden): 5,821.** jobs 2,938; deliveries
1,110; inbound_commands 870; blockers 419; decisions 227; lessons 78; events 59; tasks 58; documents 54; signals 5;
project_switches 3. Each one is linked, by a key the database enforces, to a project or job that is Grant's: a suite that
must test a feature that filters fixtures uses a real project on purpose (#45), and the composite key cannot say "a test
row inside the person's project". They are **not** relabelled and they are **not** removed; every reader that already
excludes harness traffic (`app.harness_job`, `is_fixture`) still has to. P3 must not treat `office_id = Grant` as "real".

**Repairs, each logged in `office_repair_log` with the old value first:** 75 suite commands whose scope was a default
project while their job lived elsewhere were re-pointed to the job's own project, or to a new quarantine project
`fixture-p2-default-scope` (test office, archived) where the column is `NOT NULL` and the suite never chose one; 13 chats a
suite declared a test origin (#381) that the compatibility bridge had bound to the person were moved to the test office (0666).

**One recorded exception:** `lessons.supersedes` crosses offices on one existing row (a harness session that ran inside the
real catch-all project wrote a lesson replacing a fixture's lesson). `public.lessons` refuses UPDATE, so the row cannot be
corrected; it is named in `office_edge_exceptions`, its composite key stays `NOT VALID` (it still refuses every new or changed
row), and `check:office-edges` fails if the violating set is anything other than the list.

## 5. Structural constraints (all asserted by `check:office-edges`)

* every carrier: `office_id NOT NULL`, FK to offices, index led by it, write-once trigger (enabled), bridge trigger;
* 55 validated composite keys + 1 `NOT VALID` (above), covering project<->job, parent / child / root jobs, project<->document,
  project<->task, task<->parent task, job<->produced document, origin command<->job, decisions / lessons / skills
  supersession, events compensating events, blockers<->deliveries<->tasks, notification and notebook edges;
* every derived table has a guard that refuses a path change that would move its owner; the 10 with a second edge (and `browser_actions`) refuse a
  disagreement; the polymorphic `relations` endpoints are validated;
* nothing is derived from a caller-selected parent: where a row names two owned parents they must agree, and a nullable
  secondary parent skips the key (`MATCH SIMPLE`) while `office_id` stays `NOT NULL`, so it cannot erase ownership.

## 6. Per-office uniqueness (0662)

Converted to `(office_id, name)`: project slug, project notebook reference, duty slug, trigger name, MCP provider name,
contact label, the global standing authorization. Proved in the attack suite: two offices take the same slug / duty /
trigger / provider / label; a duplicate inside one office is refused by the per-office key; and B's attempt reveals nothing
about A's slug (it simply succeeds).

Not converted, on purpose: `mcp_clients.token_sha256` (a credential must establish exactly one office), delivery / command
dedupe keys and job idempotency keys (system-composed from ids, read by `ON CONFLICT` clauses in functions P3 converts),
external provider ids, and every key already led by a project. Callers that inferred `ON CONFLICT (slug)` were changed in the
same commit (5 scripts / simulation). **Until P3, a function that resolves a project by slug alone would be ambiguous if two
offices shared one**: production does not create that state, and P3 makes every such lookup office-scoped.

## 7. Row security (0663)

Row security enabled, with the one `ai_team_app` policy (`using (true)`), on the 46 tables that lacked it. No GUC, no act-as
role, no per-office predicate was introduced, and nothing here claims RLS protects `service_role` or `postgres`: both
bypass it, and the attack suite attacks as exactly those roles. It is a tripwire: a role later granted a table sees nothing
until a policy exists. Seventeen tables already had row security on with no policy at all (closed to every role that does not
bypass it); they were left exactly so. `check:anon-exposure` is green (136 tables): no new anon or authenticated access.

## 8. The compatibility bridge

A `BEFORE INSERT` trigger fills a legacy writer's missing `office_id`, in this order: the project's office, the job's, the
duty's or trigger's owner, a harness actor -> the test office, and only then **the sole person office**. It works solely while
Grant is the only real (person or sample) office; **with a second real office `app.sole_person_office()` is NULL and the
insert fails `NOT NULL`**, proved in the attack suite for Person A + Person B and for Sample + Grant. It is metered
(`office_bridge_use`, printed by `check:office-edges`): so far three tables relied on it, which is how the declared-test-chat
leak was found (0666). **Removal point: P3**, when every writer names its office; `check:office-edges` prints the count
and the bridge triggers (`a0_office_bridge`) are dropped with the last caller converted. It never silently turns an
unscoped request into Grant for a read: nothing in P2 reads by office. Grant is the answer only for a *write* with no other
evidence, only while he is alone, and every such write is counted.

## 9. The machine key

Unchanged by P2 and not rotated. **Nothing in P2 lets the machine key choose an office**: no callable function takes an office
(`check:office-edges` fails if a public function gains a parameter named like one), `provision_office` and `office_of_auth`
were removed before they could grow a caller, and the key still names nobody. It still cannot answer a human approval, still
cannot run the 22 operator actions, and is still not minted for a browser by anything new. **Rotation: blocked, unchanged**:
whether Grant's devices present a signed-in session or the legacy `hq.token` is not observable from the server, and MCP
consent is still the key (P1 section 4.7, 4.5). The two MCP clients are bound to the person office (0659), and a second real
office while any MCP client is enabled fails `check:office-edges` until the MCP conversion is recorded complete.

## 10. Tests

| | |
|---|---|
| **Attack suite** `scripts/isolated/office-ownership.ts` | **96 / 96**. Person A, Person B, Sample, the Test and System offices; every attack as `service_role` (modelled with production's privileges: no usage on schema `app`) and as a `BYPASSRLS` worker stand-in. A cannot link to B's project, job, task, document, blocker, command, delivery, decision, event; cannot create a child under B's job; ownership cannot move (update, or null); polymorphic relations cannot cross; a null secondary parent does not erase ownership; derived rows cannot move or name another office's row; a derived row cannot lack its path; uniqueness is no oracle; system data does not resolve through a human session; a system office takes no login; harness data lands in the test office; Grant's rows are identical before and after, table by table |
| **Sabotage** `office-ownership-sabotage.ts` | **13 controls**, each: break, prove the break landed, the suite and gate go red naming the cause, restore, green. Includes: drop a composite key, remove immutability, make a derivation nullable, misclassify a table (two ways), remove the system / person distinction (two ways), remove a derived guard, the relations guard, the declared-test-chat rule, the bridge, put a global unique key back on a slug, and run the bridge as its invoker (the production failure of section 11) |
| **Planted inconsistencies** `p2-backfill-plants.ts` | 6 plants + a control: an unclassified duty, an unprovable retired project, a job tree spanning two offices, a requester nothing recognises, an unexplainable ledger event, a feedback row from an unknown actor. Each stops the wave that owns it, names the row, and leaves nothing stamped |
| Unit | `tests/ownership/` 29 tests; whole suite 262 files / 3,942 tests |
| Gates | `check:office-edges`, `check:ownership`, `check:anon-exposure`, `check:machine-key`, `check:system-secrets`, `check:callers`, `check:consumed`, `check:leaks` all green after the waves |

## 11. Production record

Characterised -> rehearsed -> planted -> measured -> applied one wave at a time with verification between.

* **Rehearsals.** Every wave on the replica; the whole chain 0654-0663 against production in one transaction that ends in a
  deliberate exception: 1 min 50 s, every composite key validated against the real rows, nothing kept. That run found that
  0657-0659 queue deferred constraint triggers they then `ALTER TABLE` through (`55006`); each now runs
  `SET CONSTRAINTS ALL IMMEDIATE` first.
* **Applied** (`scripts/p2/apply-wave.ts`: refuses while a job runs, `lock_timeout 10s`, retries on a lost lock race, records
  the ledger with the same checksum): 0654 1.2 s; 0655 9.9 s; 0656 1.1 s; 0657 32.6 s; 0658 59.3 s; 0659 2.8 s;
  0660 2.5 s; 0661 2.9 s; 0662 1.1 s; 0663 0.9 s; 0664 1.0 s; 0665 1.3 s; 0666 1.1 s. Every wave applied on the first
  attempt; no wave lost a lock race. The worker was never paused.
* **Before / after.** Row counts for all 131 tables were taken before; afterwards five new tables, no table lost a row except
  `tasks` -21 and `documents` -17, which are suite teardowns and the sanctioned `purge:fixtures` run during this session
  (the to-dos a suite leaves on Grant's list are now swept by the suites themselves).
* **Rollback points.** Every migration ends with its rollback. 0654-0656 are additive (drop the table / columns). 0657-0659
  stamp and constrain: drop the named constraints and triggers and `drop not null`; the stamped values are harmless to keep.
  Data repairs are reversible from `office_repair_log`. The deployed code did not change in this phase.

**Incident, found by the first suite to touch the Telegram webhook after the waves, minutes later.** The bridge trigger called
`app.bridge_office` as the *invoker*, and `service_role` has no usage on schema `app`, so every update the Telegram webhook
tried to store died `42501` and was answered **503 "storage failed"**. Window: **16:39:20 to 16:47:07 (7 min 47 s)**, from 0658
(which put the trigger on `inbound_commands`) to 0664 (guards run as their owner). The attack suite had missed it because it
granted its attackers usage on `app`, which production does not; it no longer does, a positive control asserts the
service role cannot reach `app`, and a sabotage proves the suite goes red when the bridge runs as its invoker. **Impact:** Telegram
redelivers a 503; Slack retries; `inbound_commands` holds no real (non-synthetic) message from 16:00 onwards, so there is no
evidence a person's message was lost, and none can be ruled out from a table that, by definition, does not hold a message it
failed to store.

## 12. Remaining risks

1. **Harness rows sit in Grant's office** (5,821, section 4) and grow: new synthetic commands carry the default project, which
   is his. Readers must keep filtering harness traffic; P3 should give the default scope an office.
2. **A function that resolves a project by slug alone is ambiguous** the day two offices share a slug. Nothing creates that state.
3. **47 functions still default their person to Grant**, and 878 are not office-scoped. Nothing reads by office yet, so
   P2 leaks nothing a second person could reach *only because there is no second person*; P3 is what makes that true with one.
4. **The bridge** binds a legacy write to Grant while he is alone. It is metered and fails closed with a second office.
5. **Seven suites remain red on the baseline** (fenced in `P1-FINAL-CLOSURE.md`), and `verify:isolated` has three red groups
   that predate this work.
6. The one history exception (`lessons.supersedes`), and the 8,484 UNATTRIBUTABLE rows that Grant's office does not hold.
7. `inference_usage` is metered from the 8,099 job-less calls forward by the bridge, but the historic cost view for Grant
   under-counts those calls until P3 attributes them.

## 13. Recommendation for P3

Do the conversion in this order, each wave behind the structure that already refuses the wrong answer:

1. **Make every writer name its office** (jobs first, then channels), and drop `a0_office_bridge` table by table as the
   meter reaches zero. The meter is the progress bar.
2. **Scope reads, not just writes**: the `required (p_office, id)` signature the ADR specifies, converting the 47
   ambient-Grant functions first (`check:machine-key` already lists the reachable ones), then the readers behind the
   dashboard and the prompt builder.
3. **Give the default project and the catch-all `unnamed` an office**, so harness traffic stops landing in Grant's.
4. **Session -> office in `speaker.ts`** (the resolver was deliberately not built here: it had no caller), then MCP consent
   with its own credential and a client bound to one office at issue; only then record `mcp.office_bound = true`.
5. Rotate the machine key once Grant confirms which devices are on signed-in sessions.
6. Only then invite a second person; run the attack suite against the converted functions as well as the tables.
