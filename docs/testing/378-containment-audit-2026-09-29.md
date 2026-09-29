# #378 — systemic test-traffic containment audit, 29 September 2026

Branch `claude/378-containment`, from `main` = `692fa165`. Nothing here is
deployed or merged. Every migration was applied only to the isolated local
replica (`scripts/isolated/`). Every production query was read-only.

**The invariant.** Work that started as harness or test traffic never causes
an externally visible side effect, except at an explicitly registered and
contained test destination. The invariant holds across delegation, retries,
restarts, delay, approval, narration and background duties, and it fails
closed.

## 1. Root cause of #378

`narrate.ts` posted to the office narration channel with no `jobId`. It
picked the jobs to narrate with `not j.is_fixture`, which misses harness work
that came in through a real door: a voice-door `verify-…` session is
`requested_by = 'voice:grant'`. Three things then lined up:

- `app.claim_delivery` asked `app.deliverable_to(job, …)`, which returned
  **true for a null job**. The guard failed open.
- `app.harness_escapes()` inner-joins deliveries to jobs, so a delivery with no
  job was invisible to it.
- Every other witness asks `app.harness_job`, or starts from `job_id`.

Result: **381 of 523** narrations ever sent were of harness jobs. All of them
are `sent`, and none was ever refused.

## 2. The canonical enforcement boundaries

There are two chokepoints, one per kind of effect. Each asks the same
canonical classifier, `app.harness_job`, which is lineage-aware.

| Effect | Boundary | Policy | Fails closed on |
|---|---|---|---|
| Any message through the delivery layer (Telegram, Slack; reply, progress, ack, approval, briefing, notice, narration, outcome) | `app.claim_delivery` | `app.delivery_refusal(job, key, channel, target)` (0601) | no job and not a registered operator sender; a job that does not exist; harness lineage. A registered `test_destinations` target is the only exception. |
| Any job that changes something in a third party's system (Notion, NotebookLM, Calendar, Google, GitHub, Slack admin, Telegram direct, task board) | `runJob`, before the "on it" and before `handler.handle` | `containmentRefusal` in `src/jobs/containment.ts` + the `REACH` registry | an unlisted kind (treated as external); the question cannot be answered (DB error, missing row, non-boolean answer); harness lineage. The job is **cancelled**, and the reason is kept in its own state history. |

`tests/jobs/containment.test.ts` keeps the boundaries closed:

- every handler kind must be classified, and a stale registry entry fails;
- no `src/` file may call a Telegram or Slack send endpoint with a bare
  `fetch` outside the two clients; the one named exception is
  `vault-export.ts`, whose kind is contained at the job boundary.

## 3. Provenance model

The chain is **side effect → delivery row or job → lineage → classification.**

- A delivery row names its job (0601 makes that the price of being sent).
  When the row names no job, the witness recovers one from the job id written
  into the dedupe key (`narration:<job>`, `outcome:<job>`).
- The lineage is `jobs.parent_job_id`, walked to the root.
- `app.harness_job` classifies the job; the witness classifies it
  independently (§6).
- An external write is a job. Its classification is taken from its own row
  and its whole lineage, at the moment it would run.

Operator notices sent with no job are allowed only from namespaces registered
in `public.operator_senders`: `build`, `hello`, `introduction`, `mcp-token`,
`hq-token`. That list was taken from every job-less namespace production has
ever sent.

## 4. Containment matrix

SAFE · PARTIAL (partially contained) · BYPASS (fixed on this branch) · DORMANT
(no evidence of occurrence; not patched, filed).

| Path | Trigger | Provenance | Classifier (before → after) | Through claim_delivery | check:leaks sees it | Can reach a human | Verdict |
|---|---|---|---|---|---|---|---|
| Slack narration (`narrateHandoffs`) | worker tick | none → `jobId` | `is_fixture` → `harness_job` | yes; null job allowed → refused | no → yes | yes, Slack `#the_floor` | **BYPASS → fixed** (#378) |
| Slack outcome (`narrateOutcomes`) | worker tick | none → `jobId` | `harness_job` in selection; guard now also | yes | no → yes | yes, Slack | **BYPASS → fixed** |
| Replies, progress, pager, Slack notifier, approval asks, reminders, briefing | job | `jobId` | `harness_job` | yes | yes | yes | SAFE (0523/0597/0598) |
| Voice-note transcript echo (`echoTranscript`) | voice job | bare `fetch` → `jobId` | none → guard | no → yes | no → yes | yes, his Telegram | **BYPASS → fixed** |
| 👎 correction question (`askForTheCorrection`) | press row | bare `fetch` → the pressed message's job | none → guard | no → yes | no → yes | yes, any chat a press row names | **BYPASS → fixed** |
| `office.notion_import` / `notion_adopt` (children of an instruction) | instruction | job lineage | none → job boundary | n/a | via job state | writes his Notion | **BYPASS → fixed** |
| `notebook.add_source` / `push_document` / `generate`, `office.execute_plan` (creates notebooks) | instruction/plan | job lineage | none (generate was approval-gated) → job boundary | n/a | via job state | writes his NotebookLM | **BYPASS → fixed** |
| `google.revoke`, `ci.dispatch`, `office.vault_export`, `google.write_calendar_tasks`, `office.provision_channels` / `rename_channels`, `office.slack_rotate`, `office.notion_sync`, `tasks.sync` | duty or instruction | job lineage | per-handler or none → job boundary | n/a | via job state | third-party writes | contained by the boundary; no harness occurrence found |
| Harness turns in the dashboard Chat (`conversation_history`) | page read | job | `is_fixture` → `+ harness_job` (0602) | n/a | n/a | yes: 11 rows visible to him in Unnamed | **BYPASS → fixed** |
| Reads (`browser.gather`, `drive.*`, `google.read_*`, `mcp.discover`, `notebook.ask/collect*`, `office.sync`, `knowledge.read_source`) | any | job | not gated, by design | n/a | n/a | no, reads only | SAFE |
| `telegram-webhook` voice refusal `sendMessage`; GitHub `repository_dispatch` | inbound webhook | the update itself | none | no | no | the chat the update came from | DORMANT: `voice.transcription = 'api'`, so it never fires; 0 harness voice commands and 0 from any other chat in production. #380 |
| `app.notice` quiet/looming branches; `app.calendar_task_plan` | duty | task | `tasks.is_fixture` | yes (briefing) / n/a | partly | content in his briefing | PARTIAL: 0 harness tasks open on real projects today; calendar sync is off. #380 |
| Other display readers (`hq_portfolio_tasks`, `hq_pulse`, `studio_modules`, `project_export`, …) | page read | row | `is_fixture` | n/a | n/a | display only | PARTIAL. #380 |
| `blocker_makes_a_task` | trigger | job | none | n/a | `check:leaks` harness tasks | hidden by `harness_task` readers | PARTIAL (0597 readers hide it) |
| `provision_missing_channels` | duty | project | slug + 15-minute age rule (0419) | n/a | n/a | creates Slack channels | PARTIAL, by time rather than lineage; an 0419 design decision |

## 5. Reproductions: red before, green after, red again under sabotage

| Proof (`scripts/isolated/`) | Before the fix | After | Sabotage |
|---|---|---|---|
| `narration-containment.ts`: the real `narrateHandoffs` / `narrateOutcomes` through the real SlackClient → SlackOffice → DeliveryService → `claim_delivery`, fake network | 5/10 | **11/11** | fix reverted → red |
| `external-containment.ts`: the real `runJob`; harness children of 9 external kinds, a grandchild, a parent that has ended, a legacy suite job, a job whose row is gone; real controls including a duty | 6/19 with the gate removed | **19/19** | gate removed 6/19; default flipped to internal → unit red; a kind dropped from the registry → unit red |
| `correction-containment.ts`: the real `processCallbacks` | 1/5 (the harness press sent) | **5/5** | `jobId` dropped → 3/5 |
| `chat-containment.ts`: the real `conversation_history` | 3/4 | **4/4** with 0602 | — |
| `witness-independence.ts`: `app.harness_job` broken on purpose, every production escape shape planted | — | **9/9** | job-from-key attribution removed → red; lineage walk removed → red |
| `verify:history`, run against the replica | its 0602 check red without 0602 | green with it | — |

`scripts/isolated/run-all.sh` now builds `cand` (production schema plus every
branch migration) and runs every proof on it. **All pass: 15 proofs.**

## 6. check:leaks: the old blind spot and the new model

**Old blind spot.** Every witness asked `app.harness_job`, or started from
`deliveries.job_id`. A delivery with no job, or a job the predicate misread,
was invisible to all of them at once.

**New model.** `provenanceSql` in `scripts/leak-witness.ts` works in three
steps:

1. Attribute each sent delivery to a job, from the row or from its key.
2. Walk the whole parent chain, judging each job by rules of its own:
   `synthetic`, `is_fixture`, harness-shaped names, fixture project slugs, and
   command keys no adapter writes. It never calls `harness_job`,
   `deliverable_to` or `operator_senders`.
3. Name `HARNESS_SENT` and `UNPROVENANCED` breaches, and report every
   disagreement with `app.harness_job`.

It fails on any breach after 0601 is applied. Until then it reports history.
It also has a found-nothing control: it refuses to run if it examined fewer
rows than were sent.

**Production today (read-only), since the guard existed:**

- 616 sent messages examined;
- 136 harness work sent (the narration class, plus acknowledged escapes);
- 0 unprovenanced;
- 10 disagreements, analysed in §7.

## 7. Historical blast radius (read-only)

**Narration** (Slack only; no Telegram, email or other integration):

- 523 narrations sent between 7 and 29 September.
- By the canonical classifier, **381 were of harness jobs**: 377 to
  `#the_floor` (`C0BVCESNS3G`) and 4 to the retired `#the-floor`.
- By the witness, 387. The extra 6 are the `verify:escapes` positive control,
  keyed `telegram:message:escapes-…-real`, which `harness_job` reads as real.
- **Outcomes:** 23 of 35 harness by the canonical classifier (27 by the
  witness), 20–24 September.
- Every one is `state = sent`. **0 attempted-and-refused, 0 suppressed, 0
  indeterminate.** The guard was never asked.
- Other humans: the narration channel is in Grant's workspace and is created
  by the app. Its membership was **not** queried (that needs the Slack API),
  so whether anyone but Grant read it is **indeterminate**.

**The disagreements (10).**

- **6 + 4, witness says harness:**
  - the `verify:escapes` positive control (21 Sep);
  - `job cabd8ab4`, a child of `telegram:artifact_demo:…`. That key is written
    by no adapter and by no file in this repository or its history, so it was
    an uncommitted authoring-session script. On 17 Sep it delivered 6 Slack
    posts and 1 Telegram reply to Grant. `app.harness_job` still reads that
    shape as real. **Confirmed historical.**
- **1, guard says harness:** `requested_by = 'probe'` on 6 Sep. The witness
  missed it; its rule was corrected (`is_fixture`, and a name at end of
  string).

**Off-shape keys.** 277 inbound commands on the external doors carry keys no
adapter writes and are read as real by `app.harness_job`. By their stems every
one is a suite (`artifact-slack`, `cap`, `ago`, `composes`, `anchors`,
`escapes`, `e2e`, …). Since the guard existed only the two acknowledged
escapes delivered.

Teaching `harness_job` the rule would reclassify those 277 across about ten
gate suites that cannot be run offline. The shape is also not validated for
Slack `action`/`reaction` keys, so a blanket rule could suppress Grant's real
presses. Filed as #379 rather than changed; the new witness fails loudly if the shape
ever sends again.

**Dashboard Chat.** 11 harness rows are visible in Unnamed: 5 from the
acceptance run and 6 from `deploy:voice` probes. They are hidden by 0602 and
not deleted.

**Limitations.**

- Slack channel membership was not read.
- Pre-0523 history counts `sent` rows only. Before 0523 there was no refusal to
  count.
- A bare `fetch` send (echo, correction) left no row, so its history is
  **unknowable**. There are 27 voice notes, all from his own chat, and
  transcription was on for all of them, so the echo went to him.

## 8. False greens found and fixed during the audit

- My own gate read an unexpected null answer as "real". The unit test found
  it; now only a definite boolean counts.
- A "synthetic leaf" check passed because the database correctly refused the
  sabotage (`synthetic` cannot move from f to t). It was replaced by cases that
  can be built.
- `verify:history` asserted that its own harness answer appeared in Grant's
  chat, which is the defect. Its shape checks now run on a real turn inside a
  DO block that always raises.
- The isolated door emulator did not run as PostgREST does, so every turn
  through it was synthetic and a reader that hides harness could only ever show
  nothing. It now sets `application_name`.
- The witness's deploy-probe pattern could never match (`deploy1790…`). Fixed.
- 0601 treated a job id that names nothing as real (`harness_job` of an unknown
  job is false). Only the foreign key stopped it, by raising. It is now an
  explicit refusal, recorded without the job.

## 9. Deployment requirements (NOT performed)

**Order matters.** With 0601 and the old worker, real narration is refused,
because the old code sends it with no job.

1. `npm run deploy:worker`. This carries:
   - `narrate.ts` with the job;
   - the job-boundary gate;
   - the echo and correction through the delivery layer.

   The new worker is correct on the old schema: it passes jobs, and the gate
   uses only `app.harness_job`, which already exists.
2. `npm run migrate`: 0601, then 0602.
3. Acceptance:
   - one real turn produces narration that is sent and names its job;
   - `npm run check:leaks` exits 0 and prints "since 0601";
   - `verify:slack`, `verify:telegram` and `verify:history` (all three adapted
     here) are green;
   - `verify:escapes` and `verify:chaos` are green;
   - `select count(*) from deliveries where job_id is null and sent_at >
     <0601 applied_at>` is 0, apart from operator namespaces.

**Rollback:**

- page: untouched;
- worker: redeploy `692fa165`, then drop 0601's `delivery_refusal` use by
  re-applying 0600's `claim_delivery`. Do not leave 0601 with the old worker.
- 0602: harmless under either worker.

## 10. Residual risk

- **Off-adapter-shape `message` keys** are still real to `app.harness_job`.
  They are witnessed, not prevented. #379.
- **Dormant direct sends** in `telegram-webhook` (voice refusal, GitHub
  dispatch). #380.
- **`is_fixture`-only display readers and briefing branches.** Currently 0
  harness rows reach them. #380.
- **Reads are ungated**: a harness `browser.gather` fetches real pages.
- **Channel audience is indeterminate** (§7).
- **`verify:slack`, `verify:telegram` and `verify:history`** were adapted but
  can only be run against production, after the deploy.

---

# #379 — unknown origin is not real traffic (same branch, 29 September 2026)

**Status.** With 0603 and 0604, the answer to "can unknown or harness-originated
work produce an external side effect at a non-test destination" is **no, by any
path known to this repository**. The limit is stated in §R.

## R1. Root cause

`app.harness_job` answers one question: *do we know this is test traffic?* Its
last line is `coalesce(…, false)`, so anything it does not recognise comes back
"real". Both 0601's guard and the worker gate asked it, so recognition was the
only thing standing between harness work and Grant.

A turn through a production door whose key no production adapter can produce
was therefore treated as his. Examples: `telegram:artifact_demo:02jzde`,
`telegram:message:escapes-…-real`, `telegram:ctx:…`, `teamhq:branch_turn:…` and
`voice:message:…`. So was a root job that no office function creates, for
example `requested_by = 'telegram:grant'` with no turn behind it.

The same gap covered content: a trusted duty carried harness task content
outward because its readers filtered on `tasks.is_fixture`.

## R2. The trusted-origin model (0603)

**Two questions, two functions.**

`app.harness_job` is unchanged and still means *known harness*. The readers
that hide test traffic from Grant keep using it.

`app.job_origin` means *where this work came from*. It is decided at the root
of the lineage, and harness anywhere in the lineage wins. It returns one of:

| Value | Meaning |
|---|---|
| `harness` | exactly when `app.harness_job` is true |
| `trusted` | the root turn's key is one its channel's production adapter produces |
| `internal` | the root is a job an office function creates, bound to the row that made it |
| `unknown` | everything else, including a missing job and a turn whose row was deleted |

**What `trusted` accepts,** per adapter, read from the adapter code
(`app.adapter_key_ok`):

| Door | Source | Key shapes |
|---|---|---|
| Telegram | `src/channels/telegram.ts` | `telegram:message:<bot>:<chat>:<msg>` and `telegram:callback:<bot>:<id>`, with `<bot>` in `public.telegram_bots` |
| Slack | `src/slack/events.ts`, `src/slack/interactions.ts`, `app.record_slack_history` | `slack:message:<C…>:<10.6 ts>` and `slack:reaction\|action:<C…>:<ts>:<U…>:<verb>` |
| Voice | `supabase/functions/voice` | `voice:turn:s<≤10 base36>.<turn>`: the session `chat.js` and `call.js` mint, so Chat voice and the realtime call |
| Dashboard | `app.say_in_project` | `teamhq:message:<32 hex>`, minted by the server |
| Dashboard | `app.send_to_agent` | `asset:<kind>:<uuid>:<action>:<17-digit clock>` |

Telegram voice notes and button presses use the same adapter keys. The origin
channel must match the key's door.

**What `internal` accepts** (`app.internal_root_ok`), per creator. These are
all 13 SQL functions that insert into `public.jobs`, and no TypeScript inserts
jobs.

| Creator | Accepted when |
|---|---|
| a duty (`dispatch_due_responsibilities`) | `duty:<slug>` names a responsibility whose `job_kind` equals the job's kind |
| an event trigger (`fire_triggers_for`) | `trigger:<name>` names a trigger row with that kind |
| channel provisioning and renaming | `hq`, for those two kinds only |
| Disconnect Google | `grant`, for `google.revoke` only |
| MCP provider registration | `connector:register`, for `mcp.discover` |
| an MCP client | `mcp:<client>`, for an enabled client with write scope |
| a new document's read | `knowledge.read_source` for a document whose own origin is trusted (`app.document_origin`) |

A document's origin is decided like this:
- a document an office job made inherits that job's origin;
- the writers that add documents record `added_by` as null, `grant`, `the office`, a staff slug or an MCP client with write scope;
- anything else is unknown. That is how `verify:scenario-a`'s documents are caught.

**Legacy.** The Telegram adapter wrote a four-part key before commit
`72dd4040` (7 September). Those turns are trusted by id: 0603 snapshots them
into `public.legacy_trusted_commands` when it runs. They are not trusted by
shape or by time, because the caller supplies `received_at`.

## R3. One definition at both boundaries

`app.may_act_outside(job)` means `job_origin in ('trusted', 'internal')`. Both
boundaries ask exactly this.

- **Delivery.** `app.delivery_refusal` refuses `harness` and `unknown`, and so
  does `app.deliverable_to`. The order before that is 0601's:
  1. a registered test destination may receive anything;
  2. with no job, only a registered operator sender may send;
  3. a job that does not exist is refused.
- **External writes.** `containmentRefusal` in `src/jobs/containment.ts` asks
  `app.job_origin`. It refuses `harness` and `unknown`, and fails closed on any
  error or any word it does not know.

The worker is deployed before 0603, so the gate needs a fallback. Only when
Postgres reports the function missing (42883) does it ask `app.harness_job` —
which is exactly the gate the previous worker had. Unit tests prove the
fallback and prove that no other error falls back.

## R4. Proofs (isolated replica; all run by `run-all.sh`)

Each command is made by the real adapter function, or the real SQL or voice
door. Each proof asks both boundaries.

| Proof | Before | After | Sabotage |
|---|---|---|---|
| `legit-origins.ts` (written first; controls) | **22/22** | **24/24** (plus both button presses `trusted`) | — |
| `synthetic-origins.ts` (#379 reproduction) | **0/36** | **36/36** | `adapter_key_ok` returns true → 14/36; `internal_root_ok` returns true → 22/36 |
| `task-content-containment.ts` (0604) | **3/5** | **5/5** | — |
| `containment.ts` (R37) | recorded both shapes as known misses | the guard refuses both; with `job_origin` broken, both witnesses still catch them — **19/19** | — |
| `witness-independence.ts` | — | **12/12**, with `harness_job` **and** `job_origin` both broken | witness made to trust every root → red |

`legit-origins.ts` covers 11 origins:
- Telegram text, a voice note and a button;
- a Slack message and a Slack button;
- Team HQ Chat typed, Chat voice and the realtime call;
- a dashboard document action and the read a new document starts;
- a scheduled duty;
- plus an operator notice and a test destination.

`synthetic-origins.ts` covers 11 synthetic door shapes, 6 root jobs no creator
makes, and a grandchild of unknown work.

**Deploy order, proved.** The new worker gate on production's schema today is
19/19. On the schema with 0601 but without 0603 it is also 19/19.

## R5. Production, read-only

**False positives.** Over every send in the last 21 days, not one message that
real work sent would have been refused. The refusals are all one of:
- harness traffic;
- suite roots (`progress-proof-*`, the `verify:escapes` positive control, a
  deleted suite duty, a dashboard probe);
- `verify:scenario-a` documents;
- hand-run authoring-session jobs.

No job is live today.

**The witness (`check:leaks`)** now has a third breach, `UNKNOWN_SENT`, with its
own grammar. Since the guard existed it finds **9 historical unknown-origin
sends**:
- 6 on 20 September from a `progress-proof` suite root: 3 to Grant's Telegram and 3 to Slack. These were not previously known.
- 3 on 24 September from a `scenario-a` document.

These are history, reported rather than failed until 0601 is applied.

## R6. #380 blocking review

| Item | Invalidates the claim? | Decision |
|---|---|---|
| Task content in `app.calendar_task_plan` / `app.notice` | **Yes.** `blocker_makes_a_task` files a harness job's task with `is_fixture = false`. Given a date, it was planned into his real calendar (dormant only because `calendar.sync_tasks` is false) and appeared in his briefing. | **Fixed: 0604**, proof above |
| `telegram-webhook` voice refusal, GitHub `repository_dispatch` | Reachable only by a Telegram-signed voice update. Transcription is `api`, so the refusal never fires. The dispatch token is present. The dispatch starts a GitHub Actions run and messages nobody; its work is drained through the guard. No code in the repository posts voice updates. | Stays tracked in #380 |
| Display readers that use `is_fixture` only | Display only | Stays tracked in #380 |
| `blocker_makes_a_task` itself | Its tasks are now filtered wherever they reach outward | Stays tracked in #380 |
| `provision_missing_channels` | Its jobs are `internal`; they create channels for real, 15-minute-old projects (0419) | Stays tracked in #380 |

## R7. False greens found in this pass

- Every "real Telegram" control in the #378 proofs used the retired four-part
  key with no bot. They passed only because the guard could not tell. They now
  use the adapter's key and a registered bot (`real-telegram.ts`).
- Three approval proofs modelled Grant's job as a root inserted with
  `telegram:grant` and no turn, which is exactly the unknown origin. It is now a
  child of a real door turn.
- The Slack fixture's timestamp was `Date.now() / 1000`, a 3-digit fraction;
  Slack always writes six.
- `containment.ts` asserted #379 as expected behaviour ("the guard misses …").
- My first witness rule flagged the office's own operator notices as unknown.
- A proof checked by key prefix and read another row's verdict.
- `task-content-containment.ts` was vacuous twice:
  - `app.task_add` already relabels harness tasks;
  - blocker tasks are assigned to him, so the deadline line never showed
    either task.

## R. Residual risk (#379)

- **Exact impersonation with production credentials.** A script holding the
  service key can write a byte-perfect adapter key: a registered bot and a
  numeric chat and message id, through PostgREST, with no harness label. That
  is `trusted` by construction. No positive model can separate it from the
  adapter without a secret only the adapter holds, and every such secret is in
  the vault the harness can read. Nothing in the repository does this; the
  harness conventions (`verify-…` labels, fixture destinations) are the control.
  **This is not a known path.** It is the stated limit.
- **Reads are ungated**, deliberately.
- **Job-less deliveries rely on `operator_senders`** (0601).
