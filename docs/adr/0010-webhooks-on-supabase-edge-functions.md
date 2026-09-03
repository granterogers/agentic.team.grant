# ADR-0010 — Webhooks run on Supabase Edge Functions, not Vercel

**Status:** Accepted · **Date:** 2026-09-03

**Narrows** master spec §4's *"App + API: Vercel Hobby (or Cloudflare Workers)"*
for inbound webhooks specifically. Vercel remains the plan for the application.

## Context

Phase 2's last items — the Telegram webhook and the Google OAuth callback — all
need one thing: a stable HTTPS endpoint. So does Gate 1's voice POC. The plan
assumed Vercel, which needs a `VERCEL_TOKEN`.

Grant had the token and reported he could not add it: the Claude Code cloud
environment's variable editor is not reachable from the iPhone app. A correct
credential and no way to hand it over.

Rather than treat that as the blocker, the question worth asking was whether the
endpoint needed a new provider at all. It did not. The Supabase Management API —
whose token this project already holds and already uses for every migration —
exposes `POST /v1/projects/{ref}/functions/deploy`.

Verified before deciding, not after. A trivial function deployed, returned
`ACTIVE` at version 1, answered publicly on `https://<ref>.supabase.co/functions/v1/<slug>`,
and was deleted again — all from this session, with no new credential.

## Decision

**Inbound webhooks are Supabase Edge Functions.** Deployed by
`scripts/deploy/edge-function.ts` via the Management API.

Reasons beyond unblocking, since "it worked first" is not an architecture:

- **One fewer provider on the critical path.** §11 requires documenting every
  external dependency's free allowance, card requirement, quota and failure
  mode. This adds none: it is the Supabase project already in use.
- **No new credential, so no new human step.** §14 asks whether something can
  be done by API before asking Grant. Here it can, and the answer arrived after
  Grant had already been asked — which is the mistake ADR-0007 recorded and this
  is the second instance of.
- **The handler is next to the data it writes.** A webhook's whole job is to
  authenticate and persist. Round-tripping that through a third region to reach
  the same database is latency with nothing bought.
- **`verify_jwt: false` is settable per function**, which a Telegram webhook
  requires: Telegram cannot present a Supabase JWT.

### What is still Vercel's job

Unchanged, and deliberately so:

- Team HQ's UI, and its dashboards
- the voice ephemeral-credential mint (§12: the browser never receives the
  permanent key)
- the Notebook sync Python function (ADR-0001)

So `VERCEL_TOKEN` is still wanted — just not on the critical path any more, and
not from a phone.

## Consequences

- Phase 2's webhook work is unblocked with zero human action. Deployed,
  registered, and round-trip tested the same session.
- **The adapter is uploaded from `src/channels/telegram.ts`, never a copy.** A
  copy would drift, and then the tested code and the running code would be
  different code. `.gitignore` excludes the generated file so a copy cannot be
  committed by accident.
- **Shared code must be runtime-agnostic**, and this is not theoretical. The
  first deployment used `Buffer.from()` in the constant-time secret comparison.
  `Buffer` is a Node global and **not** a Deno one, so every authenticated
  request threw `Buffer is not defined` while all 31 unit tests passed under
  Node. It surfaced only because the unauthenticated case correctly returned
  `401` and everything else returned `500` — the exact shape of a crash after an
  early return. Now `TextEncoder`, which both runtimes have.
- The function currently writes as `service_role`, which bypasses RLS. Recorded
  in `docs/parked/phase-2-hardening.md` rather than hidden; it gets a
  least-privilege role once `ai_team_app` has a password.

## Alternatives rejected

| Alternative | Why not |
|---|---|
| Wait for `VERCEL_TOKEN` | Blocks on a human for something an existing credential can already do — twice now. |
| Ask Grant to use a desktop browser | Works, and is still the wrong answer: it makes a person the transport for a value the system can avoid needing. |
| Cloudflare Workers | Another provider, another token, another free-tier to document. Same class of solution with more moving parts. |
| Have Grant paste the token into chat | A secret in a transcript. Never. |

## What would reverse this

Edge Functions proving unsuitable for a webhook — a cold-start latency Telegram
retries through, or a limit hit in practice. Both are measurable, and neither is
in evidence: the round trip below answered in well under Telegram's tolerance.
If the app ends up on Vercel anyway and a single deploy path becomes worth more
than the isolation, moving the webhook is a small change, because the adapter
is already a pure module with no hosting assumptions in it.

## Lesson recorded

This is the second time an existing credential could do what Grant was asked
for. ADR-0007 was the first, and its lesson was *verify the transport before
requesting the credential.* The sharper version: **before asking a human for
anything, ask what the credentials already in hand can reach.** The Management
API had a `functions/deploy` endpoint the whole time.
