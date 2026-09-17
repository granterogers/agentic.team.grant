# ADR-0039 — A session that stays valid, not a browser that stays open

**Status:** accepted · 2026-09-17 · Issues #135, #16 · `src/browser/`, migrations 0442–0446

## Context

#135 asks for a browser the office can use on Grant's behalf, and #16 asks for
a general agent runtime. Both were read for months as "needs budget", because
the obvious reading of *"a browser tab in every project"* is a browser process
that stays open, and a process that stays open is RAM somebody is paying for
while nothing is happening.

`docs/agent-runtime-assessment-2026-09-17.md` separates the two things that
sentence conflates:

| | what it means | what it costs |
|---|---|---|
| **Persistent state** | a session that is still signed in tomorrow | nothing — it is a row and a secret |
| **Persistent compute** | a process holding memory between requests | money, always |

Almost everything either Issue actually asks for is persistent **state**. The
authenticated session survives; the browser that established it was closed
hours ago and nobody noticed.

Grant's standing constraint is ~£0/month, and he confirmed the gather-before-act
ordering on 17 September 2026.

## Decision

**Store the session. Destroy the browser.**

1. `public.browser_sessions` holds one row per project per site: the host, a
   required sentence saying what the session is for, and a *reference* to a
   cookie jar in the Supabase Vault. Never the jar itself.
2. Every gather opens a fresh Chromium on **Cloudflare Browser Rendering**,
   which is free on the Workers plan — ten browser-minutes a day, three
   concurrent, sixty-second ceiling — presents the jar in the request, does one
   bounded piece of work and dies.
3. The runtime is behind `BrowserAdapter`. `UnavailableBrowserAdapter` is the
   default and runs every day until a credential exists, so the degradation
   path is the path that gets exercised.
4. **Gather only.** Open, read, photograph, download. No click, no type, no
   submit, no purchase.
5. Stop is a **column** (`jobs.stop_requested_at`), polled by #263's step
   runner between steps, because the runtime is somewhere else and there is no
   socket to interrupt.
6. Ten minutes a day is a budget, so `app.browser_budget` meters it and the
   handler refuses before opening anything rather than after.

## Why gather-only is enforced three times

The boundary is stated in three independent places and this is deliberate
rather than belt-and-braces:

- the adapter interface has no acting method;
- `browser_actions.verb` has a CHECK that will not hold an acting word;
- the capability sheet an agent reads (`connector_capabilities`, #51) lists
  pressing a button as reach `none`, switched off and described.

Any one of them could be widened by somebody solving a Tuesday afternoon
problem. All three needs a decision. The third one matters most, because 0298's
lesson is that a capability an agent is not TOLD about is one it invents for
itself — `task.create` grew a fictional four-field intake form that way, twice.

## What this does not claim

- It is not #261. A terminal and a writable filesystem in the same place as the
  browser is the one thing no free serverless runtime gives, and the assessment
  prices it honestly: a wake-on-demand Fly machine at roughly $0.50–$3.50 a
  month, or GitHub Actions at £0 if Grant reopens `workflow_dispatch`. Nothing
  paid has been enabled.
- It does not act. Acting needs its own approval path through #15, its own
  verbs, and its own migration.
- It is not running yet. The two Vault entries (`browser.cloudflare_account`,
  `browser.cloudflare_token`) are unset, so the office answers honestly that it
  has no browser rather than pretending.

## Consequences

- A page the office reads becomes a `documents` row with `origin = 'source'`,
  which is what makes it reachable by retrieval and correctly *not* treated as
  the office's own prose by `src/agents/provenance.ts`. A browsed page that
  landed as `made` would be the laundering route that file exists to close.
- `browser` is a knowledge connector (0445), so it appears in the capability
  sheet, in `project_knowledge` coverage, and in the Sources tab — rather than
  being a seventh project tab for a capability most projects will not use.
- Changing runtime later touches one file. Moving off Cloudflare does not touch
  the schema, the handler, the ledger or the page.
