# Agentic Team — Deep Architecture Audit

**Repository:** `granterogers/agentic.team.grant` · **Audited:** `main` @ `bbe9956c32851ec2c1ef0eb3f0104acf9e933959` · **Date:** 2026-09-29
**Mode:** strictly read-only. Nothing was modified, committed, pushed, deployed, filed or sent. This report is the only artefact (a scratch file).

**Labels used throughout.** CURRENT FACT (read in code/schema at this HEAD) · HISTORICAL · INFERENCE · PRODUCT REQUIREMENT · RECOMMENDATION.
**Finding classes.** BUG · ENGINEERING DEBT (the brief's design-debt class, renamed per the organisation's naming policy) · ARCHITECTURAL DEFECT · MISSING CAPABILITY · VERIFICATION GAP · DOCUMENTATION DRIFT · FUTURE PRODUCT REQUIREMENT.

**Method and honest limits.** Seven parallel read-only investigations (turn understanding; work model/job engine; approval/authority/actions; containment/provenance/interfaces; staff/learning/skills/proactivity; knowledge/database/multi-user; tests/issues/history). I personally re-verified the claims marked ✔ below against source. Limits: the production database was unreachable, so the *effective schema* is reconstructed from `migrations/0001–0606` (highest-numbered definition wins) and **no live row counts are claimed**; the local clone is shallow (66 commits, 24–29 Sep only), so 15–24 Sep history comes from issues and docs; I did not run `vitest`, any `verify:*`, or the handler. Claims I did not verify myself are attributed to the investigation and stay INFERENCE unless the source is cited.

---

## 1. Executive conclusion

**Verdict: H2 — the durable core is sound; semantic orchestration and the authority layer carry significant, bounded debt. Consolidate; do not rewrite; do not adopt a framework.**

The central question is answered in §48 of the brief; the short form:

- **Yes** to the foundation for one persistent Claire relationship over a durable, project-scoped organisation. The job engine, 14-state machine, leases, checkpoints, blocker/pause records, delivery ledger, and synthetic containment are real engineering, verified in isolated replicas, and do not need replacing.
- **Not yet** for four things the product requires, each a *boundary/ownership* problem rather than a missing feature:
  1. **No canonical record of what Grant said.** ~30 regex readers, one advisory model IR, and a model paraphrase compete; gate order is untested and demonstrably wrong in at least one case (§10).
  2. **One relationship across interfaces is not real.** Conversation identity *is* channel identity; a Team HQ → Telegram continuation locates none of the prior turns (§13).
  3. **There is no authority choke-point.** Seven overlapping approval mechanisms, one of which binds the exact action; the autonomy dial is not consulted by the main cascade or most external writes; `staff_tools` is not enforced at execution (§22–24).
  4. **Tenant/sender assumptions are baked in.** No sender authorisation below the door; approver identity is the string `'grant'`; no tenant column anywhere (§30).
- **Urgent, not architectural:** two security-relevant items (§33 B1, B2) should be triaged by Grant before any architectural work.

**Bounded consolidation required:** 9 slices (§44), the first two zero-behaviour-change. **No rewrite.** ~6,700-line `instruction.ts` is *not* the defect; the missing shared contract beneath it is.

---

## 2. Exact repository baseline

- CURRENT FACT ✔: `origin/main` = `bbe9956c32851ec2c1ef0eb3f0104acf9e933959` (the commissioning SHA; `main` has not moved). Working branch `claude/great-volta-v77py4` tip = same SHA; `git log main..origin/claude/great-volta-v77py4` is empty.
- Branches: only `origin/main` and the session branch remain. Historical remediation branches named in docs (`jolly-darwin`, `dazzling-dirac`, `basecamp-team-hq`) are merged/deleted. Nothing outstanding on any branch.
- Sizes ✔: `instruction.ts` 6,690 lines / 317,794 B / 52 imports; `src/**/*.ts` ≈ 68k lines; 621 entries in `migrations/` (0001–0606 + README + applied.json); 297 test files; 384 npm scripts (223 `verify:*`, 23 `check:*`).
- Issues: 65 open / 309 closed. **No open issue is labelled "architectural"**; architecture-level defects are filed as unlabelled behavioural issues.

## 3. Current system map

```
Adapters (write inbound_commands; 5 doors)            Job engine (Postgres)                 Effects
Telegram ─┐                                         inbound_commands ─enqueue_inbound→ jobs   deliveries (claim_delivery)
Slack ────┤  origin_channel/origin_ref/actor          root office.instruction               Google / Notion / NotebookLM / Slack
Team HQ ──┤  (Team HQ chat writes channel='voice')    ├ enqueue_child(_once) → children     browser / artifact(PDF) / tasks
Voice ────┘                                           ├ fan_in_over → office.synthesise
                                                      ├ blockers + job_pauses (approvals)
src/handlers/instruction.ts (2188–6690 = one closure) ├ job_steps (checkpoints, 4 handlers)
 ~29-stage cascade → speaker()/pickRoster → prompt →  └ recover_stalled_jobs / requeue / resumable_now
 post-gates (coherence, provenance)                   responsibilities → dispatch_due_responsibilities (duties)
Containment: job_origin / may_act_outside / claim_delivery / containment.ts REACH / leak witnesses
State: 131 tables ever created (≈122–129 live), ~855 functions ever created (564 app, 291 public; 96 public.hq_*)
Access: browser → hq-api (service key, 61 SECTIONS / 91 ACTIONS) → public.hq_* wrappers → app.*; RLS 82 tables, all policies name role ai_team_app
```

## 4. Changes since the September remediation work

- HISTORICAL: GREEN verdict 15 Sep (commit `63c5a26`, worker v391, 375 migrations). HANDOFF now reports worker v848, migrations to 0606, "#381 containment DEPLOYED and ACCEPTED 29 Sep".
- CURRENT FACT (git, 24–29 Sep): three-branch integration trial; 28 Sep merges (backend remediation, Team HQ UX, #374 acknowledgement-is-not-authorisation, #373 project provenance, #371 paused-question edges, RC migrations 0592–0599); 29 Sep containment cascade (#378 audit, #379, #380 recorded, #381 declared-conversation doors + retired test destinations 0605/0606) and #382 (Team HQ served at every address, "Basecamp" removed).
- **INFERENCE (important):** GREEN did not cover containment. At least seven harness-escape incidents (#298, #323, #333, #348, #354, #378, #381) reached real chats *after* the verdict. The verdict document itself lists what it does not claim; CLAUDE.md's "backend certification COMPLETE" framing is therefore weaker than it reads for this class.
- DOCUMENTATION DRIFT (§33): CLAUDE.md status table is 19 days stale (v391/375) against HANDOFF (v848/0606); "409 applied" appears in CLAUDE.md, 608 in HANDOFF, 621 files on disk.

---

## 5. Intended product vs current architecture

| Requirement | Current | Verdict |
|---|---|---|
| One relationship with Claire | Claire is the *fallback* addressee/synthesiser; only-chief-speaks holds at ≥4 separate seams; specialists still directly addressable on Slack/dashboard | Mostly; no single choke-point |
| Persistent, learning specialists | Identity/lessons/skills/tools are four clean tables; lessons injected only in the answering prompt; no per-agent performance/experience | Foundation present, learning loop partial |
| Specialist collaboration traceable | Fan-out/fan-in derived + `branch_groups`; "who was asked" stored five ways | Works; fragmented provenance |
| Dynamic specialists | Governed hire path exists (justification, expiry ≤180d, cap 3, no default tool grants) but router set is compile-time closed | Foundation present; 3 blockers |
| Project as mandatory boundary | Enforced at ingress (`inbound_commands` NOT NULL, Unnamed fallback); `jobs/tasks/documents/blockers.project_id` nullable | Latent invariant gap |
| Cross-project intelligence | Only `decisions` cross projects; `search_documents(null)` widens silently; no provenance-tagged cross-project read | MISSING CAPABILITY |
| One relationship across interfaces | conversation = (channel, chat segment, person) | **ARCHITECTURAL DEFECT** |
| Human tasks ≠ AI work | Same `tasks` table split by `assigned_to_human`; jobs separate; one deliberate blocker→task leak | Coherent |
| Proactivity | One scheduler = the job engine; 5 SQL detectors; dial doesn't gate duties | Right foundation; thin |
| Learning requires confirmation | Marked rules persist at 0.95 *then* say back; unmarked/corrections are offered; skills persist with no press | Diverges from §13 |
| Configurable authority by action type | `autonomy_policy` matrix is data; not editable except SQL; consulted at 3 call sites | **ARCHITECTURAL DEFECT** |
| Multi-user | 0 tenant columns; 275 `'grant'` literals in SQL, 35 in TS | Foundational blockers (2) |

---

## 6. Claire

- CURRENT FACT: `speaker()` (`instruction.ts:768`) → `roster[0] ?? 'chief-of-staff'` (`:1071`). Claire is the default answerer and writes the fan-in synthesis. Claire cannot be retired (`hq_staff_retire`) or excluded from a project (`staff_on_project`).
- Only-chief-speaks: enforced by `pagerFor` reading `system_config['telegram.only_chief_speaks']` (`src/office/pass.ts:328`), hard-coded `announce=false` on hand-off children, and retirement of the seven staff Telegram bots (0352). **INFERENCE:** a handler forgetting `announce:false`, or the flag flipping, lets a specialist speak; there is no delivery-layer rule "persona must be Claire unless the job was addressed."
- Boundary with infrastructure: appropriate (Claire does not own transitions, leases, delivery idempotency, tool authorization). **ENGINEERING DEBT:** specialist addressing (`addressed_to`, `namedColleague`) remains three-fold in code; Grant's own words (0352) route direct talk to Slack/portal only. It should stay as one `addressee` slot on the Turn record (§19), not be removed (removing it reverts ledger R21).
- **INFERENCE (untraced):** for a multi-specialist request the parent job answers under `roster[0]`'s name *and* a synthesis child answers as Claire, so Grant could receive two human-facing answers. Needs one drive to confirm.

## 7. Specialists

CURRENT FACT: eight permanent roles; `public.staff` (slug unique, expertise text[], communication_style, permanent, active, prompt_version). Router set is a compile-time closed enum (`ROLE_SLUGS`, `ROSTER_CEILINGS`, `router.ts:53–62, 345+`); `verifyRosterMatchesDatabase` checks only permanent staff. Tool reach: `staff_tools` allow-list ANDed with `tool_permissions` in `app.staff_may_use`.
**ARCHITECTURAL DEFECT (narrow):** `staff_may_use` has **no runtime caller** ✔ (grep: only comments in `src/agents/guidance.ts` and `src/mcp/client.ts`; SQL callers are `skills_for`, `request_tool`, the capability index). Tool access "as data" therefore governs what the prompt *says* an agent can do and what skills report as `missing`, not what a handler will do. ADR-0018/0119's "AND enforced" is DOCUMENTATION DRIFT until fixed.

## 8. Persistent agent identity and learning

| Aspect | Status |
|---|---|
| identity/role/expertise/style | present (`staff`); prompt composed inline from columns at `instruction.ts:5749` |
| versioned prompt body | `staff_prompts` written and constraint-checked but **never read by `src/`** — `prompt_version` points at text the model doesn't see (ENGINEERING DEBT) |
| lessons | append-only `lessons`; scopes global/project/staff/kind; 280-char cap; `lessons_for` orders staff→kind→project→global |
| skills | `skills`, `skill_uses`, `skills_for`, `skill_effect`, `retire_skill` |
| project experience, per-agent performance, relationships | **missing** (performance exists per *model*, ADR-0031, not per agent) |
| injection | `guidanceFor` has one caller (`instruction.ts:5708`); briefing, reports, synthesis, reminders **do not read Grant's standing rules** (ENGINEERING DEBT) |

Separation of identity/procedure/belief/reach is clean at schema level and deliberate (ADR-0015/0017). Growth is uncontrolled-mutation-safe by construction (append-only, address-free skills, 280-char lessons, "None of the above grants you anything").

## 9. Dynamic specialist readiness

CURRENT FACT: `app.hq_staff_hire(name,title,justification,expires_at,remit)` — temporary only (`permanent = (expires_at is null)` CHECK), expiry ≤180 days, live-temporary cap `agents.max_live_specialists`=3 (not self-adjustable), name+slug collision-checked against both, **no default `staff_tools` grants**, expiry swept each worker tick. `app.create_temporary_specialist` has no caller.
Blockers (INFERENCE, each verified in SQL/TS by the investigation): (a) router closed set — a hired slug is dropped by `pickRoster` ceilings; (b) ADR-0023 absence-means-everyone — `staff_on_project` includes anyone with no `project_staff` row, so a new specialist is on *every* project from day one (membership, not tool authority); (c) `staff_may_use` unenforced; (d) `staff`-scoped lessons attach to a slug and hire's collision check ignores retired staff (slug reuse would inherit lessons).
**Verdict:** feasible **without redesign** using the existing hire shape + a proposal press (the `suggestions`/`decide_suggestion` pattern) after slices 4 and 8.

## 10. Human-turn understanding (the primary question)

**Why the file is large (CURRENT FACT).** `instructionHandler` spans 2188–6690 = **4,502 lines (67%) in one closure**. It is mostly *writers, guards and prompt assembly*, not interpretation: plan/pursuit (238–440), spines (440–757), `speaker` (768–1133), task writers (1133–1356), voice (1356–1585), links (1585–1817), memory (1817–1984), then inside the handler: pre-gates 2190–2378, resolve/route/convene 2379–2950, recognisers+writers ≈1,670 lines (3240–4910), pursue/confirm, outcome, context assembly (5275–5735), prompt (5735–6160), post-gates (6160–6690).

**Ordered cascade** (earliest side-effect or return first): dictation clean (2217) → link/caption pairing (2222) → **`rejectsWithoutSaying` early return (2265)** → `closesWithoutAsking` early return (2307, guarded by open-question check) → retraction (2368) → **`resolveAgainstThread` — a model rewrite replaces `instruction` (2379–2386)** → `speaker()` (2388) → fan-out (2678–2887) → **`readPlan` early return (~2959→3011)** → populate/connect early return (~3134) → **`understand()` model IR (3210)** → 16+ sequential recognisers/writers with ad-hoc vetoes (3240–4910; side effects: `stop_conversation_work` 3570, `act` 3856, `my_task_add`) → teaching/remember (3670; early return 3826) → `spokenAnswer` → `hq_answer_blocker` (4741) → `planAndPursue` only if nothing acted → prompt → post-gates.

**Is there a canonical IR? Partly.** `Understanding` (`src/agents/understand.ts:104`) is model-populated, subtractive-only and advisory by design (ADR-0044); consumed at ~8 decision sites. It is skipped on the trivial path (≤60 chars with no connective, `:407` — so `kind` is `other` for the commonest turns), on handoff branches, and never reached on the three early returns above it. Meanwhile `instruction` is read **74 times**, `asSaid` 15, `understood` 12, `hisWords` 4; four independent clause segmenters (regex `split`, model `understand`, retraction pivots, calloff); ~30 regex readers (`request`, `intent`, `router`, `calloff`, `again`, `teaching`, `tasks`, `mine`(~28 lists), `links`, `plan`, …).

**Failure classes, with evidence:**
- *Reader ordering changes meaning* — ✔ **`rejectsWithoutSaying` (2265) has no open-blocker guard while its sibling `closesWithoutAsking` does (2316)**; `REJECTS` matches `^no[,.\s]` (`negation.ts:136`). A bare "No." answering an open approval question is answered "What did I get wrong?" and the blocker is never declined (the spoken-answer path at 4741 is never reached). The investigation executed the predicates; I confirmed the wiring in source. Reach depends on the question being scoped to that chat (not run). **BUG**, and the demonstrated instance of a class.
- *Message-level destroys clause-level* — `readPlan` runs on the whole resolved message and returns early; executed on "Create a notebook…, then make a slide deck. Also from now on always use bullet points, and what are my tasks today?" it yields steps `project,add_source,generate,ask` with **no preference step**; teaching (3670) is never reached (INFERENCE that the preference isn't stored that turn; handler not driven).
- *Guards that permit reading the paraphrase* — `linkRequest` (3848), `pageRequest` (4084), `readPlan/populate/connect` read the resolved rewrite; #328's rule ("a guard that permits may not read a paraphrase") is applied per site, not enforced. INFERENCE: `pageRequest` on an expanded "open it" could permit a browser gather; no covering test.
- *Same words, several readers* — "Stop sending me updates." is claimed by nothing (deliberate, #364); "No, leave it." fires `callsItOff` **and** `spokenAnswer='no'` (two side-effecting writers, one sentence).
- *Named-specialist addressing* — two paths (`addressed_to` from channel; `namedColleague` in text); not core to understanding; keep as a slot.
- *Temporal* — dates parsed only inside personal-task titles (`due.ts`, `remind-at.ts` via `mine.ts`); no general temporal slot. *Project switching* — not read from text in the handler (SQL cascade, §11).

**Falsification of "a canonical TurnUnderstanding would materially simplify."** **Partly falsified.** The IR already exists and is *deliberately* advisory; most of the 4,502 lines are writers/guards/prompt blocks a new struct would not delete; the regexes each carry a permission/provenance/idempotency guard. **What is real and narrower:** (i) three parallel "his words" variables (`asSaid`, `hisWords`, `resolved.from`) plus `firstOf`/`firstOfHis`, chosen per call site — the #313/#322/#327/#328/#329 class recurs *by construction*; (ii) no precedence table for early-return gates; (iii) recognisers that run before the IR can discard clauses.
**Recommendation:** do **not** rewrite around a new IR. Introduce a small immutable **`Turn` value** built once at the top (`said, cleaned, kept, withdrawn, resolved, resolvedFrom, isBranch, addressedTo, answersOpenQuestion`), where each field is typed for its entitlement (permitting readers can only receive `said`/`kept`), plus a **gate-precedence table** for the early returns, plus moving `understand` above the plan/populate/teach early returns. What disappears: the three his-words variables, 21 `isBranch ?` guards, ad-hoc vetoes. What merely relocates: the regexes and writers (leave them).

## 11. Projects

**Inference vs propagation kept separate.**
- *Inference* (CURRENT FACT, `enqueue_inbound` as redefined by 0547/0548): asset `context.project_id` → caller-named project → Slack channel map → `app.current_project(scope)` (latest `project_switches` row by `switched_at desc, seq desc`; fixture reads as none) → Unnamed → most-recently-updated active project. `src/projects/context.ts` (`resolveProject`, `switchTo`) has **no importer** — dead TS beside the real SQL cascade (ENGINEERING DEBT). The last rung is a guess (0337: 193/194 messages at the time; current share unmeasured).
- *Propagation:* message→job always non-null; job→child by `coalesce(p_project, parent.project_id)`; retries keep the row; handlers pass `job.projectId` to `retrieve()`.
- **Invariant gap (latent ARCHITECTURAL DEFECT):** "meaningful work belongs to a project" is enforced only at `inbound_commands` (default Unnamed) and `duty_said`; `jobs.project_id`, `blockers.project_id`, `tasks.project_id`, `documents.project_id` are nullable; readers `coalesce(project_id, unnamed_project())`, proving nulls are expected. And `retrieve(db,q,projectId=null)` → `search_documents(p_project null)` = **every project, silently** — a null-project job would search the whole office with no boundary or provenance guard (INFERENCE: no real caller traced).

## 12. Cross-project intelligence

CURRENT FACT: only `public.decisions` crosses projects (`app.decisions_about`, no project argument, project as provenance, cap 4, ADR-0036). `relations` are per-project; `who_knows_about` matches staff expertise, not knowledge. `search_documents(p_project null)` does return `project_id` per row but no caller uses it deliberately and there is no sharing/permission model. **ContextPack does not exist** in code (one line in `AUTONOMOUS-RUN.md:1274`, "not started"; issue #288).
**MISSING CAPABILITY.** RECOMMENDATION: a *derived* read function over `search_documents` + `project_aliases` + `relations_of` + `decisions_about` returning `(project_id, connector, citation)` — no copy, no new store (0310's rule). A ContextPack, if built, is that query's result, never a table.

## 13. Conversation and cross-channel continuity

- CURRENT FACT: there is **no conversation entity.** `app.conversation_before` (0549) filters `origin_channel = self AND split_part(origin_ref,':',1) = self.chat AND coalesce(subject,actor) = self.who`, window 30 min, 12 turns. `conversation_work`/`conversation_extent` use the same tuple. Only the *person* axis crosses channels (`subject_identities`, 0056).
- Grant test: Team HQ turn (channel `voice`, `<session>/<project>`) → Telegram turn (channel `telegram`, chat id): the Telegram turn's `conversation_before` returns none of the Team HQ turns; project scope is per surface (`project_switches.scope_kind ∈ telegram_chat|slack_channel|voice|dashboard|global`; **`global` is never consulted**). What *is* shared: person, projects, documents, outputs, standing lessons.
- **Verdict: continuity is similar, not shared → ARCHITECTURAL DEFECT (ownership of conversation identity).** HISTORICAL context: 163 of 202 real project switches were on Telegram — Grant's real usage makes this the most user-visible gap.
- Adapter violations: Team HQ voice edge function composes conversation identity (`<session>/<project>`, `voice/index.ts:414`) and runs STT itself (transcript/STT not recorded); `app.voice_answer` (0102–0110) is a **regex-driven responder with no job** — no output row, coherence gate, `inference_usage`, or delivery ledger; the same question through Telegram takes the full office and may answer differently. Live voice call is a second external "Claire" (OpenAI Realtime) whose only bridge is the `ask_the_team` tool. Vocabulary drift: Team HQ chat writes `origin_channel='voice'`, docs/0313 say `teamhq`.

## 14. Delegation and collaboration

CURRENT FACT: selection `speaker()`→`pickRoster` (subject match per clause, ceilings, semantic fallback); extras become `enqueue_child_once(job,'office.instruction', …, announce=false)`; recursion stops because a child with `addressed_to` and no selection convenes nobody further, capped by `jobs_enforce_delegation_depth` (0020). Fan-in: `fan_in_over` when ≥1 branch started (0563), `branch_groups` + `job_branches`, 20-min deadline, `office.synthesise` child; 0 outputs → says so, 1 → relays verbatim, ≥2 → model behind invention gate; failed branches are named "lost"; `fan_in_ready` = all *required* settled (required defaults false) and (all settled or past deadline).
Inheritance (SQL-verified): `enqueue_child(_once)` copies `parent_job_id, correlation_id, project_id, requested_by, priority`; `synthetic` by trigger `job_inherits_synthetic` (0542); **`pinned_config` is NOT copied** (children lose `command_id/origin/addressed_to`; reply routing and `hadHistory` need a lineage walk — three depth limits 8/64/unbounded). Approval-created children copy the whole `pinned_config`.
**Defects:** (i) **BUG (source-verified, not run)** synthesis starvation — synthesis pauses 60 s at a time (`synthesise.ts:~187`), `resume_job` (0436) does not touch `attempt`, `dequeue_job` (0330) increments it every claim and excludes `attempt >= max_attempts`; nothing decrements it; after ~5 wakes a slow-specialist fan-in leaves the job un-dequeueable and un-failed (no sweep covers `queued`). The header at `:24` claims the opposite. `verify:parallel` passes only for short waits. (ii) 20 raw `enqueue_child` callers are not retry-idempotent (plan steps, notebook chains) — ENGINEERING DEBT. (iii) "Who was asked" lives in five places (`recipient_agent`, `routing_decisions.roster`, `consultations` best-effort, `job_branches`, the tree) — ENGINEERING DEBT.
**Journey D caveat:** specialist-*initiated* delegation mid-work is not evidenced; hand-off chains are initiated by Claire's routing at the root.

## 15. Obligation / work model

**CURRENT FACT: there is no obligation, conversation, plan or pursuit table.** Obligation = `app.obligation_tree/obligation_state` (0562) walking `parent_job_id` from the root `office.instruction` job (`parent_job_id IS NULL` + an inbound command); conversation = derived tuple; plan = `pinned_config` + `job_steps` receipts (+`job_plans` effect preview); pursuit = an `office.pursue` job with rounds. State order: root cancelled → `cancelled`; open blocker on live job → `waiting_on_user`; any live job → `working`; no job complete → `failed`; any failed/cancelled → `partially_complete`; else `fulfilled`. HISTORICAL: 53/56 real parent/child pairs finished the child *after* the parent — derivation handles this without counters.
**Assessment:** derivation is the right choice (no counter can strand; no second truth) — **PRESERVE**. Gaps: (a) `paused` counts as live, so a non-resumable pause (`needs_reconciliation`, `checkpoint_stale`, `credential_required`) with no blocker reads `working` forever (INFERENCE from SQL; no check); (b) duty roots are invisible to `conversation_work`/`owed_a_word`; (c) ownership/answer-delivered are thin (only `recipient_agent` and deliveries) — FUTURE PRODUCT REQUIREMENT: a *derived* `obligation_summary(root)` API that Claire can call, not a table (§22 of the brief).

Concept table (abridged; canonical state / creator / owner / duplicated by):

| Concept | Facing | Canonical | Creator | Duplicated by |
|---|---|---|---|---|
| inbound_command | human | `inbound_commands` (+`synthetic`) | adapters | `jobs.pinned_config` copy |
| conversation | human | none (derived tuple) | — | telegram_chats/slack maps |
| obligation | human meaning | `obligation_state(root)` | derived | `conversation_work`, `job_progress`, `today` |
| job / parent / child | infra | `jobs.state` (14) | enqueue fns | `states.ts`, ~18 SQL lists |
| plan / step / checkpoint | infra | `pinned_config`, `job_steps` | planner/`runSteps` | ADR text; 3 "plan" vocabularies |
| human task | human | `tasks` (`assigned_to_human`) | `my_task_add`, blocker trigger | `blockers.satisfies_*` |
| blocker/approval/pause/impediment | human/infra | `blockers`, `job_pauses(binds_to)`, `job_impediments` | `raiseBlocker`, `pause_job`, `app.cannot` | each encodes "stuck" via triggers/views |
| responsibility/duty | infra | `responsibilities` | Grant/migrations | `duty:<slug>` roots |
| output/delivery | human | `outputs`, `deliveries` | handlers/`deliverPending` | `documents` |

## 16. Human tasks vs AI work

CURRENT FACT: one `tasks` table, two populations (`assigned_to_human` vs `assignee_staff`); `hq_portfolio_tasks` excludes human rows; `studio_tasks` shows both marked `mine`; `my_tasks` reads human rows. Jobs never read tasks. **One deliberate leak:** trigger `blockers_make_a_task` (0496) files a human task for a blocker with `work_can_continue=false` and a job; ticking it resolves the blocker as `approval_options[1]` (an *option-order assumption*; ENGINEERING DEBT) via `app.task_answers_blocker`, which **bypasses `hq_answer_blocker`** (no lock, no option validation, no `on_answer`/standing/`approval_next`) — ARCHITECTURAL (approval door, §23). **COHERENT** otherwise. Note: CLAUDE.md's "harness tasks never reach his calendar" (#379/#380) is still partial (#380 lists readers on `is_fixture` only).

## 17. Planning

CURRENT FACT: `planAndPursue` (`instruction.ts:238`, runs only where the cascade declined) → `planFor` (`goal.ts`, catalogue of enabled `tool_permissions` rows with level<3) → `validate` (vocabulary, forward-only `needs`, ≤8 steps, `audience:'outside'` refusal) → `office.pursue` → `compile()` → `runSteps` → `mayAct` at do-time → executor → `Observation` → `assess` (7 verdicts) → bounded replan (3 rounds/120 s, `tried` fingerprint, same-route stop). Coherent and deterministic in the assessment half. **Three "plan" vocabularies** (`agents/plan.ts` notebook steps; `goal.ts` `GoalPlan`; `tools/plan.ts` `job_plans`) are distinct but un-unified (ENGINEERING DEBT). ADR-0045's "planner runs only where the cascade declined" is DOCUMENTATION DRIFT: `readPlan` (2959) runs *before* the cascade.
Refusal rule (ADR-0046) lives in **three agreeing places** — `pursue.ts:231`, an English regex `final()` in `satisfied.ts:114`, and tests-by-regex — and `final()` does not match the declined step's own impediment; INFERENCE gap: refused+empty mixed plans can re-plan toward a refused intent through another capability (authorization not widened; each step re-passes `mayAct`).

## 18. Capabilities and executors

CURRENT FACT: ~19 enabled `tool_permissions` rows; planner `EXECUTORS` (`perform.ts`) cover 5 (`db.read, notebook.read, draft.create, task.create, task.extract`) — **nothing in the planner path performs an external effect today**. The rest have handlers/adapters reachable through the cascade. So #285's "capabilities without executors" is **MISSING CAPABILITY** (planner breadth), *not* an architectural inability — `check:capabilities` (handler kind → enabled registry row; one-directional) and `npm run levels` (registry → handler; a report) narrow it. MCP is the sharpest: `mcp/client.ts` discovers only — **no `tools/call` client**; an enabled offered tool with `delivered_by='mcp:<p>'` satisfies the 0298 CHECK with nothing behind it. Truthfulness: planner path is real (`perform.ts:588` "granted but nothing performs it"); conversation path `blocked_capability` in `outcome.ts` is **unreachable in production** ✔ (`capabilityRefused: false` hard-coded at `instruction.ts:5244`, set only in tests) — BUG (the defaulted-parameter defect CLAUDE.md already names). #302 (understood-but-cannot-act answered with a promise) remains open.

## 19. Knowledge

CURRENT FACT: Postgres is canonical (ADR-0003/0013/0043). `documents` keyed `(connector, external_parent_ref, external_ref)` with fingerprint and generated weighted tsvector; `mirrors_document_id` marks the office's own writes; `search_documents` hides archived items and steps mirrors aside; `knowledge_connectors` (6 kinds) + `project_knowledge` coverage note; mail is derived by contact/alias/thread (ADR-0037/38); untrusted connectors fenced (browser/gmail/mail); null connector = the office's own work, not fenced. **External systems are sources/projections, not competing truth — COHERENT.** Debt: legacy `projects.notebook_ref` beside `project_attachments`; `search_documents` mirror-dedupe is procedural, not constrained.

## 20. Skills

CURRENT FACT: `skills` is append-only, versioned, provenanced prose; a trigger refuses addresses/credentials; `tools` FK to `tool_permissions`; nothing "runs" a skill (injected into the prompt); `staff_may_use` never reads skills; a verify test proves the most persuasive skill changes nothing. Separation knowledge≠skill≠tool≠permission holds at schema level. Loop readiness: storage/version/provenance/`skill_effect` exist; **`skill_effect` has no reader outside SQL/verify**, nothing retires a poorly-measuring skill, no agent-side proposal path; `src/eval` scores answers/models, not skills. **BUG:** `remember()` stores a skill from any message with steps or a method announcement with no `marked` gate and no offer (`remember.ts:381`) — the reverse of the care taken for lessons. RECOMMENDATION: skill proposal as a `suggestions` kind decided by a press; a `skill_effect` consumer; auto-flag.

## 21. Learning

CURRENT FACT vs the required flow (candidate → Claire confirms → Grant confirms → persist):

| Path | Persists without a press? |
|---|---|
| Marked ("from now on", "always", "never", "remember that"…) | **Yes** — `app.learn` at 0.95, say-back afterwards (`remember.ts` cites ADR-0017: no bottleneck) |
| Unmarked preference-shaped sentence | No — offered via `propose_standing_rule`, decided on the Governance page (#290) |
| Correction | No — offered once per class (#147), decline durable |
| Procedure with steps/method | **Yes** (skill) |
| Bound to the conversation | Not stored |
| Withdrawal | retraction row |

There is **no agent-authored learning path** (nothing infers a candidate from outcomes). The "confirm" for marked rules is a say-back *after* the write; for offers it is a press on a page Grant does not use on Telegram. **Decision needed from Grant (not an engineering call):** one gate for all persistence, or say-back-plus-review-after. HISTORICAL: the wide-`STANDING` alternative was measured and rejected (#364; 0 real turns open with "stop"; permanent rules are irreversible because `lessons` refuses UPDATE).
**BUG (INFERENCE, combining two verified facts):** `guidanceFor` treats any `learned_by` not a staff slug as Grant's standing order (`guidance.ts:100`), `learned_by = split_part(requested_by,':',2)`, and the Telegram webhook accepts any private-chat sender (`telegram-webhook/index.ts:176`, no allowlist ✔). A stranger's "always …" could therefore be stored at 0.95 and shown to the model as an order from Grant. Not driven; triage first.

## 22. Permissions and autonomy

CURRENT FACT: data: `autonomy_policy` matrix with CHECK `action_level<3 or verdict<>'proceed'` (a level-3 action can never proceed), `autonomy_settings`, `tool_permissions.level/enabled`, standing authorizations (upgrade `ask`→`proceed`, never `refuse`; trigger refuses a level-3 standing row), `blockers.standing_*`. `app.may_act` is consulted at **three** call sites (`perform.ts:721`, `governOutward` via calendar-tasks, `drive.ts:265`) ✔ `instruction.ts` contains 0 references to autonomy/`mayAct` (grep count 0). **ARCHITECTURAL DEFECT:** the dial (#15) is not consulted by the main cascade or by Notion writes, NotebookLM add/push, Slack posts or plan execution; ADR-0035 discloses this. At `observe` the office still writes. Editing a matrix cell or tool level is possible only via SQL (ADR-0035 "Grant can change a cell" = DOCUMENTATION DRIFT); code-embedded policy: `DELIVERS_TO_PEOPLE` (`goal.ts`), `NEVER_PROPOSABLE=3`, the `REACH` registry, affirmative word list in `hq_answer_blocker`. Latent BUG: `may_act` treats `requested_by` `trigger:*`, `mcp:*`, `hq`, `connector:register` as "a person asked" (0423:83), upgrading `ask`→`proceed` below level 3; only duty callers pass a job today.
Chain separation knowledge≠skill≠tool≠permission≠autonomy≠approval: **holds in schema, leaks at runtime** (permission not enforced per staff; autonomy not consulted; approval mechanism-specific).

## 23. Approval

**There is no single approval lifecycle: seven mechanisms share only `blockers` and `hq_answer_blocker`.**
M1 plan-step ask (`perform.ts:772–841`: blocker + `job_pauses.binds_to` sha256 fingerprint; joined to the pause by job+±10 s window, not FK) · M2 `governOutward` (binds nothing; plan re-derived next run) · M3 generation/plan approval (binds a *copy* of mutable `pinned_config`; `notebook.generate` gates on the presence of `approved_by`, not a resolved blocker row) · M4 Drive ingest (`on_answer` exact payloads) · M5 tool reach (`approve_tool/decline_tool/offer_mcp_tool`, `p_by='grant'`, unlocked reads) · M6 standing authorizations · M7 document review/`decide_suggestion`/`hq_undo`.

| Required property | Verdict |
|---|---|
| binds exact action | **M1 only**; `app.approval_binds`/`approvalStillBinds` have no production caller |
| changed action invalidates | M1 proven behaviourally (isolated); none for M2/M3 |
| yes at most once | blockers: `for update` + `already` (0596), `approved-<blocker>` child key, behavioural race suite; effects: `step_begin` parks only `external` — `local` steps repeat on resume (`perform.ts` comment overstates) |
| no executes zero | M1 (behavioural), M3, M2/M4 by construction |
| no cannot be replanned around | enforced in **code in three places**, not data/schema |
| duplicate answers | harmless (lock); task-tick door has a narrow unlocked race |
| restart | harmless for M1 (isolated: "worker dying after the answer: performed once") |
| another interface | same door except the **task tick** (weaker door); no Telegram/Slack inline buttons; spoken yes/no refuses bare acknowledgements (#374) |
| delivery failure vs approval | independent (DB rows; isolated R46) |
| expiry | **none** — no path writes `expired`/`withdrawn`; an approval can be answered days later |

Approver identity: `hq_answer_blocker` takes no identity; `callbacks.ts:409–430` attributes to `options.subject ?? 'grant'`, ignoring `row.actor` (BUG). **Bugs found where an offered option performs nothing** (the CLAUDE.md "offer may only promise what the press performs" class, still live): `governOutward` "Yes, do it" (`approval.ts:291`: no `on_answer`, no `approval_next`, `workCanContinue:true` — re-asks next run unless a standing row exists; latent today because 0424 seeds one for the calendar duty); `channels.ts:159` name-conflict question; `drive.ts:346` options 2 and 3 (`check:answerable` is blocker-level, cannot see per-option promises); `perform.ts:841` `.catch(() => undefined)` on `raiseBlocker` (job paused with no question).
**Classification:** ARCHITECTURAL DEFECT — approval binding and answering have several interpretations rather than one authoritative lifecycle.

## 24. External side effects

Action-contract matrix (Reg = registry row; Dial = autonomy consulted; Apr = mechanism; Idem/Rcpt):

| Action | Reg | staff_may_use at exec | Dial | Apr | Idem/Receipt |
|---|---|---|---|---|---|
| Calendar write | calendar.write L2 | no | yes (`governOutward`) | M2 | `hqTaskId` tag + link hash |
| Drive ingest | drive.ingest L1 | no | yes | M4 | child per file |
| Notion write | notion.write L2 | no | **no** (registry `enabled` only) | none | `createPageIfAbsent`, links |
| Slack post / Telegram send | L2 / none | no | **no** | none | `claim_delivery` (provenance only) |
| Gmail send | L3 disabled | — | — | — | no code path (refused by absence) |
| GitHub write / `ci.dispatch` | L3 disabled / dormant | — | — | — | `ci_reserve` atomic |
| MCP tool call | offered disabled | — | — | M5 | **no executor** |
| Browser gather | web.read L1 (uses signed-in sessions) | no | no | none | `runSteps` external → parks |
| Notebook generate/add/push | notebook.write L2 | no | no | M3 / none | `approved-<blocker>` key |
| Task/reminder | task.create L1 | no | planner only | none | writer-idempotent (job+title, no unique index) |
| PDF/artifact | document.create L1 | no | no | none | `runSteps artifact.report` |

**Two choke-points exist, and both answer *origin*, not *authority*:** `containmentRefusal` in `runJob` (REACH registry, fail-closed for unlisted kinds) and `claim_delivery/delivery_refusal`. **"Contacting another human needs Grant's approval" is structural only by absence of capability** (gmail.send off, no `slack.post` executor) plus the model-declared `audience:'outside'` refusal over a hard-coded TS set — not enforced by recipient at `claim_delivery` or by constraint. Unledgered sends: vault export (`vault-export.ts:195,212`, straight to Telegram, no `deliveries` row) and the webhook's voice-refusal reply. **Recommendation:** an explicit conceptual action contract is *worth having* — as one SQL function `app.authorize_effect(job, capability, action_fingerprint)` reached from the existing `runJob` REACH seam, not a new table (§43, slice 4).

## 25. Proactivity

CURRENT FACT: **one scheduler, and it is the job engine.** `responsibilities` (staff, project, kind, period 10–20160 min, at_time, tz, `pinned_config`) → `fireDueDuties` (`capacity.ts:288`): `defer_over_budget()` then `dispatch_due_responsibilities()` inserting `public.jobs` (`requested_by='duty:<slug>'`, idempotency `duty:<slug>:<window>`). Same queue, leases, retries. Detectors are SQL (`app.notice`: `deadline_unowned` w80, `project_quiet` w55, `source_unused` w45, `failure_repeats`, `capability_missing` w70) fired by nightly `office.propose` (had **no caller until #351**; `suggestions` had never held a row); `tasks.remind` every 15 min; briefing shows ≤3 notice items; `waiting`/stalled readings; repetition control `say_once` (0584/85/89, kind+project key, topic argument, fails open, once/day when unchanged).
Ownership today: **detection = SQL detector list; phrasing = Claire (`sayAs`); nobody "decides".** Governance: spending yes (`defer_over_budget`), notification yes (`pager_floor`, `only_chief_speaks`), **autonomy no** (duties fire regardless of the dial; the dial gates outward actions, not starting work — INFERENCE: acceptable if stated). Missing: cross-project relevance detector; "assigned but not started before deadline"; briefing-vs-reminder overlap suppression. **RECOMMENDATION:** ownership = *policy engine decides* (autonomy/notification/budget), *responsibility schedules*, *detectors propose*, *Claire speaks*; no second scheduler.

## 26. Synthetic/test containment

CURRENT FACT: stored immutable marks exist only on `inbound_commands.synthetic` and `jobs.synthetic` (0541 trigger `synthetic_is_immutable`); `test_origins` append-only (0605); `known_escapes` count cannot fall (0583). Inbound stamped by `stamp_synthetic_inbound` (synthetic unless `application_name` matches `PostgREST%`, or the conversation is declared a test origin); root inherits via `job_inherits_synthetic` (parses `idempotency_key like 'inbound-<uuid>'`); child copies parent's mark at insert (fires for every creator, incl. raw inserts). `app.job_origin` (0603): harness / trusted (root has `command_id`, `command_origin` trusted, `adapter_key_ok` positive regex per channel) / internal (root has no command and `internal_root_ok` — a `requested_by` grammar joined to real rows) / **unknown fails closed** at both boundaries via `may_act_outside`. Independent witnesses: `leak-witness.ts provenanceSql` (own regex/grammar, never calls `harness_job`), off-shape witness, static `check:door-origins`, isolated `witness-independence.ts` (breaks the guard on purpose).
**Findings:** ARCHITECTURAL DEFECT (narrow) — *origin is derived, not stored* for everything but the `synthetic` bit: six harness signals (synthetic, generated `is_fixture` from `requested_by`, project fixture, `origin_namespace='verify'`, dedupe-key regexes, parent recursion — only the first is a stored immutable fact) are patches for past escapes (0355, 0574, 0582, 0598, 0603); `is_fixture` is only as stable as the mutable `requested_by` string. ENGINEERING DEBT: door signal is a client-settable GUC (`application_name`; the repo's own proofs forge it; 0541's "cannot be faked" is overstated); voice-door trust is a regex over a `Math.random` session id; **"trusted" means "an adapter wrote it", not "Grant wrote it"** (§30 B1); `containment.test.ts:221` scans only `src/` for bare sends — `supabase/functions/**` (where webhooks run) is unscanned; three copies of the adapter grammar (SQL, `ADAPTER_SHAPE`, witness) plus hard-coded `REAL_IDENTIFIERS`/`ACKNOWLEDGED_OFF_SHAPE`; #380 lists readers still on `is_fixture` only (`app.notice`, `hq_pulse`, `hq_portfolio_tasks`, `hq_studio_core`, `studio_modules`, `task_sync_panel`, `project_export`, `blocker_makes_a_task`). The independence proof lives only in the isolated replica, outside `npm run gate`.
Propagation table (root→retry/resume same row: canonical; delegation/approval child: canonical by trigger; **tool, narration, delivery, artifact, task, lesson, suggestion: re-derived per subsystem through `harness_job` or names** — INFERENCE: no downstream mark to break, but N derivations to keep aligned).

## 27. Provenance

| Question | Class | Evidence |
|---|---|---|
| user | safely derivable | `inbound_commands.subject`, `jobs.requested_by` string; no user FK |
| request | explicit | `command_id`, `instruction`, `transcript` |
| conversation | derived per channel | §13 |
| project | explicit on job (re-derived at ingress) | `jobs.project_id` |
| root obligation | safely derivable | `obligation_state`; no stored root id |
| job/parent | explicit | `parent_job_id` (mutable) |
| specialist | explicit | `recipient_agent`, `outputs.staff_id` (written before the answer) |
| sources | explicit | `outputs.sources` (`scheme:ref`) |
| **cross-project sources** | **missing** | `outputs` has no `project_id`; sources carry no project tag |
| observations | partial | `lessons.observations` counter only |
| approval | partial | `blockers`, `approved_by` free text, not bound to the effect |
| capability | explicit | `tool_permissions`, `delivered_by` |
| external effect | partial | `events`, `deliveries`; vault export and webhook refusals unledgered |
| model/provider | explicit for office inference | `inference_usage`; Team HQ STT and Realtime not recorded |
| delivery | explicit | `deliveries.suppressed_reason` |

## 28. Reliability

CURRENT FACT ✔ verified transitions: 14 states seeded once (0005), enforced by `enforce_job_transition`; `dequeue_job` (0330) takes only `queued` with `attempt<max_attempts`; `recover_stalled_jobs` (0599, per-row subtransaction — the 25 Sep 87-minute stall was a single job making the sweep raise) recovers running/output_created/quality_review/committing on expired lease → `retrying` (or `failed`, or a 0536 checkpoint-progress grant); committed/notifying → `deliverPending`; retrying → `requeue_retrying`; paused → `resumable_now` for four reasons only (`scheduled_wait, rate_limited, provider_unavailable, dependency_wait`) or `let_job_go`/`resume_paused`. Worker per tick: each sweep in its own try/catch; each job in its own try/catch (`worker.ts:1943`); attempt caps; a failed-turn apology path.
**Invariant "one malformed job never blocks unrelated work": the mechanism is present** (per-job catch, row-level subtransaction, attempt limits, dequeue kind filter) — **no poison-job suite proves it end to end** (VERIFICATION GAP). Weaknesses: `waiting_user`/`waiting_external` are legal states **no code writes** (dead; blockers park as `paused`+`job_pauses`); **paused with a non-resumable reason has no expiry, escalation or human "reconcile" action** (no writer of `blocker_state='expired'`; 0436 says "something should say so"); TS hardcodes `attempt < 4` at `worker.ts:987, 1238, 1536` vs SQL `max_attempts` (5, raisable by 0536); a job in `retrying` with `attempt >= max_attempts` is swept by nobody (latent); `states.ts assertTransition` has no production caller (`moveTo` sends raw SQL) — the lifecycle is defined in **four places** (SQL table+trigger, `states.ts`, ~18 hand-typed terminal lists, `dequeue_job`/`recover_stalled_jobs`/`obligation_state` in-flight lists) → ARCHITECTURAL DEFECT? **No** — ENGINEERING DEBT: the SQL table is authoritative and enforced; the copies are a drift risk, not a competing authority.
Checkpointing: `job_steps(job_id, step)`; `step_begin` → do/skip/park(external only)/stale(schema_version only; `code_version` stored, unused); `awaiting_approval` pauses require sha256 `binds_to` (0457). **Only four handlers use `runSteps`** (`office.pursue, artifact.report, browser.gather, office.backup`); instruction/plan/synthesise/notebook handlers have none — Journey P/Q coverage is exactly those four.

## 29. Database architecture

CURRENT FACT: 28 enum types + ≥55 inline CHECK lifecycle lists; 82 `enable rls` / 10 `force` / 118 policies, all naming `ai_team_app`; `auth.users` has zero rows; the browser never reaches PostgREST (only `hq-api` with the service key). Domains: core work; project/knowledge; tasks/contacts; staff/capability; channels; health/governance/ledger; config/secrets. **Postgres-vs-TS split is sensible** (queue, state machine, provenance gates, harness predicates, unnamed project, dedupe in SQL; routing, coherence gates, retrieval assembly, handlers in TS). Duplicate authorities: job state (SQL vs `states.ts`; no check they agree), channel/origin vocabularies (SQL constraint vs `DeliveryChannel` vs `CHANNELS`), three harness predicates (`is_fixture`, `harness_label`, `harness_job`), project resolution (SQL cascade vs dead TS). `app.*` is a disciplined domain API through public wrappers, enforced by `check:callers/pressable/gateway-wrappers/consumed/undo/answerable`; but 111 functions were dropped at least once and `create or replace` overload traps recur. **PRESERVE the pattern; CONSOLIDATE the enumerations.**

## 30. Multi-user readiness

| Assumption | Class |
|---|---|
| No `tenant_id/owner_id/org_id` on any table (0 hits); `user_id` = platform ids only | **FOUNDATIONAL BLOCKER** |
| RLS only for role `ai_team_app`; no per-user policies | FOUNDATIONAL BLOCKER for real isolation; SAFE TO DEFER for one user |
| Lessons scope enum has no user; a global rule reaches every prompt | **FOUNDATIONAL BLOCKER** |
| **No sender authorization below the door** (Telegram: shared secret + bot exists; any private chat becomes `SUBJECT`='grant'; Slack: signature + bot-echo only) | **BUG / security today** (single-tenant assumption failing open) |
| `'grant'` literal: 275 in SQL (defaults on `added_by`, `owner`, `scope_ref`, `p_*`), 35 in TS (8+ fallback-subject sites: `callbacks.ts`, `preference-store.ts`, `progress.ts:101,329`, `pager.ts`, `slack/notifier.ts:274`, `vault-export.ts:60`) | MODERATE MIGRATION LATER (mechanical, wide) |
| Global `staff`, `staff_prompts`, `staff_tools`, `tool_permissions`, `autonomy_settings` (project-only) | MODERATE MIGRATION LATER |
| `projects.slug` unique, `project_aliases` unique globally | MODERATE (blocker only if two people share a namespace) |
| Conversation/scope keyed on chat id; `subject default 'grant'` | MODERATE |
| Single `hq.api_token` bearer; `office_members` sign-in exists but authorises the whole office | SAFE TO DEFER |
| Vault/`system_config` global; decision log office-wide (ADR-0036) | MODERATE / leak once two offices exist |
| Approver = the string `'grant'`; approval attribution ignores presser | MODERATE, but pair with §33 B2 |

Only the *foundational* items (tenant seam column strategy, per-person lesson scope, sender authorization, approver identity) belong in near-term work; see slice 9. Do **not** build tenancy now.

## 31. Test architecture

Classified by proof, not count. Vitest unit/pure ≈175 of 232 files; **source-text assertions ≈55 files** (≈40 assert `toContain/indexOf` on source; e.g. `one-live-attempt` 44 assertions, `a-dead-turn-still-speaks` 21, `containment` 18, `promise-needs-pending-work` 18, `an-obligation-is-not-a-job` 12, `his-words-not-the-rewrite` 9); 29 tests read `instruction.ts` as text and are the only vitest "seam" coverage. Live-DB suites (~167 `verify:*`) run against the **shared production Supabase**; browser ≈81; isolated-replica 33 (approval race/delivery/execution, recovery matrix, witness independence, containment); live adapters ≈30; synthetic behavioural corpora ≈45 (model-mediated, stochastic — #367); replay 2; static `check:*` 23.
`npm run gate` = `scripts/e2e.ts --gate`: ~75 scripts (door/origin checks first — ordering pinned by `gate-order.test.ts`; ~45 live suites; 16 `check:*`). **Excluded:** all isolated-replica suites (approval yes-once/no-zero, recovery matrix, witness independence), browser families, `verify:pursues`, session/shadow corpora, `tier1`, replay, vitest/lint/typecheck; #368/#377 (red browser suites in no gate) and #383 (`check:tokens` red on main) follow from this split.
**VERIFICATION GAPS:** invariants proved only by source text — "reader asks his words not the rewrite" (#313 family), "a duty says it once", "a dead turn speaks", "one live attempt", ADR-0018's "no agent path calls `approve_tool`" (`boundary.ts:223` is a source grep; the service key can call it with `'grant'`); guards and witnesses sharing predicates (`check:leaks` ~10 `harness_job` sites; independence proven only in isolated); **no test of gate order** (`rejectsWithoutSaying` vs open blocker; early returns vs `spokenAnswer`); the full handler is driven only by DB-backed scripts; **no poison-job queue suite**; #287/#295 (planner path never run through Telegram/Slack; live door can test 52% of corpus); #344 (fresh office cannot be built from the migration corpus — zero-state dies at 0534); #352 (backup rehearsal never reaches restore); sabotage-and-restore is by convention with no harness that fails when a sabotage doesn't land.

---

## 32. Representative journeys A–Y

| | Journey | Class | Key path / evidence |
|---|---|---|---|
| A | Simple question | **COHERENT** | cascade → prompt → post-gates (`quality.ts`, provenance) → outputs → delivery |
| B | Research via Claire | COHERENT WITH ENGINEERING DEBT | `speaker`→`pickRoster`→Emma answers; only-chief-speaks at 4 seams; parent may also answer (INFERENCE) |
| C | Multi-specialist | COHERENT WITH ENGINEERING DEBT | `enqueue_child_once`, `fan_in_over`, `office.synthesise`; **synthesis attempt-starvation BUG (§14)**; `pinned_config` not inherited |
| D | Specialist→specialist | **UNPROVEN** (routed hand-off exists: `handoff.ts`, `verify:handoff/sequence`; specialist-*initiated* not evidenced) | delegation-depth trigger |
| E | Project context | **COHERENT** | SQL cascade + `job.projectId`→`retrieve` |
| F | Cross-project | **MISSING CAPABILITY** | only `decisions_about`; null project widens silently |
| G | Cross-interface continuation | **BROKEN BY ARCHITECTURAL DEFECT** | conversation = channel tuple; `global` scope unused |
| H | Mixed turn | **BROKEN BY ARCHITECTURAL DEFECT** | `readPlan` early return before `understand`/teaching (INFERENCE, readPlan executed) |
| I | Change of mind | COHERENT WITH ENGINEERING DEBT | `readRetraction`, `callsItOff`; four segmenters; open #291 (dash), #305 |
| J | Human task | **COHERENT** | `personalTaskRequest`→`my_task_add`→`tasks(assigned_to_human)` |
| K | AI work | **COHERENT** | jobs; not on personal list |
| L | Approval | COHERENT WITH ENGINEERING DEBT | M1 binds; M2/M3 don't; option-performs-nothing bugs |
| M | Refusal | COHERENT WITH ENGINEERING DEBT | code-enforced ×3; bare "No." BUG; refused+empty gap |
| N | Permitted autonomous action | COHERENT WITH ENGINEERING DEBT | calendar duty via standing row (0424); no general path; planner has no external executors |
| O | Unsupported capability | COHERENT WITH ENGINEERING DEBT | planner impediment real; `blocked_capability` unreachable in production; #302 open |
| P | Long-running restart | COHERENT WITH ENGINEERING DEBT | checkpoints in 4 handlers only |
| Q | Crash after ambiguous effect | COHERENT WITH ENGINEERING DEBT | `external` parks `needs_reconciliation` (no resolution path); `local` repeats |
| R | Malformed job isolation | COHERENT (mechanism) / **UNPROVEN** (no suite) | per-job catch, 0599 subtransaction |
| S | Synthetic production-door | COHERENT WITH ENGINEERING DEBT | declared conversation + two guards + independent witness; door GUC forgeable by SQL holders |
| T | Standing preference | COHERENT WITH ENGINEERING DEBT — **diverges from requirement §13** on the marked path | write-then-say-back; unmarked path is an offer |
| U | One-off | **COHERENT** | `boundToThisConversation`, unmarked → offer |
| V | Proactivity | COHERENT WITH ENGINEERING DEBT | one scheduler; five detectors; dial doesn't gate duties |
| W | Self-improving skill | **MISSING CAPABILITY** | storage/measure exist; no proposal path, no `skill_effect` consumer |
| X | Dynamic specialist | **MISSING CAPABILITY** (foundation present) | governed hire; router closed set; ADR-0023; `staff_may_use` unenforced |
| Y | Second user | **BROKEN BY ARCHITECTURAL DEFECT** (future) | §30 |

---

## 33. Bugs (open, evidence in sections cited)

**Triage first (security-relevant):**
- **B1** No sender authorization below the door; any Telegram private chat is attributed to `SUBJECT`='grant' (`telegram-webhook/index.ts:176` ✔), reaches the full office, and per §21 may store a standing rule shown as Grant's. INFERENCE for the last step; not driven.
- **B2** Approver identity: `callbacks.ts:409–430` uses `options.subject ?? 'grant'`; `hq_answer_blocker` takes no identity; `p_by='grant'` for tool approvals.

**Correctness:** B3 bare "No." claimed by `rejectsWithoutSaying` (§10, ✔ source) · B4 fan-in synthesis attempt starvation (§14, ✔ source) · B5 `governOutward` "Yes, do it" performs nothing (`approval.ts:291` ✔) · B6 `channels.ts:159` and `drive.ts:346` options 2/3 promise things nothing performs · B7 `perform.ts:841` swallowed `raiseBlocker` failure · B8 `blocked_capability` unreachable (`instruction.ts:5244` ✔) · B9 skills stored without a press (`remember.ts:381`) · B10 `guidanceFor` `stated` flag = "not a staff slug" (`guidance.ts:100`) · B11 `may_act` "a person asked" for `trigger:`/`mcp:`/`hq` requesters (latent) · B12 TS `attempt < 4` vs SQL `max_attempts` (latent) · B13 Slack door calls `enqueue_inbound` before writing `inbound_commands_slack` · B14 unbounded `harness_job` recursion (cycle) with three unaligned depth limits · B15 task-tick door race/bypass · plus the open issue corpus (#339, #340, #336, #359, #321/#307/#303, #305, #306, #361, #362, #365, #358, #343, #338, #352, #383, #369, #326).

## 34. Engineering debt

D1 three "his words" variants and 74 raw reads · D2 four clause segmenters · D3 4,502-line single closure with ~16 sequential writers and `isBranch` at 21 sites · D4 `understand` fast path makes `kind` mostly `other` · D5 permitting readers still read the paraphrase (`linkRequest`, `pageRequest`, `readPlan`) · D6 lifecycle copies (`states.ts`, ~18 SQL lists) · D7 `enqueue_child` (20 callers) non-idempotent on retry; `pinned_config` not inherited · D8 "who was asked" ×5 · D9 `waiting_user/waiting_external` dead states · D10 `staff_prompts` decorative · D11 lessons/skills reach only the answering prompt · D12 only-chief-speaks at several seams · D13 ADR-0023 default gives new specialists every project · D14 `skill_effect` unread; performance per model only · D15 dead `src/projects/context.ts` · D16 duplicated enumerations (job state, channel/origin) with no agreement check · D17 three harness predicates + 6 name-based signals · D18 `verify:*` run on production and leave debris (#343, #372, #281) · D19 three "plan" vocabularies · D20 `step_begin` stale check compares only `schema_version` · D21 `voice` vs `teamhq` channel word · D22 `inference/policy.ts decide()` has no caller · D23 `approve_tool/decline_tool` unlocked · D24 unledgered sends (vault export, webhook refusal).

## 35. Architectural defects (sparingly — each changes an ownership, lifecycle, boundary, source or representation)

| # | Defect | Why architectural |
|---|---|---|
| AD1 | **No canonical, entitlement-typed record of what Grant said, and no precedence for turn-level gates** | core representation; the #313/#322/#327/#328/#329 class recurs by construction; demonstrated ordering bug (B3) and clause loss (H) |
| AD2 | **Conversation identity = channel identity** | ownership of "conversation"; cross-channel continuity structurally absent |
| AD3 | **No single authority path for external effects; dial and `staff_may_use` not enforced at execution** | boundary; requirement §15/invariant 20 |
| AD4 | **Approval has several lifecycles; binding exact action only in one** | lifecycle; requirement §27 |
| AD5 | **Trust/origin for non-inbound roots derived from a mutable free-text grammar; harness classification via six name-based signals** | authoritative source; root of ≥7 post-GREEN escapes (narrow: the `synthetic` bit itself is sound) |

Everything else (D-list) is debt. Multi-tenancy is FUTURE PRODUCT REQUIREMENT with two foundational blockers noted.

## 36. Missing capabilities

MC1 cross-project retrieval with provenance/permissions; ContextPack (derived) · MC2 MCP `tools/call` executor · MC3 planner executors for external writes (#285 breadth) · MC4 agent-initiated lesson/skill candidate flow; skill proposal + `skill_effect` consumer · MC5 specialist-initiated delegation; Claire-created specialists (proposal press) · MC6 cross-channel conversation/scope · MC7 expiry/escalation/reconcile for non-resumable pauses and blockers · MC8 editable autonomy matrix UI/action · MC9 spend reporting (#284) and feedback consumption (#353) · MC10 general temporal slot in turns · MC11 per-agent-per-project experience record.

## 37. Verification gaps

V1 gate-order test · V2 poison-job queue suite · V3 isolated replicas not in the gate (approval, recovery, witness independence) · V4 seam tests for "permitting reader never sees paraphrase" · V5 behavioural replacements for source-text invariants (§31) · V6 M2/M3/`channels`/`drive` option answers undriven; refused+empty replan; task-tick vs dashboard race · V7 SQL/TS enumeration agreement (states, channels) · V8 `supabase/functions/**` bare-send scan · V9 non-resumable pause reads `working` · V10 stranger-sender refusal · V11 `jobs.project_id` non-null for real work · V12 synthesis wait > 5 wakes · V13 planner path through real Telegram/Slack (#287/#295) · V14 fresh-office migration build (#344).

## 38. Future product requirements

FP1 tenant/user seam and per-user lessons, vault, config, RLS · FP2 per-user approval authority and sender allowlists per adapter · FP3 stored/derived obligation summary with owner and result-delivered · FP4 per-person board arrangement (#341) · FP5 Gmail intelligence (#172) · FP6 shared-project membership/visibility · FP7 per-user Claire configuration.

---

## 39. H1 / H2 / H3 / H4 judgment

- **H1 (sound; only ordinary bugs)** — *rejected.* Ordinary bugs exist (§33), but AD1–AD5 are boundary/ownership problems: the same class recurred ≥7 times each in the issue corpus (rewrite-vs-words ×6; harness-escape ×7 after GREEN; offer-cannot-be-performed ×9 in CLAUDE.md). Patching instances has demonstrably not closed the class.
- **H2 (sound core; semantic-orchestration and authority debt requiring consolidation)** — **accepted.** Counter-evidence sought against H2: the IR *already exists* and is safety-designed (so no new IR is needed — I narrowed my own initial hypothesis); obligation derivation is correct and sufficient; containment's stored `synthetic` bit is sound. These reduce the *size* of the consolidation, not the verdict.
- **H3 (orchestration fundamentally confused)** — *rejected.* Claire → derived obligation → children → synthesis → delivery is coherent; failures are in *readers of language* and *authority plumbing*, not in the control-plane model.
- **H4 (foundation wrong; replace a core)** — *rejected, bar not approached.* No requirement is blocked by the job engine, state machine, Postgres-as-truth, checkpointing, or delivery layer.

## 40. Preserve / consolidate / redesign / remove / replace

| Subsystem | Decision | Note |
|---|---|---|
| Inbound commands / adapters | PRESERVE (+CONSOLIDATE sender auth, conversation key) | door stamping is sound |
| Human-turn understanding | **CONSOLIDATE** | `Turn` value + gate table + `understand` earlier; no rewrite |
| Claire | PRESERVE | add delivery-layer persona rule |
| Specialists / staff persistence | PRESERVE (+CONSOLIDATE ceilings to data) | enforce `staff_may_use` |
| Dynamic agents | CONSOLIDATE (extend hire path) | proposal press, no default grants |
| Projects | PRESERVE (+NOT NULL on work tables) | delete dead `context.ts` (REMOVE EVENTUALLY) |
| Cross-project knowledge | CONSOLIDATE (new derived reader) | no new store |
| Conversations / cross-channel | **REDESIGN (small)** | derived cross-channel conversation, `global` scope |
| Delegation / fan-out / fan-in | CONSOLIDATE | fix attempt accounting; `pinned_config` inheritance contract; idempotent children |
| Obligations | PRESERVE (derived) | add summary API; read paused-nonresumable correctly |
| Human tasks / AI jobs | PRESERVE | keep separation; fix option-order assumption |
| Planning | PRESERVE (+CONSOLIDATE refusal rule to data) | ADR-0046 as data |
| Capabilities / executors | PRESERVE (+add MCP executor as capability work) | make `check:capabilities` bidirectional |
| Knowledge | PRESERVE | |
| Skills | PRESERVE (+extend loop) | press gate for skill writes |
| Learning | CONSOLIDATE | one confirmation policy — Grant's decision |
| Permissions / autonomy | **REDESIGN (bounded)** | one authority path; editable matrix |
| Approval | **CONSOLIDATE** | M2/M3 onto M1's fingerprint binding; task-tick delegates to `hq_answer_blocker`; expiry |
| External actions | **CONSOLIDATE** | `app.authorize_effect` at REACH seam |
| Proactivity | PRESERVE (+ownership rule) | |
| Job engine / checkpointing / recovery | PRESERVE | fix bugs B4/B12; extend `runSteps`; add expiry |
| Synthetic containment | PRESERVE + CONSOLIDATE | store `origin`; retire name signals after witness parity |
| Provenance | PRESERVE (+project tag on sources) | |
| Delivery | PRESERVE (+ledger the two unledgered sends) | |
| Telegram / Slack / Team HQ | PRESERVE | remove `voice_answer` bypass or route through a job (CONSOLIDATE) |
| Voice (live call) | CONSOLIDATE | keep `ask_the_team` bridge; record STT/Realtime inference |
| DB lifecycle functions | CONSOLIDATE enumerations | SQL as source; generated TS + agreement check |
| Tests | CONSOLIDATE | behavioural replacements; isolated suites into gate |
| Old: `staff_prompts` (unused), `states.ts assertTransition`, `inference/policy decide()`, `waiting_*` states | REMOVE EVENTUALLY | after caller search |

## 41. Rewrite decision

**No rewrite. No substantial core replaced.** The evidence that *would* justify H4 — a requirement the job engine or Postgres model cannot express — was sought and not found. Rewriting `instruction.ts` "to be smaller" is explicitly rejected: size is writers and guards, not interpretation.

## 42. External-framework decision

**Do not adopt LangGraph, AutoGen, CrewAI or similar.** Judged on the hard problems: durable work, crash recovery and checkpointing are *already* in Postgres with behavioural recovery proofs; persistent agents/learning/authorization/approval binding/idempotency/provenance/synthetic containment/cross-channel continuity/multi-user are exactly what frameworks *do not* provide and would still have to be bolted on around their own state stores (a second durable store = the second-truth defect this audit is trying to avoid). A framework would replace ~none of the complexity and add a competing workflow engine. A library *inside one layer* (structured-output validation for `Turn` extraction) is fine and already effectively present.

## 43. Target architecture

Modified from the brief's sketch on evidence:

```
                       HUMAN
                         │
                       CLAUDE (one persistent relationship; persona rule at delivery)
                         │
   adapters (translate only + sender authorization + channel id) ── all write inbound_commands
                         │
              TURN  (immutable value, built once: said/cleaned/kept/withdrawn/resolved/
                     resolvedFrom/isBranch/addressedTo/answersOpenQuestion)
                         │  gate-precedence table (open question → withdrawals → plan → populate → teach → …)
                         ▼
   PROJECT CONTEXT (SQL cascade; NOT NULL on work tables)      CONVERSATION (derived across channels
                         │                                        from person + recency + global scope)
                 ROOT OBLIGATION (derived from job tree; summary API for Claire)
                   /        |         \
               answer    delegate     pursue ── PLAN (data on job + job_steps receipts)
                           │             │
                     specialists    ┌────┴───── EXECUTION CONTEXT = derived function of the job
                     (children,     │           (project, root, origin, agent, correlation) — NOT a table;
                      synthesis)    │            only `origin` is stored, once, by the door/creator
                                    ▼
                          app.authorize_effect(job, capability, action_fingerprint)
                          = tool_permissions ∩ staff_tools ∩ autonomy/standing ∩ origin (may_act_outside)
                                    │  ask → ONE approval API (fingerprint-bound blocker, atomic consume, expiry)
                                    ▼
                    CHECKPOINTED JOBS → executors → receipt (`deliveries`/`events`) → OUTPUT → DELIVERY
   KNOWLEDGE: documents/connectors + derived cross-project reader   SKILLS/LESSONS: proposal press → adopt → measure
```

Rejected: a second workflow engine, a universal mega-agent, a persisted context/ContextPack table, an obligation table, in-memory state.

## 44. Incremental migration plan (no big bang; office stays usable; contracts before deletions)

Each slice: **Objective · Problem · Contract · Touches · Must survive · Invariants · Tests before · Strategy · Tests after · Rollback · Exit.**

**Slice 0 — Triage (not architecture; cheap, evidence-backed).** Objective: close B1–B7. Problem: security/approval attribution and offers that promise nothing. Contract: sender allowlist per adapter (default-deny to unknown senders, Grant's chat/user from `office_members`/config); approver identity from the channel principal; options that cannot be performed are removed or wired; `raiseBlocker` failures fail the job visibly; synthesis wait does not consume attempts (or `resume_job` restores it). Touches: telegram-webhook, slack-events, `callbacks.ts`, `approval.ts`, `drive.ts`, `channels.ts`, `perform.ts`, `synthesise.ts`/`resume_job`. Must survive: existing real-chat flows, standing rows. Invariants: 19, 24, 25, 15 (stranger cannot teach), 29. Tests before: reproduce each (stranger message; bare "No." with open blocker; 6-wake synthesis; "Yes, do it" without standing row). Strategy: one small change per bug. Tests after: the reproductions green + isolated replica suites + gate. Rollback: revert commit. Exit: repro suite green on deployed worker.

**Slice 1 — `Turn` value + entitlement typing (zero behaviour change).** Objective: one record of the text streams. Problem: AD1 (D1, D5). Contract: `buildTurn()` at handler top; `Turn.said`/`kept` are the only fields permitting readers may take; `resolved` only for routing/prompt. Touches: `instruction.ts`, `understand.ts`, `thread.ts`, `retraction.ts`. Must survive: every current reader's input string byte-for-byte. Invariants: 1, 5. Tests before: characterisation of each permitting reader's current input across a table (incl. #313/#327/#328 sites). Strategy: introduce, alias old variables to fields, migrate readers one at a time, delete aliases last. Tests after: characterisation unchanged; a **behavioural** test that a permitting reader given a hostile resolver rewrite still reads `said`; compile-time type block on `resolved` into permitting signatures. Rollback: revert; aliases keep old code valid. Exit: `instruction` raw reads ≤ handful, three variants collapsed.

**Slice 2 — Gate precedence + mixed turns.** Objective: fix ordering as data. Problem: B3, H (clause loss), `callsItOff`+`spokenAnswer` double fire. Contract: one ordered gate table where "answers an open question" precedes rejection/close/call-off; `readPlan` output is *one of* the turn's clauses, remaining clauses continue (dropped clauses become inputs, not lost); `understand` moves above plan/populate/teach early returns. Touches: `instruction.ts` 2265–3210 region, `negation.ts`, `plan.ts`. Must survive: R43/R21 ledger behaviours, #364 pins. Invariants: 4, 5, 23–26. Tests before: gate-order test enumerating early returns against open-blocker/no-blocker; mixed-turn table (plan+preference+question). Strategy: encode current order → assert; then change table. Tests after: mixed intents survive; "No." declines the blocker; neighbour + negative controls (no over-reach on bare closes). Rollback: revert table. Exit: V1/V4 green in gate.

**Slice 3 — Authority path.** Objective: `app.authorize_effect`. Problem: AD3 (+AD4 foundations). Contract: called from `runJob` REACH seam and delivery: `tool_permissions ∩ staff_tools ∩ autonomy_for ∩ standing ∩ origin`; returns proceed/ask/refuse; **contacting another human ⇒ `ask` regardless of dial** (structural, at recipient); `may_act`'s "person asked" derived from job origin, not `requested_by` prefix. Touches: `containment.ts`, `perform.ts`, calendar-tasks, drive, notion/notebook/slack write paths, `guidance`/`capabilityBrief`. Must survive: calendar duty standing row, containment REACH classes. Invariants: 18, 20, 22, 37, 38, 39. Tests before: per-action matrix table asserting today's behaviour. Strategy: shadow-mode first (log divergence), then enforce per capability. Tests after: staff_tools change alters runtime behaviour; `observe` dial blocks Notion/Slack; negative controls. Rollback: shadow flag. Exit: matrix table green for every row of §24.

**Slice 4 — One approval API.** Objective: fingerprint-bound blocker for all mechanisms. Problem: AD4. Contract: `app.raise_approval(job, action_fp, …)` and `app.answer_approval(blocker, answer, principal)` (lock, option validation, single consume, expiry); M2/M3 bound to a fingerprint; `task_answers_blocker` delegates; ADR-0046 refusal becomes a stored `declined` fact on the pause/step that replan reads. Touches: `approval.ts`, `perform.ts`, notebook, drive, `hq_answer_blocker`, 0496 trigger, `satisfied.ts`. Invariants: 23–26, 27, 28. Tests before: extend isolated approval suites to M2/M3. After: same + refused+empty replan. Rollback: old functions remain as wrappers. Exit: isolated approval suite in the gate; `approval_binds` has a production caller or is removed.

**Slice 5 — Stored origin.** Objective: `jobs.origin` set once, inherited, immutable. Problem: AD5. Contract: `origin ∈ {trusted,internal,harness,unknown}` written by the door/creating function; child copies; `harness_job` becomes a read of it plus the legacy signals until witness parity, then legacy signals retire. Touches: 0541/0542/0603 triggers, `internal_root_ok`, `enqueue_*`, `dispatch_due_responsibilities`. Invariants: 11, 31–33. Tests before: witness-independence in gate; `provenanceSql` unchanged. Strategy: add column + trigger; backfill by current `job_origin`; compare for N days; flip readers. Rollback: keep derived function. Exit: witness and guard agree on all historical jobs; #380 readers all use one predicate.

**Slice 6 — Lifecycle single source + recovery gaps.** Objective: kill drift and dead ends. Contract: SQL `job_transitions_allowed` generates TS `states.ts` (build-time) + an agreement check in the gate; delete `assertTransition` or wire it; `attempt<4` replaced by reading `max_attempts`; expiry/escalation/reconcile action for non-resumable pauses and unanswered blockers (`expired` written; Claire tells Grant); `obligation_state` reads non-resumable pause as `waiting_on_user`/`stuck`; remove or use `waiting_*`. Invariants: 29, 30, 34, 35, 36. Tests: poison-job suite; expiry suite. Exit: every legal nonterminal state has a named recovery test.

**Slice 7 — Conversation across channels.** Objective: derived person-level conversation. Contract: `app.conversation_of(command)` derived from person + recency + `global` project scope, channel tuple retained as a facet; `conversation_before/work/extent` and `obligation lookup` consume it; `voice_answer` routed through a job. Touches: 0549/0564, `enqueue_inbound` cascade, Team HQ voice edge function. Must survive: per-chat windows, #197/#209 behaviours. Invariants: 6, 7, 36. Tests before: cross-interface journey (Team HQ→Telegram) as a behavioural suite; after: same green. ADR required. Rollback: feature flag on derivation.

**Slice 8 — Staff, skills, learning.** Objective: governed extension. Contract: roster ceilings as data (class/kind column); new-specialist project default "off"; hire proposal press; skill proposal `suggestions` kind + `skill_effect` consumer + auto-flag; **one learning-confirmation policy (Grant decides)**; standing rules reach briefing/reports/synthesis. Invariants: 13, 14, 18, 19, 38, 39. Rollback: additive.

**Slice 9 — Cross-project reader and tenant seam (ADR only for the seam).** Objective: derived cross-project retrieval with `(project, connector, citation)`; `outputs.sources` carry project; `NOT NULL project_id` on work tables via Unnamed backfill; a tenant-seam ADR listing where `office_id` will go (lessons, staff, tool_permissions, vault/config) and a lint that stops new `'grant'` literals. Do **not** implement tenancy. Invariants: 3, 16, 17, 40.

## 45. Finite architecture acceptance suite (40 invariants)

Status: ✅ evidenced at HEAD · 🟡 partly · ❌ not yet. "Evidence required" is a *behavioural* proof on the integrated system, not a source assertion.

| # | Invariant | Status | Evidence required |
|---|---|---|---|
| 1 | Every human turn enters one semantic boundary | 🟡 | all five doors → same `buildTurn`; test that no reader is called before it |
| 2 | Claire remains human-facing owner | 🟡 | delivery-layer persona rule; specialist-addressed exceptions enumerated; test on Slack/dashboard/Telegram |
| 3 | Every meaningful obligation belongs to a project | 🟡 | NOT NULL on `jobs/tasks/documents/blockers`; Unnamed backfill; null-project retrieve refused |
| 4 | Mixed intents survive | ❌ | mixed-turn table incl. plan+preference+question; each clause executed or explicitly dropped-and-said |
| 5 | Corrections/cancellations govern correct span | 🟡 | retraction span table incl. dash (#291), withdrawn work not performed |
| 6 | Cross-interface continuation locates same context | ❌ | Team HQ→Telegram→Slack suite asserting same person/project/conversation/obligation/prior work |
| 7 | Every root objective has durable ownership | 🟡 | derived obligation covers duty roots and non-resumable pauses; summary API |
| 8 | Human tasks and AI jobs distinct | ✅ | schema/readers as §16 + blocker-task option-order fixed |
| 9 | Child inherits project | ✅ | `enqueue_child(_once)` coalesce test incl. override rules |
| 10 | Child inherits user/tenant | 🟡 | subject/requested_by inheritance test; tenant seam |
| 11 | Child inherits security/synthetic | ✅ (bit) | trigger test on every creator; extend to stored `origin` (slice 5) |
| 12 | Child inherits provenance | 🟡 | `pinned_config` inheritance contract or lineage-walk test for every consumer |
| 13 | Specialist identity survives delegation | ✅ | `recipient_agent` per child + `addressed_to` |
| 14 | Specialists collaborate without losing root ownership | 🟡 | root-owned synthesis, no dual-answer; specialist-initiated case |
| 15 | Fan-in produces one coherent result | 🟡 | one delivered answer per obligation; >5-wake wait passes |
| 16 | Project retrieval preserves provenance | ✅ | `search_documents` returns project/connector; mirror step-aside test |
| 17 | Cross-project retrieval preserves provenance and permissions | ❌ | derived reader + permission policy + negative control |
| 18 | Skills cannot grant authority | ✅ | existing "most persuasive skill" test; keep |
| 19 | Learning cannot silently create durable preferences | ❌ | one confirmation policy; marked and skill paths tested; stranger sender refused |
| 20 | One authoritative tool-permission path | ❌ | `authorize_effect` matrix over §24; `staff_tools` change alters runtime |
| 21 | Unsupported capabilities produce truthful outcomes | 🟡 | `blocked_capability` reachable in production; #302 promise gate |
| 22 | Consequential actions cross authorization | ❌ | every external effect kind in REACH passes `authorize_effect` (dial included) |
| 23 | Approval binds exact action | 🟡 | fingerprint on all mechanisms; changed-action test per mechanism |
| 24 | Yes executes at most once | 🟡 | race suite for every mechanism, incl. `local` steps and task-tick door |
| 25 | No executes zero times | ✅ (M1,M3) | extend to all mechanisms |
| 26 | Refusal cannot be replanned around | 🟡 | declined fact in data; refused+empty test; "No." reaches decline |
| 27 | Completed checkpoint work not repeated | 🟡 | `runSteps` coverage for handlers that write; `local` repeat semantics settled |
| 28 | Ambiguous external effects reconciled | ❌ | reconcile action for `needs_reconciliation`; crash-after-effect suite per external handler |
| 29 | Every legal nonterminal state has recovery | ❌ | per-state recovery test; remove/wire dead states; expiry |
| 30 | One malformed job cannot stop unrelated work | 🟡 | poison-job suite on deployed worker |
| 31 | Synthetic descendants remain synthetic | ✅ | trigger test all creators |
| 32 | Synthetic cannot reach real destinations | ✅ (GREEN 29 Sep) | isolated + production acceptance incl. `supabase/functions` scan |
| 33 | Containment has an independent witness | 🟡 | witness-independence in the gate |
| 34 | Completion claims require canonical evidence | 🟡 | coherence gates keyed on claims; state-gated backstop (#302) |
| 35 | Partial completion reported as partial | ✅ | `obligation_state` + synthesis "lost branch" tests |
| 36 | Claire can determine state of an active obligation | 🟡 | summary API; question "what's happening?" journey |
| 37 | Proactive work obeys authorization/notification | 🟡 | duty passes `authorize_effect`; say-once; budget |
| 38 | Dynamic specialists cannot self-grant authority | 🟡 | no default grants (✅) + router/project default + runtime `staff_may_use` |
| 39 | Skill improvement cannot self-grant authority | ✅ (schema) | keep; test on the new proposal path |
| 40 | Credible tenant/user-isolation path | ❌ | ADR + `office_id` seam + sender auth + per-person lessons scope |

## 46. Definition of architectural done

The foundation is complete enough when: all 40 invariants are ✅ **on the integrated system**, each by a behavioural test that (a) has a positive control and a sabotage that demonstrably lands, (b) runs in a gate that includes the isolated-replica suites, and (c) is not a source-text assertion; the gate is green on `main`; the doc set states the true migration/worker counts. After that, a failing behaviour is ordinary product maintenance unless it falsifies one named invariant — in which case the invariant, not the phrase, is what gets fixed. This is a finite, evidence-based definition and is **not** a synthetic examination corpus (CLAUDE.md's standing rule against a fifth exam is respected; this audit was directed by Grant).

## 47. Recommended next development sequence

1. **Grant triages §33 B1/B2** (sender authorization, approver identity) — security first; ~1 day.
2. **Slice 0** (close B3–B7 with reproductions).
3. **Slice 1 → 2** (Turn value, then gate table and mixed turns) — biggest reduction in recurring behavioural defects; matches how Grant actually finds defects (real use).
4. **Slice 3 → 4** (authority path, one approval API) — required before proactivity/dynamic specialists gain reach.
5. **Slice 5, 6** (stored origin; lifecycle single source and recovery gaps).
6. **Slice 7** (cross-channel conversation) — highest user-visible value on Telegram-first usage; sequence earlier if Grant prefers, it is independent of 3–6.
7. **Slice 8, 9** (staff/skills/learning; cross-project + tenant seam ADR).
Also, in parallel with all of it: correct CLAUDE.md/HANDOFF drift (migration count, v391/375, `verify:ui` target, e2e.ts "seventy-nine suites") and add the isolated suites to the gate.

**Decisions only Grant can make (asked once, here, because they change the plan):** (a) the learning-confirmation policy — press-before-write for every durable rule, or say-back-then-review-after as today; (b) whether cross-project retrieval is open-by-default for him (single-user) with provenance, or opt-in per project; (c) whether autonomy should also gate *starting* proactive work or only outward effects.

---

### Appendix — what I verified myself vs. took from investigators
Verified in source by me: baseline SHA/`instruction.ts` size; `rejectsWithoutSaying` wiring and `REJECTS` regex, absence of an open-blocker guard vs `closesWithoutAsking`; `enqueue_inbound` last defined at 0547; `staff_may_use` has no runtime TS caller; `instruction.ts` contains no autonomy/`mayAct` reference; `capabilityRefused: false` hard-coded; `governOutward` option list without `on_answer`; `resume_job` does not touch `attempt` and `dequeue_job` increments it; Telegram webhook has no sender allowlist at the attribution site. Everything else is the investigators' CURRENT FACT reading, cited to file/migration, and should be treated as INFERENCE until the independent review re-checks it — in particular counts (tables/functions ever created vs live), the "two answers" possibility (§6), the stranger-teaches-a-rule chain (§21), and the `pageRequest` paraphrase risk (§10).
