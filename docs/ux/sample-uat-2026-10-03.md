# Team HQ as a customer: the Sample Person run, 3 October 2026

Everything below was done through the real page and the real gateway as the canonical Sample Person (Jordan Reyes, owner key
`p4-second-person`) or as disposable throwaway accounts. Grant's office was fingerprinted before and after each write run and did not
change. Nothing contacted a person.

## Capability matrix

Legend: **TESTED** (driven, with the command), **UNTESTED** (exists, not driven), **PARTIAL**, **OPERATOR** (by design, a person is refused),
**EXTERNAL** (needs a real connection), **BROKEN**, **NONE**.

| Area | Status | Evidence / note |
|---|---|---|
| Create account | **TESTED** | `verify:entry-ui` (64), `verify:account-ui` (52), `verify:account-lifecycle` (75). Sign-in is passwordless: the mail itself (delivery, template, rate limit) is Supabase's and is substituted by the harness |
| Office provisioning | **TESTED** | exactly one office per login, five concurrent creates make one, owner key `u-<auth uuid>`, no Grant/Sample fallback; `accounts.open_signup` and `accounts.max_person_offices` switches |
| First-run | **TESTED** | "Your office is ready" with one next step; the empty catch-all project no longer hides it |
| Sign in / out / session persistence | **TESTED** | reload keeps the session; sign-out leaves no key, IndexedDB record or cache; Back and a typed project address show the entry screen |
| Project create | **TESTED** | Team HQ had **no** way to create a project until this run (P0 for a new person); a near match is asked about first |
| Project edit / archive | **TESTED** archive; rename **UNTESTED** | Project settings > Project > Archive (native confirm, see #411) |
| Team Chat, Claire | **TESTED** (3 real turns) | answers arrive; quality findings below (#408) |
| Specialist delegation | **PARTIAL** | delegation happens and the answer is a later output on the Team page; the answer cannot see tasks or documents (#408) |
| Tasks: add, rename, done, reopen, remove, reload | **TESTED** | `sample:use`; title edit and Remove were missing from the task record (fixed) |
| Tasks: subtasks, categories, priorities, blocked | seeded and shown; **TESTED** display, **UNTESTED** editing |
| Needs You / Late / Stuck | **TESTED** Late and Stuck open their lists; Needs You only via a real job's blocker (jobs are permanent, so not seedable) |
| Calendar | **PARTIAL** | Schedule is built from dated tasks (Japan Spring Trip has 20 multi-day items). `calendar_events` is a Google cache read only by the briefing; there is **no internal event model**. Reported, not faked |
| Docs & Files | **TESTED** open (new tab), thumbnails/list; drafts are held back from the page |
| Contacts | **TESTED** open; save **UNTESTED** |
| Recent activity | **PARTIAL** | only genuine ledger events; task/contact/document writes record none (#409) |
| Sources / Google | **EXTERNAL** | not connected for the Sample; an expired Google reads Reconnect (`verify:google-reconnect`) |
| Slack, Telegram | **EXTERNAL** + architecture | deployment channels, operator-only (#410) |
| Voice note | **TESTED**, microphone and transcription substituted | `sample:voice` |
| Talk to Team | **PARTIAL** | session boundary only (mint as the Sample, stranger refused, office-bound brief, control reachable on a phone). **No audio was exercised** |
| Tool requests: approve, decline (with reason), take back | **TESTED** | `verify:sample-tool-requests` (24) and the same presses through Settings in `sample:use` |
| Lessons / memory | listed (2 seeded); adding **UNTESTED** |
| Global Settings | **TESTED** | `verify:sample-settings` (53) |
| Operator-only controls (hire, credentials, global switches) | **OPERATOR** | 403 for the Sample, asserted |

## What is real, simulated, impossible

- **Real sample data:** 3 projects, 96 tasks, 12 contacts, 22 documents, 2 lessons, 4+ tool requests, autonomy and accent, all written through the
  gateway or office-scoped writers (`npm run sample:inventory`).
- **Simulated:** nothing in the Sample office. The harnesses substitute the mailbox (account creation), the microphone and the transcription call (voice note).
- **Impossible without a product change:** internal calendar events, Needs You/Stuck fixtures without a job, activity for hand-made changes, chat history (fabricated history would break provenance, so none is seeded), per-person Slack/Telegram.

## Defects found and what became of them

Fixed in this run (each has a regression where a harness could carry one):
1. **P0** no way to create a project in Team HQ; no account/office creation; a stranger saw invented projects. Built (`account.js`, `create_office`, 0866).
2. **P1** a fresh office carried a visible empty "Unnamed" project that hid first-run; now listed only once something is filed, and shown as "Conversations".
3. **P1** a failed link send was reported as "check your email" (`askForLink` ignored `ok:false`).
4. **P1** `app.voice_answer` answered any message containing budget, cost, schedule, report... with a canned report and no job ("Ask the finance specialist to summarise the assumptions in the budget documents" got a model-usage figure). Instructions and long messages now go to the team (0867, `sample:voice-answer`, 13 verdicts incl. negative controls).
5. **P1** the delegated-answer sentence promised Slack and Telegram to people who have neither; reworded in the page, the call page and the `voice` function (deployed v631).
6. **P1** the task record could not be renamed or removed; a removed task came back as a struck-through "done" one.
7. **P1** Enter in Search reloaded the page and threw the query away.
8. **P2** desktop Home had no chat entry; eight labels under the 12px floor; spacing token `--bc-5` did not exist (card flush on a phone) and now a test fails if one is used again.

Open, filed: #408 (chat cannot see own tasks/documents, P1), #409 (activity writers, P2), #410 (per-person Slack/Telegram, decision), #411 (P2/P3 polish).

## Harnesses

`sample:tour` (every surface, four widths, measures and captures), `sample:use` (21 interactions), `sample:chat` (3 paid model turns, bounded),
`sample:voice`, `sample:voice-answer`, `verify:account-ui`, `verify:entry-ui`, `verify:account-lifecycle`, `sample:inventory`, `sample:reset`.
