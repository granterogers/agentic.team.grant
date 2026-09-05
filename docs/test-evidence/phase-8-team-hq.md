# Phase 8 — Team HQ

**Run:** 2026-09-05 · **Suite:** `npm run verify:hq` (17 checks, live)
**Migrations:** 0045, 0046
**Page:** <https://ai-team-hq.vercel.app> · **API:** `…/functions/v1/hq-api`

---

## What §25 asks for, and what is actually claimed

| Acceptance | State |
|---|---|
| Mobile-first interaction with desktop information density | Built and structurally checked. **Not claimed as met** — see below |
| No raw JSON or token/debug detail in normal workflow | ✅ checked against real responses |
| Estimated quota clearly labelled as estimated | ✅ checked in the API and in the rendered page |

The first one is a judgement about how something feels in a hand, and a script
cannot make it. What the suite checks is that the *conditions* are there — a
mobile viewport with safe-area insets, touch targets at 38px, and no
`max-width` media queries at all, so the desktop rules are genuinely the
additions rather than the phone being a squeezed desktop. Whether it reads well
on Grant's phone is his to say, and §13's Gate 1 precedent applies: **a
subjective acceptance is not marked passed before the human has performed it.**

---

## The one decision everything else follows from

**The browser cannot name a table, a column or a query.** It names a SECTION
from a list of four, and the projection lives in SQL (`app.hq_*`, 0045) where it
can be reviewed.

The obvious alternative is PostgREST with the publishable key and RLS. Three
reasons against, and the third settles it:

1. The RLS in this database is written for `ai_team_app`, a server role.
   Rewriting every policy for an anonymous browser is a large change to the
   security model in service of a dashboard.
2. `usable_models` and `credential_health` both carry `secret_ref`. Not a
   secret, but exactly the "token/debug detail" §25 excludes.
3. **There is one user and no login.** Any key the page holds is a key anyone
   with the URL holds, so the only question is what that key can do. "Read four
   fixed shapes" is a good answer; "query the database" is not.

Every projection lists its columns explicitly. Never `select *` — a dashboard
endpoint with `select *` publishes whatever column someone adds next.

---

## What the checks found

### The token went into a transcript

`deploy:hq` printed the access token to the terminal, and therefore into a
session transcript — durable, copied, searchable. That is the same mistake that
put Google session cookies in one earlier in the week, made by the same author,
four days later, while cleaning up after the first one.

Rotated immediately, so the printed value is dead. The script no longer prints
it: `npm run hq:token` sends it to Grant on Telegram instead — his own device,
through the delivery path this system already owns, in a message he can delete.

The general lesson is not "be careful with tokens". It is that **a convenience
that puts a credential in front of a human is a credential in a log**, and the
fix has to be structural. A script that cannot print the token cannot print the
token in a hurry.

### A deployed page that could not be opened

Vercel turns SSO protection on for a new project by default, and it applies to
the deployment URL. The deploy reported success; the URL served a 302 to
`vercel.com/sso-api` and a 15-byte "Redirecting…" body.

Caught because the deploy checks *what the URL serves*, not whether the API call
succeeded — the rule this project adopted after a Vercel deploy returned 200
with 339,010 bytes of auth wall. Now disabled by the deploy script rather than
by hand, because a manual step needed only on a first deploy is a step nobody
remembers on the second project.

### The PostgREST schema trap, caught before it bit

The `app` schema is not exposed to PostgREST, so the four RPCs would have failed
on every load. This is the same defect as the Telegram registration in 0042 —
where it was *silent* for a while — and it was avoided here only because that
one had already been paid for. 0046 adds four narrow `public` wrappers.

---

## What is checked, and what each check is for

| | |
|---|---|
| Unauthenticated, and wrong-token, reads are refused | the dashboard is the one surface reachable from the internet |
| A section name that tries to be a query is just an unknown section | four injection shapes, all 400 |
| No response carries `secret_ref` | two source views have one; the explicit projections are what stop it |
| Nothing token-shaped in any response | six credential patterns, all four sections |
| **CONTROL**: the sections return real data | otherwise the two checks above pass on empty bodies |
| Notebook is labelled `estimated`, with a reason | §11: never present estimated quota as authoritative |
| **CONTROL**: inference, TTS and queue are labelled `measured` | otherwise the label is decoration rather than a distinction |
| The page renders the ESTIMATED badge | receiving the label and rendering it are different things |
| The page ships no token of its own | it asks for one and keeps it in `localStorage` |

---

## Known limitations

1. **Read-only.** No actions, deliberately for now: an action needs a
   confirmation model and an audit trail per §21, and adding buttons before that
   is how a dashboard becomes a way to do something irreversible by accident.
   Actions live in Slack and Telegram, where the six §12 buttons already work,
   and the page says so in its footer.
2. **One token, no per-device revocation.** Rotating it locks out every device.
   Acceptable for one user; it would not be for two.
3. **No charts.** §25 asks for them. The numbers are all there and rendered as
   tiles; a sparkline over 30 days of inference cost is a small addition and is
   not done.
4. **No remembered collapse/reorder.** Also §25, also not done. It needs a place
   to keep per-device preferences, which is a decision (localStorage or the
   database) rather than an afternoon.
5. **The mobile judgement is unmade**, as above.
