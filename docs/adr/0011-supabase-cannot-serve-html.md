# ADR-0011 — Supabase cannot serve a web page; pages go to Vercel

**Status:** Accepted · **Date:** 2026-09-03
**Amends** [ADR-0010](0010-webhooks-on-supabase-edge-functions.md), which stands
for JSON endpoints and does not for pages.

## Context

ADR-0010 moved inbound webhooks to Supabase Edge Functions, correctly: the
Telegram webhook works, was round-trip tested, and needed no new credential.

The Gate 1 voice POC page was then served the same way. Grant opened the link
and reported it *"just opens up, like, a text file, which is a bit strange."*

He was describing the symptom precisely. Measured:

```
GET /functions/v1/voice
  content-type: text/plain
  x-content-type-options: nosniff
```

`text/plain` with `nosniff` is exactly "a text file" to a browser. The function
set `text/html; charset=utf-8`; the gateway replaced it.

### It is not a mistake in how the header was set

Five variants probed in one deployment — lowercase key, capitalised key, a
`Headers` object, an array of tuples, and no header at all:

```
mode 1  headers: { 'content-type': 'text/html' }          -> text/plain
mode 2  headers: { 'Content-Type': 'text/html; charset…' } -> text/plain
mode 3  new Headers().set('Content-Type', …)               -> text/plain
mode 4  [['content-type', 'text/html; charset…']]          -> text/plain
mode 5  no content-type at all                             -> text/plain;charset=UTF-8
```

**Every response is `text/plain`.** Other headers pass through untouched —
`x-frame-options: DENY` survived — so this is content-type specifically.

Supabase Storage does the same, and more revealingly. It **records** the
mimetype correctly and still serves `text/plain`:

```
object list: probe.html -> mimetype text/html      (recorded)
GET  /storage/v1/object/public/poc/probe.html      -> content-type: text/plain
```

`application/xhtml+xml` likewise. This is a deliberate platform-wide XSS
mitigation — user-uploaded HTML executing on a `*.supabase.co` origin would
share it with the project's own auth surface — and it is the right decision by
Supabase. It simply means **Supabase cannot serve a web page at all.**

## Decision

**JSON endpoints stay on Supabase Edge Functions. Pages go to Vercel.**

- `voice-token` (mints ephemeral Realtime credentials) — Supabase. Unchanged,
  works, JSON is unaffected by the content-type rule.
- `telegram-webhook` — Supabase. Unchanged.
- the voice POC page, and Team HQ later — **Vercel**.

The split follows the constraint rather than a preference, and it is a small
one: the page is static, and the mint endpoint was already CORS-aware. Only the
page's fetch target changed from a relative path to the absolute Supabase URL,
and `VOICE_ALLOWED_ORIGIN` now pins CORS to the Vercel origin instead of `*` —
better than it was, because the page previously being same-origin made a wide
CORS policy look harmless.

## Consequences

- `VERCEL_TOKEN` is back on the critical path for anything with a UI. It has
  now propagated, and the page is live.
- **Vercel's Deployment Protection is on by default**, and it cost a step worth
  recording. The first deployment returned `200 text/html` and 339,010 bytes —
  Vercel's own authentication wall, not the page. A naive check for "HTTP 200
  and HTML" would have passed it and handed Grant a login screen. The deploy
  script now also asserts the body contains something only the real page has.
- Two hosts on the critical path instead of one, which ADR-0010 counted as a
  cost. It was right to count it; the constraint outranks it.

## Alternatives rejected

| Alternative | Why not |
|---|---|
| A different content-type Supabase might honour | Probed. `text/html` and `application/xhtml+xml` both neutered; `nosniff` closes the remaining gap. |
| Serve HTML from Supabase Storage | Same behaviour, and it records the correct mimetype while ignoring it — so the constraint is enforced at serve time, not upload. |
| A Claude Artifact page | Its CSP blocks `fetch`/`XHR`/WebSocket to non-allowlisted hosts, so it could reach neither the mint endpoint nor OpenAI. |
| GitHub Pages | Private repositories need a paid plan, and publishing this one is not an option. |
| Cloudflare Pages | Another provider and another credential to solve a problem Vercel already solves, and Vercel was always the plan for the UI. |

## Lesson recorded

The two previous ADRs taught *verify the transport before requesting a
credential* and *ask what existing credentials can reach*. This one adds the
narrower point that both of those missed: **verify the response, not just the
status code.** The endpoint returned `200`. The deploy asserted `200`. The page
was unusable, and only Grant opening it on a phone found out.

Both fixes are now assertions rather than habits — the deploy checks the
content-type *and* a marker only the real page contains.
