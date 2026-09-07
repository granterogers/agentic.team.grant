# Start here

**For the next session, human or otherwise.** This replaces every earlier
handoff; the dated ones remain as history and you do not need them.

**Branch:** `claude/phase-7-communications-kh8ow8` — everything committed and
pushed. **Written:** 2026-09-05, revised 2026-09-06.

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
4. **[`defects-fixed.md`](defects-fixed.md)** — the 26 defects found and closed,
   and the one shape of mistake that has now appeared in fifteen costumes.
   [`test-evidence/`](test-evidence/) has the twelve long-form accounts.

Then run `npm run inventory` before trusting any credential.

---

## Where it stands

| Phase | |
|---|---|
| 0–6 | ✅ complete |
| 7 · communications | ✅ complete. Five of seven staff bots exist and answer; the other two are BotFather clicks and nothing waits on them |
| 8 · Team HQ | ✅ deployed; the mobile judgement is Grant's and unmade |
| 9 · Google ecosystem | 🟡 **unblocked but not scheduled** — ADR-0013 re-bases it: Calendar/Gmail/Drive read Grant's own data on his own account, which was always the supported path |
| · knowledge layer | ✅ ADR-0013 decided and built: `documents`, a connector registry, Postgres full-text search. Notion connected and waiting only on shared pages |
| 10 · hardening | 🟡 **in progress.** Provider failover, §31's cross-interface equality, a security pass over the live public surface, and **all but one** of §18's degradation cases — see [`degradation-coverage.md`](degradation-coverage.md). Remaining: §22's scenario A end to end |

73 migrations · 668 unit tests · 22 live suites, 454 checks, all green (plus
`verify:transitions`, which compares the two state machines rather than counting).

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
