# Run 3 sabotage controls

A test that has never been shown to fail is not evidence. For each security-critical fix the guarantee was
broken on purpose, the run printed proof the sabotage **landed**, and the named suite went red. Each was
restored and re-run green. (A crashed suite counts as red: exit code non-zero. It is noted where that is
how a control went red.)

| # | Broken on purpose | Proof it landed | Suite | Result |
|---|---|---|---|---|
| S0 | the pre-0613 database (production's own ACLs) | 175 functions reachable by a public key; `vault_secret`, `callback_ack`, `hq_revoke_tool` execute | anon-surface | 12 FAIL (21 checks) |
| S0b | the event trigger disabled | `evtenabled = D`; a new function is born reachable | anon-surface | the exposure check goes red on a new function |
| S1 | the office key attributed to `grant` again | `principal: 'grant', kind: 'person'` | principals | **29 FAIL** |
| S2 | the service gate disabled | `if (false && kind === 'service' …)` | principals | **27 FAIL** |
| S3 | `link_for_operator` mints for a person | kind check disabled | principals | 1 FAIL (the key mints a session for Grant's address) |
| S4 | voice: the key speaks under a real-looking session | test-session gate disabled | principals | 1 FAIL |
| S4b | the harness rule removed from `app.authority_refusal` | function replaced, `authority_refusal('verify-operator')` is null | principals | 5 FAIL |
| S5 | Slack door stops asking `sender_admitted` | `admission()` always `'admitted'` | slack-sender | **7 FAIL** |
| S6 | `enqueue_inbound` reverts to Telegram only | gate text replaced in the live definition | slack-sender | 1 FAIL |
| S6b | the pre-fix Telegram door (bot-lookup failure = 200; enqueue failure swallowed; reply every redelivery) | file restored from the pre-run copy | sender-authorization | **6 FAIL** |
| S7 | `notebook.generate` trusts the presence of `approved_by` again | `approval` faked from the payload | approval-binding | **9 FAIL** |
| S8 | no claim before the write | `claimExternal` replaced with a constant `do` | approval-binding | 2 FAIL (retry generates twice; a drop is not parked) |
| S9 | `office.execute_plan` with no approval check | `mayStart` replaced with `{ ok: true }` | approval-binding | 2 FAIL |
| S10 | `app.approval_verdict` says approved for anything | function replaced | approval-binding | suite **crashed** (exit 1): the handler no longer asks, so there is no question to read |
| S11 | vault export as it was (newest chat, no claim) | pre-change handler restored | vault-export-door | 3 FAIL |
| S12 | a button resolved by "newest open question on the job" | lookup replaced | approver-identity | 2 FAIL (a stale Approve answers the newer question) |
| S13 | `answer_blocker` added to `SERVICE_MAY` | source edited | tests/architecture | 2 FAIL |

A first draft of one control was itself wrong and is worth recording: `principals.ts` asserted the sign-in
refusals with `status === 403`, and the **origin allow-list** produced that 403, not the kind check. It went green for
the wrong reason. It now sends a real `Origin` and asserts the refusal *message* (`test member`, `not somebody the office
works for`). A refusal for the wrong reason looks exactly like the rule working.
