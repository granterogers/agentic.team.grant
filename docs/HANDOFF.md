# Start here

**For the next session, human or otherwise.** This replaces every earlier
handoff; the dated ones remain as history and you do not need them.

**Branch:** `claude/docs-onboarding-setup-5nxt5z` — everything committed and
pushed. **Written:** 2026-09-07.

---

## Read three documents, in this order

1. **[`new-environment.md`](new-environment.md)** — the four commands, the two
   environment variables, and the seven habits this codebase learned by
   shipping the defect first.
2. **This document** — what arrived today, and what it left open.
3. **[`known-problems.md`](known-problems.md)** — everything currently wrong,
   worst first. Current as of 2026-09-07.

**Nothing else, before starting.** The master spec, the ADRs and the twelve
test-evidence documents are reference material, and each of the three above
sends you to the right one when you need it. Previous handoffs opened with a
four-document reading list plus "then run `npm run inventory`", and the reading
was the part that got skipped.

`npm run inventory` is command three in `new-environment.md`. Run it before you
believe anything about a credential, including anything in this file.

---

## Where it stands

| Phase | |
|---|---|
| 0–6 | ✅ complete |
| 7 · communications | ✅ complete bar seven staff Telegram bots (tokens only Grant can make) |
| 8 · Team HQ | ✅ deployed; the mobile judgement is Grant's and unmade |
| 9 · Google ecosystem | ⛔ **do not start** — its OAuth client is under a disabled account, and [ADR-0012](adr/0012-notebook-account-disabled.md) questions the premise |
| 10 · hardening | ⬜ **the obvious next move**, and it needs nobody |

48 migrations · 583 unit tests · 15 live suites, ~300 checks. The unit tests and
the secret scan were re-run green today; the live suites were last run in full
on 2026-09-05.

---

## What arrived today

**An onboarding entry point, and nothing else.** No code, no migrations, no
behaviour change.

- **[`new-environment.md`](new-environment.md)** is new: four commands and two
  environment variables, both verified by running them in a clean container
  rather than transcribed from the older docs, plus a section naming the seven
  habits — each one traceable to a defect that shipped, so the habit arrives
  with its argument attached.
- **The reading list is three documents**, down from four-plus-a-command, and
  the three are now internally consistent about what to read and in what order.
- **Two stale facts corrected.** The Telegram staff-bot count is seven, not six
  — [`telegram-bot-roster.md`](telegram-bot-roster.md) has always listed seven
  and `npm run inventory` reports seven. And `known-problems.md` now carries
  today's live credential state rather than 2026-09-05's.

## What it left open

- **Phase 10 is still unstarted**, and it is still the obvious next move.
  Nothing today touched it.
- **The Slack config token has expired again** — it does that every ~12 hours by
  design. `npm run slack:rotate`. Today's inventory caught it; that is not a new
  problem, it is the expected steady state.
- **`GEMINI_API_KEY` is still set and still dead.** Deleting the variable is a
  one-line environment change nobody has made, and while it is present anything
  testing `if (key)` believes it has a credential.
- Everything on the waiting-on-Grant list below is exactly where it was.

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

All seven of these, with the defect each one cost, are in
[`new-environment.md`](new-environment.md).

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
reason is that surfacing needs one per turn is exactly what went wrong that
week.

1. 🔴 **Change the Backblaze account email** while that login still works.
2. **Which email are OpenRouter, OpenAI and Groq under?**
3. **A decision on the knowledge layer** — ADR-0012.
4. Seven staff Telegram bot tokens; a Google Cloud service account on a live
   account. Browser-agent prompt ready at
   [`offload/setup-prompt.md`](offload/setup-prompt.md).
5. One button press, and a look at Team HQ on a phone.

---

## What I would do next

**Phase 10 (hardening) is unblocked and needs nobody.** Failure injection across
every integration, provider failover, the §30 documentation set. The backup
restore rehearsal is already done — it now passes for the first time, and pages
on failure.

**The knowledge layer spike** is the highest-value thing after that, and it can
start the moment ADR-0012 is settled. Postgres full-text search needs no
provider, no quota and no credential; the content is already in
`notebook_sources.content`.

**Do not start Phase 9.** Its foundation is a credential under a disabled
account, and ADR-0012 asks whether the system should depend on Google at all.
