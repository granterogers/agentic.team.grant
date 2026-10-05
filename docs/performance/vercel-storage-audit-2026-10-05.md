# Vercel Functions Storage audit — team `agentic-team-grant`

Captured 5 October 2026, about 15:00 UTC, with the team's Vercel token, **read-only** (GET requests only). Nothing was
deleted, deployed, reconfigured or upgraded. No token value is recorded here. This extends the Supabase efficiency audit
(`Efficiency-evidence.md`) and is kept apart from it: **nothing in this document is a Supabase compute verdict.**

Trigger: a 3 October notification that 75% of the 10 GB Functions Storage allowance was consumed.

## What could and could not be verified

| Item | Status |
|---|---|
| Team, plan, projects, deployments, aliases, retention settings, regions, per-function bundle sizes | **Measured** through the Vercel API (329 deployments, all read) |
| The 75% / 10 GB figure and the dashboard Usage page | **Not readable here.** The billing and usage endpoints answered 404 or needed parameters the token does not have. The 10 GB allowance is taken from the notification, not from the dashboard. The three official pages do not state a Hobby allowance or what happens at 100%. |
| Enforcement behaviour at 100% | **Unverified.** The pages say nothing about it. The team shows `blocked: null`, `softBlock: null`, no feature blocks today. |
| Live `notebook.reader_url` value | **Not read** (it lives in production Supabase; no read was authorised). The migration that seeds it uses the stable alias, not a deployment URL. |

Official sources read: Deployment Storage, Optimize Deployment Storage, Deployment Retention (all on vercel.com/docs).

## What the metric is

From the official page: Functions Storage is the Vercel Function bundles stored for each retained deployment, per region.
For billing, Vercel takes the maximum stored amount per project per billing day and sums the days (GB-months). Retention
decides when a deployment becomes eligible for deletion; a background job marks it within about 48 hours of expiry, and
deleted deployments stay restorable for 30 days.

**Accumulated versus retained.** The plan here is Hobby (`plan: hobby`, legacy iteration). The reading that fits the
notification is *currently retained bytes*: reconstructing what was retained on 3 October gives 7.3 to 7.6 GB, which is
73 to 76% of 10 GB (table below). A sum of daily maxima over a billing period would be much larger. This match is an
**inference**, not a dashboard reading.

| Moment (UTC) | Retained function bundles | % of 10 GB |
|---|---:|---:|
| 2 Oct 00:00 | 7.26 GB | 72.6% |
| 3 Oct 00:00 | 7.34 GB | 73.4% |
| 3 Oct 12:00 | 7.61 GB | 76.1% |
| 5 Oct 15:00 | 8.15 GB (7.59 GiB) | 81.5% |

Counting identical bundle digests once would give 6.1 to 6.9 GB; the notification fits the undeduplicated count better.

## Inventory

Team `agentic-team-grant` (created 3 Sep 2026), Hobby, one concurrent build, **no Git connection on any project**.

| Project | Deployments | With functions | Retained function bytes | Notes |
|---|---:|---:|---:|---|
| `ai-team-hq` | 236 | 203 | **7.59 GiB** | The only project with functions. 202 deployments carry 2 Python functions, 1 carries 1. |
| `agentic-team-hq-basecamp` | 84 | 0 | 0 | Static only; 13 BLOCKED, 5 preview, current production is one of them. |
| `ai-team-hq-voice` | 3 | 0 | 0 | |
| `team-hq-ux-review` | 2 | 0 | 0 | |
| `site` | 2 | 0 | 0 | One BLOCKED. |
| `atg-integration-2026-09-24` | 1 | 0 | 0 | |
| `agentic.team.grant` | 1 | 0 | 0 | Its only deployment is in ERROR. |

- **Regions:** every one of the 405 function bundles is deployed to `iad1` alone. There is no extra region to remove.
- **Retention:** every project is already at 30 days for all states, `deploymentsToKeep` 10 (the Hobby default). The team
  default is the same. Retention is therefore not misconfigured; it is simply as long as Hobby allows by default.
- **Aliases:** only 6 deployments hold a live alias, one per project. For `ai-team-hq` it is the newest one
  (`dpl_3yZSXFhyNXjbhee7V86sUfA8Yui3`). The other 235 are replaced production deployments.
- **Triggers:** all 236 are `target: production` uploads through the API from `scripts/deploy/hq.ts` or
  `scripts/deploy/hq-page-delta.ts`. No Git, hook or CI trigger exists (`link` is empty on every project and none of the
  repository workflows calls Vercel). The cause of deployment volume is people and agent sessions running those two scripts.

## Cause

1. **Two near-identical 21 MiB Python functions per deployment.** `api/notebook.py` and `api/notebook-act.py` are about
   10 KB each. Each bundle measures 16.2 to 21.3 MiB (22,376,573 and 22,376,444 bytes on the newest). A local install of
   `notebooklm-py` for Python 3.12 is 36.7 MiB, of which `notebooklm` is 16.3 MiB and `pygments` (pulled in by `rich`) is 9.5
   MiB; the bundle is the compressed form. Both functions carry the same dependencies, so the dependency payload is paid twice.
2. **The static site is packed into the functions.** `deploy:hq` uploads `index.html`, `studio/**` and a second copy of
   every studio file at the root, beside `api/`. The bundle grew from 16.20 MiB (8 Sep) to 21.34 MiB (5 Oct) in step with
   `web/studio` (5.0 MB now); the Python code did not change in that time. This is the strongest *inference* in this
   document and needs the single preview proof below before it is relied on.
3. **Deployment volume.** 7.7 deployments a day over 30 days; 31 on 11 Sep, 28 on 13 Sep, 36 on 16 Sep; 2.4 a day over the last
   14 days. Those three days alone hold about 3.5 GiB of the 7.59 GiB.
4. **Repeat deployments.** In 31 of 203 function-bearing deployments every bundle was byte-identical to an earlier one:
   62 of 405 bundles, 1.16 GiB, with nothing changed. `deploy:hq` also redeploys the page when only the gateway changed.
5. **Unpinned dependency.** `requirements.txt` says `notebooklm-py` with no version, so the bundle size can move with a
   release (0.8.4 today).

## Options, ranked by evidence

| Rank | Option | Evidence | Effect | Risk |
|---:|---|---|---|---|
| 1 | Delete superseded deployments older than 7 days (list below) | 207 candidates, none aliased | −6.39 GiB of 7.59 GiB (84%) at the next measurement | Low if the reader URL precondition holds |
| 2 | Stop packing static files into the functions (`excludeFiles` in `vercel.json`, keeping `scripts/notebook/act.py`) | Bundle size tracks `web/studio` growth | About −5 MiB of 21 MiB per bundle (−24%), **unproven** until one preview deployment is compared | Medium: `notebook-act.py` needs `scripts/notebook/act.py` at runtime |
| 3 | Fewer, smarter deployments: skip when no file changed; deploy the gateway without redeploying the page | 31 fully repeated deployments, 1.16 GiB | Up to −15% of what is retained | Low |
| 4 | One function instead of two | Identical dependency payloads | Up to −50% per deployment, **unproven** | Medium: changes two URLs and two timeouts (60 s and 300 s) |
| 5 | Shorter production retention for `ai-team-hq` (7 days) | At 5 deployments a day, 30 days holds about 6.3 GiB; 7 days about 1.5 GiB | −76% at steady state | Low to medium: shortens rollback history; Hobby always keeps the last 3 deployments and last 3 ready production deployments |
| 6 | Trim `pygments` lexers from the bundle | 8 MiB uncompressed | Unmeasured, probably 2 to 3 MiB compressed | High: an import failure surfaces only at runtime |
| 7 | Remove a region | Only `iad1` is used | None | n/a: **rejected, nothing to remove** |

Not recommended: upgrading the plan. Retained storage is 7.59 GiB, of which 6.39 GiB sits in deployments nobody can
reach through an alias, so the allowance is not the constraint yet.

## Natural expiry, and when cleanup moves the metric

Retention never runs ahead of the 30-day window, so nothing has expired yet (the project is 30 days old). The burst days of
11 to 19 Sep begin to expire from 11 Oct. Projection with no further deployments: 6.83 GiB on 11 Oct, 4.10 on 15 Oct,
1.72 on 19 Oct. At the recent 5 a day the figure never falls below roughly 4.6 GiB and settles near 6.3 GiB.

- Deleting a deployment lowers *retained* bytes. If the dashboard shows retained storage, it should drop at the next daily
  measurement; the retention job itself can take up to 48 hours, and recently deleted deployments are restorable for 30
  days, so whether recovery-period bytes still count is **unverified**.
- If the dashboard instead shows a sum of daily maxima across the billing period, cleanup stops further growth but the
  reading falls only when the period resets.
- Output changes (options 2 to 4) affect only deployments made after they ship.

## Deletion list for approval (not executed)

Rule: every `ai-team-hq` deployment that is **not** the current production deployment, **not** among the newest 15, and
**older than 7 days** at the time of approval. Computed today: **207 deployments, 6.386 GiB**, created 5 Sep to 24 Sep,
all `READY`, none holding an alias. The 29 kept (1.204 GiB) run from 28 Sep 15:36 UTC to the present and include the live
one. The full list is `vercel-ai-team-hq-deployments.csv` (236 rows, each marked KEEP or DELETE, with id, URL, created
time, function bytes). It must be regenerated at the moment of approval because "newest 15" and "7 days" move.

Preconditions before anything is deleted:

1. Grant authorises a read-only check that production `public.system_config` `notebook.reader_url` still equals
   `https://ai-team-hq.vercel.app/api/notebook` (the alias), not a deployment-specific URL. If it is a deployment URL, that
   deployment goes on the keep list first.
2. Grant approves the rule or edits it. A longer rollback window (14 days, keep newest 15) deletes 202 deployments and
   6.19 GiB; a shorter one (3 days, keep newest 10) deletes 217 and 6.80 GiB.
3. No project and no plan change is part of this. Other projects' older deployments hold no function bytes and are left alone.

## Living evidence rows (same format as the Supabase table)

| AREA | BASELINE | PROBLEM PROVEN? | CHANGE | AFTER | IMPROVEMENT | CONFIDENCE | NOTES |
|---|---|---|---|---|---|---|---|
| Vercel Functions Storage | 7.59 GiB (8.15 GB) retained across 405 bundles; 7.3 to 7.6 GB on 3 Oct | Yes for retained bytes; the dashboard figure is **inferred**, not read | None | Pending approval | Unmeasured | High measured, medium on the dashboard match | Only `ai-team-hq` has functions |
| Vercel bundle size | 22,376,573 bytes per function, two per deployment | Yes | None | Pending | Unmeasured | High | About 10 KB of source behind 21 MiB |
| Vercel static in functions | Bundle grew 16.20 to 21.34 MiB with `web/studio` | Inferred | None | Pending one preview comparison | Unmeasured | Medium | `excludeFiles` must keep `scripts/notebook/act.py` |
| Vercel deployment volume | 236 in 30 days; peak 36 a day; 2.4 a day over 14 days | Yes | None | Pending | Unmeasured | High | API uploads from two scripts; no Git or CI trigger |
| Vercel repeat deployments | 31 of 203 byte-identical, 1.16 GiB | Yes | None | Pending | Unmeasured | High | Digest equality |
| Vercel retention | 30 days all states, keep 10, all projects | Not a defect; default | None | Pending | Unmeasured | High | Hobby default |
| Vercel regions | `iad1` only, 405 of 405 bundles | Disproved as a cause | None | n/a | None available | High | |
| Vercel plan upgrade | Not needed on current evidence | Not established | None | n/a | n/a | Medium | Allowance and enforcement text not verified |

## Storage before and after scorecard

| Measure | Before (measured) | Projected if the list is approved | Verified after |
|---|---:|---:|---|
| Retained function bytes, `ai-team-hq` | 7.59 GiB (81.5% of 10 GB by decimal GB) | 1.20 GiB (12.9%) | **Pending: nothing deleted** |
| Deployments retained, `ai-team-hq` | 236 | 29 | Pending |
| Bundle size per function | 21.34 MiB | about 16 MiB with statics excluded (unproven) | Pending |
| Bundles per deployment | 2 | 2 (1 if merged, unproven) | Pending |
| Steady state at 5 deployments a day, 30 days | about 6.3 GiB | about 1.5 GiB at 7 days' retention | Pending |
| Headroom to 10 GB today | 1.85 GB | 8.7 GB | Pending |

**Verified savings so far: none.** Today's figures are a baseline.

## Remaining headroom and risk

Headroom today is about 1.85 GB. At the recent 213 MiB a day it lasts about 8 days, and a single burst day like 16 Sep
(1.4 GiB) would use most of it. The expiry of the September bursts from 11 Oct is the natural relief but is not guaranteed.

## Recurrence prevention (proposed, not built)

- A pre-deploy step in `deploy:hq` and `hq-page-delta` that refuses a deployment when no uploaded file changed.
- A budget check that fails when a function bundle exceeds a ceiling (for example 25 MiB) or when retained function bytes
  pass 60% of the allowance, run as a read-only Vercel API query.
- Pin `notebooklm-py` in `requirements.txt` so the bundle cannot change with a release.
- Record the sizes this audit reads (`/v13/deployments/{id}/builds`, field `output[].size`) in the deploy script's output.

## Deployments made by this session

None. No Vercel project, deployment, domain, setting or plan was changed.
