# ADR-0019 — The studio becomes the product, and `web/hq/index.html` is retired

**Date:** 2026-09-11 · **Status:** accepted
**Grant's decision, 11 September. Supersedes nothing; completes ADR-0002 and ADR-0011.**
**Tracked by Issue #68.**

---

## What happened

Grant opened the deployed dashboard and asked:

> *"excuse me but where all the nice graphics that we spent so long trying to
> perfect?"*

> *"there was a lot more to it than that.. we asked for animations,
> transparency, effects, drop shadows, embossing, draggable surfaces, do you
> recall all the specifications we discussed? they are to be implemented across
> the whole front end"*

> *"why did you not integrate this? we talked about it for hours"*

He was right, and the diagnosis is not that anything was lost. `docs/design/direction.md`,
`docs/design/core-invariants.md`, §§14–20 of the frontend prompt and the ASCII
information architecture in `docs/spec/project-dashboard-ia-2026-09-10.md` are
all intact and verbatim; Issues #23, #38, #39, #40 track the work. His rule about
putting things in Issues did its job.

**What failed is that the design work went into one file and the deploy ships a
different one.** Measured on the day:

| | `web/studio/studio.css` | `web/hq/index.html` (deployed) |
|---|---|---|
| `transition` | 52 | 1 |
| `cubic-bezier` | 23 | **0** |
| `box-shadow` | 136 | 12 |
| `backdrop-filter` | 25 | 1 |
| inset shadows (emboss) | 26 | **0** |
| `transform` | 70 | 11 |

Zero designed easings and zero inset shadows is the whole story: the live page
was never given the motion language or the depth language at all.

## The decision

**The studio becomes the product.** Its shell, tokens, depth, motion and
information architecture are the frontend; the operational surfaces currently in
`web/hq/index.html` move into it; and that file is retired rather than
maintained in parallel.

Grant chose this over the cheaper option of porting the design system into the
live page, and he was right to. The cheaper option leaves the canonical IA — his
own ASCII diagram, Issues #25–#30 — permanently unbuilt, and leaves two pages to
drift apart again the moment anybody is busy.

## Why two pages existed at all

Not a mistake at the time, which is worth recording so the same split is not
re-invented. `web/hq/index.html` was built first, to be *useful*: a token gate,
live sections, and every write action Grant needs. The studio was M0 — the WOW
prototype §14A demands **before** committing to a design, with invented data so
the composition could be judged without waiting on the backend.

The failure was not building both. It was letting M0 finish and never merging.

## What this does not change

**ADR-0002 and ADR-0011 still hold.** No React, no bundler, no build step. The
studio is already plain hand-written HTML, CSS and ES modules, and it stays that
way — this decision is about *which* hand-written page, not about the stack.

**One bearer token, constant-time compared.** The studio inherits the gate
exactly as it is. No new auth system.

**The API stays as it is.** `hq-api` already serves every section the studio
needs; this is a client change.

## The order, and why

Each step has to leave something Grant can open, because a rewrite that is
unusable for a fortnight is a rewrite that gets abandoned.

1. **The studio reads real data.** `data.js` is replaced section by section by
   what `hq-api` serves. Portfolio and project overview first — they are the
   screens he actually looks at, and they are the ones the IA is about.
2. **The write actions come across.** Create and rename a project, attach and
   detach a source, edit a person, grant a tool, retire a procedure, approve a
   request. Until these exist in the studio, `web/hq/index.html` stays deployed
   at its URL as the place things get done.
3. **The operational surfaces come across** — usage, connections, cost, routing,
   setup, the build diary, the voice call.
4. **`web/hq/index.html` is deleted**, in one commit, once nothing needs it.

The old page keeps its URL until step 4. Retiring it before its actions exist
somewhere else would remove capability in the name of a redesign, which is
exactly the failure 0119 identified in a different context: *"a permission
system's first job is to not change behaviour on the day it is installed."*

## The check that must exist

The reason this went a week unnoticed is that `npm run shots` renders the studio
and `verify:ui` drives the HQ page, and **nothing looked at both**. Two suites,
each correct, with the gap between them invisible.

So a check has to fail — not inform — when the deployed page drifts from the
design system. It arrives with step 1, not after step 4, because the value of
the check is entirely in the period when the two still differ.

This is the third instance of the same shape in one day, and the pattern is now
in `CLAUDE.md`: **a verification that looks somewhere other than where the user
looks passes for the wrong reason.** `verify:ui` feeding the staff tab
`hq_staff()` when the page requests `hq_team()`, so the tool grid rendered as
nothing and passed. `verify:skills` testing the table and the function separately
and missing the bug in the gap. And this.

## What was considered and rejected

**Port the design system into `web/hq/index.html`.** Faster to something usable
daily. Rejected by Grant, and rightly: the studio's layout and IA stay unbuilt,
his ASCII diagram never becomes navigation, and the two pages drift again.

**Keep both, forever — studio for projects, HQ for operations.** Defensible on
paper. Rejected: it is the current state, and the current state is what produced
the question. Two frontends means every feature has a place it was not added.

**Rebuild in a framework now that it is a real application.** Rejected without
much thought, and ADR-0002 and ADR-0011 give the reasons at length. Nothing about
this decision is blocked by the absence of a bundler; the studio is already
1,500 lines of plain modules doing more than the page it replaces.

## Consequence for anyone extending this

- **Do not add a feature to `web/hq/index.html`.** It is in run-out. Anything new
  goes in the studio, and anything you fix there you should ask whether to port
  rather than duplicate.
- **The IA is canonical and it is in `docs/spec/project-dashboard-ia-2026-09-10.md`.**
  Two levels, never three. If you find yourself adding a third, read it again.
- **Judge it by running it.** §14A, and the reason this ADR exists.
