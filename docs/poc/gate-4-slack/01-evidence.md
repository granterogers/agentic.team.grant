# Gate 4 — Slack

**Verdict: PASS** · 19/19 automated checks · reproduce with `npm run poc:gate-4`

Supersedes `00-app-creation-evidence.md`, which recorded only the app-creation
step and stated plainly that the gate was not passed.

| | |
|---|---|
| Date | 2026-09-03 |
| Workspace | Agentic Team Grant (`T0BUCJ2L5FD`) |
| App | `A0BUFRVSSLD`, bot `@ai_team_hq` (`U0BUG0RPZ8B`), 17 bot scopes |
| Events endpoint | `https://baujwlzcziasnfhhkchg.supabase.co/functions/v1/slack-events` (Deno, Supabase Edge Functions — [ADR-0010](../../adr/0010-webhooks-on-supabase-edge-functions.md)) |
| Subscribed events | `message.channels`, `message.groups`, `message.im`, `reaction_added`, `tokens_revoked`, `app_uninstalled` |
| Database | Supabase `baujwlzcziasnfhhkchg`, PostgreSQL 17.6 |
| Cost | $0.00 — no inference; the preference parse is deterministic |

## What the gate asks for

> Prove installation, auth, channel mapping, project channel creation, DM,
> thread, reactions, event receipt, **command normalization**, preference
> updates, rate limits, token revocation, reconnect/reinstall, that **Postgres
> remains canonical**, and that **Slack history loss does not break the
> application**. Only then consider per-staff apps.

Fifteen requirements. The script is those fifteen in that order.

## Results

```
| # | check | outcome | |
|---|---|---|---|
| 1 | the app is installed, and installation is a fact in Postgres | team=Agentic Team Grant bot=ai_team_hq installed=true | ✅ |
| 2 | auth works and the bot user id recorded matches the live one | U0BUG0RPZ8B vs U0BUG0RPZ8B | ✅ |
| 3 | the app creates a project channel itself | #gate4-probe-48699872 -> C0BUWK34SP6 | ✅ |
| 4 | the channel resolves to its project, and the project to its channels | channel -> project: correct; project -> channels: {C0BUWK34SP6} | ✅ |
| 5 | the app posts to a channel | ts=1788448707.528179 | ✅ |
| 6 | a threaded reply lands in the thread, confirmed by reading the thread back | reply ts=1788448707.694419; read back ok=true; messages in thread=2 | ✅ |
| 7 | a reaction is added and reads back on the message | added=true read back ok=true reactions=[eyes] | ✅ |
| 8 | the endpoint refuses unsigned, wrongly signed and replayed requests, and answers a valid one | unsigned=401 bad_sig=401 replayed=401 valid=200 echoed=true | ✅ |
| 9 | five event shapes normalize into one canonical envelope | channel message=200 mention with the address stripped=200 threaded reply=200 direct message=200 reaction=200 | ✅ |
| 9b | and each is stored with the Slack routing that only Slack means | rows=5 kinds=[message,reaction] dm=true thread=true reaction=true mention_stripped=true | ✅ |
| 9c | the app's own message is not read back as an instruction | 200 ignored | ✅ |
| 9d | 5 concurrent redeliveries of one event produce one row | all 200: true; rows: 1 | ✅ |
| 10 | a preference instruction arriving over Slack updates the same structured preference | applied=true from="only important things"; routine=held important=delivered blocker=delivered | ✅ |
| 11 | the rate limit is reached, and its retry contract is read from the response | 429 after 6 conversations.list calls in 620ms, Retry-After: 30s | ✅ |
| 11b | and honouring Retry-After actually clears it | waited 31s, next call ok=true | ✅ |
| 12 | a tokens_revoked event marks the workspace uninstalled, with a reason | 200 installed=false reason=tokens_revoked timestamped=true | ✅ |
| 13 | reconnecting clears the revocation, and nothing else was lost | installed=true reason=null uninstalled_at=null | ✅ |
| 14 | every message the app posted is deleted from Slack and the channel is archived | deleted 2/2 authored messages (1 system messages are not deletable by any app); archived=true; authored messages still readable in Slack: 0 (0 top-level + 0 in threads) | ✅ |
| 15 | and every instruction is still readable from Postgres, with its text intact | commands before=5 after=5; with instruction text=4; mapping row kept=true | ✅ |

19/19 checks passed
```

## What is real, and what is not

Real: the workspace, the bot, the channel it created, the two messages it
posted, the thread, the reaction, the 429, the deployed endpoint, and the
database.

Real in a way worth stating separately: **Slack itself verified the endpoint.**
`apps.manifest.update` sends a signed `url_verification` challenge to the
`request_url` before accepting it, and the read-back confirms the URL was
accepted. That is a third party exercising the signature path, not us exercising
it against ourselves.

Not real: a human typing. Slack has no API for "pretend a person sent this", so
inbound instructions are synthesised — but they are **signed with the live
signing secret and posted to the live endpoint**, so the code path is identical
to Slack's own traffic. The only untested link is Slack's outbound delivery,
which the handshake above covers.

`SLACK_SIGNING_SECRET` moves from **UNVERIFIED to WORKING** with this gate. It
had only ever had its shape checked — 32 characters — because it cannot be
verified without an inbound signed request, and there was nothing to receive
one. `npm run deploy:slack` now signs a handshake with it and requires the
challenge to be echoed.

## The three defects this run found

Each was found by a check failing, and each would have been invisible in
production for a while.

### 1. A reaction with `+` in its name could never be stored

`reaction_added` for 👍 arrived, normalized, and came back **503**. The dedupe
key was `slack:reaction:C…:1788…:U…:+1`, and
`inbound_commands.dedupe_key` is constrained to `[A-Za-z0-9:_.-]+`. `+` is not
in that set, so the insert was refused, and a 503 tells Slack to **retry** —
forever, for an event that could never be stored.

The fix keys the reaction on the *mapped action* rather than the raw emoji,
which is also the better semantics: reacting 👍 and then ✅ is one person saying
"useful" twice and should collapse to one signal, while 👍 then 🔍 remain two
distinct meanings and two keys.

### 2. One of five concurrent redeliveries was told to retry

`Prefer: resolution=merge-duplicates` returns the existing row for a duplicate —
but *concurrent* duplicates can still surface as `409` from the unique index,
which is the index doing its job. The handler treated any non-`ok` as failure
and returned 503, asking Slack to retry an event already stored correctly. `409`
is now success, and the response says `duplicate: true`.

Note what the row count said while this was happening: **1**, which is correct.
The idempotency guarantee held perfectly; only the reply to Slack was wrong. A
check that asserted the row count alone would have passed.

### 3. The Slack Web API is not uniformly JSON — and the failure reads as a pass

`conversations.replies`, `reactions.get` and `conversations.history` sent with a
JSON body return `ok: false` with `invalid_arguments` and `no_item_specified`.
Those errors describe the *arguments*, not the encoding, so they read as "you
asked for the wrong thing" rather than "you asked the wrong way". They need
query parameters. `chat.*`, `conversations.create/archive` and `reactions.add`
accept JSON.

The dangerous part was not the failure. `ok: false` carries no `messages` key,
so `((body.messages ?? []) as unknown[]).length` is **0** — and a check written
as "no error thrown" or "at least 0 replies" passes while reading nothing at
all. Every Slack read in this script now asserts an exact count *and* checks
`ok`.

## Two checks that passed while claiming more than they had shown

Both were rewritten. Neither was caught by a failure; both were caught by
reading the outcome string against the sentence next to it.

**Check 11 never reached the rate limit.** It reported *"30 calls in 2475ms, no
429"* against `conversations.info` (tier 3), and passed on a branch that
accepted "no 429" as informative. True sentence, no measurement: the burst
allowance simply covered it. §11's requirement is that the figure be *measured*.
Switched to `conversations.list` (tier 2), the limit arrives after **6 calls in
620 ms** with `Retry-After: 30`. A pass now requires both the 429 and a numeric
`Retry-After` — a backoff that has to guess the wait is a backoff that hammers.
Check **11b** then waits it out and confirms the next call succeeds, because a
`Retry-After` that does not actually clear is worse than none.

**Check 14 claimed every posted message was deleted, and left one behind.** It
reported *"deleted 1/1 authored messages"* after posting two. **Thread replies
do not appear in `conversations.history`** — only the parent does — so the
threaded reply was never enumerated and was still sitting in Slack while the
check said Slack history had been destroyed. It now walks each parent's replies,
counts what remains in threads as well as at top level, and requires at least
two deletions so a silent zero-walk cannot pass again.

There is also a real bound worth recording rather than working around: **the
`channel_join` notice cannot be deleted by any app.** `chat.delete` has no
author to delete it as. So the claim is scoped to messages the app authored, and
the count of undeletable system messages is reported alongside.

## Postgres remains canonical

Checks 14 and 15 are one experiment: destroy the Slack side, then ask what the
application still knows.

Both messages deleted, the channel archived, the mapping marked inactive. Every
one of the five inbound commands is still in Postgres with its instruction text
intact, and the mapping row is *kept* rather than deleted — it is what explains
where past instructions came from, and deleting it would orphan them.

The design choices that make this true rather than lucky:

- The **channel↔project mapping lives in Postgres**, not in a channel topic. A
  topic is editable by anyone in the channel and is lost with the channel, which
  would make Slack canonical for something the application needs.
- The **instruction text is copied at receipt** into `inbound_commands`. Slack
  holds a copy, not the record.
- `slack_channel_map.channel_name` is documented as **display only**. Slack
  renames are common and we learn of them late, so the id is the identity.
- `inbound_commands_slack.resolved_project_id` is **stored, not joined at read
  time**: the mapping can change, and a command must stay attributed to the
  project it was actually about when it was given.

The test to apply to anything added later: *could the application be rebuilt
from Postgres alone, against an empty Slack workspace?*

### The cleanup that was refused, and why that is the real proof

The script originally deleted its own probe commands at the end. Postgres
refused: `preference_instructions` holds a foreign key to the command that
carried the preference, and that table is append-only, so the reference cannot
be dropped either.

That refusal is the invariant working. **The record of an instruction Grant gave
cannot be removed by the thing that recorded it — not even to tidy up after a
test.** Deleting them would have quietly proven the opposite of what check 15
claims, so the rows stay.

## Command normalization

Five Slack event shapes, one canonical envelope, identical in shape to
Telegram's:

| shape | what normalization does |
|---|---|
| channel message | `origin_ref` = `channel:ts`, instruction verbatim |
| mention | the leading `<@U…>` is addressing, not content, and is stripped; everything after it — including trailing spaces and inner mentions — is verbatim |
| threaded reply | `thread_ts` carried so a reply lands in the thread; `origin_ref` is the reply's own ts, because a reply must land on the reply |
| DM | `is_dm` true |
| reaction | mapped onto the **same action vocabulary the Telegram buttons produce** |

That last row is the one that matters beyond this gate. `+1` becomes `useful` —
the same string a Telegram 👍 produces — so "Grant found this useful" is one
concept with one handler regardless of surface. A separate Slack vocabulary
would mean two code paths for one intention, and they would diverge.

A unit test asserts every value in `REACTION_ACTIONS` is inside
`inbound_commands`' `callback_action` CHECK constraint, so a mapping that the
database would reject fails in CI rather than at 3am.

Deliberately **not** normalized into instructions:

- **Our own messages** (`user === botUserId` or `bot_id` present), checked
  before anything else in the function. Without it the app answers itself,
  forever, and every other branch would happily process the echo. Check 9c.
- **`message_changed` / `message_deleted`.** Acting on an edit means re-running
  an instruction whose text has changed underneath a running job, and there is
  no defined semantics for that. §6's canonical record is the instruction as
  first received.
- **`reaction_removed`.** Un-thumbs-upping is not "not useful"; it is a
  retraction, and there is no defined handling for retracting a signal that may
  already have been acted on. Ignored, and the reason is stated rather than
  guessed at.
- **Unmapped emoji.** People react with whatever they like; 🌮 is not an error.

## Preference updates from Slack

The DM in check 9 said "only important things". §5 forbids the adapter from
acting on it — *"channel adapters may only translate. They may never decide"* —
so the adapter stored it and the policy applied it, using the **same parse the
Telegram path uses**. `routine` held, `important` delivered, `blocker`
delivered. One preference system, two surfaces.

## Token revocation and reinstall

A signed `tokens_revoked` event flips `slack_workspaces.installed` to false with
a reason and a timestamp. `tokens_revoked` and `app_uninstalled` are recorded as
different reasons because they have different remedies.

The point is *how the application learns*. Without these events, revocation is
discovered by a call failing later, which conflates "the token was revoked" with
"Slack is having a bad minute" — and the credential audit in this build has
already been wrong three times by reading "present" as "working".

The revocation is simulated by a signed event, not by actually revoking the
token: a real revocation would end the run and need Grant in a browser to undo.
What is under test is that the event is believed and recorded, and it is. The
reinstall path is the *same upsert statement `npm run deploy:slack` runs*, not a
different one written for the test, so the reconnect proven is the one that
ships.

## Known limitations

1. **No human has typed into Slack.** Inbound events are synthesised and signed.
   Slack's outbound delivery to this endpoint is proven only by its own
   `url_verification` handshake. Grant sending one real message would close it,
   and costs a minute.
2. **`app_mention` is not subscribed.** It needs `app_mentions:read`, and adding
   a scope forces a reinstall — Grant in a browser. `message.channels` already
   delivers a mention in a channel as a message, so the capability is covered;
   the adapter handles an `app_mention` envelope if the scope is ever added.
3. **Revocation is simulated**, as described above.
4. **One workspace, one user.** `slack_workspaces` is keyed on `team_id` and
   `notification_preferences` on `subject`, so multi-workspace and per-staff apps
   are not structurally blocked — but neither is exercised. §13 says to consider
   per-staff apps only after this gate, which is now the case.
5. **Outbound formatting is plain text.** Block Kit, the UI §12 describes, is
   Phase 5. What is proven here is the transport.
6. **The rate-limit figure is one method at one moment.** `conversations.list`
   429s after 6 calls with `Retry-After: 30`, recorded in
   `slack_workspaces.observed_rate_limit_tier`. Other tiers are not measured,
   and Slack does not promise these numbers are stable.

## Files

| | |
|---|---|
| `migrations/0014_slack_channel_map.sql` | workspaces, channel mapping, the Slack side table, both resolvers |
| `src/slack/signature.ts` | request signature verification (Web Crypto) |
| `src/slack/events.ts` | event → canonical command |
| `supabase/functions/slack-events/index.ts` | the deployed handler |
| `scripts/deploy/slack-events.ts` | deploy, then verify with a signed handshake |
| `scripts/slack/configure-events.ts` | event subscriptions by manifest, verified by read-back |
| `tests/slack/signature.test.ts` | 19 unit tests |
| `tests/slack/events.test.ts` | 20 unit tests |
| `scripts/poc/gate-4.ts` | this evidence run |
