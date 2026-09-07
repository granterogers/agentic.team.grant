# Start here

**For the next session, human or otherwise.** This replaces every earlier
handoff; the dated ones remain as history and you do not need them.

**Branch:** `claude/phase-7-communications-kh8ow8` — everything committed and
pushed. **Written:** 2026-09-05, revised 2026-09-07.

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

| Phase | |
|---|---|
| 0–6 | ✅ complete |
| 7 · communications | ✅ complete. All eight bots exist, answer, and have introduced themselves to Grant individually on both surfaces |
| 8 · Team HQ | ✅ deployed and redesigned — grouped menus, and every tab says what it is for and what to do |
| 9 · Google ecosystem | 🟡 **plumbing built, readers not written.** OAuth start/callback, the four-step setup on the Settings page, and a refresh token in the vault. Calendar, Gmail and Drive have no reader yet, and it waits on Grant creating an OAuth client in a project he owns |
| · knowledge layer | ✅ ADR-0013 built. Notion connected and syncing 15 pages |
| 10 · hardening | ✅ §18 covered except case 7, which is not yet real; §31 equality live; a security pass over the public surface |
| · the office acting | ✅ an instruction becomes work, is said back before it runs, and every generation is gated on Grant |
| · MCP | ✅ read and write, with OAuth for ChatGPT's developer mode |
| · recurring duties | 🟡 **dispatcher built (0098–0101), one duty seeded.** The daily capacity report §22 names. Briefings, weekly reviews and self-improvement proposals are rows nobody has written |

101 migrations · 752 unit tests · 25 live suites, 458 checks, all green (plus
`verify:transitions`, which compares the two state machines rather than
counting).

**The gap that matters most, and it is not code.** `.github/workflows/worker.yml`
and `vault-export.yml` live only on this branch, and GitHub schedules workflows
from the **default branch** only. So the worker has never run on a timer: every
message to a staff bot is accepted, filed, and ignored until someone runs
`npm run work` by hand. PR #2 fixes it by existing. Until it merges, run the
worker yourself.

**What Phase 10 has cost so far, which is the argument for doing it:** three
real defects, none of which any existing suite could see. The router made one
attempt at one model, so a single 429 failed a whole job. §31's exit criterion
could not hold as written, because `actor` is channel-native. And a job that
crashed after committing was re-run from scratch and produced a second
output — the exact duplicate substantive work §18 forbids. Each was found by
writing the test the spec asked for, not by reading the code.

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

Do not add to this list in chat. It lives in
[`known-problems.md`](known-problems.md) and in `npm run inventory`, and the
reason is that surfacing needs one per turn is exactly what went wrong this
week.

1. **Add the MCP server to Claude.** The token is on your phone. Settings →
   Connectors → Add custom connector, paste the URL and the `Authorization:
   Bearer …` header. Five read-only tools over the projects, the corpus, the
   staff and recent work — see
   [`adr/0014`](adr/0014-the-team-attaches-to-projects.md). ChatGPT gets its own
   token with `npm run deploy:mcp -- --client=chatgpt "ChatGPT"`.
2. **Share some Notion pages with the integration.** In Notion: open a page →
   ⋯ → Connections → add **Agentic Team Grant**. Child pages come with it; a
   database has to be shared itself. Then `npm run notion:sync`. This is the
   only thing the connector waits on — the token is in the vault and works.
3. **Two Telegram bots left** — Quality and Comms. Five arrived on 2026-09-06
   and are registered, configured and answering. Roster and the one manual
   cosmetic step (BotFather `/setuserpic`) at
   [`telegram-bot-roster.md`](telegram-bot-roster.md).
4. **Rotate the Notion token when convenient.** It was pasted into a chat
   transcript on 2026-09-06, which is durable and searchable. Nothing is known
   to have leaked and the integration is scoped to what you share with it, so
   this is hygiene rather than an incident.

**Settled on 2026-09-06, recorded so they are not re-asked:** Backblaze is safe
(its own password, no Google SSO); Google Cloud TTS is parked; the ownership of
the OpenRouter, OpenAI and Groq accounts is parked.

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

The spec says V1 is complete only when **both** scenarios work reliably. Each is
broken into its own clauses below, because "nearly there" is a feeling and this
is a list.

### A — source to conversation

| clause | |
|---|---|
| Grant adds a source from his phone | ✅ paste a link to any bot |
| detected within the sync interval | 🟡 the worker is not scheduled — PR #2 |
| Research analyses it | ✅ |
| justified specialists consulted | ✅ the cap, the justification and the refusal to convene are all enforced |
| Quality/Risk reviews | ✅ |
| findings written back | ✅ as a document; NOT into the notebook — ADR-0013 retired that |
| operational metadata in Postgres | ✅ |
| Slack project channel, correct staff identity | ✅ |
| Telegram notified where policy warrants | ✅ |
| react / respond / Undo | ✅ six buttons, all acted on |
| **Talk to Team — a live voice conversation** | ❌ **not built.** See below |
| Chief explains from real state, "bring Finance in" | 🟡 works by text; the voice path does not exist |
| work continues autonomously | ✅ |
| all actions versioned | ✅ |
| usage in-app and in the daily capacity report | ✅ as of 0098–0101 |

### B — cross-interface delegation

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
| **the same instruction through Voice** | ❌ **not built** |
| generated code in an isolated workspace or branch | ❌ not built, and nothing generates code yet |

### The one thing standing between here and V1

**Voice is not a command source.** What exists is a Gate-1 POC page, an
ephemeral-credential minting endpoint, and voice *notes* — spoken instructions
sent to a bot, transcribed locally, acted on. That is genuinely useful and it is
not what §22 asks for: "Talk to Team" is a live conversation in which Grant
interrupts, redirects and brings someone else in, and §22 B requires the same
instruction spoken to take the same canonical path as the same instruction
typed.

It is also the only §18 case still uncovered (case 7, *Realtime unavailable*),
which becomes testable the moment there is a session to fail.

**There is a real tension in the spec here, and it needs Grant.** §12 calls
voice "optional premium". §22 makes it a completion criterion for both
scenarios. Those cannot both be true, and the answer changes what "done" means:

- if voice is required, V1 is one substantial build away — a Realtime session
  over WebRTC, ephemeral credentials, and the canonical command layer reached
  from a third adapter;
- if §12 wins and voice notes are accepted as the voice surface, then apart from
  Phase 9's readers, the slide decks and the code workspace, **V1 is done**.

Nobody but Grant can settle that, and it should not be settled by whoever picks
this up next quietly assuming one.

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
