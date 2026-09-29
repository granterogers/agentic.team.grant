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
