# Phase 7 — the Slack office

**Run:** 2026-09-05 · **Suite:** `npm run verify:slack` (38 checks, all live)
**Unit:** `npx vitest run tests/slack` — 78 tests across 6 files
**Migrations:** 0032, 0033, 0034, 0035, 0036

This document records what the checks **found by failing**, not a list of what
passed. The passes are in the suite output; the failures are the part worth
reading, and there were five.

---

## What now exists

| | |
|---|---|
| `migrations/0032_slack_office.sql` | outbound deliveries, the claim/lease mechanism, channel life |
| `migrations/0033…0035` | three corrections to 0032, each found by a check |
| `migrations/0036_clear_the_leaked_global_mute.sql` | a live preference a test left behind in 2026-09 |
| `src/slack/api.ts` | the Web API client, its retry rules and its error classification |
| `src/slack/identity.ts` | §9 presentation: name, title, avatar — and what happens with no avatar host |
| `src/slack/blocks.ts` | Block Kit composition, Slack's silent limits, §12/§16 honesty rules |
| `src/slack/office.ts` | claim → post → record, reconciliation, retraction, channel life |
| `src/slack/provision.ts` | a channel per project, and the `name_taken` question |
| `src/slack/notifier.ts` | the worker's `notifying` state, made real |
| `scripts/verify/slack.ts` | the 38 live checks |

Seven of Phase 7's eight named Slack failure injections are performed for real
against the real workspace. The eighth is discussed below rather than faked.

---

## The five defects the checks found

### 1. The worker said "delivered" and delivered nothing

`runJob` moved `committed → notifying → complete` with
`state_reason = 'delivered'`. There was no notifier. The state machine was
telling the truth about which state it was in and a lie about what that state
meant, and every worker test passed because none of them asked what `notifying`
did.

Fixed by giving the worker an optional `Notifier` and making the final state
reason report what actually happened — including `no notifier configured;
nothing was delivered`, which is the honest answer when there is none.

### 2. A recovery path with a caller and a syntax error

`app.claim_slack_delivery` is declared `returns table (delivery_id uuid, …)`,
which makes `delivery_id` a PL/pgSQL variable throughout the body. The reclaim
branch then wrote `where delivery_id = v_row.delivery_id`, which Postgres
refuses at runtime with `42702`.

Four of the function's five paths return before that statement. The fifth is
the one that runs only after a claimer has died — so the function worked
perfectly except during a crash, which is the only time it is needed. 0032's
own header argues that a recovery path with no caller is not a recovery path;
this is the next form of the same defect. Fixed in 0035.

### 3. A retry that could not be retried for two minutes

`resolve_slack_indeterminate` establishes that a message provably did not land
and hands the delivery back with a **fresh two-minute lease** — the natural
thing to write, and wrong, because the resolver is a reconciler and is not
going to post anything. The next real caller found a live claim and was told
`held`.

Caught only because the check asserted the *consequence* — that a later
delivery actually posts — rather than the resolver's own return value, which
said `retryable` and was believed. Fixed in 0034: the lease is handed back
already expired.

### 4. `conversations.replies` rejects a JSON body that `conversations.history` accepts

The client POSTed JSON to every method. `conversations.history` accepted it;
`conversations.replies` returned `invalid_arguments`. Slack's read methods are
documented as form-encoded and only some tolerate JSON, so "it worked for the
method I tried" was not evidence about the next one. Reads now go out as GET
with a query string, with a unit test pinning it.

### 5. A test muted the live system for three days

`notification_preferences` held one row — subject `grant`, no project,
`min_severity = 'important'` — applied on 2026-09-03 at 14:57 by
`scripts/poc/gate-3.ts`, which ends with the comment *"clean up the probe rows;
the preference stays as evidence"*.

Evidence and configuration are different things. The evidence is in
`preference_instructions`, which is append-only and still holds all three
instructions. What stayed behind in the live table suppressed **every routine
notification on every channel**.

It cost nothing until today because two defects concealed each other exactly: a
mute that suppressed nothing, sitting in front of a notifier that did not
exist. The first end-to-end delivery through the real preference gate came back
`suppressed by notification preferences` — the system reporting honestly what
it had done, and the check's own assumption being the thing that was wrong.

Cleared by 0036. `gate-3.ts` now clears it too, and `verify:slack` states its
preference scope explicitly rather than inheriting whatever the workspace is
set to — because had the ambient state been *muted globally*, the mute check
would have passed for the wrong reason.

This is the third instance of the same class (`gmail.send` enabled by a
permissions check, `research-director` running a prompt written by a test) and
the pattern is now clear enough to name: **a check that exercises real
configuration must restore it, and "kept as evidence" is not a reason to leave
live configuration changed.**

---

## The finding that needs Grant

**A bot removed from a public channel cannot let itself back in.** Both remedies
were tried against the real workspace:

| | |
|---|---|
| `conversations.join` | `missing_scope`, needs `channels:join` — the app was not installed with it |
| `conversations.invite` (inviting itself) | `not_in_channel` — the inviter must already be in the channel |

So the remedy is a human: either somebody invites the app back to that channel,
or Grant reinstalls the app with `channels:join` added to the manifest. The
code reports which (`needs_invite` / `needs_reinstall`) rather than returning a
bare false, because a caller retrying a bare false forever would never surface
the one fact that matters.

**Consequence today:** the lockout check gives up its own membership, and
archiving a channel also needs membership — so each full run of `verify:slack`
leaves one empty `proj-fixture-slack-office-*` channel behind. The suite says so
by name at the end of every run. It stops once the scope is installed.

**Not attempted:** updating the app manifest to add the scope. It requires a
config-token rotation and, more to the point, a reinstall only Grant can
perform, so the decision is his.

---

## App slots — the eighth injection, not faked

§13 reserves ≥3 app slots and Phase 7 lists *"app limit reached"* as an
injection. It is not performed, and simulating it would prove nothing about the
app limit. What is true and checkable is recorded instead:

- the architecture consumes **one** app slot (§9's ONE shared app), so the
  reservation holds by construction;
- `app_limit_reached` is classified `needs_human` and unit-tested as such, so
  meeting it produces a human-legible failure rather than a retry loop.

---

## Measurements, not assumptions

| | |
|---|---|
| Rate limit | `conversations.list` 429ed after **31**, **48** and **69** calls across three runs today, `Retry-After: 30` each time. Gate 4 measured **6** on 2026-09-02. One method, one moment — recorded in `slack_workspaces.observed_rate_limit_tier` with its date, and not treated as a constant. |
| Identity | `iconSource = emoji_fallback` on every delivery, because the avatar PNGs are not hosted. The field exists so this is visible rather than silent. |
| Cost | $0.00. No model call: the end-to-end job's handler is a fixture. |

---

## Known limitations

1. **No avatars in Slack yet.** `staff.avatar_ref` holds a repository path, not
   a URL, and `identityFor` refuses to build a URL it cannot justify. Every
   message therefore carries a per-role emoji. Hosting the PNGs and setting
   `avatarBaseUrl` switches it, and `iconSource` will say so.
2. **One workspace, one user.** Multi-workspace is not structurally blocked but
   is not exercised.
3. **Interactivity is not wired.** The six §12 buttons are composed, posted and
   carry their correlation id, but nothing yet receives the click: that needs
   an interactivity request URL on a deployed endpoint. The inbound half of
   Gate 4 covers the transport; the button payloads are shaped for it.
4. **DMs are not exercised outbound.** `im:write` is installed and the code path
   is identical (a DM channel id is just a channel id), but no check posts one.
5. **The lockout check costs a channel per run**, as above.
