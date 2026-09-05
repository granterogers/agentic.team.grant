# Phase 8 — Team HQ

**Run:** 2026-09-05 · **Suite:** `npm run verify:hq` (24 checks, live)
**Migrations:** 0045, 0046, 0047
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

## The charts, and what rendering them found

Four sparklines over 30 days: jobs completed, model calls, inference spend,
messages delivered. Inline SVG, no library — §2's first principle is "frontend
simplicity, backend sophistication", and a build pipeline for four fetches and
some DOM is the tail wagging the dog.

**Colour was computed, not chosen.** The palette validator failed the dark-mode
UI accent (`#6f9bff`, L 0.703, outside the dark lightness band), so the dark
series colour is a different value from the dark link colour — a chart colour
and a UI accent answer to different checks and are allowed to differ. Light mode
passes on the UI accent unchanged.

**Three things were only visible once it was rendered**, which is the step in
the method easiest to skip and the reason it exists:

1. **Every load of the Trends tab was a 400.** The tab is called `trends` and
   the API section is called `series`, and the first version passed the tab name
   straight through. Nothing in the source looks wrong; the browser console says
   it immediately.
2. **The stroke was stretched.** `preserveAspectRatio="none"` scales the 300-unit
   viewBox to whatever the card is wide and takes the stroke width with it, so a
   2px line renders thin and uneven. Fixed with `vector-effect`.
3. **A flat line pretending to be data.** Inference spend is £0 for all 30 days,
   and a sparkline of constant zero draws a confident horizontal line along the
   baseline — it *looks* like a measurement. It now says "Nothing in the last 30
   days" instead.

A fourth was visible but not a bug: with `auto-fit`, five stat tiles stretched
across a 1900px row and gave a single digit 300px to itself, which is the
opposite of the density §25 asks for. `auto-fill` with a bounded track fixes it.

**The series is dense, not sparse.** `generate_series` produces every day and the
counts are left-joined on, so a quiet day is a zero. Drawing from sparse rows
would run a straight line across a quiet week and make it look busy — the shape
would lie, and lie in the reassuring direction.

Each chart carries a crosshair with a tooltip (pointer events, so a finger works
as well as a mouse) and a `<details>` table of the numbers, because a shape you
cannot interrogate is decoration. One series each, so no legend: the heading
names it.

---

## Known limitations

1. **Read-only.** No actions, deliberately for now: an action needs a
   confirmation model and an audit trail per §21, and adding buttons before that
   is how a dashboard becomes a way to do something irreversible by accident.
   Actions live in Slack and Telegram, where the six §12 buttons already work,
   and the page says so in its footer.
2. **One token, no per-device revocation.** Rotating it locks out every device.
   Acceptable for one user; it would not be for two.
3. **Reorder is "move up", not drag-and-drop.** Dragging on a phone fights the
   scroll gesture, and a control that only works with a mouse is not a
   mobile-first control. Tap the chevron to promote a card.
4. **The mobile judgement is unmade**, as above.
