# The public Sample Office

Status: **live in production on 5 October 2026.** Branch `claude/multi-user-p4`. Migrations 0897 and 0898.

A logged-out visitor to Team HQ sees two plain paths: **sign in or create your own office**, and **Explore the Sample Office**.
The Sample is real Team HQ, open to anybody with no email, link, password or key, filled with one made-up café's story. It is a
read-only look around plus a small, capped, safe chat with the team. Nothing a visitor does is saved, and nothing they do can
reach a real person, a real office or a real credential.

## The three kinds of non-person office (kept separate)

| Office kind | What it is for | Who sees it |
|---|---|---|
| `sample` | The polished public demo: Jordan Reyes of Brightside Café. One active office. | Any visitor, as a guest. |
| `test` | Engineering fixtures and the verification suites' quarantine. | Nobody but harnesses. |
| `system` | The deployment's own work (duties, health, sweeps). | Nobody. |

The separate **Sample Person** (`docs/multi-user/SAMPLE-PERSON.md`) is a genuine second *person* with a real login, used to test
what an ordinary customer sees. It is not the public Sample and the two never share data.

## What a visitor sees and can do

1. **Logged out.** One screen: a card "New here? Explore a Sample Office" above "Sign in or create your own office". The Explore
   button is on the first screen on a desktop (y 455 of 900) and a phone (y 416 of 844) with no scrolling.
2. **Entering** needs nothing. The page asks the `signin` function's `sample` action for a session; the function ignores any
   address it is sent. A banner then reads "Sample Office, a made-up café, so changes are not saved" with **Create your own
   office** and **Sign in** always in reach, and the header's sign-out reads **Leave sample**. Neither route traps.
3. **Inside**, everything is the real Team HQ reading real rows: three projects (Riverside Café Launch, Autumn Menu Research,
   Winter Market Pop-up), their to-dos and sub-tasks, documents, contacts, activity and the team. A document opens in a new tab
   through a signed link (a PDF, a Markdown note and a CSV were each opened in production; the first two read in the browser, the
   CSV downloads). **Schedule** in Team HQ means *dated work*: tasks with due and start dates. There is no calendar and no events
   table, and the Sample has no Google Calendar, so nothing here is called a calendar.
4. **Talk to the team.** The dock's chat works. One real model turn costs one inference, is answered by the real worker (for the
   test question on 5 October, the finance director) from the Sample's own papers, and never reaches anybody outside the page.
5. **What is refused, in words.** Any change (adding a task, making a project) is refused by the gateway with the sentence "This
   is a sample office, so changes are not saved. Create your own office to make it yours." Calling the team says it needs your own
   office. A voice note says the same. A visitor never reads a code.

## Real versus simulated

| Real | Simulated or withheld |
|---|---|
| The page, the gateway, the database reads, the search, the project views | The data: a fictional café, fictional contacts on the reserved `.invalid` domain |
| The chat: the real worker, the real agents, the real model | Any change: refused, so nothing is "saved" |
| Per-visitor chat history, kept apart for each visitor | Voice calls and voice notes: refused (metered) |
| The refusal sentences, the caps, the banner | Slack, Telegram, Google, Notion, email: no connection exists in the office |

## Why it cannot reach anybody else (the design)

The decision is a **read-only guest plus a harness-classified, per-visitor chat**. There is no reset job to run and no state to
restore, because the only thing a visitor can write is their own conversation, and that is marked as nobody's real work.

- **A guest is a new member kind** (`office_members.kind = 'guest'`, 0897). The gateway maps it to a principal kind `guest`.
  A guest may run exactly one action, `sample_say` (`GUEST_MAY`). Every other action returns `403 sample_readonly` with a
  sentence, before any function is called. `sample_say` itself is `guestOnly`, so anybody else gets `403 guest_only`.
- **Reads are scoped to the one office.** Operator-only pages (`google`, `build`, `drive`, `bots` and the like) are refused.
  `app.conversation_history` returns nothing for a sample office; a visitor reads only their own thread through
  `app.sample_conversation`, keyed by a random visitor id the browser holds.
- **A visitor's turn is harness traffic by definition.** `app.harness_job` treats an inbound command whose context names a
  visitor as nobody's real work. That hides it from every reader of real activity and makes `app.job_origin` refuse outside
  effects. In production the test turn was `harness = true` with **0 deliveries**.
- **No credential is borrowed.** The visitor's session belongs to a login that owns only the Sample office. `src/auth/speaker.ts`
  returns null for a guest, which protects `voice`, `voice-token` and `mcp`. The Sample office has no connection of its own.
- **`app.sample_login()` works only while the office is sealed** (its sole member is a guest). `app.sample_office_open` flips it
  open for the operator's seeding, and the seeding script seals it again.

### Cost and abuse protection

All set in `public.system_config` and enforced inside `app.guest_allow`, before a job exists:

- 6 questions per visitor per hour (`sample.turns_per_visitor_hour`), 15 per visitor per day (`sample.turns_per_visitor_day`).
- 250 questions per day across all visitors (`sample.turns_per_day`). Past it the team "needs a rest" until tomorrow.
- At most 2 questions still being answered per visitor, 600 characters per question, one project per question.
- The visitor id must look like a random 20 to 64 character token, and must belong to the Sample office's own guest.
- No voice, no MCP, no uploads, and no action that leaves the page.

A visitor who is stopped is told why and pointed at **create your own office**.

## What a visitor cannot spoil

Visitors cannot change the Sample, so there is nothing to restore. The two things they can write, their own chat turns, are scoped
to their visitor id and never read by another visitor. A visitor who clears their storage simply starts a new thread.

Dates used to age (the story was dated relative to the day it was seeded). Since 0902 a daily job (`sample-dates`, 03:23 UTC)
moves the Sample's task due dates and start dates forward by the whole days since the last run, so the shape of the week is kept
(see "The showcase layer" below). Closed work keeps its completion time, and the Activity history is derived from real row
times, so it ages truthfully rather than being rewritten.

## The showcase layer (migrations 0899 to 0904, 5 October 2026)

The first Sample was a project list with a chat. The showcase layer makes it show the *team*: real work, done by the real worker
in the café's world, then sealed. Nothing a visitor reads there was written by hand.

| Capability | What a visitor finds |
|---|---|
| Delegation | Ask Grace to check the launch budget: Claire hands it on, Grace asks two pieces of the work, Daniel answers, a synthesis comes back |
| Agent-made work | Oliver's caption draft; a Riverside status report (PDF, approved, in Docs & Files) |
| Needs you | A Winter Market costs report made as a *draft*, waiting for review (Add to project). The blocker list is empty on purpose: a visitor cannot decide anything |
| Approvals / tools | Settings, Requests: Oliver asks for `gmail.send`, with the reason; the office key cannot approve it and neither can a visitor |
| Decisions | Two recorded decisions (floor, builder) on "What it has learned" |
| Automations | A Monday-morning duty on Riverside; its scheduled runs are hidden because they are plumbing |
| Lessons | Two plain-language rules, shown to every visitor |
| Search / questions | Search finds tasks, documents, people, sources; the team answers from the papers (see the limits above) |

What changed to make that visible: `app.studio_requests` and `app.sample_conversation` (0899) show a visitor the Sample's *own*
seeded work and thread (a visitor's own turns stay hidden from everyone but them); 0900 fixed a latent defect that made delegation
fail (an empty `command_id` cast to uuid inside `harness_job`); 0901 and 0903 and 0904 leave out failed attempts and any seeded
turn flagged `showcase_hidden`, which hides and never deletes; 0902 keeps dates believable.

**Undo.** There are no undo offers a visitor can see (the overview count is 0) and the `undo` action is refused with
`403 sample_readonly` (checked in production). The 44 rows that exist belong to the seeding and were already expired.

**What is deliberately absent, and why.** Voice calls (metered), Slack, Telegram, Gmail, Calendar, Drive, Notion (they need a real
private connection, which the Sample must never hold), and Settings changes (read-only). Each says so in a sentence.

## Capability matrix (5 October 2026)

Nothing is marked complete by inference. "Tested" says what was pressed or read as a visitor, in a real browser against the
deployed page unless stated. **Final walkthroughs, 6 October 2026, after the platform recovered:** desktop 73 of 73, phone 73 of 73
(`sample:public-showcase-ui`, harness at its final commit). The run added the contact Save changes / Remove contact presses and
project Settings > Automations "Set it going"; each is refused in the gateway's sentence and writes nothing (the gmail.send
request stays open; the automation count is unchanged; the contact is still listed). Two harness defects were found and fixed:
the Approve press never answered the page's own "Approve this?" dialog, and several refusal checks matched the page's standing
Sample notice instead of the gateway's sentence, so they could pass without a refusal. No product defect was found.
**0902's first scheduled run (03:23Z, 6 October) failed with "job startup timeout"**, which is the platform stall of that night,
not the function; the date anchor still reads 2026-10-05. A real run has not yet been seen to succeed (next due 03:23Z, 7 October).

| Capability | Classification | Sample content | Interactive? | Tested | Notes |
|---|---|---|---|---|---|
| Three projects, board, docs, people, sources, activity | DEMONSTRATED WITH SYNTHETIC DATA | 3 projects, 48 tasks, 7 contacts, 17 documents | yes, read-only | desktop surveyed and walked; phone walked in part | a deep link to a project works signed in |
| My Tasks (today, overdue, project named) | DEMONSTRATED WITH SYNTHETIC DATA | 5 personal tasks, one overdue | read-only | yes (the `[object Object]` project name was found and fixed) | |
| Sub-tasks, labels | DEMONSTRATED WITH SYNTHETIC DATA | parent and child tasks, labels | read-only | surveyed | |
| Stuck drill-down | DEMONSTRATED WITH SYNTHETIC DATA | alcohol licence, blocked on the council | read-only | surveyed | |
| Documents opened | FULLY DEMONSTRATED | Markdown, CSV, three made reports | opens in a tab | yes: served as text, reads correctly | CSV opens as text, it does not download |
| Contacts: Save and Remove | SAFE READ-ONLY DEMONSTRATION | the card opens | refused | **NOT TESTED** | the gateway refuses every write; not pressed |
| Search and command bar | FULLY DEMONSTRATED | tasks, documents, people | yes | yes: search found a task; the bar listed a project | the bar lists projects, tools and records; Shift+Enter searches everything |
| Delegation | FULLY DEMONSTRATED | Claire to Grace to Daniel and back, a synthesis | read-only | yes (chat and Agentic Team) | answers carry the product's own quirks (see Known limits) |
| Agent-made work | FULLY DEMONSTRATED | caption (Oliver), status report, costs report | read-only | yes | a made report is a PDF document |
| Needs You (a question waiting on a decision) | REMAINING GAP | none: the blocker list is empty | n/a | yes (empty state reads "Nothing is waiting on a decision from you") | no real blocker could be produced without hand-writing one; a draft awaiting review exists but Team HQ lists only accepted work |
| Approvals and tool requests | SAFE READ-ONLY DEMONSTRATION | Oliver asks for Sending email | Approve and Decline refused in a sentence | yes | the office key and a visitor can approve nothing |
| Decisions, lessons | DEMONSTRATED WITH SYNTHETIC DATA | 2 decisions, 3 lessons | read-only | yes | |
| Automations (duties) | DEMONSTRATED WITH SYNTHETIC DATA | a Monday-morning duty | read-only | surveyed earlier; **not re-tested** on the final build | its runs are hidden |
| Calendar | EXPLAINED | none | n/a | yes | not a released feature of Team HQ; Schedule is dated work. The team answers "no calendar entries" |
| Skills | NOT ASSESSED | none | n/a | **NOT TESTED** | not confirmed whether Team HQ shows them as their own page |
| Notifications, briefings | REQUIRES REAL ACCOUNT | none | n/a | n/a | delivered through Telegram, Slack or voice, which the Sample never holds |
| Settings (all tabs) | SAFE READ-ONLY DEMONSTRATION | read-only; a line says it is the Sample | refused changes answer in a sentence | yes: Autonomy, Requests, Learned, Services, Messaging; Appearance is local only | only connections, channels and health deep-link |
| Services and connections | EXPLAINED | all "Not connected" | the cards open Settings | yes | nothing is shown as connected |
| Undo | EXPLAINED | no offers | the action is refused | yes (403 `sample_readonly`, 0 offers) | |
| Chat with the team | DEMONSTRATED WITH SYNTHETIC DATA | seeded thread plus the visitor's own | yes, capped | yes: six real questions asked and read | "what am I waiting on" and "what is stuck" answer well; see limits |
| Voice | REQUIRES REAL ACCOUNT | none | refused | earlier session | metered |
| Failed read | FULLY DEMONSTRATED | no invented names; Try again | yes | yes (refused at the network, then recovered) | #426 |
| Dates | DEMONSTRATED WITH SYNTHETIC DATA | a daily job (0902) | n/a | proved on a replica (11 of 11) | the first scheduled run has **not been observed** |
| The team knows this is the Sample | DEMONSTRATED WITH SYNTHETIC DATA | two lessons say so | n/a | yes, in answers | the worker identity stays neutral (#425, held) |
| Phone | NOT COMPLETED | | | partial | final-build phone walk not completed |

**Remaining concrete gaps:** the final desktop and phone walkthroughs; a Needs You example; contact Save and Remove and the
Automations tab pressed as a visitor on the final build; Skills unassessed; the first run of the dates job unobserved; the team's
awareness of its own Activity (#425).

## Is the Sample clean rather than test debris?

Yes, and this was checked rather than assumed. On 5 October a stray question was found on the Sample's home: the catch-all
"Conversations" project carried "Create the Slack channel #unnamed for 'Unnamed'?" raised by the Slack channel sweep, which asks
every *active office*. **0898** limits that sweep to `kind = 'person'`, and the one open question was resolved by the operator
with a recorded reason (the guest rule correctly refused the Sample's own owner key to answer it). The Sample now shows 0 open
questions. The seeded data contains no `fixture`, `verify-` or real-office names, which `sample:public-ui` asserts on every run.

## Operating it

```
npm run sample:public -- status      # is it sealed, seeded, how many projects and rows
npm run sample:public -- provision   # create the office and its sealed guest login (once)
npm run sample:public -- seed        # (re)write the story through the gateway, then seal
npm run sample:public -- verify      # production API checks, 9 of them, no model call
npm run sample:public-ui -- [label] [--page=https://ai-team-hq.vercel.app] [--chat]   # the visitor's journey, desktop and phone
npm run sample:public-transition     # visitor -> real person -> sign out -> visitor, on the deployed page
```

`--chat` spends one real turn. Run `npm run trust:proxy-ca` first for a browser against the deployed page.

## Deployed

| What | Version | Previous / rollback |
|---|---|---|
| Migration 0897 (guest kind, guest functions, `harness_job`, `conversation_history`, wrappers) | applied | additive; the sample office stays sealed if the page is rolled back |
| Migration 0898 (Slack channel sweep limited to person offices) | applied | restore the previous body of `app.provision_missing_channels` |
| `hq-api` | v891 | v890 is commit `7f858c9c`; recovered live source is the base of the staged copy |
| `signin` | v126 | the `sample` action is new and additive; v124 before this work |
| `voice`, `voice-token`, `mcp` | v656, v685, v661 | the guest refusal rides in `src/auth/speaker.ts` |
| Migrations 0899 to 0904 (showcase layer, empty command id, completed work only, dates, hidden turns) | applied | additive reader changes; each has an isolated proof |
| Page | `dpl_2VgoidAKu95AcMjLieCocWr6bWxv` (My Tasks project name, #426 chat fallback, Settings notice) | previous `dpl_3yZSXFhyNXjbhee7V86sUfA8Yui3`; original `dpl_8QwvvES1oRridjeokGzu2MMGdEYm` (before this work); then `dpl_DrHpy8xh…`, `dpl_3E7t94dY…`, `dpl_2z4wvtNQ…` |

**Nothing held was deployed.** Function and page deploys were built from the *live bytes* plus only this change, never from the
working tree (which carries the held Slack self-service and polish work). The page deploy tool uploaded 7, 1, 1 and 1 files; the
function deploy tool refuses a staged file the live bundle does not have. `scripts/deploy/hq-function-staged.ts` and
`hq-page-delta.ts --root=` are the tools; the staged tree is `.out/stage/` (not committed).

## Migration numbering collision with main (6 October 2026)

The Sample branch and `main`'s Team HQ UX integration numbered migrations independently from the same base (`28569e68`).
Production holds the Sample's `0897_a_visitor_can_explore_a_sample_office_and_nothing_else` to `0905_a_sample_can_show_one_piece_of_work_from_a_hidden_thread`
(770 migrations applied). `main` held `0897_project_calendar_events` and `0900_documents_are_logical_items_with_versions_and_an_explicit_import`,
both **unapplied** to production.

What the runner actually does (read from `src/migrations/runner.ts` and `check.ts`, not assumed): the identity of a migration is its
**name plus checksum**; unapplied files run in `localeCompare` filename order; **but** `runMigrations` calls `checkMigrations` first and
an unapplied duplicate sequence number is a *blocking* error (`sequence/duplicate`). Only a collision where every file is already
applied is a note. So coexisting by filename alone would have worked in a replay and **`npm run migrate` would have refused to run**;
`npm run check:migrations` failed on the merged tree for exactly that reason (0897 and 0900), before the resolution below.

Resolution, following the repository's own rule (an applied file is never renamed, because the repository would then claim a number
production did not run under; a pending file takes a free number): `main`'s two unapplied files were renumbered with `git mv`, contents
byte-identical, to `0906_project_calendar_events` and `0907_documents_are_logical_items_with_versions_and_an_explicit_import`. The numbers
are free, sit below `main`'s next file (`0920`), and keep the calendar-then-documents order `main`'s own chain used. No Sample file was
touched. After this, `check:migrations` passes (798 files; the pre-existing both-applied notes remain).

Evidence it is safe: a full replay from an empty database (`scripts/isolated/replica.sh`, local only) applies every file in order
through `1022`, including `0897` to `0905` immediately followed by `0906`, `0907`, then `0920` onward, each in its own transaction that
stops on the first error; the resulting schema holds both histories (the Sample's `app.sample_say`, `app.sample_refresh_dates`, the
`sample-dates` job, and `main`'s `public.project_events`).

Still true after the merge, and not done by it: **no migration was applied and nothing was deployed.** `main`'s unapplied UX migrations
(`0906`, `0907`, `0920` to `1022`; see `docs/ops/deployment-readiness-2026-10-05.md`) remain a separate decision. Because the on-disk
ledger `migrations/applied.json` stops at 0891 and is rewritten only by `npm run migrate` from what the database reports, it does not
yet list the Sample's nine applied files; it is not edited by hand.

## Evidence

- Isolated proofs on a rebuilt replica: `scripts/isolated/sample-office.ts` 47/47 (including sabotaging `harness_job`,
  `conversation_history` and `authority_refusal`, each of which turns a check red) and `sample-gateway.ts` 33/33 against the real
  `hq-api` and `signin` (97 actions refused to a guest with nothing written; removing the allow-list in a copy lets a guest through).
- Production API check `sample:public -- verify` 9/9: session with no address; reads limited; operator pages 403; a write 403 with
  the sentence and **an exact count of 0** rows written; the voice door 401.
- Production browser `sample:public-ui`: 24 checks per width on desktop and phone, including one real chat turn answered from the
  Sample's papers (£88,000 for the Riverside site, and an honest "I have no record" for a coffee supplier that is not in them).
- `sample:public-transition`: 28/28. Logged out, Explore, Sign in, a real person (the P4 second person), sign out, Explore again.
  The real office never shows the Sample's projects and carries no banner; the Sample never shows the person's projects; no session,
  visitor id or office data is left in browser storage after either exit.
- Unit tests: `tests/sample/public-plan.test.ts` (10), `tests/auth/speaker.test.ts` (guest refused, person and harness controls),
  `tests/web/due-words.test.ts` (4, proved able to fail).

## Defects found while reviewing it as a customer, and fixed

1. A stray Slack question on the home screen (above). Fixed at the class, 0898.
2. A raw `sample_readonly` code printed under the Create project button. The gateway had sent a sentence; the page printed the code.
   `office.js` now shows the sentence for the two visitor refusals.
3. A **completed** task labelled "30 Sept · overdue" while the late count said 0. `dueWords` now agrees with `isLate`.
4. The first harness chat check passed while the team was still thinking (it matched figures other panels already show). It now
   requires the answer text and refuses the "working on it" state.
5. Two checks from `check:callers` and `check:pressable` caught new surfaces with no visible caller; fixed with npm entries and a
   greppable request in `chat.js`.

## Known limits (recorded, not hidden)

- **Dates are kept believable by a daily job, not by a scheduler.** 0902, whole days only, task dates only (#424).
- **The team's wording is neutral (#425, still open).** The worker (held) builds the prompt identity from the office owner; for a
  non-person office it says "the person you work for", and the Sample's context arrives as office-scoped lessons ("What it has
  learned"). That gives the team the facts (this is a demonstration, nothing is saved, creating your own office is the way to do it
  for real) without a worker change. A sample-aware identity is a worker change and is queued behind the held release.
- **The team does not know its own Activity history or its earlier chat.** Asked "what happened on Riverside this week?" or "what
  has the team produced?", a visitor is honestly told there is no record: those answers are read from documents, tasks and the
  asker's own thread, and the Activity feed is derived for the page. A specialist's conclusion is findable only once it has been
  filed in the project as a document (Daniel's budget check was, with the product's own *Add to project* press, after this was
  found by asking).
- **Some real answers are untidy.** The seeded answers are real, not written, so they carry the product's own quirks: a first line
  such as "I have not done this yet, and nothing has been changed" before a report that was then made, a second specialist adding
  "I have no record" beside a good answer, and a duplicate relay when the same question is asked twice. Each is a worker or
  prompt behaviour and not a Sample defect; the worst seeded turns were left out of the demonstration (flagged, never deleted).
- **If the gateway read fails** (or a proxy answers with an HTML page) while signed out, the page falls back to its built-in
  invented example projects and says so in a strip. A *signed-in* visitor no longer sees those names in a chat that failed to load
  (#426): they see their own messages only. This happened several times in the build sandbox where the proxy sometimes answers
  502 with no `x-vercel-id`; it was not seen from the product itself.
- **Voice is not offered.** A visitor is told it needs their own office.
- **Nothing real is connected, and none is shown as connected.** Services read "Not connected / Not checked"; Messaging offers
  *Connect Telegram* and answers with the sample sentence; Settings carries a line saying so.
