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
> ## State as of 2026-09-10
>
> | | |
> |---|---|
> | Tests | 859 passing · `verify:hq` 40/40 · `verify:ui` 36/36 · `verify:talk` 34/34 |
> | Office health | 0 real failures in 24h of 121 jobs (`app.office_health`) |
> | Migrations | 170 applied |
> | Trunk | `main` exists and carries everything — **but the repository default is still `claude/new-session-o2oklu`** (#7, one click, needs Grant) |
> | Current milestone | **M0 — visual prototype.** Not started; assessment and GitHub scaffolding done |
>
> **Waiting on Grant:** the default-branch click (#7) and rotating a leaked
> GitHub PAT (#18). Neither blocks development.
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

146 migrations · 770 unit tests · ~30 live suites, all green.

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
