# Phase 2 evidence — Telegram webhook, live round trip

**Date:** 2026-09-03 · **Endpoint:** `https://baujwlzcziasnfhhkchg.supabase.co/functions/v1/telegram-webhook`
**Deployed by:** `npm run deploy:telegram` ([ADR-0010](../adr/0010-webhooks-on-supabase-edge-functions.md))

Acceptance criterion: *"Telegram round-trip with idempotent callback handling."*

## Result — 12 requests, 7 of them duplicates, 2 rows

```
1. no secret header        -> 401  unauthorized
2. wrong secret            -> 401  unauthorized
3. wrong secret, right len -> 401  unauthorized
4. correct secret          -> 200  {"ok":true,"dedupe_key":"telegram:message:-100123:…"}
5. SAME update redelivered -> 200  same dedupe_key
6. unknown action          -> 200  {"ok":true,"ignored":…}
7. undo, bad payload       -> 200  {"ok":true,"ignored":…}
8. valid callback          -> 200  {"ok":true,"dedupe_key":"telegram:callback:cbg-…"}
9. callback redelivered    -> 200  same dedupe_key
10. 5 CONCURRENT duplicates of the same update

rows in inbound_commands: 2   (one message, one callback)
```

## Why each line is there

**Case 3 is the one worth noticing.** A wrong secret of the *correct length*
must be rejected exactly like a wrong-length one. The obvious implementation —
`if (a.length !== b.length) return false` — is a length oracle, and node's
`timingSafeEqual` throws on unequal lengths, which would turn a hostile request
into a 500 and leak the same information. Both cases now cost one comparison.

**Cases 6 and 7 return 200, not 4xx.** Telegram retries anything non-2xx, so an
update we will never understand would be retried forever. Acknowledged and
dropped. Case 7 specifically is an `undo` whose payload is not a uuid — a button
payload is user input, and §10 forbids free-form input reaching a lookup.

**Case 10 is the requirement §6 actually states.** Not "pressing Undo twice",
but that *"duplicate deliveries can be genuinely concurrent"* — Telegram's retry
contract is one sentence with no ordering guarantee. Five simultaneous posts of
the same update produced one row, because the dedupe key carries a unique index.
A guard in a handler is decided by a race; an index is decided by the database.

## The bug only a live test could find

The first deployment returned `401` for the unauthenticated case and **500 for
everything else** — the exact shape of a crash occurring after an early return.

Cause: `secretMatches` used `Buffer.from()`. **`Buffer` is a Node global and not
a Deno one.** All 31 unit tests passed under Node while every authenticated
request in production threw `Buffer is not defined`.

The module now uses `TextEncoder`, which both runtimes have. The lesson is
narrower than "test in production": **code shared across runtimes must be
written to the intersection of them**, and a unit test on one runtime cannot
prove anything about the other.

It also vindicates uploading the adapter from `src/channels/telegram.ts` rather
than a copy. One fix, in the tested file, and the running code changed with it.

## What the endpoint deliberately cannot do

§5: *"Channel adapters may only translate. They may never decide."* The
`inbound_commands` table has **no `intent_class` column**, even though
`core-invariants.md` §1 lists the field — because §5 assigns it to the router. A
column an adapter can write is a column an adapter will eventually decide, so
the rule lives in the schema rather than only in the prose.
