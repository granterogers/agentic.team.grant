# #381 RC2 — production acceptance, 29 September 2026: STOPPED, not promoted

**Deployed.** RC2 is `52bb21aa`. The worker went from v844 to **v846**. Migrations
went from 613 (ending `0600`) to **618** (ending `0605`), applied one at a time;
each was recorded once, and nothing else was applied.

**Not promoted.** Main is still `692fa165`. #378, #379 and #381 stay open.

## Why it stopped

1. **The independent witness reported a post-0601 breach.**
   - `check:leaks`: `HARNESS_SENT job:95339b28…:result -> slack C0C5CU13DHA at 11:40:19`.
   - The job is `verify:slack`'s end-to-end `research.conclusion` on fixture
     project `fixture-slack-office-81928391`, origin `harness`.
   - `C0C5CU13DHA` is `#zz_test_slack_81928391`, a channel the suite created
     for itself and **registered in `public.test_destinations`** (the only way
     `app.delivery_refusal` lets harness work through).
   - It **deleted that registration in teardown**, so the witness, which reads
     current registrations, sees a harness send to an unregistered destination.

   Assessment: the guard allowed the send by design, and the witness is right
   that the evidence of why no longer exists.

2. **The channel is human-facing.** `ChannelProvisioner.inviteSubject` invites
   `slack.subject_user_id` (Grant) into every channel it creates. The run
   logged `invited=invited members=2 subject_present=true`. About seven suite
   messages were posted into it: the result, a thread reply, a reconciled
   post, a retried post, the end-to-end result, and a broadcast answer. The
   suite then archived the channel.

   So **test-generated content reached a Slack channel Grant is a member of**.
   It was a registered test channel, named `zz_test…` and archived afterwards,
   but it was not a destination only test traffic can see. This has been the
   design of `verify:slack` since before #378. RC2 did not introduce it, and
   RC2's claim "no test content reaches his normal destinations" does not hold
   while it remains.

3. **`verify:history` is red: 46 ok, 5 FAIL.** This is a harness defect, not
   containment.
   - Four or five assertions expect the suite's own harness messages to read
     back in the conversation. 0602 hides harness turns there by design, and
     those assertions were never updated for it.
   - The suite inserts a `verification.conversation` job with
     `requested_by 'grant'` (`synthetic = false`) *before* declaring its
     project. `register_test_origin` therefore refused the project: "the
     project has real work". The suite stopped before its HTTP `say`, which is
     the fail-closed direction.

## What passed

| Suite | Result | Declared before knocking | Deliveries |
|---|---|---|---|
| `verify:security` | 20/20 | chat `1` | none (every probe refused) |
| `verify:telegram` | 38/38 | 2 fixture chats `-7…` | answer to fixture chat **and to `C0C276SFM7D`**: both suppressed as "harness traffic"; 1 API send to its registered, nonexistent fixture chat (failed at Telegram) |
| `verify:echo` | 14/14 | `C0ZTBKTU5IEP` | none (probe jobs cancelled); both turns synthetic/harness |
| `verify:slack` | 73/73 | `C0C5CU13DHA` | **the send above**, and job-less posts deleted in teardown |
| `verify:latency` | 7/7 | `-7329…` and `C0ZT8RJX7RQ6` | 3 answers suppressed, one of them to `C0C276SFM7D` |
| `verify:escapes` | 15/15 | (emulated door) | unknown-origin to his chat suppressed with the "unknown origin" reason; positive control went to a counting transport |
| `verify:history` | **46 ok / 5 FAIL** | refused (see 3) | 4 suppressed, **2 of them aimed at his Telegram 1386648496** |
| `verify:mcp` | 23/23 | both clients | none |

Other results:
- Structural checks on production rows: Grant's turn and its child are `trusted`; a duty is `internal`; `escapes-…-real` is `unknown`; `artifact_demo` and a `verify-` voice session are `harness`.
- Declaring his chat, the office group, `C0BVD21Q9S5`, `C0C2DAPDN02`, `C0C276SFM7D`, `C0BVCESNS3G` or his `legacy-coaching-course` project was refused every time.
- A real `duty:notion-sync` result was delivered normally to `C0BVC629Y1L`, beside suppressed test answers.

## Reconciliation (since 11:35:40)

| | |
|---|---|
| Declarations | 9, all released |
| Turns | 5, all synthetic |
| Jobs | 21 harness, 4 internal (real duties); 0 live |
| Deliveries | suppressed 9 (including 2 to 1386648496 and 3 to `C0C276SFM7D`); sent 2 (the breach, and the real notion-sync result); failed 1 (fixture chat) |
| Tasks, blockers | 0 new |
| Test destinations left | 0 |
| Sent to his Telegram chat or the office group | **0** |

## Evidence preserved

The breach row stands: `deliveries.delivery_id 454f2ea2-63b1-4345-a3db-d324e6a3bad2`.
Nothing has been cleaned.

## Decisions needed

1. `verify:slack`'s channel. Options:
   - stop `ChannelProvisioner` inviting the subject into a fixture project's channel;
   - or accept a zz-test channel he is invited to as a test destination, and keep its `test_destinations` row (never delete it) so the witness can reconcile.
2. Test-destination teardown: a deletion erases the only evidence the witness has. Retire registrations; don't delete them.
3. `verify:history`: declare before creating any job, and move its conversation assertions to real-shaped turns inside a rollback (the pattern it already uses once).
4. Gate order: `check:door-origins` and `check:voice-sessions` run after the live-door suites in `npm run gate`.

---

## Remediation and re-acceptance, 29 September: GREEN, promoted

**Implementation commit `76f9c603`.** It contains the accepted RC2 (`52bb21aa`)
plus the four fixes below. Records only: `37d5fbf3`, `1aa2e49d` and this entry.

| Fix | Where |
|---|---|
| A fixture project's channel invites nobody, decided from `projects.is_fixture` for every caller; real projects unchanged | `src/slack/provision.ts`, `tests/slack/provision.test.ts` (red under sabotage) |
| Test destinations go ACTIVE -> RETIRED and are never deleted; the guard honours active rows only; `app.test_destination_at` tells the witness what was registered when the guard decided; the 29 September send is acknowledged in `known_escapes` under #381 | `migrations/0606`, `scripts/leak-witness.ts`, `scripts/check-leaks.ts`, every suite teardown |
| `verify:history` declares before any work, and its stale 0602 assertions now prove the harness turn is hidden, with the real property tested on rolled-back real-shaped turns | `scripts/verify/history.ts` |
| `check:door-origins` and `check:voice-sessions` run first in the gate, and a failed preflight stops it | `scripts/e2e.ts`, `tests/scripts/gate-order.test.ts` |

**Production.**
- Migration 0606 applied on its own: 619 migrations, latest `0606`.
- Worker v846 -> **v848**, built from `76f9c603`. `src/slack/provision.ts` is the only application-code change.

**Targeted re-acceptance.**

| Step | Result |
|---|---|
| Preflight, in the new order | `check:door-origins` 0 violations · `check:voice-sessions` clean · `check:leaks` 39 known, 0 new, and the historical breach listed as acknowledged |
| `verify:slack` | **74/74, plus 3/3 retirement checks**. The fixture channel `C0C5D6D4WJG` had members=1 and humans=0, so Grant was not invited to it or to its research channel. Declared 12:12:53.8, registered 12:12:54.9, first send 12:13:10, retired 12:17:34. All 16 deliveries went to that channel, all authorised at send time (11 sent), and a retry after retirement was refused |
| `verify:history` | **57/57**. Declared 12:18:09, before its first job at 12:18:22. Its own turns are hidden; the real-shaped turns (rolled back) are trusted and shown. All 5 delivery attempts were suppressed, including 2 aimed at 1386648496 |
| `check:leaks` after | 0 new escapes and 0 of every breach class. The only acknowledged row is the 29 September send. 0 declarations ignored, 0 test destinations still active |

**Human exposure.**
- The 11 real Slack sends went only to `#zz_test_83965320_8kme`, whose only member is the app.
- Nothing reached his Telegram chat, the office group, a project channel or his dashboard chat.
