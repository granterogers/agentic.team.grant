# #381 — tests at real doors: containment RC2

**29 September 2026.** Builds on the reviewed #378/#379 candidate (`939f32ce`)
and the prepared `verify:escapes` change (`7c9c9638`). Nothing here is
deployed, merged or applied to production. Every production query below was
read-only.

## Why the deployment stopped

0603 decides where work came from **positively**. A turn is trusted when its
key is one a production adapter writes. That is correct, and it has one
consequence 0603 could not answer. A verification suite that posts a
**correctly signed** update to the **deployed** webhook gets a key the adapter
really wrote. The signature proves the caller holds the credential. It does
not prove the request is Grant's.

## Root cause

**Test intent was being inferred after an authenticated request had been
accepted.** It came from names in `requested_by`, from teardown relabelling,
and from a subject mapping. Each of those was either missing (`verify:latency`)
or happened after the office had already answered (gate-3/`verify:telegram`,
relabelled by 0351 days later).

Nothing at the door could tell a suite from Grant. The fix is to stop
inferring: **the suite declares the conversation before it knocks, and the
door honours the declaration at the moment the row is written.**

## 1. Live-door test matrix

All credentials come from the vault (`telegram.webhook_secret`,
`slack.signing_secret`, `hq.api_token`) or are minted by the suite (MCP client
tokens). The historical sends are job-bearing deliveries, all time, read-only
(§6).

| Script | Door | Inbound identity (before) | Conversation (before → RC2) | Grant's real destination? | Makes jobs | Test provenance inherited (before) | Historical external sends | Gate | RC2 |
|---|---|---|---|---|---|---|---|---|---|
| `verify:latency` | telegram-webhook, slack-events | **Grant**: from 1386648496; Slack U0BUNF6AALC | his private chat and the `ai-team-hq-test` lobby C0BVD21Q9S5 → declared fixture chat `-7…` and fixture channel `C0ZT…` | **yes, it posted as him from his chat** | 2 × office.instruction | **no, trusted, never marked** | **29 sends, 20 roots, 9–21 Sep**: his Telegram 11, office group 7, C0BVD21Q9S5 10, C0C276SFM7D 1 | not in `e2e`; manual behind `--sends-to-grant` since #354 | **contained (option A)**; the impersonating mode is removed; containment asserted before measuring |
| `verify:telegram` | telegram-webhook | 4242 | `-100<stamp>2/3` → declared `-7…` | reply routing could reach him; the chat was recorded as his | "hello" → office.instruction; 2 presses | relabelled after the fact (0351) | with gate-3: **21 sends**, 7–14 Sep (his Telegram 8, C0BVD21Q9S5 13) | `verify:db` | declares both chats; asserts synthetic, not outside, and a non-deliverable chat before continuing |
| `scripts/poc/gate-3` | telegram-webhook | 4242 | `-100…` | as above | yes | relabelled by 0351 | in the 21 above | deleted in `4b2853d4` | n/a |
| `verify:echo` | slack-events | U0ECHOVERIFY → subject `verify-echo` | fixed C0ECHOVERIFY → declared `C0ZT…` per run | no | yes | yes (via subject map, at creation) | **1 send**, his Telegram, 14 Sep (before the 0523 guard) | — | declares a per-run channel; asserts containment |
| `verify:slack` | slack-events (signed press) | U0GRANTVERIFY | channel it creates for a fixture project → declared | no | press signal | presses were trusted | 0 found | `verify:db` | declares the channel; asserts the press is synthetic |
| `verify:security` | both webhooks | none | chat 1 → declared | no | **none; every probe must be refused** | n/a | 0 | `e2e` | declares chat 1 as defence in depth |
| `verify:history` | hq-api `say` | dashboard | `fixture-conversation-…` project → declared | no | yes | yes (fixture project) | counted in known harness | `e2e` | declares the project before the HTTP say |
| `verify:mcp` | mcp | minted read client and **write client** | client ids → declared | no | a writer's work was `internal` under 0603 | **no** | 0 (`mcp:probe-w`: 4 failed notebook.generate, 6 Sep, not in the repo) | `verify:db` | declares both clients |
| `verify:connectors` | mcp | minted read client | → declared | no | none (read-only) | n/a | 0 | — | declares |
| `verify:oauth` | mcp OAuth endpoints | registers a client | — | no | none; never calls a tool | n/a | 0 | `verify:db` | exempt, and the exemption is checked (no turn payload in source) |
| `deploy:slack` | slack-events (signed press) | UDEPLOYCHECK | CDEPLOYCHECK → declared | no | none | n/a | 0 | deploy | declares |
| `verify:chaos` | none (SQL) | — | — | **switches Grant's production Slack install and pager off, then back on** | — | — | 0 | `verify:db` | those two sections now need `--flip-production-switches` and print NOT RUN otherwise |
| `verify:escapes` | door emulated in SQL | 4242 | — | — | yes | yes | its old control is in #378's count | `e2e` | `7c9c9638`, reviewed and kept (see §5) |
| voice suites (`scenario-a`, `chat-live`, `basecamp-*`, `talk`, `deploy:voice`) | voice `/turn` | sessions named `verify-…` | — | — | yes | yes (0598, `check:voice-sessions`) | #354's known escapes | `e2e` | unchanged; the door is `check:voice-sessions`' |
| `scratch/kick-probe` | hq-api `say` | dashboard | **whatever project it is given** | **could be his** | yes | no | 0 | hand-run | declares first, so the database now refuses a real project |

Browser suites that hold a working credential were reviewed too:
- `talk`, `basecamp-chat`, `basecamp-project-turn`, `basecamp-failures` and `basecamp-livevoice` stub the door.
- `basecamp-voice` fulfils OpenAI's call itself.
- `basecamp-reconcile` runs with no credential, and the gateway refuses its send.
- `tasks-ui`, `basecamp-addsource` and `basecamp-team` write through the gateway but make no door turn (see Residuals).

## 2. The design

`migrations/0605_a_test_at_a_real_door_says_so_before_it_knocks.sql`

| Piece | What it does |
|---|---|
| `public.test_origins` | One row per (channel, conversation, run). The channel is `telegram`, `slack`, `voice`, `teamhq` or `mcp`. **Append-only**: releasing a run records a time, a DELETE is refused, and no column but `released_at` can change. Expires in at most 24 hours. |
| `app.register_test_origin` | The only writer. The run token must match `^[a-z0-9]{8,32}$`. It **refuses** any conversation with evidence of real use: a non-synthetic turn in it; a Telegram chat the office already knows; a Slack channel mapped to a real project or to none; a project or MCP client with real work. |
| `app.origin_conversation` | The conversation of a turn, from the fields each adapter writes: the Telegram chat (message and press), the Slack channel, the voice session, the dashboard project. |
| `app.stamp_synthetic_inbound` | The 0541 ingress stamp. For production ingress, a turn in a declared conversation is written `synthetic`. |
| `app.job_inherits_synthetic` | An MCP root job from a declared client is synthetic. |
| `app.document_origin` | A document a declared client added is `harness`. |
| `app.record_telegram_chat` | A declared chat the webhook records is **not deliverable**, so `telegram_chat_for` can never choose it as where to reach him. |

What it plugs into:
- `synthetic` is already immutable (0541) and inherited by every child at insert (0542).
- `app.harness_job`, `app.job_origin`, `app.may_act_outside`, `app.delivery_refusal` and the worker's external-write gate all read it already, unchanged.
- So the decision is made **once, at the door, and is permanent**.

**Why conversation-level, and why it cannot swallow Grant.** An exact-key registration was the alternative. It is narrower in theory, but it cannot cover a press or a reply whose key the suite does not know in advance. It is also no narrower in practice: every declared conversation is a fixture the suite minted and the database confirmed had never carried real traffic.

The identity is (transport, conversation) plus a run token:
- Telegram chat `-7` followed by 15 digits, outside every real chat range;
- Slack `C0ZT` followed by 8 characters;
- the suite's own project or MCP client.

Grant's chat, his group, his project channels and his projects cannot be declared. So a real message of his, concurrent or not, cannot land in a declared conversation.

**Sticky.** Expiry and release end the run's *window*. They do not make the conversation real, because registration proved it never was. A late or duplicated webhook, a retry, or a child made after cleanup is still a test.

**Before anything runs: `npm run check:door-origins`** (in `e2e`). Every script that names the Telegram webhook, Slack events, MCP or the dashboard `say` path must call `testOrigins(db…)` and must name none of Grant's real conversation ids. An exemption must give a reason, and it is checked: an exempt script may contain no turn payload. At `939f32ce` it finds **13 violations**; on RC2 it finds **0**. It is backed by 7 unit tests (`tests/scripts/door-origins.test.ts`).

## 3. Race behaviour

Everything below is proved in `scripts/isolated/test-origins.ts` (47 checks). It uses the real adapter code and **two database sessions in flight** for the concurrent cases.

| Case | Result |
|---|---|
| Declared Telegram turn and Grant's turn, simultaneously | test: synthetic → harness → suppressed; his: trusted → claimed |
| Declared Slack turn and Grant in a real project channel, simultaneously | same |
| Button press in a declared channel | synthetic |
| Child, grandchild, external writer under it | harness; the worker gate refuses Notion; the control writer under his turn is allowed |
| Narration, progress, approval question from it | suppressed |
| `synthetic` taken back | refused (immutable) |
| Worker dies holding it, recovery → `retrying` | still harness |
| Child after release, turn after release | harness (sticky) |
| Declaration expired before the turn arrived | harness |
| Duplicate webhook | one row (unique key) |
| Two runs at once, one released | both harness; the other still in its window |
| Declaring his chat, a real Slack channel (spoken in, or only mapped), a project with real work, a chat with a real turn | refused, each with its reason |
| Malformed token | refused |
| Guessed token | releases 0 |
| Real turn quoting a run token | trusted |
| DELETE / moving a declaration | refused |
| Declared dashboard project; his project | harness; trusted |
| Declared MCP client's job; its document | harness; harness |
| Registered test destination | still receives test work |
| Unknown key | unknown, refused |
| Webhook records a declared chat | not deliverable; pager still → 1386648496 |

**Red before, green after.** With the pre-0605 stamp, inheritance and document functions put back (keeping the table), **21 of 47 fail**: every declared turn is trusted and claims Grant's chat. All the Grant controls stay green, so the defect is reproduced exactly.

## 4. Independent witness

`scripts/leak-witness.ts`, called by `check:leaks`:
- **`TEST_ORIGIN_SENT`**: a sent message whose root is in a declared conversation. The witness parses the conversation from the job's own copy of `origin_ref`, because suites delete their inbound rows. Its regex is not `app.origin_conversation`, and it reads `test_origins` itself.
- **`UNREGISTERED_ORIGIN_SENT`**: an adapter-exact root from a conversation no real person uses. This is judged by platform facts, not this office's code:
  - a Telegram **private** chat's id is positive and equals its sender (all 760 of Grant's private turns satisfy this);
  - a group's id is negative;
  - a Slack channel is real if it is mapped to no project or to a non-fixture project, or if the speaker is the configured Slack user.
- **`ignoredOriginSql`** (no send needed): a turn in a declared conversation that is not synthetic. `check:leaks` fails on any.
- Before 0605 is applied, `check:leaks` detects the missing table and runs without declarations. It ran read-only against production: exit 0, history unchanged, both new classes 0.

`scripts/isolated/witness-test-origins.ts` (10 checks):
1. **Production recognition sabotaged**: the stamp ignores declarations; the sabotage is confirmed landed.
2. The declared escape is caught, although its inbound row was deleted.
3. Its child is caught.
4. A Telegram suite and a Slack suite that forgot to declare are both caught.
5. Grant on both doors is not a breach.
6. The ignored-declaration check fires with nothing sent.
7. **The witness sabotaged twice**:
   - with declarations unread, the escape is no longer `TEST_ORIGIN_SENT`;
   - with the undeclared-chat rule off, the forgotten declaration is no longer caught.

   Either way the proof's own checks go red.

## 5. Suite changes

| Suite | Change |
|---|---|
| `verify:latency` | Option A. It declares a fixture chat and channel, posts from them through the real signed doors, and asserts synthetic plus not-outside **before** it waits (it stops otherwise). The last hop was never measured, so nothing is lost. Grant's identifiers and `--sends-to-grant` are removed. Option B is not kept: an impersonating mode is exactly the one shape no runtime witness can see. |
| `verify:telegram` | Declares both webhook chats, and asserts containment and a non-deliverable chat before anything else. |
| `verify:echo` | A per-run declared channel; asserts containment. |
| `verify:slack` | Declares its channel; asserts the signed press is synthetic. |
| `verify:security` | Declares chat 1. |
| `verify:history` | Declares its project. |
| `verify:mcp`, `verify:connectors` | Declare their clients. |
| `deploy:slack` | Declares CDEPLOYCHECK. |
| `scratch/kick-probe` | Declares its project. |
| `verify:chaos` | The production kill switches run only with `--flip-production-switches`. |
| `verify:escapes` | `7c9c9638` reviewed and kept. It emulates the door in SQL. It asserts the unknown-origin control is refused to his chat, **with the reason**, and that the positive control reaches a per-run registered test destination, torn down and asserted. Nothing in it weakens containment. |

## 6. Consolidated history (read-only)

Every **job-bearing** sent delivery, all time, one class each. #378's 381
job-less narrations are counted there and are disjoint from this table (the
narration column below is 0).

| Class | Sends | Roots | His Telegram | Other Telegram | Slack | Dates |
|---|---|---|---|---|---|---|
| Known harness (includes `verify:echo`'s 1) | 242 | 150 | 126 | 0 | 116 | 6–24 Sep |
| **Authenticated door, marked harness only afterwards** (gate-3/`verify:telegram` hello 21, `verify:transport` dashboard 1) | **22** | 19 | 9 | 0 | 13 | 7–14 Sep |
| **Authenticated test impersonating Grant, never marked** (`verify:latency`) | **29** | 20 | 11 | 7 (office group) | 11 | 9–21 Sep |
| Unknown or synthetic origin (includes #379's 9) | 44 | 26 | 19 | 0 | 25 | 6–24 Sep |
| Real or the office's own | 1770 | 1486 | 1061 | 10 | 699 | — |

The newly accounted authenticated-door traffic is **51 sends**:
- 20 to his Telegram;
- 7 to the office group;
- 24 to Slack (C0BVD21Q9S5 23, C0C276SFM7D 1).

Nothing since 21 September.

The witness's new `UNREGISTERED_ORIGIN_SENT` rule finds **0** historically. The latency probes posted from his own chat as him, which no runtime rule can distinguish. That is why the static check and the database refusal exist.

## 7. Regression

| Gate | Result |
|---|---|
| `npm run lint` · `typecheck` | 0 · 0 |
| `npm run test` | 229 files, **3598 passed** |
| `check:migrations` · `check:secrets` · `check:templates` | 0 · 0 · 0 |
| `check:door-origins` · `check:voice-sessions` | 0 · 0 |
| `check:leaks` (production, read-only, pre-0605) | exit 0; 38 known, 0 new; new classes 0 |
| `scripts/isolated/run-all.sh` (post + 0601–0605) | **all green**: test-origins 47/47, witness-test-origins 10/10, legit-origins 24/24, synthetic-origins 36/36, task-content 5/5, narration 11/11, external 19/19, correction 5/5, chat 4/4, witness-independence 12/12, approval-execution 15/15, approval-delivery 9/9, containment 19/19, acknowledgement 32/32, sequence 36/36, project-provenance 20/20, paused-incoherent 8/8, ask-unasked 19/19, recovery matrix, drain, 0596 |

`witness-independence` went red once. Its "real" Telegram turn was never recorded in `telegram_chats` and carried `actor = 'grant'`, where the real webhook records the chat and writes the sender's numeric id. The fixture was corrected in `real-telegram.ts` and in that proof. The rule was not weakened.

The live-door suites cannot run against production until 0605 is applied. That is by design: `register_test_origin` must exist before they knock.

## 8. Deployment order

1. `npm run deploy:worker`. It is unchanged from `939f32ce` in `src/`, and the order is #378's.
2. Apply `0601` → `0602` → `0603` → `0604` → **`0605`**, one at a time, confirming each is recorded.
3. No edge function changes. `deploy:slack` declares its channel, so it needs 0605 first.

Rollback: 0605 is additive (a table plus replaced functions), and its own drive block proves it in a rolled-back subtransaction. Reverting it means restoring the four 0603/0541 function bodies. It never needs a destructive change, because declarations are evidence and stay.

## 9. Safe acceptance plan

1. After 0605: `check:door-origins`, then `check:leaks` (0 new, 0 ignored).
2. `verify:security`: every probe refused.
3. `verify:telegram`: it **stops itself** unless the webhook turn is synthetic, not outside and not deliverable.
4. `verify:echo`, `verify:slack`: they assert containment before continuing.
5. `verify:latency`: it stops before measuring unless both probes are contained.
6. `verify:escapes`, `verify:history`, `verify:mcp`.
7. `check:leaks` again: `TEST_ORIGIN_SENT` 0, `UNREGISTERED_ORIGIN_SENT` 0, ignored 0, new escapes 0.
8. Real traffic: **wait for Grant's own next message**; do not manufacture it. Confirm it is `trusted` and its answer is claimed.

`verify:chaos` runs without the flag.

Stop on any containment assertion failing, any breach, or any delivery to 1386648496, -5444104624 or a real project channel from a declared conversation.

## 10. Residual risks

- **A script outside the repository** (an authoring-session scratch file) that posts as Grant from his own chat is indistinguishable at runtime by construction. The repository half is `check:door-origins`, and the database refuses to declare his conversations. Nothing can stop an unreviewed script someone runs by hand.
- **The witness's undeclared-origin rule** depends on platform invariants. A suite posting a fake *group* chat with a negative id, or a fake private chat whose id equals its fake sender, passes that rule. `check:door-origins` is the guard for repository scripts.
- **Gateway writes that are not turns** (`tasks-ui`'s personal task, `basecamp-addsource`'s source, `basecamp-team`'s words) create real-looking rows for minutes, and duties read those tables. No external send was found: the task is due in two days and `calendar.sync_tasks` is off. It is the #380 class, not #381's.
- The voice door is still classified by session name (0598). That is unchanged and outside this RC.
