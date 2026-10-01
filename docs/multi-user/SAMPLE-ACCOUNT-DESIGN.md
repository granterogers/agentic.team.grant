# The Sample User — the acceptance environment for multi-user V1

> Design only. Nothing here has been created in production. No auth user, office, project or row exists for the
> Sample User. Baseline `41de1965`.

## 1. What it is, and what it is not

The Sample User is **a second human with a real office**, not a demo mode. It is the thing multi-user V1 is accepted
against: if the Sample User cannot do everything a person does, with Grant's office untouched, V1 is not done.

| It is | It is not |
|---|---|
| a real `auth.users` row, signed in through the same `signin` function | a seeded flag, a prototype-mode screen, or a UI-only fixture |
| a real `offices` row of `kind = 'sample'` | a project inside Grant's office |
| served by the same gateway, worker, handlers and migrations as Grant | a branch of the code that "knows" it is a demo |
| populated through the **product's own writers** (`hq_create_project`, `task_add`, `enqueue_inbound`, …) | populated by direct `INSERT` into tables (the only exception is aged timestamps, §5) |
| truthfully **disconnected** from every provider it has no credentials for | shown as connected to anything it is not |

The one thing that distinguishes it is `offices.kind = 'sample'`. That single, immutable fact is the whole of its
containment (§6).

## 2. The persona

A fictional person with a fictional small business, chosen to be unlike Grant's work so that a leak is unmistakable by
reading it:

- **Jordan Reyes**, owner of **Brightside Café** (a neighbourhood café opening a second site).
- Auth address: an address under a domain the operator controls that **cannot receive customer mail** (for example an
  alias on the operator's own domain). Never a real person's address, never `example.com` (reserved for the existing
  `verify-operator`), and not stored in the repository: the provisioning script reads it from the environment
  (`check:secrets` already refuses personal addresses in migrations, 0580).
- Fixture content avoids every proper noun the repository's hallucination-bait corpus uses (CLAUDE.md records "Priya",
  a "Q3 pricing review document" and a churn figure as deliberate non-existent things) so a bait can never be
  satisfied from Sample data.

## 3. What gets populated (only what exists in the product today)

Each row below is a surface that exists now (read from the schema and `web/studio`), and how it is filled.

| Surface | Sample content | Written by |
|---|---|---|
| **Office** | name, `kind='sample'`, preferences (concise answers; ask before spending), timezone | `app.provision_office` |
| **Claire + 7 specialists** | the same eight shared `staff` rows; Jordan's office has its own `staff_tools` grants (a *narrower* default than Grant's) and `project_staff` decisions | `provision_office` seeds from template |
| **Project A — "Second Location Launch"** (active) | 9 tasks incl. 2 subtasks (`parent_task_id`), one milestone, one **overdue** (→ **Late**), one due today, one with `remind_at`; 3 documents (`yours`: lease summary PDF, budget CSV, site photo PNG); a standing conversation of 6 turns; autonomy `act_with_review` for this project; 3 contacts (landlord, equipment supplier, contractor — `.invalid` addresses) | product writers |
| **Project B — "Seasonal Menu Research"** (research) | 4 `source` documents (uploaded PDFs/notes), 2 `made` documents produced by Emma through a real job, a Notion/Drive/NotebookLM attachment **row shown as not connected** (no credential), a pinned decision (`decisions`) with `ruled_out` | product writers + one real research job |
| **Project C — "Winter Pop-up"** (mature/completed) | 14 tasks all `done` with `done_at`/`completed_by`; archived documents; a closed conversation; historical `events`; **a remembered refusal**: a No Jordan gave to "email the supplier directly" (a durable `blockers` decline + `refusal` window) | product writers, then aged (§5) |
| **Needs You** | 2 open `blockers`: (1) approve a plan "draft and send supplier enquiry" (a real `job_plans` approval); (2) a question Claire cannot answer without Jordan. Both are real rows created by real jobs | real jobs |
| **Late** | the overdue task above | tasks |
| **Stuck** | one job genuinely parked in `paused`/`waiting_user` beyond the waiting threshold with an open `job_pauses` row | real job + aged (§5) |
| **Delegation** | Claire → Tom (strategy) → Daniel (finance) on Project A: a root `office.instruction` job with a child and grandchild, `branch_groups` for one fan-out | real jobs |
| **Preferences / learned context** | 3 `lessons` taught by Jordan (`learned_by` = Jordan's subject): one conduct preference, one project fact, one **withdrawn** rule — exercising "learning ≠ authority" | real teaching turns |
| **Standing authorizations** | one project-scoped, one office-global (to prove `project_id is null` means *this office*) | `app.grant_standing` through the gateway |
| **Integration states** | Google ✗ · Slack ✗ · Telegram ✗ · Notion ✗ · NotebookLM ✗ · Drive ✗ · Vikunja ✗ · MCP none. LLM provider ✓ (system). Realtime voice ✓ mintable (system key). Each shows its **real** state in `connection_health` (`not_connected`), never a stub "ok" | `provision_office` writes the true state |
| **Calendar / mail** | **not seeded.** `calendar_events` and `mail_messages` are caches of a connected Google account; fabricating rows would present a provider as connected. The Calendar and Mail surfaces show the product's own *"Google isn't connected"* state — and that is the test (the state must render truthfully, not empty-as-success) | — |
| **Activity feed, Recent activity** | emerge from the above | — |
| **Voice** | one voice-note turn from a fixture audio file; one minted realtime session | §7 |

Counts are a design target to give each surface more than one state; they are not a quota. If a surface listed does
not exist at implementation time it is skipped and said so — **no feature is invented to make the sample look richer**.

## 4. The acceptance flow: Sample User → Claire → Specialist → Result

Run through the real architecture, with these assertions at each hop (every assertion is a SQL query, not a log read):

| Hop | What happens | Assertion |
|---|---|---|
| 1 | Jordan, signed in, sends "What does the lease change do to our opening budget?" in Project A from the dashboard | `inbound_commands.office_id = sample`; `origin_channel = 'teamhq'` |
| 2 | gateway resolves office from the session; `enqueue_inbound` stamps the job | `jobs.office_id = sample` and `origin_class` is not `trusted`-for-outside (kind sample) |
| 3 | worker claims; Claire answers or hands off | `jobs.office_id` equal across `parent_job_id` and `root_job_id` (composite FK) |
| 4 | Claire convenes Daniel (finance) → child job | child `office_id = sample`; `routing_decisions.linked_job` in the tree |
| 5 | Daniel retrieves Project A's budget CSV and the lease PDF | every `documents` row returned has `office_id = sample` and `project_id` in Jordan's projects |
| 6 | the **model input** is built | **no byte of any Grant-office document, lesson or output is in the prompt** (§4.1) |
| 7 | the result is written | `outputs.office_id = sample`; provenance/evidence labels intact |
| 8 | the answer returns to the dashboard thread only | `deliveries` rows have `channel = 'teamhq'`; **zero** rows for Telegram/Slack/email |
| 9 | Jordan reads it | the UI shows the sample thread; Grant's office has gained **zero** rows in every table between hop 1 and hop 9 |

### 4.1 Proving the model never sees foreign content
Two canaries. Grant's side of the isolation suite is never Grant's real office: it is a **test** office seeded with
unique canary strings (`CANARY-A-<run>` in a document title, a lesson, an output and a task). The Sample flow then asks
a question designed to match them (same project name, same keywords). The model seam is `src/providers/router.ts`; the
suite installs a recording provider that stores every request body for the run, and asserts that no request contains
`CANARY-A-<run>`. A second pass runs the same prompt as the test-office user and asserts the canary **is** present (the
control: a recorder that cannot see the canary proves nothing).

## 5. Seeding, aging and reset

**Provision** (`npm run sample:provision`, idempotent): create the auth user (admin API) → `provision_office(kind =>
'sample')` → a sequence of gateway calls *as Jordan's session* that create the projects, tasks, documents and
conversation → enqueue the three real jobs (delegation, research, plan-needing-approval) and wait for them.
Because it uses the product's writers, every row has the same provenance a real one would; there is no second code path
to rot.

**Aging.** "Late" and "Stuck" need time to have passed. Writing `updated_at` directly is reverted by
`projects_touch_updated_at` and its siblings (CLAUDE.md records this trap), so aging is one sanctioned function,
`app.seed_age(p_office, …)`, which (a) refuses unless `offices.kind = 'sample'`, (b) sets the few timestamps the
surfaces compute from inside a transaction that suspends only those touch triggers, and (c) is the only code allowed
to. Its control test points it at Grant's office and a `person` office and must be refused.

**Reset** (`npm run sample:reset`, idempotent): `app.purge_sample_office(p_office)` then provision again.

Jobs and ledgers are append-only ("a job cannot be deleted"), so a naive reset leaves the debris pile CLAUDE.md
describes (thirty-two debris projects from one afternoon). The design that avoids it:

- The purge is **one** `SECURITY DEFINER` function callable only by the service role. It deletes in dependency order
  *by `office_id`*. Because every dependent row is in the same office (composite FKs), the deletion set is complete
  without enumerating tables by name, and **cannot include a row of another office** — there is no foreign key that
  could lead there.
- The append-only triggers get one narrow exception: they allow `DELETE` when a transaction-local setting names an
  office and that office's `kind = 'sample'`. The setting is set only inside `purge_sample_office`.
- It refuses unless `kind = 'sample'`, refuses if the office has any `deliveries.state = 'sent'` (a sample must never
  have sent anything — if it did, that is an incident, not a reset), and writes an `events` row to a system ledger
  **outside** the office before deleting.
- Controls (must be red): (1) call it on Grant's office → refused; (2) call it on a `person` office → refused;
  (3) snapshot per-table row counts for every non-sample office before and after a purge → identical; (4) sabotage the
  `kind` check → control (1) goes red.
- It deletes the **data**; the `offices` row and `auth.users` row stay so the account is stable across resets.

## 6. Containment — structural, not a flag

Test classification must survive jobs, children, retries, conversations, messages, approvals, voice and effects.
Copying a flag onto each of those is the pattern that failed seven times in this repository (0303/0304, 0342, 0351,
0355, 0603, 0605, 0606). The design copies **nothing**:

- `office_id` is on every job and immutable, so a child, retry, resume or recovery is still in the sample office.
- `app.may_act_outside(p_job_id)` is the one question the delivery guard and the worker's external-write gate both
  ask. It becomes `app.job_origin(p_job_id) in ('trusted','internal') and (select o.kind = 'person' from offices o join
  jobs j using (office_id) where j.job_id = p_job_id)`. One edit, both boundaries.
- A sample job therefore can never message Grant, his Slack, his Telegram, his contacts or any ordinary external human,
  **even if** a handler is wrong or a model is persuaded: the effect doors refuse on the office.
- Sample has **no** `subject_identities`, `telegram_chats` or `slack_workspaces` rows. There is nowhere for a
  delivery to go but the dashboard.
- Spend: sample jobs call the real (free-tier) model router. That is the one real cost; it is bounded by the same
  budgets (`budget.*`) and is visible per office through `inference_usage` joined to the job.

An approval in the sample office is real: Jordan can press Approve. The action it would perform outside the office is
then refused by `may_act_outside` with a truthful reason ("this office cannot act outside"), and the test asserts that
**the refusal is recorded and visible**, not silent (CLAUDE.md: a gate that fails into silence).

## 7. Voice

**Voice note** — Jordan uploads `sample-voice-note.wav` (a short generated clip, not Grant's recording): the page posts
audio to `voice/note` with Jordan's JWT → words returned → the page sends them as a chat turn → `inbound_commands`
`origin_channel='voice'`, `office_id = sample`. Assertions: transcription is attributed to the sample office's subject,
not `VOICE_SUBJECT`; the turn lands in the sample thread; a second user's session id cannot post a turn into it.

**Realtime voice** — Jordan's session mints a `voice_sessions` row and a client secret. A scripted check asserts:
the instructions contain Jordan's `voice_state(p_office)` and **no** Grant text; a turn with a session id from another
office is refused; an expired id is refused. The audio conversation itself is a manual acceptance step (it needs a
microphone and spends the deployment's OpenAI key); the design does not pretend a scripted test covers it. If the
operator does not want the key spent, the truthful state is "realtime voice: minting verified, conversation not
exercised", written into the acceptance report.

## 8. What would make the sample dishonest (and the control for each)

| Dishonesty | Control |
|---|---|
| a surface fed by direct `INSERT` that no product path could produce | provisioning goes through the gateway as Jordan; a check lists any sample row whose provenance columns are null |
| an integration shown connected without a credential | `connection_health` for sample is asserted `not_connected` for all six; a test tries to read Google data and expects the truthful refusal |
| Sample classification lost on a retry | the suite kills a sample job mid-run, lets `recover_stalled_jobs` requeue it, and asserts `office_id` and `kind` unchanged and still containment-refused |
| Sample reaching Grant through a duty | sample's `responsibilities` are seeded; a duty fires; its `deliveries` are asserted dashboard-only |
| reset deletes something it should not | controls in §5 |
