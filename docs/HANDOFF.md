# Start here

**For the next Claude Code session.** This replaces every earlier handoff; the
dated ones are kept as history and you do not need them.

**Branch:** `claude/phase-7-communications-kh8ow8` — everything is committed and
pushed. **Date of this handoff:** 2026-09-05.

---

## Where the project is

| Phase | State |
|---|---|
| 0–6 | ✅ complete |
| 7 — Communications | ✅ complete **except** six more Telegram bots (tokens only Grant can make) |
| 8 — Full UI | ✅ built and deployed. One acceptance criterion is deliberately unclaimed — see below |
| 9 — Google ecosystem | ⬜ next |
| 10 — Hardening | ⬜ |

**47 migrations. 583 unit tests. 14 live suites, ~300 checks, all green.**

```
npm run verify        # lint, typecheck, migrations, unit tests, secret scan
npm run verify:db     # every live suite in order — takes ~25 minutes
```

`verify:slack` and `verify:worker` each need the queue to themselves and refuse
to start otherwise, rather than producing a wall of misleading red.
`npm run purge:fixtures -- --go` clears debris.

---

## Read these three things first

1. **`AI_TEAM_HQ_MASTER_SPEC.md`** — canonical, supersedes everything else.
2. **`docs/test-evidence/`** — one document per phase. They record what the
   checks found **by failing**, not what passed. The failures are the part worth
   reading, and there are now eleven in Phase 7 alone.
3. **`src/jobs/worker.ts`** — its header states the rule the whole system is
   built on: *it takes no shortcut that the database would have allowed.*

---

## The one thing to understand about this codebase

Every phase has produced the same defect in a new costume: **a check whose
result does not depend on the thing under test.** The list so far —

- a hardcoded literal
- a query against the wrong column
- a test running as the wrong role
- an over-broad pass condition
- an `UPDATE` matching zero rows
- a second safety mechanism arriving in front of the one under test
- a fixture blocked by an earlier gate
- a check asserting a function's return value rather than its consequence
- a check scoped so loosely it read a previous run's leftovers as a bug
- a check that could only ever have measured nothing
- **a component tested only against its own expectations** (a button composer
  and its adapter, each green, disagreeing about the wire format entirely)

There is a sibling rule, learned three times the hard way: **a test that changes
real configuration must restore it.** `gmail.send` was left enabled by a
permissions check; `research-director` ran a prompt written by a test; and a
gate-3 fixture left a global mute in place that silenced every routine
notification for three days. "Kept as evidence" is not a reason to leave live
configuration changed — that is what the append-only audit tables are for.

**When you write a check, ask what it would do if the feature were deleted.** If
it would still pass, it is not a check. Add a CONTROL that proves it
discriminates; the live suites are full of them and they have earned their place.

---

## What exists now, by surface

**Slack — the office.** Results reach a channel or a thread, presented as the
staff member who produced them, exactly once. Six §12 buttons, received and
acted on. The bot recovers itself from being removed from a channel.
`verify:slack`, 56 checks.

**Telegram — the pager.** One bot live and registered to Grant. Pages only for
`important` and above; silent below urgent. An interrupted send can never be
reconciled (a bot cannot read its own sent messages back), so it parks forever
rather than risk sending twice. `verify:telegram`, 28 checks.

**Team HQ — <https://ai-team-hq.vercel.app>.** Read-only dashboard, five views,
four sparklines. The token is in the vault as `hq.api_token`; `npm run hq:token`
sends it to Grant on Telegram. **Never print it.** `verify:hq`, 24 checks.

**Voice notes.** Everything up to the API call is built. Without a Google
credential every note degrades to text and says `no_credential`, which is the
acceptance criterion working rather than a gap.

**Delivery is channel-agnostic.** `public.deliveries` and `app.claim_delivery`
serve both Slack and Telegram. If you add a third surface, add a `Transport` —
do not add a third table.

---

## Waiting on Grant

He has a browser-agent prompt for the first three:
**`docs/offload/setup-prompt.md`**.

1. **Six or seven Telegram bot tokens.** Roster in
   `docs/telegram-bot-roster.md`. When they arrive: store each in the vault (§15
   — one row per app, never a flat env var), set name/description/commands/photo
   over the API, register a webhook each with its own secret, and tell Grant he
   must send one message to each new bot before it can page him.
2. **A Google Cloud service-account JSON** for Chirp 3. Instructions in
   `docs/google-cloud-tts-credential.md`. When it arrives it goes in the vault
   and `decideVoiceNote` starts returning `speak: true`.
3. **The Slack interactivity request URL.** One field. Until it is set, Slack
   buttons look clickable and do nothing.
4. **Revoking old Google cookies** — needs an interactive sign-in nobody but he
   has. The scanner already prevents a recurrence.
5. **His judgement on whether Team HQ feels right on a phone.** §13's Gate 1
   precedent: a subjective acceptance is never marked passed before the human
   has performed it.

---

## Dead credentials, so you do not trust them

- **`GEMINI_API_KEY` is dead** — `401, the bound service account is deleted or
  disabled`. It is *present* in the environment, so anything checking whether
  the variable is set believes it has a credential. Same shape as the
  `GOOGLE_CLIENT_ID` that was an empty string in September.
- **`SLACK_APP_CONFIG_TOKEN` expires every ~12 hours.** `npm run slack:rotate`
  handles it; the refresh token is single-use, so persist before verifying.

---

## What I would do next, and why

**Phase 9 (Google ecosystem) is the natural next step and is partly blocked.**
Calendar and Gmail need an OAuth consent flow, and `GOOGLE_CLIENT_ID` /
`GOOGLE_CLIENT_SECRET` exist and are valid — but the flow needs a human to
consent once, in a browser. Design the token exchange and the refresh handling
first; that part needs nobody.

**Phase 10 (Hardening) has work available immediately** and does not need Grant
at all: full failure injection across every integration, a backup restore
rehearsal, provider failover, and the §30 documentation set. If you want
something to do that is unambiguously unblocked, start there.

**Two known gaps in what exists**, both mine and both small: Team HQ is
read-only by design (actions need a confirmation model per §21 first), and the
`docs/parked/` items have not been revisited since Phase 4.
