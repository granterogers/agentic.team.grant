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
2. **[`adr/0012`](adr/0012-notebook-account-disabled.md)** — the open decision.
   Do not re-enable Notebook and do not create a Google account before reading it.
3. **[`../AI_TEAM_HQ_MASTER_SPEC.md`](../AI_TEAM_HQ_MASTER_SPEC.md)** — canonical,
   supersedes everything.
4. **[`test-evidence/`](test-evidence/)** — twelve documents recording what the
   checks found *by failing*. The failures are the part worth reading.

Then run `npm run inventory` before trusting any credential.

---

## Where it stands

| Phase | |
|---|---|
| 0–6 | ✅ complete |
| 7 · communications | ✅ complete bar six Telegram bots (tokens only Grant can make) |
| 8 · Team HQ | ✅ deployed; the mobile judgement is Grant's and unmade |
| 9 · Google ecosystem | ⛔ **do not start** — the account is reinstated, but ADR-0012 questions the premise, and that is the blocker |
| 10 · hardening | ⬜ **the obvious next move**, and it needs nobody |

48 migrations · 583 unit tests · 15 live suites, ~300 checks, all green as of
this evening.

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

1. 🔴 **Change the Backblaze account email** while that login still works.
2. **Which email are OpenRouter, OpenAI and Groq under?**
3. **A decision on the knowledge layer** — ADR-0012.
4. Six Telegram bot tokens; a Google Cloud service account on a live account.
   Browser-agent prompt ready at [`offload/setup-prompt.md`](offload/setup-prompt.md).
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
