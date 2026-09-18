# Handover — the first beta session, 18 September 2026

This one is different in kind from the four before it. Nothing here came from a
corpus. **Every finding in it started with Grant using the product and saying
something was wrong**, which is what CLAUDE.md's standing rule says beta is for:

> *Real usage is now the primary source of behavioural findings, and a genuine
> failure Grant hits during normal use is worth more than any corpus, because
> nobody wrote it to find anything.*

Two reports. Four defects. Two of the four had been live for days, and **both
were invisible to every gate in the repository** — one because it produced no
page, one because it produced no message.

| | |
|---|---|
| **started at** | `3557017` (the completion-run handover) |
| **ended at** | `3c23246` on `claude/phase-7-communications-kh8ow8`, pushed |
| **commits** | 5 |
| **migrations** | 484 → **488** |
| **unit tests** | 1,713 → **1,716**, all green |
| **new detectors** | 2, both sabotaged and watched go red |
| **deployments** | `google-oauth` v377 · `hq-api` v586 · studio · `worker` |

---

## What Grant said, and what was actually wrong

### 1. *"Well, I went through the clicks and it just gave me this."*

He pressed Connect Google, the consent **worked**, and what came back was a
wall of raw markup.

**Cause, established by probe rather than by reading:** Supabase rewrites
`text/html` to `text/plain` with `nosniff` on the shared
`*.supabase.co/functions/v1` domain — an ordinary anti-phishing measure on a
host thousands of projects share. The control that settles it: `hq-api` returns
`application/json` through the same gateway untouched.

**So every page `google-oauth` has ever produced has arrived unreadable.** Not
a regression. It has never once worked, and nothing could have caught it,
because no suite in this repository opens a page served by an edge function.

**Fixed (`0486`).** A header cannot win an argument with the host, so consent
ends on our own domain: the callback redirects to the studio with the outcome
in the query string, and the studio says it once, above the Connections cards,
naming what Google actually granted. Where there is no app to return to, the
answer is plain text, which no host can flatten. The dead-end page is gone —
it had no way back at all, which is what #216 exists about.

**Two things had to move, and driving it found both.** `keepUrl()` rewrites the
address from the state on every paint, so a parameter not read before the FIRST
render is already gone; and `live()` returns early with no token, so a browser
signed out while he was away at Google would have said nothing. The read is at
boot now, before the first paint.

**Watched from here on.** `npm run shots` captures `back-from-google` at both
sizes in both schemes and **asserts** the banner has a box and the query string
was cleared — a capture cannot tell a missing banner from one taken too early.
Proved it can fail: with the read disabled it reported `NO BANNER`.

### 2. *"I definitely set up a Telegram bot already… I don't know what the hell you're talking about."*

He was right. Telegram had been working the whole time. The office was lying
about it, and had been for four days.

| | |
|---|---|
| The dashboard said | `Telegram / chief bot token — missing`, "disconnected at your request", 14 Sep 10:40:57 |
| The vault holds | `telegram.chief.bot_token`, created 6 Sep, untouched |
| Telegram says | `getMe` → `ok: true, @agenticteamgrantbot` |
| The registry says | that bot `enabled = true` |

**Cause.** `app.hq_disconnect('telegram')` ran — `verify:disconnect` called it
outside a transaction, which CLAUDE.md already records (it really disconnected
Slack the same afternoon; Slack was reconnected two hours later). Of the three
things that branch does, **two matched nothing**: the delete named
`telegram.chief_bot_token` where the stored name has a dot, and the config key
`telegram.enabled` has never existed. Only the third worked — marking the
dashboard `missing`. And it returned `ok: true`.

CLAUDE.md, #210, names this exact branch: *"Assert that a destructive function
actually removed something, or it is a claim with nothing behind it."* Nobody
acted on it, so it sat until Grant did.

**Fixed (`0487`, `0488`).** A disconnect that removed nothing no longer touches
the dashboard — it returns `ok: false` and says what it could not find,
because a live credential reported missing is worse than one that failed to be
removed. The secret is found through `telegram_bots.token_ref`, the id every
reader resolves, rather than by guessing names; and the ref is nulled with the
delete, because that branch had never once run and nobody had met the dangling
reference waiting behind it — the thing that took down every job in the
building when it happened to Slack.

Then the class question, asked before patching further: `notion` already
refuses honestly, the notebook branch says so in a note, and **Slack was the
same shape as Telegram**, safe only because its five names happen to be the
ones stored. Same guard applied. The registry half deliberately does NOT carry
across — Slack has no registry, and inventing one to make two branches look
alike is #249's mistake in the other direction.

**The false chore is cleared**, through the duty that owns it rather than by
hand.

### 3. And underneath the second report, the one nobody would have found

Clearing that chore raised a new one — **Slack's config token had expired** —
and asking why turned up a duty that had failed **ten times running since
16 September**, always the same way:

    output refused: output cannot be marked deterministic:
    job … has 1 recorded inference attempt(s)

`slackRotationHandler` spreads one `base` with
`path: 'deterministic_retrieval'` into all five of its returns. Four are
templated and true. The fifth calls `sayAs` — it asks a model to explain the
failure to Grant — so the moment renewal actually failed, the handler spent an
inference, claimed it had not, and the gate correctly threw the answer away.

**The branch that exists to speak up is the branch the check silenced.** The
token expired with nobody told. That is the worst shape this defect has.

**Fixed (`0489`) at the class.** `howComposed` already existed in
`handlers/instruction.ts`, with a comment promising *"one function, every
caller, so the next confirmation added cannot be the fifth"*. The fifth was in
another file, where a private const could never reach it. It lives in
`agents/provenance.ts` now and both callers import it. The exemption is kept
where it is true — four routine templated outputs a day through quality review
is the other way to get this wrong.

**Proved end to end through the deployed worker**: the job that had failed ten
times completed, and the message reached Slack.

---

## Three things this session says about the instruments

- **A page no suite opens is a page nobody has seen.** The OAuth function's
  output was never rendered by anything — not `verify:ui`, not `shots`, not a
  probe — so it was unreadable from the day it was written and stayed that way
  until a person met it.
- **`check:secrets` refused my own fixture, correctly.** The first draft opened
  with Slack's real refresh-token prefix. A scanner that learns to ignore
  fixtures is a scanner that misses the real thing; CLAUDE.md already has that
  lesson and it held.
- **A test written against a real drive is wrong about half the time first.**
  0487's drive failed its own assertion by reading step 1's writing as step 2's.
  That is the harness being wrong, not the fix — the most-used rule in
  CLAUDE.md, used twice more today.

Both new detectors were deliberately broken, watched go red, and restored.

---

## What is actually open

| | |
|---|---|
| **Slack config rotation still fails** | The office can now SAY so, which is what 0489 bought. The underlying error is `internal_error` from Slack's own `tooling.tokens.rotate`. The likeliest cause is that the config token expired before the refresh could be used, in which case the pair must be regenerated by hand at https://api.slack.com/apps → **Your App Configuration Tokens**. Slack messaging is unaffected — the BOT token is fine. |
| **E — #261**, the agent computer | Not started. Check first what is independent of the Cloudflare credential. |
| **G**, the self-learning loop | Not started. |
| **H**, the visual campaign | Not started as a campaign. |
| **The routing pattern** | Eleven of thirteen misses are decided by the literal trigram matcher before the semantic layer is consulted. Standing finding, `docs/testing/e2e-2026-09-18.md`. |
| **#259's Vikunja provider** | Waiting on Grant's hosting decision, described in the Issue. |

**Corrections to the previous handover**, which is now wrong in two places:
Google is reconnected (and the Connect button asks for Gmail, Calendar and
Drive together, driven off `google_services` so it cannot drift back), and the
Telegram chief bot token was never missing.

## What Grant has to do

**Nothing urgent.** One optional thing when convenient:

**Regenerate the Slack app configuration tokens** at
https://api.slack.com/apps → your app → *Your App Configuration Tokens*. This
only affects the office's ability to edit its own Slack app manifest; posting
and reading in Slack work without it.

And one piece of housekeeping from earlier in the session: a Google OAuth
**authorization code** was pasted into chat. It was already spent and cannot be
redeemed again, so the risk is low. If you want belt and braces, revoke the app
at https://myaccount.google.com/permissions and press Connect Google again.
