# Core invariants: canonical command layer, event ledger, job engine, quality gate

**Status:** Draft for review — Phase 0 design, no implementation yet
**Written:** 2026-09-02
**Spec sections:** "Canonical Multi-Interface Command Architecture", §10, §13, §16, §21, §22, §31
**Deliberately provider-independent.** Nothing here depends on Supabase, Slack,
Telegram, OpenAI or Gemini Notebook specifically. Those are bound in
`architecture.md`; this document is what must stay true regardless of which
vendors survive.

---

## Why this document exists separately

The specification's hardest requirement is not any single integration — it is
§"Canonical Multi-Interface Command Architecture": *the source interface must
not change the organisation's underlying behavior.* That is an invariant, and
invariants get violated by convenient shortcuts during implementation ("just
handle this one case in the Slack adapter"). Writing it down separately, ahead
of any vendor binding, makes those shortcuts visible in review.

The four mechanisms below are mutually dependent and should be built in Phase 1
as one coherent unit, before any agent or channel exists:

```
Channel adapter ──► Command ──► Router ──► Job ──► Output ──► Quality gate ──► Commit ──► Ledger ──► Delivery
                    (§CMCA)     (§10)     (§22)              (§16)                        (§21)      (policy)
```

---

## 1. The canonical command

Every instruction from every surface normalizes into one object *before* any
business logic runs. The spec's minimum fields, plus what durability requires:

| Field | Why |
|---|---|
| `command_id` | Primary key; the idempotency anchor. |
| `origin_channel` | `slack` \| `telegram` \| `voice` \| `teamhq` — **for delivery policy and audit only.** |
| `origin_ref` | Channel-native locator (Slack `channel_id`+`thread_ts`, Telegram `chat_id`+`message_id`, voice `session_id`). Lets a reply land back in the right place without the core knowing channel semantics. |
| `actor` | Who issued it (Grant, or an agent for agent-initiated work). |
| `project_id` | Resolved project, or `null` when ambiguous — see §1.2. |
| `recipient_agent` | Intended staff member, or `null` for "the organisation" (defaults to Chief of Staff). |
| `instruction` | The raw natural-language text. Never pre-digested by the adapter. |
| `conversation_context` | Prior turns needed to interpret it. |
| `intent_class` | See §2. Set by the router, not the adapter. |
| `correlation_id` | Groups every downstream job, output and event. The spine of "explain this action". |
| `received_at` | Timestamp. |
| `dedupe_key` | Channel-derived natural key for at-least-once delivery — see §1.1. |

### 1.1 The rule that makes this work

> **Channel adapters may only translate. They may never decide.**

An adapter's entire job is: authenticate the source, map the payload to the
fields above, and hand it over. An adapter must not classify intent, pick an
agent, create a task, call a model, or format a result. If a behaviour exists in
the Slack adapter and not the Telegram one, the invariant is already broken.

This is testable, and §31's cross-interface acceptance test is exactly that
test: the same instruction through Slack and through Voice must produce the same
canonical command modulo `origin_channel`, `origin_ref` and `command_id` — and
therefore the same downstream work. **That comparison should be an automated
test, not a manual observation**: capture the normalized command from both
paths, blank those three fields, assert deep equality.

### 1.2 Ambiguous project resolution

`project_id` is nullable on purpose. Grant saying "let's look at a website for
the Money Mastery app" in a project channel resolves from `origin_ref`; the same
sentence by voice with no project context does not. Resolution order:

1. Explicit mention of a project name in the instruction.
2. `origin_ref` mapping (Slack project channel → project).
3. Active project context of the conversation/voice session.
4. Single active project → use it.
5. Otherwise **ask**, as a clarification, not a guess.

Guessing the project is a silent-wrong-work failure mode and is worse than
asking. It is one of the few cases where a clarifying question is correct
behaviour under §13's "don't ask permission for routine work" default, because
the cost of being wrong is wasted autonomous work on the wrong project.

---

## 2. Intent classification — the cost governor

§"Intent Classification" exists to stop a passing thought becoming a large
autonomous job. This is the single most important cost control in the system,
because everything downstream is metered.

| Class | Meaning | Default response |
|---|---|---|
| `thought` | Grant thinking aloud | Acknowledge, persist as a note. **No job.** |
| `question` | Wants an answer now | Answer from existing state; deterministic query if possible. |
| `discussion` | Wants to talk it through | Conversational turn. No job. |
| `suggestion` | "We should maybe…" | Persist as a candidate initiative. Do not start it. |
| `light_investigation` | Bounded look into something | One job, hard-capped sources and one agent. |
| `assignment` | Real delegated work | Full job with delegation and quality gate. |
| `direct_command` | "Do X" | Execute; destructive → approval per §13. |

Two rules make this safe:

- **Ambiguity resolves downward, never upward.** If the classifier is unsure
  between `suggestion` and `assignment`, it picks the cheaper one and *says so*
  ("I've noted that — want me to actually run at it?"). The spec asks for a
  bounded lightweight investigation or a natural clarification rather than an
  uncontrolled multi-agent workload; downward-biasing is how that is enforced
  mechanically rather than left to a model's discretion.
- **Classification is deterministic-first.** An explicit imperative addressed to
  a named agent does not need an LLM to classify. Per §10, do not call a model
  where ordinary code will do.

Thresholds are learned from feedback (§17) but **only via the weekly approved
proposal** — never adjusted autonomously, because a self-adjusting cost governor
that drifts upward is exactly the failure this section prevents.

---

## 3. Event ledger

Append-only. Never updated, never deleted. Everything material writes here.

Fields, from §21 plus what rollback needs:

`event_id`, `correlation_id`, `project_id`, `actor` (agent or user),
`trigger`, `action_type`, `occurred_at`, `before_state`, `after_state`,
`rationale_summary`, `source_refs`, `provider_used`, `tool_used`,
`reversible`, `reversal_method`, `related_job_id`, `related_task_id`.

### Invariants

1. **Append-only, enforced at the database level**, not by convention — revoke
   `UPDATE`/`DELETE` for the application role. A convention that history is
   immutable is not immutability.
2. **`rationale_summary` is a summary, never chain-of-thought.** §23 forbids
   storing or exposing hidden reasoning. This must be enforced at the write
   boundary: the ledger writer accepts a short structured rationale, and agents
   have no API that could dump raw reasoning into it.
3. **`reversible` and `reversal_method` are set at write time**, by the code
   performing the action — never inferred later. If an action's author cannot
   say how to undo it, it is `reversible = false`. Irreversible actions must be
   labelled as such and require approval (§13, §21).
4. **The ledger is the explanation surface.** §23's "every autonomous action
   should be explainable operationally" is satisfied by querying the ledger by
   `correlation_id`, not by a separate logging system that can disagree with it.

### Rollback via compensating actions

Undo never rewrites history — it appends a compensating event that references
the original. Consequences:

- **Undo is idempotent by construction.** §21 requires pressing Undo twice to be
  safe. Implement by making the compensation keyed on the original `event_id`:
  the second press finds an existing compensation and is a no-op. This is the
  correct fix; guarding in the Telegram button handler is not, because Telegram
  *will* redeliver callbacks and the guarantee must hold below the channel.
- External side effects bound the honesty of Undo. A Slack message can be
  deleted; a sent email cannot. Anything with an unrecallable external effect is
  `reversible = false`, full stop. Never offer an Undo button that cannot
  actually undo.

---

## 4. Job engine

States, per §22: `queued → running → output_created → quality_review →
committed → notified → complete`, plus `failed` and `retrying`.

The critical property is **resumability**: the container will restart, and it
must be safe.

### Design rules

1. **Idempotency key per job**, derived from its semantic inputs (project +
   action + source fingerprint), not from a random id. Re-enqueueing the same
   logical work must collide rather than duplicate. This is how §22's "no
   duplicated jobs" and §5's "avoid duplication" are actually achieved.
2. **Every state transition is a committed database write**, so recovery is
   "read state, continue" rather than reconstruction. A crash between two
   transitions leaves the job in its last durable state.
3. **A recovery sweep on boot** reconciles jobs left in transient states
   (`running`, `output_created`, `quality_review`): each is either resumed or
   moved to `retrying` with its attempt count incremented. This sweep is the
   difference between a system that survives a restart and one that merely
   claims to.
4. **Side effects are idempotent or ledger-guarded.** Before a job performs an
   external write, it checks the ledger for a matching completed event under its
   `correlation_id`. This is what makes at-least-once delivery from channels and
   at-least-once job execution tolerable.
5. **Capacity limits are enforced at dequeue**, not at enqueue, so §13's limits
   (3 simultaneous substantive jobs, 5 investigations/project/day) hold across
   restarts and across all channels at once. Enqueue-time checks are racy and
   forget across restarts.
6. **Circuit breakers per provider** (§22), tripped on repeated failures, with
   the breaker state in the database so it survives restart and is visible on
   the §23 health page.
7. **Shared visibility.** §22 requires all staff to see shared project work to
   reduce duplication. Concretely: before starting an investigation, an agent
   queries open jobs and recent findings for the project. Duplicate-work
   avoidance is a *query the agent must make*, enforced by the router, not a
   hope that agents coordinate.

---

## 5. Quality gate

§16: no substantive output bypasses review. The word "substantive" needs a hard
definition, or the gate is decided ad hoc.

**Requires review:** research conclusions, strategy, recommendations, project
changes based on inference, external sources being introduced, and anything
written back to the Notebook.

**Exempt:** deterministic retrieval (status, task lists, calendar reads),
mechanical transformations, and direct answers quoted from already-reviewed
material. §16 says routine factual retrieval does not need multi-agent review;
the exemption must be defined by *how the answer was produced* — deterministic
code path vs. inference — because that is checkable, whereas "was it
important?" is not.

Every substantive output carries structured metadata (§16): `confidence`
High/Medium/Low, `evidence_type` Verified/Inferred/Speculative, `sources`,
`contradictory_evidence`, `reviewer_status`, `reviewed_at`.

### Two rules that keep the gate honest

- **Disagreement is surfaced, never resolved by averaging.** §16 forbids
  silently hiding material disagreement. The output carries both positions;
  Grant is notified when it matters. An agent pipeline that quietly picks a
  winner is the failure mode this prevents.
- **The gate cannot be bypassed by the caller.** The commit step reads
  `reviewer_status`; an output without it cannot reach `committed`. Enforced in
  the job engine, not by asking agents to remember.

---

## 6. Delivery policy

Output routing is a policy decision *after* the work is done, and is the only
place `origin_channel` legitimately re-enters:

| Surface | Carries |
|---|---|
| Slack | normal collaboration, threads, substantial results |
| Telegram | high-value alerts, briefings, quick actions, voice notes |
| Team HQ | dashboards, controls, history, usage, settings |
| Notebook | project knowledge and rich artifacts |
| Voice | immediate conversational acknowledgement |

Two properties the spec requires explicitly, both following from the above:

- **Work outlives its originating conversation.** A voice session can end while
  its job continues; results surface later in Slack/Telegram/Team HQ. This works
  because the job holds `origin_ref` and a delivery policy, not an open socket.
- **Cross-surface visibility is immediate**, because all surfaces read the same
  state rather than holding their own.

---

## Open questions for the architecture pass

1. **Where does the queue live** — Postgres-native or an external queue? Pending
   the platform research; the design above only requires transactional state
   transitions and `SKIP LOCKED`-style dequeue, which Postgres satisfies.
2. **Is `quality_review` synchronous within a job, or its own queued job?**
   Recommendation: its own job, so a slow reviewer cannot occupy a worker slot
   and so review failures are independently retryable.
3. **Voice tool-call latency vs. the job engine.** A realtime voice tool call
   cannot wait for a full job. Recommendation: voice tools either read state
   deterministically (fast) or *enqueue* and return an acknowledgement — never
   block on substantive work. The voice research's finding on async tool calls
   bears on this and is flagged there as under-documented.
4. **Notebook write-back is an external side effect with weak reversibility.**
   Deleting a Notebook source is possible via the adapter, so write-backs are
   nominally reversible — but this needs confirming per artifact type before any
   write-back is offered with an Undo button.
