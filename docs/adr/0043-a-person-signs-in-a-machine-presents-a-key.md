# ADR-0043 — A person signs in; a machine presents a key

**Date:** 2026-09-24 · **Status:** accepted · **Supersedes in part:** the
"no new auth system" line in CLAUDE.md's hard constraints · **Issues:**
the 23 September mission §2, as corrected 24 September

## The decision

**Two credentials, for two kinds of caller, and they never meet.**

- A **machine** — the worker, the deploy probes, the MCP endpoint, every
  script — presents `hq.api_token`. Unchanged: one bearer token, compared in
  constant time, rotated by changing one vault row.
- A **person** presents **their own Supabase Auth session**, obtained by an
  emailed sign-in link. The gateway verifies it with Supabase and checks
  `public.office_members`.

The office token no longer appears in the user experience in any form.

## Why this ADR exists

Because the obvious reading of CLAUDE.md forbids it, and a future agent will
reach the same conclusion I did on 23 September and build the wrong thing
again. I did build it: a pairing flow where the browser asked, the office sent
the request to Telegram, Grant tapped, and the browser collected the token. It
worked. Every part of it was verified. It was the wrong answer.

Grant, 24 September:

> *"Grant did not ask to replace 'Paste the office token' with 'Approve an
> office token through Telegram.' He does not want an office-token interaction
> in the normal user experience AT ALL... If an internal credential/token is
> required for secure communication with the office, that is an IMPLEMENTATION
> DETAIL."*

> *"The normal user should not: see an office token; paste an office token;
> copy an office token; receive an office token; approve an office token
> through Telegram; enter a pairing code; understand what an office token is;
> repeatedly authorize their own browser."*

The lesson worth keeping is not about tokens. It is that **improving the
ergonomics of a thing that should not exist is not a fix**, and that a
requirement saying "the user should not have to X" is not satisfied by making X
pleasant.

## What the trace found before anything was replaced

The mission required understanding the token before touching it. Four facts
decided the design, and three of them were surprises:

1. **`auth.users` held zero rows.** Supabase Auth has been provisioned since
   the project was created and had never been used. There was no canonical
   identity system in USE, but there was one PRESENT.
2. **Every one of the 117 row-level policies names `ai_team_app`.** Not one
   names `anon` or `authenticated`. So a browser holding a Supabase session can
   read nothing directly, which is correct and is why adopting Supabase Auth
   loosens nothing.
3. **The browser has never spoken to PostgREST.** It speaks to `hq-api`, which
   holds the service key. The whole data path is unchanged by this decision.
4. **The original Team HQ authenticated the same way** — `localStorage` under
   `hq.token`, delivered by `npm run hq:token`, whose own message reads
   *"Access token — paste it once, per device."* The Basecamp frontend did not
   bypass a real session mechanism. **There was never one to inherit.**

So the entire change is **which fact the gateway checks before it answers**.

## The shape

```
browser ──asks for a link──▶ signin ──▶ Supabase Auth ──emails──▶ person
person  ──clicks────────────▶ /auth/v1/verify ──▶ page#access_token=…
page    ──Bearer <session>──▶ hq-api ──verify with Supabase──▶ office_members
worker  ──Bearer <hq key>───▶ hq-api ──constant-time compare
```

Three things must be true before a session gets in, and none is something the
browser can assert about itself:

1. Supabase says the token is a live session **it** issued — verified by asking
   Supabase, never by decoding the JWT here. A token this code merely decoded
   would be a token anybody could write.
2. It carries a confirmed email address.
3. That address is in `public.office_members`, a table only the service role
   can read.

**Supabase says who proved an address. `office_members` says who the office
works for.** Keeping those as two questions is what makes open signup at the
identity layer a nuisance rather than a hole: a stranger gets a perfectly valid
session and the office refuses it.

## Consequences, including the awkward ones

- **The browser never holds a shared secret.** It holds a session that expires
  in an hour and refreshes itself against the office.
- **The anon key stays server-side.** Supabase's auth endpoints want it; the
  page asks the office and the office asks Supabase. So it is not in the
  repository, not in the page, and not one more thing to rotate.
- **`hq.token` is still READ by the page, and never written.** Browsers Grant
  already uses hold one, and removing the read would have signed him out of
  every device the moment this shipped. Nothing in the interface offers to put
  one there.
- **Signup is open at the identity layer.** It had to be: creating accounts by
  hand means either materialising the service key or writing GoTrue's tables
  directly, and both are worse than letting GoTrue create a user through its
  own code path on first sign-in. The allowlist is the boundary.
- **The experiment runs its own copy of the gateway**, `hq-api-basecamp`,
  because this branch's gateway source is ahead of `main` and behind
  `human-simulation-harness`, and deploying it over the shared one would drop
  somebody else's work. **This is temporary and its removal is a step:** when
  the copies are one file again, delete `scripts/deploy/hq-basecamp.ts`, the
  slug, and the hostname block in `web/studio/index.html`.
- **`link_for_operator` exists**, gated on the office key, so a link can be
  produced rather than emailed. It escalates nothing — anybody who can call it
  could already read and write everything with the same header — and it is what
  lets the suites sign a browser in without emailing Grant on every run.

## What is not verified

**The mail arriving.** Supabase's built-in email service is rate limited to two
per hour and is not a production mail path. Everything either side of that hop
is driven in `verify:signin` and `verify:basecamp-signin`; the hop itself is
not, and no suite may claim otherwise. If it proves unreliable the answer is an
SMTP provider in the auth config, not a return to pairing.

## What was rejected

- **A nicer token ceremony.** The thing this ADR exists to stop.
- **Google sign-in**, which would reuse the OAuth client the office already
  has. Better on deliverability and blocked on a redirect URI that has to be
  added in Google's console — an external step Grant would have to take. Worth
  revisiting with him.
- **Embedding the office token in the page**, which §4 of the correction
  forbids by name and would put a shared secret in every visitor's browser.
- **Vercel deployment protection**, which is a paid feature and the cost
  constraint is about £0 a month.
