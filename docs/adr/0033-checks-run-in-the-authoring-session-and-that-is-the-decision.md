# ADR-0033 — Checks run in the authoring session, and that is the decision

**Status:** Accepted · 2026-09-16 · Issue #17

## Context

Grant, 2026-09-08, after 1,800 of the account's 2,000 monthly GitHub Actions
minutes went to a five-minute worker cron:

> *"stop using github actions completely please, find another way to do
> thing... for any process."*

Every schedule and push trigger was removed the same day. `workflow_dispatch`
remains on all nine workflow files, so each is a button and none is a clock.

§3 of the build prompt asks for CI on Actions. §26 caps cost at ~£0/month and
the instruction above says no Actions. **Issue #17 exists so that conflict is
recorded rather than silently resolved in whichever direction the next session
happens to prefer.**

## The decision

**Option 1: leave it.** Checks run before every push, in the session making the
change, and that is the arrangement — not a gap waiting to be filled.

```
lint · typecheck · test · check:migrations · check:secrets · check:templates
· check:leaks · check:icons        then the suites the change touches
```

Three reasons, in the order they matter:

1. **It is earlier feedback than CI ever gave.** A failing check stops the
   commit rather than arriving after it. The whole value of CI is catching what
   the author did not run; the cost is that it catches it minutes later and
   somewhere else.
2. **It is free, and the budget is a hard constraint rather than a preference.**
3. **A push trigger on a repository where nothing is merged does nothing.**
   `main` now exists, so that objection is weaker than it was — but the
   development branch is still pushed to directly and a PR trigger would fire
   on approximately nothing.

## What this costs, stated rather than omitted

**An independent second opinion on a machine that is not the author's.** A
session that skips its own checks is caught by nothing. That is the honest
residual risk of this decision and it is not mitigated away by this ADR.

Two things narrow it, and neither closes it:

- **`e2e.ts` keys every suite result to the COMMIT** (#226), so a suite that
  ran can be told from one that did not, after the fact, for any commit on the
  branch. It records; it does not enforce.
- **The environment is not the author's laptop.** Sessions run in a fresh
  container against the real Supabase project, so "works on my machine" is a
  smaller class of failure here than in an ordinary repository.

## The cost if it is ever turned on

Measured against what the checks actually take today, not guessed:

| | |
|---|---|
| One job: install, lint, typecheck, test, the six static checks | **~4 minutes** |
| At 20 pull requests a month | **~80 minutes of 2,000** — about 4% |
| At 5 a month, the realistic rate for one person | **~20 minutes** — 1% |

So the money is not the obstacle. **The obstacle is the standing instruction**,
and it was given after a specific, expensive failure.

## If it is enabled

Conditions, so that a future session enabling it cannot repeat 2026-09-08:

1. **`pull_request` only.** No `push`, no `schedule`, ever. A schedule is what
   spent the 1,800 minutes.
2. **One job, not five.** The cost above assumes one; five parallel jobs
   installing dependencies five times is the same work at five times the price.
3. **A stated budget in the workflow file itself**, with `timeout-minutes` set,
   so a hung job cannot run for six hours.
4. **It never becomes the only place a check runs.** The pre-push set stays;
   an Actions run that duplicates it is a second opinion, and an Actions run
   that replaces it is a slower first one.

**This needs Grant's word.** Enabling it reverses a standing instruction, and
a standing instruction is not reversed by an agent's cost estimate.

## Consequences

- #17 is closed with the decision recorded, which is what it asked for.
- `.github/workflows/README.md` continues to record the loss.
- The nine `workflow_dispatch` buttons stay: a button somebody presses is not
  a cron, and the backup and vault-export ones are genuinely wanted on demand.
