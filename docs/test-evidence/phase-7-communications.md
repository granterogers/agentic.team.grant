# Phase 7 — the Slack office, the Telegram pager, and voice notes that stay silent

**Run:** 2026-09-05 · **Suite:** `npm run verify:slack` (54 checks, all live)
**Unit:** 532 tests overall; 107 of them new here across 8 files
**Slack suite is now 55 checks** · **Also:** `npm run verify:telegram` (25 checks, live) · `npm run verify:tts` (14 checks, live)
**Migrations:** 0032 – 0042

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
| `src/slack/interactions.ts` | the six buttons coming back |
| `src/channels/callbacks.ts` | what a press actually does, for every channel |
| `src/voice/notes.ts` + `migrations/0038` | voice notes, the character ledger, and the decision not to speak |
| `src/channels/delivery.ts` + `migrations/0039–0040` | exactly-once delivery, for any channel |
| `src/telegram/*` + `migrations/0041–0042` | the pager: client, composer, transport, chat registry |
| `scripts/verify/slack.ts` | the 38 live checks |

Seven of Phase 7's eight named Slack failure injections are performed for real
against the real workspace. The eighth is discussed below rather than faked.

---

## The nine defects the checks found

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

### 8. The webhook returned 200 and registered nothing

The chat registration was written as an RPC into the `app` schema, which
PostgREST does not expose, so the call failed on every update. It failed
*silently*, because the handler wrapped it in `.catch(() => undefined)` —
deliberately, since failing to register must not make Telegram retry an update
that was otherwise handled. But "must not fail the request" had been implemented
as "must not be noticed".

The check caught it by asserting the consequence — a row exists afterwards —
rather than the status code, which was 200 and meaningless. 0042 adds a narrow
`public` wrapper (exposing the whole internal schema to fix one call was the
alternative, and it is not one), and the handler now reports the registration
outcome in its response body so the same check keeps working.

### 9. A verification suite that believed its own leftovers

The Telegram pager checks asked for Grant's chat, found a chat left behind by an
earlier crashed run of the same suite, and reported the resulting delivery
failure as though the pager were broken. Two changes: the pager checks now use
their own fixture subject, so they are independent of whether a real chat exists
*and* exercise the whole path instead of stopping at "nobody to page"; and
`purge:fixtures` sweeps delivery and chat debris, which had reached 81 rows and
was making `delivery_health` unreadable — the same way leaked fixture jobs once
made every "how busy are we" summary wrong.

---

## Interactivity, and the three ways it differs from events

Added after the office, on the same endpoint, and each difference is a way to
get it wrong:

1. **The payload is form-encoded, not JSON** — `payload=<json>`. A handler that
   calls `request.json()` produces a 400 for every button press. The signature
   is still verified over the raw body, which is the only correct place either
   way, and the interactivity branch is checked BEFORE the JSON parse.
2. **There is no verification handshake.** An interactivity URL is configured
   and simply starts receiving traffic, so a broken endpoint is not discovered
   at configuration time — it is discovered by a button not working. The deploy
   therefore probes it separately with a signed press rather than trusting that
   "the endpoint is up".
3. **A response body REPLACES the message.** Returning something chatty would
   overwrite the result the button is attached to, so the handler returns an
   empty 200 — asserted by a check, because it is invisible until it happens.

The button value is treated as untrusted even though we wrote it: it
round-trips through a client and is visible to anyone who can inspect the
message. The action comes from `action_id`; the correlation is validated as a
uuid before it is believed; and the authoritative answer to "what work is this
about" comes from `slack_deliveries`, which recorded the `message_ts` and the
correlation together at post time. A check asserts that lookup works, so the
system never has to rely on the click.

### 6. A 👍 landed on the wrong output

The callback processor answered "which output is this feedback about?" by
correlation → jobs → most recent output. That is right exactly while one
correlation has one job, and a correlation is *designed* to span several: it is
what ties an instruction to every job it spawned.

The verification run created two jobs under one correlation and pressed 👍 on
the first one's result. The feedback was recorded against the second job's
output. Nothing errored. A real signal, attached to the wrong work, silently —
and the only symptom was a count in a neighbouring check reading zero.

0037 records the job on the delivery. `correlation_id` stays: it is the right
key for "everything about this conversation" and is what undo offers are grouped
by. The defect was using one key for two questions.

### 7. Two of the new checks were passing on absence

Both caught while writing them, and both the same shape as the recurring
pattern:

- the feedback count was scoped by `given_by` alone, so it depended on whether
  an *earlier run's* cleanup had completed — one had not, and the check reported
  a stale row as a double-processing bug. Now scoped to this run's output.
- a check for the `dismissed` outcome would have passed on nothing happening:
  only a notification still at `delivered` can move, and the only one in the run
  had already been resolved to `acted` three checks earlier. It was **removed**
  rather than weakened, and the mapping is asserted in the unit tests instead.
  A comment in the suite says why, so it does not get "helpfully" added back.

---

## What a press does now

`inbound_commands.callback_action` had been constrained to §12's six words since
0011 and had never been read; `notification_events.outcome` is what 0031's
learning weighs and nothing outside its own fixtures had ever moved a row past
`delivered`. Both halves met here.

| Press | What happens |
|---|---|
| 👍 / 👎 | a `feedback` row against the output the message reported on; the notification moves to `acted` |
| ↩ Undo | `app.request_undo` on the live offer — or `nothing_to_undo`, which is expected rather than exceptional: an offer lapses and a posted message cannot un-draw its own button |
| Mute 24h | the same parse and the same store a typed *"leave me alone today"* uses. **Global, not project-scoped** — a button whose scope depends on what our records happen to contain means two different things on two different days |
| Open project | recorded as a signal; opening something is not a request |
| More detail | recorded and **not acted on**. Acting means creating work, and creating work is the router's decision (§5, §9). A processor that quietly enqueued a job would be a second, unaudited entry point into the work system. It is marked processed anyway, because an unprocessable row left pending is a loop |

The processor is channel-agnostic: Slack buttons, Slack reactions and Telegram
buttons all produce the same six words, and three handlers for one intention
would diverge.

One thing it does that is easy to miss: **it clears its own global mute**, and
checks that it did. A verification run that leaves the system quiet is exactly
what defect 5 was.

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

## Voice notes — the feature is the refusal

Phase 7's acceptance is one sentence: *"TTS degrades to text rather than
incurring cost."* Chirp 3: HD needs a Google Cloud credential this project does
not have, so **no synthesis happens and none is faked**. What is built and
proven is everything that decides whether it should.

**There is no fallback path, deliberately.** A fallback is a second path taken
when the first fails; second paths run rarely, are tested rarely, and are wrong
on the day they matter. So the text is not the consolation prize — it is the
deliverable, always produced and always sent, and audio would be an addition
that sometimes accompanies it. Nothing downstream reads a different field when
synthesis did not happen. A test asserts the text survives every one of the six
refusals, because a refusal that returns no text turns a degraded voice note
into a lost message.

The six reasons to stay silent, each about correctness rather than taste:

| | |
|---|---|
| `no_credential` | nothing to call. Its own reason, because "not configured" and "it broke" need different people to do different things |
| `over_budget` | the free tier is a budget, and 0038 is the only counter that exists — Google exposes none |
| `too_long` | §12 calls Telegram the pager. A pager that talks for ninety seconds is already generous |
| `unreviewed` | §16's label is printed where a reader can see it. Audio has no margin, and a spoken caveat is the first thing heard and the last thing remembered accurately |
| `not_speakable` | a table, a code block, or a paragraph that is mostly figures. Speech makes these worse, not merely no better — and it sounds authoritative while being unusable |
| `caller_asked_for_text` | Grant said so |

`verify:tts` proves the ledger, including the property a single-session test
cannot show: **eight concurrent reservations against room for three grant
exactly three**, and the five refused callers get null rather than an error. An
advisory lock rather than a row lock, because what needs protecting is a SUM and
there is no row to lock until after the decision.

It reserves against a fixture provider name, never against `google.chirp3-hd`.
Reserving against the real budget and cleaning up would put a test's characters
in the ledger that decides real spending, and a cleanup that fails would leave
it wrong in the expensive direction — which is what defect 5 above was, in a
different table.

---

## The pager

§12 divides the surfaces by what they are for — *"Slack = office · Telegram =
pager"* — and until now Telegram had an inbound webhook and no outbound path at
all. Nothing had ever paged Grant.

**The delivery table was generalised rather than copied.** A
`telegram_deliveries` table would have been quicker and would have been a second
implementation of one invariant: *a message is sent at most once, and we can
always say whether it was.* That is a property of delivery, not of Slack. 0039
and 0040 move the table and its five functions, carrying the reasoning behind
the four corrections 0033–0037 made, because all four are easy to reintroduce.
Slack behaviour is unchanged and its 54 checks prove it.

**The one place the channels genuinely differ is reconciliation, and it is not
symmetric.** After an indeterminate send, Slack can be asked whether the message
landed: a bot can read channel history and every post carries its dedupe key in
Slack's metadata. A Telegram bot **cannot read its own sent messages back** —
there is no history endpoint, `getUpdates` returns incoming updates only, and a
sent message carries no field to search on. So `Transport.reconcile` is optional
and `TelegramTransport` does not implement it. The delivery stays parked as
`failed` forever and the service reports `unreconcilable`.

That is the correct outcome rather than a gap. A page that did not arrive is a
page Grant does not get; a page sent twice at 3am is worse, and a system that
resends on a guess would do the second one every time.

**One notifier, two channels.** The worker has one `notifying` state, so "also
send to Telegram" is not a flag — it is the same `app.notification_allowed`
question asked for a second channel, plus a severity floor. A second severity
rule for Telegram was the alternative and is the wrong shape for the reason
0013's own comment gives about that function: a filter applied in one of two
call paths drifts from the one in the other.

The context both channels need — who produced the output, whether it was
reviewed, which buttons to offer — is resolved once. Two resolvers reading the
same three tables would eventually disagree about who produced a finding, and
the disagreement would surface as one channel attributing it to the wrong
specialist. A channel that throws does not stop the next one: a Slack outage
that also silenced the pager would take out the surface that exists to work when
the other does not.

The job's state reason names every channel's outcome, including the boring
ones — `delivered to slack via thread; not paged: no telegram chat registered`.
A note that says only what succeeded is how a channel stops working unnoticed,
because the symptom of a pager that never pages is silence, and so is the
symptom of a quiet week.

**The pager does not page for everything.** A floor of `important` sits under
the preference check: preferences can make it quieter, never louder. Anything
below urgent is sent silently — on the phone when he looks, without the phone
asking to be looked at.

### Four Telegram-specific traps, each tested

| | |
|---|---|
| `retry_after` is in the JSON body, not a header | the habit every other API teaches gets nothing and retries immediately |
| Errors are English prose, not codes | there is no `chat_not_found` field, only `"Bad Request: chat not found"` — matched in one place, with an explicit fallback |
| `callback_data` is capped at 64 **bytes** | an action name plus a uuid does not fit, so the action goes as a one-character code and the correlation goes whole. An over-long payload is a silently dead button |
| MarkdownV2 needs eighteen characters escaped | HTML needs three. That is the entire reason HTML mode was chosen: the text is model output, and a missed escape is a message Telegram refuses to send |

---

## Known limitations

1. **No avatars in Slack yet.** `staff.avatar_ref` holds a repository path, not
   a URL, and `identityFor` refuses to build a URL it cannot justify. Every
   message therefore carries a per-role emoji. Hosting the PNGs and setting
   `avatarBaseUrl` switches it, and `iconSource` will say so.
2. **One workspace, one user.** Multi-workspace is not structurally blocked but
   is not exercised.
3. **Interactivity is built and deployed, but Slack is not yet configured to
   use it.** The endpoint handles button presses and seven live checks press
   one for real — signed, form-encoded, at the deployed URL. What is missing is
   one manifest field (the interactivity request URL), which needs a
   config-token rotation. Until that is set, Slack has nowhere to send a click.
4. **DMs are not exercised outbound.** `im:write` is installed and the code path
   is identical (a DM channel id is just a channel id), but no check posts one.
5. **The lockout check costs a channel per run**, as above.
6. **No voice note has ever been synthesised.** Everything up to the call is
   built and checked; the call itself needs a Google Cloud credential.
7. **No Telegram message has ever reached a person.** Telegram forbids a bot
   messaging anyone who has not messaged it first, so there is no chat id and
   none can be configured or guessed. The registry, the lookup, the send, the
   error classification and the deployed webhook's registration path are all
   exercised for real — the send against a chat that does not exist, which
   proves everything except a human receiving something. One message from Grant
   to @agenticteamgrantbot closes it.
