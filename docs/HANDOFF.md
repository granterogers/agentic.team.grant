# Handover

> **Read `CLAUDE.md` first.** It is the standing brief — Grant's own
> instructions, the hard constraints, the traps this repository has already
> fallen into, and how to run and verify everything. This document is only the
> current state.
>
> **Actionable work lives in
> [Issues](https://github.com/granterogers/agentic.team.grant/issues)**, under
> milestones M0 → v1.0. Not here, not in commit messages, not in chat.
>
> ## State as of 2026-09-11
>
> | | |
> |---|---|
> | Tests | 935 passing · `verify:ui` **57/57** · `verify:hq` 39/39 · `verify:talk` **36/36** · `verify:design` 13/13 · `verify:boundary` 57/57 · `verify:layouts` **38 states, 0 findings** · `verify:wired` **47 controls, none dead** · `verify:arrangement` **6/6** · `verify:disconnect` **23/23** |
> | End-to-end sweep | **570 checks, 431 controls pressed** — `docs/testing/e2e-2026-09-11.md` (#41) |
> | Identity | `verify:identity` **29/29** — project name resolution works, aliases seeded (0179) |
> | Restore | `backup:rehearse` **9/9**; a fresh archive at 0180, 24,822 rows, 71 tables |
> | Free tier | measured, not guessed: **31 MB of 500 MB** database, **41 MB of 1 GB** storage (`public.free_tier_headroom()`) |
> | Office health | 0 real failures in 24h of 121 jobs (`app.office_health`) |
> | Migrations | **252 applied** |
> | Trunk | `main` exists and carries everything — **but the repository default is still `claude/new-session-o2oklu`** (#7, one click, needs Grant) |
> | Current milestone | **M0 — visual prototype.** Not started; assessment and GitHub scaffolding done |
>
> **Waiting on Grant:** the default-branch click (#7) and rotating a leaked
> GitHub PAT (#18). Neither blocks development.
>
> **One frontend, and it is the designed one.** `ai-team-hq.vercel.app` serves
> `web/studio`; `web/hq/index.html` is deleted (ADR-0019, #68). Every write
> action, all six operational sections and the voice call moved across, and the
> suites moved with them — `verify:ui` walks nineteen studio screens at three
> sizes, and `verify:design` fails if a second frontend ever reappears.
>
> **The office now learns, notices and can be taught.** `app.notice()` finds
> what nobody asked about — an unowned deadline, a quiet project, a source that
> gave nothing, a limitation that recurred — and a dismissal buys a fortnight of
> silence per dismissal rather than lowering a score. It feeds the morning
> briefing's recommendations, which arrive daily at 07:00 Athens. And skills are
> data: Grant can tell the office a procedure in a Telegram message and it goes
> in front of the relevant work from the next job on, visible and retirable on
> each person's card. **A skill may name a tool and may never name an address**
> (ADR-0017) — that one rule is what makes a procedure safe to let an agent
> write, and `app.staff_may_use()` reads neither skills nor lessons, asserted
> behaviourally and structurally.
>
> **Overnight, 11–12 September.** Twenty-seven of the thirty UX-review items
> are closed, plus #11 and #24 which turned out to be blockers. Google Calendar
> sync is built and **switched off** — turn it on at Settings → Behaviour →
> *"Put dated tasks in my Google Calendar"*. Everything else is live.
>
> The last five of that night: **#103** the dock — a fixed column that keeps a
> conversation with the team open while you move around, reaching `/voice/turn`
> like the call does · **#81** dashboard arrangements now live in Supabase
> rather than `localStorage`, which is **ADR-0021** and the rule for everything
> customisable after it · **#90** Disconnect works for Notion and NotebookLM as
> well as Google, refuses honestly where there is no safe disconnect, and says
> where to revoke at the provider because Postgres cannot · **#108** dashboard
> panels stopped clipping their own content mid-word · **#107** a contact shows
> the labels its role already names, so no chip reads zero beside somebody who
> plainly belongs in it.
>
> Two things to know before reading further:
>
> - **`calendar.sync_tasks` is false on purpose.** It works end to end,
>   verified with one controlled round trip against the real diary. A task that
>   becomes done has its event **deleted** without asking — only ever events
>   carrying our own task id (ADR-0020). That is the one decision worth your
>   eye before you flip it.
> - **`public.tasks` had zero rows and no way to make one**, which is why #11
>   got built ahead of the calendar. A calendar sync over an empty task table
>   would have been #72 exactly.
>
> **Grant's UX review of the studio is filed as #75 and half-built.** Thirty
> items, persisted verbatim at `docs/spec/ux-review-2026-09-11.md` and filed as
> #76–#105. Fourteen are closed: the navigation is his shape now (picker top
> left, sections in the sidebar, Lately and Settings at the bottom, no status
> strip, no Desk, the rail collapses to nothing), the covers are 64px marks
> rather than slabs, light and dark is a real three-state setting, and the
> connect buttons connect.
>
> Two of them were worse than described. **#102 was not "off does not work"**:
> closing the call sheet threw away the only reference to a live microphone,
> so nothing could ever stop it and reopening started a second. **#87 could
> not have been fixed as written**: there was no dark-mode setting to fix —
> every palette's dark tokens lived only inside `prefers-color-scheme`.
>
> **Six new checks, each written because something passed while broken.**
> `check:templates` parses every `web/**/*.js` as a module and refuses a
> backtick in an HTML comment. `verify:wired` fails on a control no source
> file looks up. `verify:talk` now counts live audio tracks across every
> stream the stub handed out, including ones the page has forgotten.
> `verify:layouts` fails when a box hides content and gives the eye neither a
> real scrollbar gutter nor a marker — the third clipping-class defect a green
> suite had missed. `verify:arrangement` asserts what LEAVES the page, because
> a layout saved only to `localStorage` drags, snaps, survives a reload and
> captures perfectly, and is wrong only on the second device. And
> `verify:disconnect` checks a destructive action **without being
> destructive**: every SQL assertion runs inside `begin … rollback`, the page's
> own payload is read back inside the transaction, and it then re-asserts that
> the real credentials are still there.
>
> **Each of the three new suites was proved by putting its bug back.**
> `verify:layouts` reported 2192px of Documents hidden with nothing to say so;
> `verify:arrangement` went to 1/6; and `verify:disconnect` needs no such
> demonstration because it deletes a real credential and rolls it back on
> every run.
>
> **The backlog is current as of 11 September.** Every issue verified complete
> was closed with the evidence in a comment rather than a tick — #9, #48, #52,
> #53, #55, #56, #57, #58, #59, #61, #62, #66, #68. **#50 stays open on
> purpose**: six of its seven boxes are ticked and the last one — a real
> capability acquired end to end without a coding session — needs the office to
> ask for a tool it does not have and be granted it. Five findings from that
> day's work that were in nobody's Issue are now filed: Claire is the only
> agent with no bot of her own and the only one permitted to speak to Grant
> (#70) · modules are in the canonical IA with no table behind them (#71) ·
> *build the mechanism, forget the mouth*, five instances in one session, which
> wants a check rather than another note (#72) · the backtick-in-a-template
> -literal trap fired five times in a day despite being documented (#73) ·
> `verify:controls` audits the studio without a token, so it cannot see a
> single write control (#74).
>
> **Recently landed:** the frontend build prompt persisted to
> `docs/spec/` · integration assessment · GitHub as the operational record
> (19 labels, 5 milestones, templates, 14 Issues) · the Notion document
> duplication fixed at the root (#8) · phone notifications (`npm run notify`) ·
> the build diary (`npm run step`, visible at *What Claude is building*).

# Start here

**For the next session, human or otherwise.** This replaces every earlier
handoff; the dated ones remain as history and you do not need them.

**Branch:** `claude/phase-7-communications-kh8ow8` — everything committed and
pushed. **Written:** 2026-09-05, revised 2026-09-09.

**Starting a new session or a new environment?** Read
[`new-environment.md`](new-environment.md) first — it is four commands and the
two variables an environment needs, so the first thousand tokens go into work
rather than rediscovery.

---

## Read these four, in this order

1. **[`known-problems.md`](known-problems.md)** — everything currently wrong.
   Start here, not with the code.
2. **[`adr/0013`](adr/0013-the-project-is-the-source-of-truth.md)** — the
   decision that settles the knowledge layer. The project is the source of
   truth; NotebookLM, Notion and uploads are connectors to it. Read it before
   touching `documents`, and do not revive the NotebookLM sync.
3. **[`../AI_TEAM_HQ_MASTER_SPEC.md`](../AI_TEAM_HQ_MASTER_SPEC.md)** — canonical,
   supersedes everything.
4. **[`defects-fixed.md`](defects-fixed.md)** — every defect found and closed,
   and the one shape of mistake that keeps arriving in a new costume.
   [`test-evidence/`](test-evidence/) has the long-form accounts. The seven
   habits at the end of [`new-environment.md`](new-environment.md) are the
   distillation; read those even if you skip the list.

Then run `npm run inventory` before trusting any credential.

---

## Where it stands

**Revised 2026-09-09.**

| Phase | |
|---|---|
| 0–6 | ✅ complete |
| 7 · communications | ✅ complete. All eight bots exist, answer, wear their own face, and write in a voice a person would use |
| 8 · Team HQ | ✅ deployed and redesigned — grouped menus, plain English, and a real voice call on the Talk page |
| 9 · Google ecosystem | ✅ Calendar, Gmail, Drive and YouTube connected per-service; calendar and mail have readers and refresh hourly |
| · knowledge layer | ✅ ADR-0013 built. Notebook reads AND writes now run over HTTPS with no subprocess (0138, 0140); Notion has a duty as of 0146 |
| 10 · hardening | ✅ §18 covered including case 7; both §22 scenarios harnessed and passing; backup taken nightly and restore rehearsed |
| · the office acting | ✅ an instruction becomes work, is said back before it runs, and every generation is gated on Grant |
| · MCP | ✅ read and write, with OAuth for ChatGPT's developer mode |
| · recurring duties | ✅ seven live: capacity report, calendar, mail, discovery, Notion, Slack token rotation, nightly backup. One left disabled — `vault-export`, which needs Grant |

281 migrations · 964 unit tests · ~54 live suites, all green.

**Since 2026-09-11 the studio can take things back (#118, migrations
0263-0266).** Every write with an EXACT inverse records it at the moment it
still knows the previous value — a rename, a task edit, a state change, an icon
or hue, an arrangement, a detached source — and a strip offers to reverse it.
Everything else offers nothing and says why: a replaced project photo, a
disconnected service (the credential is deleted from the Vault), a new project
(the confirmation is the safeguard). `npm run verify:inverse` proves the
exactness per action against the live database, and carries a control that
records a deliberately WRONG inverse and requires the same comparison to catch
it.

**A write-capable job now says what it would do before it does it (#131,
migrations 0267-0269).** `Handler.plan()` is computed by the same code path that
performs the work — `syncTasksToCalendar` was split at exactly that seam — and
the worker records it against the job before the handler runs, at one
chokepoint. `app.request_approval` appends it to the blocker, so an approval
shows the list rather than the category. `npm run verify:dryrun` runs the
planner with a `fetch` that throws on any outward write, then runs the handler
with one that counts, and fails a handler that does more than it planned. Not
yet covered: `office.notion_import`, whose plan depends on a model call and so
needs the STORED plan to be the thing executed.

**A queued job is no longer invisible (#112, migrations 0270-0271).** Nine
hourly jobs sat queued for eight hours with a green dashboard, because
`office_health()` counted complete, failed and in-flight and a job nobody has
taken is none of those. `verify:worker` now holds the kinds enabled duties
enqueue against the kinds the real registry declares — `buildPass` exposes them
— and fails before a deploy rather than eight hours after.
`app.jobs_stuck_queued()` measures a stall against the period of the duty that
made the job, `office_health()` reports it, and the studio shows an orange strip
naming the kind and the age.

**An output can declare its shape (#130, migrations 0272-0273).**
`public.output_shapes` holds the contract as rows — one authority, because the
validator has to run where the row is written and every consumer is SQL — and a
trigger refuses a declared shape whose facts do not match, naming the key and
what it should have been. `body` stays: prose is what Grant reads. The duties
that report "nothing changed" now say so in a field. Still prose-only:
`research_summary`, `tasks_extracted` and `draft_document`, which need their
handlers taught to ask the model for structure.

**The office knows what it can do, per person (#148, migrations 0277-0279).**
`app.capability_index(staff)` is generated on every call from
`tool_permissions`, `staff_tools`, `knowledge_connectors`, `connection_health`
and `tool_requests`, and answers four different questions — can / must ask /
nobody may / already refused. It replaces `verbsNow()`, a hand-written list in
TypeScript that covered three of twenty-one tools; the verbs are a column now,
so the office can correct one without a deploy. It also fixed a duplicate that
had been in **every capability brief the office had ever sent**: Slack and
Telegram each have two `connection_health` rows and the surfaces branch never
deduped.

**Tasks exist across the whole portfolio (#173, migrations 0280-0281).**
`tasks.project_id` is nullable, so a task can belong to no dashboard project;
`app.hq_portfolio_tasks()` aggregates every open one with overdue, waiting,
stale, unowned and suggested computed on read in Grant's timezone; and the
studio has a Tasks screen whose first row answers *"what should I be doing
next"* rather than only listing. Ticking one there is the same row the project
view ticks, so undo works for free.

**The office recognises a failure it has seen before (#132, migrations
0274-0276).** `failure_signatures` counts a repeat instead of logging it again,
and `app.notice()` raises one that has happened three or more times in a
fortnight — *"this has failed the same way eleven times"* is a recommendation.
Deliberately not a circuit breaker: recognising a repeat and refusing to try
again are different features, and the second silently stops work Grant expects.

The table is **provably free of payload** because it has nowhere to put one —
no text column an error message could be written into, only a dotted kind, one
of nine class words, and an id. `verify:failures` attacks that rather than
asserting it, and found a real hole on the first run: a Slack-token-shaped
string satisfied the original subject pattern completely. 0276 narrowed it to a
UUID or a short lowercase handle AND held it against the credential shapes.

**There is no cron and no GitHub Actions.** Grant switched Actions off on
2026-09-08 — *"for any process"* — and everything scheduled moved to
`pg_cron` poking a Supabase Edge Function every minute, which then fires
whatever duties are due. Three capabilities silently stopped when Actions went
(the worker, the notebook reads, the backup) and each was found separately;
if something looks like it has not run since 2026-09-08, that is the first
thing to suspect.

**What Phase 10 has cost so far, which is the argument for doing it:** seven
real defects, none of which any existing suite could see. The router made one
attempt at one model. §31's exit criterion could not hold as written. A job
that crashed after committing produced a second output. No output had ever
been attributed to anybody. The event ledger had never recorded a real action.
§22's own sentence was classified as a request for work. And the Set up page
showed a green light for a backup that had stopped happening. Every one was
found by running the thing end to end, not by reading the code.

---

## What happened today, in one paragraph

Grant reinstalled Slack with `channels:join` and set the interactivity URL, so
the office is complete. Photorealistic avatars were generated, hosted and are
live. Team HQ was built and deployed. Then Google disabled the account four
vendors sign in with, which turned the day into an audit: NotebookLM is gone,
the Gemini key was already dead of the same cause, Groq turned out to be dead
too, and the backup rehearsal turned out to have failed every night since it was
written without telling anyone. All of that is fixed or recorded; none of it is
still bleeding.

---

## The rule the codebase is built on

From `src/jobs/worker.ts`: **it takes no shortcut that the database would have
allowed.** A worker knows what it is doing — it wrote the output, so why re-read
`reviewer_status`? Every such shortcut turns an enforced invariant into an
honour-system one, and the enforcement stays green because nothing exercises it.

And the defect this project keeps meeting, in eleven costumes so far: **a check
whose result does not depend on the thing under test.** When you write one, ask
what it would do if the feature were deleted. If it would still pass, it is not
a check — add a CONTROL that proves it discriminates.

Two siblings, each learned the hard way:

- a test that changes real configuration must restore it;
- **a failing check that notifies nobody is indistinguishable from a passing
  one.**

---

## What exists, by surface

**Slack — the office.** Results reach the thread that asked, presented as the
staff member who produced them, exactly once. Six §12 buttons, received and
acted on. The bot recovers itself from being removed from a channel.
`verify:slack`, 56 checks.

**Telegram — the pager.** One bot, registered to Grant. Pages at `important`
and above, silent below urgent. An interrupted send can never be reconciled — a
bot cannot read its own sent messages back — so it parks forever rather than
risk sending twice. `verify:telegram`, 28 checks.

**Team HQ — <https://ai-team-hq.vercel.app>.** Read-only, five views, four
sparklines, per-device layout memory. The token is in the vault as
`hq.api_token`; `npm run hq:token` sends it to Grant's phone. **Never print it**
— the deploy script did once, which is why it now cannot. `verify:hq`, 24 checks.

**Delivery is channel-agnostic.** `public.deliveries` and `app.claim_delivery`
serve both surfaces. Adding a third means adding a `Transport`, not a third
table.

**Voice notes.** Everything up to the API call. Without a credential every note
degrades to text and says `no_credential`, which is the acceptance criterion
working.

---

## Waiting on Grant

**Revised 2026-09-09.** Do not add to this list in chat. It lives here, in
[`known-problems.md`](known-problems.md) and on the Set up page, and the reason
is that surfacing needs one per turn is exactly what went wrong that week.

1. **Make the Telegram office group.** Telegram does not let a bot create one,
   so this step cannot be automated. New group → add all eight bots
   (`@agenticteamgrantbot` and the seven `@atg_*_bot`) → call it AI Team HQ.
   They register themselves on being added (`my_chat_member`, 0136), and the
   routing already exists: the Chief of Staff reaches Grant directly, everyone
   else moves into the room the moment it exists. It also appears on the Set up
   page as of 0142.
2. **Make a Notion Teamspace for each project, and share a database from it.**
   Answered on 2026-09-09 and now prompted rather than remembered. Notion's
   public API exposes no teamspace at all — no endpoint, no field, and a
   database inside one reports its parent as the workspace — so this genuinely
   cannot be automated and never will be until Notion adds it. Every project
   without a Notion attachment now reads `wanted` on the Projects page with the
   steps attached: make the teamspace, put a database in it, share that
   database with the Agentic integration, attach it to the project. After that
   the team can write into it unaided.

   `notion.project_slug` is gone (0161). It could only ever name one project,
   and it was named for something it did not hold — Grant: *"Configuration and
   database fields must use terminology that reflects what they actually
   reference."* The mapping is per project now, in `project_attachments`.
3. **Decide whether `vault-export` runs weekly.** It is the last duty still
   disabled. Enabling it means a copy of every credential arriving on Telegram
   every week — which is the only thing that would survive losing the Supabase
   project, and also a weekly credential broadcast. His call, and it needs
   `openssl` replaced with Web Crypto first so it can run in the worker.
4. **Add the MCP server to Claude,** if it is still wanted. The token is on
   your phone. Settings → Connectors → Add custom connector, paste the URL and
   the `Authorization: Bearer …` header.
5. **Rotate the Notion token when convenient.** It was pasted into a chat
   transcript on 2026-09-06, which is durable and searchable. Hygiene rather
   than an incident.
6. **A read-only GitHub token, if "look at my Rest Timer repo" should work.**
   `github.dispatch_token` is in the vault, authenticates as `granterogers`,
   and is scoped to THIS repository with contents:write — it was made for
   `repository_dispatch` (0126). It is what the read client uses, and it cannot
   see any other repository whatever it is allowed to do here. A fine-grained
   token with Contents/Metadata/Issues read-only across the repos he picks
   would close §8. Steps are in the 2026-09-09 audit.
7. **A CoachAccountable API key, if the team should update coaching records.**
   Researched rather than assumed: CoachAccountable has had a full REST API
   since 2015, with `Client.update`, `Action.add`, `Metric.addData`,
   `Session.add` and webhooks. Profile icon → Settings → System → API Access
   gives an API ID and a private key. That is strictly better than the
   login-and-scrape he asked for — no password stored, revocable, structured,
   and it does not break when they change their HTML.

**Notion is no longer a read-only integration.** As of 2026-09-09 the client
speaks API `2026-03-11` and can create pages, append and update blocks, set
properties and relations, upload and attach files (audio becomes an audio block,
not a download link), read a database schema before writing to it, and archive
reversibly. `notionCapabilities()` answers "do we have a token / what can I do /
is this read-only" without asking anybody. The full matrix, the three things
Notion genuinely cannot do, and the two breaking changes the version bump
brought are in [`notion-capability-matrix.md`](notion-capability-matrix.md).

**Settled, recorded so they are not re-asked:** Backblaze is safe (its own
password, no Google SSO); Google Cloud TTS is parked; the ownership of the
OpenRouter, OpenAI and Groq accounts is parked; voice is required (Grant,
2026-09-07) and is built; GitHub Actions is off for every process.

**No longer waiting:** all eight Telegram bots exist, are configured, answer,
and wear their own face. Notion pages are shared. The Google OAuth client
exists and all four services are connected.

---

## What arrived on 2026-09-07, and what it left open

The office can now act rather than only answer. In order of how likely you are
to trip over them:

- **Every notebook generation is gated on Grant's approval** (0083–0086). The
  gate is in `notebook.generate`, not in the office, because an MCP client and a
  scheduled retry can both start one. Approval creates a NEW job carrying
  `approved_by`; nothing resumes.
- **`jobs.not_before` and `jobs.announce`** (0074) exist and are load-bearing.
  A job can be delayed, and a job can decide its own output is not worth a
  message. Both are read by the worker and the notifier.
- **The notebook meter** (0078). Google's compute allowance cannot be queried —
  there is no API — so `notebook_spend` counts ours and a refusal lowers the
  ceiling permanently. Never present those numbers as Google's.
- **Voice notes** transcribe locally with faster-whisper. The audio never
  leaves the runner, deliberately; do not "improve" this by sending it to a
  provider.
- **`#the-floor`** narrates routing decisions in plain English, rendered clause
  by clause from the row. Do not let a model write it: an unconfident reading
  smoothed into a confident one is exactly what the channel exists to show.

Left open, and honestly: NotebookLM **slide decks fail** every time on this
account (four attempts, all `failed` from Google, with audio and mind maps
working). The boilerplate stripper removes 61% of a Wikipedia extraction but the
remainder still carries theme toggles and table-of-contents chrome — better, not
solved.

---

## §22 completion, measured rather than felt

**Revised 2026-09-09.** Both scenarios now have live harnesses, and the tables
below are what those harnesses report rather than a reading of the code. Run
them: `npm run verify:scenario-a` and `npm run verify:cross-interface`.

### A — source to conversation · `verify:scenario-a`, 20/20

| clause | |
|---|---|
| Grant adds a source from his phone | ✅ paste a link to any bot |
| detected within the sync interval | ✅ `discovery-sync`, hourly, since 0138 — reads run over HTTPS now, so the Edge worker can do them |
| Research analyses it | ✅ |
| justified specialists consulted | ✅ the cap, the justification and the refusal to convene are all enforced |
| Quality/Risk reviews | ✅ |
| findings written back | ✅ as a document; NOT into the notebook — ADR-0013 retired that |
| operational metadata in Postgres | ✅ |
| Slack project channel, correct staff identity | ✅ — and it was NOT, until 2026-09-09. 736 of 736 outputs had a null `staff_id`; a name was resolved for display and never persisted |
| Telegram notified where policy warrants | ✅ |
| react / respond / Undo | ✅ six buttons, all acted on; `undo_offers` idempotent |
| **Talk to Team — a live voice conversation** | ✅ Realtime over WebRTC, barge-in, live transcript, and an `ask_the_team` tool that reaches the office |
| Chief explains from real state, "bring Finance in" | ✅ — and §22's literal sentence was being delegated instead of answered until 0139 |
| work continues autonomously | ✅ |
| all actions versioned | ✅ — and the ledger had never recorded a single action by the working system until 2026-09-09. 75 events, all of them fixtures |
| usage in-app and in the daily capacity report | ✅ |

### B — cross-interface delegation · `verify:cross-interface`, 10/10

| clause | |
|---|---|
| the instruction through Slack | ✅ |
| identifies the project, creates a persistent initiative | ✅ — and asks first, after it created two projects nobody wanted |
| delegates to justified specialists | ✅ |
| routes conclusions through Quality/Risk | ✅ |
| works asynchronously, preserves state | ✅ |
| returns progress to the right Slack thread | ✅ |
| places rich artifacts in the notebook | 🟡 audio overviews and mind maps yes; slide decks fail every time |
| notifies Telegram only per policy | ✅ |
| **the same instruction through Voice** | ✅ asserted as an equality on the stored row, modulo the channel-native fields |
| generated code in an isolated workspace or branch | ❌ not built, and nothing generates code yet |

### What is actually left

Voice was the answer to the tension this section used to describe — Grant
settled it with three words, *"Voice is required"*, and it is built. What
remains is smaller and none of it is a scenario clause:

- **the code workspace** (§22 B's last line), which nothing needs yet because
  nothing generates code
- **slide decks**, which fail upstream at Google
- **`vault-export`**, the last duty still seeded disabled: it needs `openssl`
  replaced with Web Crypto to run in the worker, and switching it on means a
  copy of every credential arriving on Telegram weekly, which is Grant's call
- **a security review as a distinct pass** — `verify:security` covers RLS,
  vault isolation and role separation, but nobody has sat down and tried to
  break it on purpose

---

## What I would do next

**Finish Phase 10.** Provider failover, §31's cross-interface equality and
failure injection are done; `verify:chaos` covers seven of §18's twenty named
cases. The remaining thirteen are the obvious next block of work, and they need
nobody — §18 names them explicitly, so there is nothing to decide.

After that, **§22's scenario A end to end**: a source arriving, being analysed,
reviewed, delivered to the right Slack thread with the right face on it, and
reacted to. Every piece exists and is checked in isolation; nothing has run the
whole arc in one go.

**Phase 9 is unblocked but unscheduled.** ADR-0013 re-based it: Calendar, Gmail
and Drive were always going to read Grant's own data on his own account with his
consent, which is the supported path and carries no policy exposure. It needs an
OAuth client in a project he owns, and it needs someone to decide it is worth
the time before the hardening is finished.

**Do not revive the NotebookLM sync.** Not caution — ADR-0013 decided it. There
is no public API, so an unattended client must impersonate a browser session,
which is exactly what the ban named. Pasting a source in by hand still works and
produces a document like any other.
