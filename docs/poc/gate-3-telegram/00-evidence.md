# Gate 3 — Telegram

**Verdict: PASS** · 12/12 automated checks · reproduce with `npm run poc:gate-3`

| | |
|---|---|
| Date | 2026-09-03 |
| Bot | `@agenticteamgrantbot` (id `8967954396`) |
| Webhook | `https://baujwlzcziasnfhhkchg.supabase.co/functions/v1/telegram-webhook` (Deno, Supabase Edge Functions — [ADR-0010](../../adr/0010-webhooks-on-supabase-edge-functions.md)) |
| Database | Supabase `baujwlzcziasnfhhkchg`, PostgreSQL 17.6 |
| Cost | $0.00 — no inference is involved; the instruction parse is deterministic |

## What the gate asks for

§13 does not enumerate Gate 3's cases the way it does Gates 4 and 5, so the
checklist is §12's Telegram paragraph read as requirements, plus §6's
idempotency contract, which a pager depends on absolutely:

> One Chief of Staff bot for V1. Only `/newbot` is manual — name, description,
> commands **and profile photo** are API-settable (Bot API 9.4). Buttons:
> 👍 Useful · 👎 Not useful · ↩ Undo · Open Project · Mute 24h · More Detail.
>
> Natural-language instructions ("leave me alone today", "only important
> things") become **structured persistent preferences**.

Every request below goes to the deployed function over HTTPS with the real
secret header, read from the vault rather than the environment — reading it from
anywhere else would test a different secret than the one the function checks.

## Results

```
| # | check | outcome | |
|---|---|---|---|
| 1 | one Chief of Staff bot, live and identified | @agenticteamgrantbot id=8967954396 can_join_groups=true | ✅ |
| 2 | description, short description and commands are set and read back | description=133ch short=45ch commands=6 | ✅ |
| 3 | the webhook is registered, points at our function, and has a secret | url=matches pending=0 last_error=none | ✅ |
| 4 | no secret, a wrong secret of the right length, and a short one are all 401 | 401 / 401 / 401 | ✅ |
| 5 | all six §12 buttons are accepted; an unknown action is acknowledged and dropped | accepted=6/6 rejected=[] unknown -> 200 ignored | ✅ |
| 5b | an undo whose payload is not a uuid is refused by our code, not looked up | not-a-uuid=200 ignored · empty payload=200 ignored · uuid-shaped but wrong length=200 ignored | ✅ |
| 5c | a path-traversal payload never reaches the function (blocked upstream, not by us) | 403 HTML error page from the edge, before our handler | ✅ |
| 6 | 8 simultaneous deliveries of one update produce one row | all 200: true; distinct dedupe keys: 1; rows: 1 | ✅ |
| 7 | the two instructions §12 names produce the behaviour §12 describes | "leave me alone today": routine held · "leave me alone today": blocker delivered · "only important things": routine held · "only important things": important delivered | ✅ |
| 8 | the preference survives in the database and every instruction is on record | preference: min_severity=important blockers_always=true; instructions logged=19 deterministic=true | ✅ |
| 9 | an unparseable instruction is reported and recorded, not silently dropped | applied=false not_understood present=true interpreted_as={} | ✅ |
| 10 | the record of what Grant said cannot be edited afterwards | the trigger refused the UPDATE | ✅ |

12/12 checks passed
```

## The false pass this run produced, and how it was caught

Check **5b** originally read:

```ts
add('5b', 'an undo whose payload is not a uuid is refused, not looked up', outcome, true)
```

A hardcoded `true`. It printed `ok`, and the outcome string it printed was
`403 <!DOCTYPE html>` — a Cloudflare-style HTML error page. The request had been
rejected at Supabase's edge before the handler ran, because the payload
contained `../../etc/passwd`. The check asserted nothing about our code and
reported a pass for a request that was never served.

This is the fourth time in this build that a check has passed for the wrong
reason (see `docs/test-evidence/phase-1-ledger-append-only.md` for the first,
where `SET ROLE` failing produced the same SQLSTATE as the refusal being
tested). The pattern is consistent enough to state as a rule: **a check whose
expected value is a literal is not a check.** Every `add()` in this script now
derives its boolean from the response.

5b now sends three payloads that are malformed but not hostile-looking —
`not-a-uuid`, an empty payload, and a uuid-shaped string of the wrong length —
all of which reach the handler and are ignored with a 200. The traversal payload
became **5c**, which records honestly that it is blocked upstream and that this
is *not our defence*.

## Why an unrecognised update returns 200

Telegram retries anything non-2xx, indefinitely and with no ordering guarantee.
A 4xx for an update we will never understand is a permanent retry loop. So
unknown callback actions and malformed `undo` payloads are acknowledged and
dropped. The distinction that matters is that they are dropped *before* the
payload reaches a lookup: §10 forbids free-form input reaching a tool call, and
an `undo` payload is used to find an event in the ledger.

## Idempotency is concurrent, and that is the requirement

§6's contract is not "the user pressed Undo twice". It is that *duplicate
deliveries can be genuinely concurrent*. Eight simultaneous POSTs of one update
produced **one** row and one dedupe key.

A guard inside the handler — read, then decide, then insert — is resolved by a
race. A partial unique index on the dedupe key is resolved by the database. The
handler does not need to be careful, which is the only kind of carefulness worth
relying on.

## Natural language → structured persistent preference

Both of §12's example sentences are tested end to end against the real database,
and the assertion is on the resolver's answer rather than on the stored row —
what matters is whether Grant gets told, not what a column contains.

| instruction | severity asked about | result |
|---|---|---|
| "leave me alone today" | `routine` | held |
| "leave me alone today" | `blocker` | **delivered** |
| "only important things" | `routine` | held |
| "only important things" | `important` | delivered |

The second row is the safety property, checked with the mute still in force.
§12 gives Grant blockers because he is the only one who can clear them, so a
mute that hides them turns a preference into a deadlock.
`notification_preferences.blockers_always` defaults to `true`, and only an
instruction that is unambiguous about wanting total silence — "absolutely
nothing", "not even blockers" — can set it `false`. "Leave me alone today" does
not qualify, and must not, or the common case becomes the dangerous one.

### Why the parse is rules, not a model

A misparsed preference is **silent by construction**. The symptom is an absence
of notifications, which is exactly what a correct mute looks like. There is no
feedback signal to notice it by, which removes the usual argument for accepting
a probabilistic component. §10's prohibition on free-form input reaching a tool
call applies too: a model's free text deciding a mute window is that, one
indirection removed.

So `parseInstruction` matches rules and **reports what it could not apply**.
`not_understood` is a first-class result, not a fallback — check 9 proves an
unrecognised instruction is reported to Grant and recorded, rather than doing
nothing. An instruction that silently did nothing is worse than one that said it
could not be applied, because Grant would believe he had been muted.

Patterns are anchored on word boundaries, tested with "the commuter numbers look
wrong". `/mute/` as a substring matches that, and the effect of the bug would be
silence — indistinguishable from a correct mute.

A model-assisted path can be added later. If it is, it must produce the same
`ParsedPreference` shape and be recorded with `interpreted_by` naming the model:
`preference_instructions` has that column for exactly this reason, so a
suspicious interpretation is attributable.

## Two tables, two jobs

`notification_preferences` holds one row per scope and is updated in place —
the resolver needs to know what applies *right now*, and a query over history
that has to compute that can be wrong. `preference_instructions` is the
append-only record of what was said and what it was taken to mean.

The reason for the second table is not sentiment. When a preference produces
surprising behaviour three weeks later, "why was I not told about this?" is only
answerable if the sentence and the interpretation are both on record. Check 10
proves that record cannot be edited afterwards.

`app.notification_allowed(subject, channel, severity, project_id)` lives in SQL
because both the Edge Function runtime and the worker loop need it. §11's lesson
about a guard applied in one of two call paths applies just as much to a filter:
a second implementation would drift, and the drift would be silence.

## Known limitations

1. **The profile photo is not verified.** §12 names it as API-settable, and
   `setChatPhoto` exists, but there is no `getMyPhoto` in the Bot API — the
   photo cannot be read back, and this build's rule is that a `200` from a
   setter is not evidence the state changed. Left unset rather than set and
   asserted. Cosmetic, and recorded rather than claimed.
2. **`useful` / `not_useful` / `more_detail` / `open_project` are accepted, not
   yet acted on.** All six buttons round-trip into `inbound_commands` with the
   correct canonical action; what happens next — a preference signal, a detail
   expansion, a deep link — is Phase 5, when there is something to be detailed
   or opened. The gate's requirement is that the pager surface works, and it
   does.
3. **No message has been sent to a real chat.** The bot has no chat with Grant
   yet; every update in this run is synthesised and posted to the webhook, which
   is the only part under test. Outbound delivery is exercised in Phase 3.
4. **Digest modes are stored, not yet scheduled.** `digest_mode` is parsed,
   constrained and persisted; the scheduler that batches on it is Phase 5.

## Files

| | |
|---|---|
| `migrations/0013_notification_preferences.sql` | preferences, the instruction log, `app.notification_allowed` |
| `src/channels/preferences.ts` | the deterministic parse |
| `src/channels/preference-store.ts` | applying a parse, and recording it |
| `src/channels/telegram.ts` | the update → canonical command adapter |
| `supabase/functions/telegram-webhook/index.ts` | the deployed handler |
| `tests/channels/preferences.test.ts` | 24 unit tests |
| `tests/channels/telegram.test.ts` | 31 unit tests |
| `scripts/poc/gate-3.ts` | this evidence run |
