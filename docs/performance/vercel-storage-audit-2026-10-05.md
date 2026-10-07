# Vercel Functions Storage audit — team `agentic-team-grant`

Version 2, 5 October 2026 (v1 was committed earlier the same day). Read-only except where stated: one bounded production
read (item 1, authorised), and three isolated **preview** deployments (item 2, authorised). Nothing was deleted, nothing
was deployed to production, no project, setting, alias, secret or plan was changed. No token or secret value appears here.

This extends the Supabase efficiency audit (`Efficiency-evidence.md`) and stays apart from it. **Nothing here is a Supabase
compute verdict**, and these Vercel findings do not complete the original audit.

## What changed since v1

| v1 said | Now |
|---|---|
| The official pages state no Hobby allowance and nothing about what happens at 100%. | The two Vercel changelogs do. Hobby includes 10 GB, going over can **block deploying**, and over-limit teams have unprotected deployments **deleted immediately** (item 3). Enforcement is therefore real, not hypothetical. |
| The static site is probably packed into the functions. | Proven: a probe inside the bundle lists it (item 2). |
| Excluding it should save about 24% per bundle. | Measured **20.2%** (21.49 to 17.16 MiB). |
| Retained function bytes 7.59 GiB. | 7.753 GiB now: my three experiment previews added 0.163 GiB (disclosed, listed for deletion). |
| The deployment file set is `index.html`, the studio and the functions. | It also includes the generated, gitignored `config.js` that `config:site` writes (item 5). |

## 1. Reference check (production read)

One bounded read-only session through the repository's own guard (`ALLOW_PRODUCTION_CHECKS=1 npm run q`), authorised for this
check only. Four queries; nothing written.

| Question | Result |
|---|---|
| `notebook.reader_url` | `https://ai-team-hq.vercel.app/api/notebook`: the **stable alias**, not a deployment-specific host. Deleting old deployments cannot break it. |
| Any other `system_config` row naming a `vercel.app` host | Three rows, all the same alias host: `notebook.reader_url`, `notebook.writer_url`, `web.base_url`. |
| The ten URL-capable columns in `public` (artifacts, browser_actions, documents.origin, mcp_auth_codes, mcp_providers, project_attachments, project_references, providers, telegram_bots, build_steps) | 0 rows name a `vercel.app` host. |
| Tracked files naming a hashed deployment host | None. Code and migrations use `ai-team-hq.vercel.app` (and `agentic-team-hq-basecamp-agentic-team-grant.vercel.app`, an alias of a different project). |
| Tracked documents naming a deployment **id** | 25 distinct ids, 23 still exist. They are release records and rollback points. Four of them are deletion candidates (item 4). The two named in `HANDOFF.md` as the current page and its rollback are kept. |

Not checked, and why: values of Supabase edge-function secrets (the Management API shows names only), and redirect URIs
registered at Google, Slack and Telegram (not reachable from here). Both are the places a deployment-specific URL would
hide, so they stay **UNVERIFIED**; the code defaults in `voice-token` and `slack-oauth` use the alias.

Vercel side: the only project environment variable is `NOTEBOOK_READER_SECRET` (production only); the team has 12 aliases, all
`*.vercel.app`, one live alias per project.

## 2. Controlled preview experiment: exclude static files from both Python bundles

**Question.** Does `excludeFiles` shrink each Python function bundle, and does the notebook reader and writer behave
identically afterwards?

**Method.** Three previews of `ai-team-hq` from the same file set that `deploy:hq-page` builds (no `target`, so not
production and nothing aliased; production alias verified unchanged afterwards). A throwaway random reader secret was
supplied in each deployment's own environment, so the real production secret was never used and no project setting was
touched. Each also carries a small probe function that lists what is inside its bundle.

| Variant | `vercel.json` | Purpose |
|---|---|---|
| A | current (no exclusion) | baseline |
| B | `excludeFiles` on both functions, `scripts/notebook/act.py` kept | the proposed change |
| C | B plus `scripts/**` | **negative control**: the test must detect a missing `act.py` |

Pattern: `{*.css,*.html,*.js,studio/**,bc/**,fonts/**,logos/**,samples/**,textures/**,vendor/**}` (86 characters).
**Finding on the way:** Vercel refuses an `excludeFiles` longer than 256 characters (`INVALID_VERCEL_CONFIG`), which is why
the first attempt, a list of 44 names (455 characters), failed to build. Two errored deployments remain from it.

**Bundle sizes** (`output[].size` of each function in the build output):

| Variant | `api/notebook` | `api/notebook-act` | Each, MiB | Change vs A |
|---|---:|---:|---:|---:|
| A | 22,532,847 | 22,532,718 | 21.49 | baseline |
| B | 17,990,430 | 17,990,301 | 17.16 | **-4,542,417 bytes (-20.2%)** |
| C | 17,973,657 | 17,973,528 | 17.14 | -4,559,190 bytes (-20.2%) |

Production at the time held 22,376,573 bytes (it differs from A by the probe file and the file list, +0.7%). Memory (2048 MB),
timeouts (60 s and 300 s), runtime (python3.12) and region (`iad1`) are identical in A, B and C.

**What is inside** (probe, uncompressed): A 3,979 files, 55.9 MB, including `studio/` (108 files, 5.2 MB) and a root copy of every
studio file. B 3,763 files, 45.5 MB: `api`, `scripts`, `requirements.txt`, `vercel.json`, `_vendor` (3,748 files, the
Python dependencies, 45.4 MB) and the builder's own files. Static site: gone. This is the proof that the studio was packed into
every function.

**Behaviour** (the same 15 requests against each variant; an identical status **and** response body hash counts as equal):

| Check | A | B | C |
|---|---|---|---|
| reader and writer liveness (GET) | 200 | 200, identical | 200, identical |
| no `Authorization` header (POST), each endpoint | 401 | 401, identical | 401, identical |
| wrong bearer (POST), each endpoint | 401 | 401, identical | 401, identical |
| empty body, not JSON, unknown op or action, missing storage, `args` not an object | 400 | 400, identical | 400, identical |
| reader `notebooks`, invalid cookie jar (imports the library) | 502 | 502, identical | 502, identical |
| writer `notebooks`, invalid cookie jar (**runs `act.py` in a subprocess**) | 200 | **200, identical** | **500: `act.py is not in this deployment`** |

B matched A on all 15. C matched A on 14 and failed exactly the one check that needs `act.py`, so that check can fail and B's
pass means something. No response echoed the secret or the submitted jar (asserted in the script on every response). The invalid
jar is rejected locally by the client library (`Missing required cookies`), so no request reached Google.

**Not covered by this experiment.** A real Google session was not used, so the notebook read and write through B against real
notebooks is untested. `deploy:hq` already performs exactly that probe after every deploy (`reader: http 200 N notebook(s)`,
`writer ... ok=true`); it is the acceptance step when B is deployed to production.

**Left behind.** Five preview deployments (`dpl_FBQrt9CdDrZEZ8CmQBZuGkJBpqAA`, `dpl_AF7zeon6NzGyhGBi2aFXu7rPojfk`,
`dpl_4tQhGkzjmUjE7YFXS2WFAnUDDTqk` ready; `dpl_7EuiLzMixkqzRWncL8VYv8C1YR4h`, `dpl_G1Eqbqw1rESZ9X4bkYi96ZvZ2G6R` errored), adding
0.163 GiB of retained function bytes. They are in the cleanup list as DELETE, awaiting approval like the rest. The proposed
configuration is `vercel-experiment/vercel.proposed.json` (not applied); the experiment scripts are alongside, exactly as run.

## 3. How the Functions Storage metric is calculated, and when cleanup moves it

**Sources.** Deployment Storage, Optimize Deployment Storage and Deployment Retention (the three you named), plus the two
changelogs they link, the Hobby plan page and the usage guide. The exact sentences below were read from the pages themselves.

**What the sources say.**

- *Deployment Storage page:* Functions Storage is "Vercel Function bundles stored in each region where Vercel deploys them".
  "For each metric, Vercel records the maximum stored amount for each project on each billing day. It adds those daily project
  amounts across the billing period." That is the **Pro** GB-month definition ($0.10 per GB-month).
- *Hobby plan page (14 Sep 2026):* no storage row in its included-usage table, and "As the Hobby plan is a free tier there are no
  billing cycles."
- *Changelog, 21 Aug 2026:* "Hobby teams include up to 10 GB". "The Usage page shows Deployment Storage and Functions Storage
  by project".
- *Changelog, 16 Sep 2026:* "Hobby teams get 10GB of Deployment Storage. Every deployment you keep uses some of it, and going
  over the limit can block you from deploying until you free some up." "If your team is over the 10GB limit, deployments
  outside those exceptions are now deleted immediately instead of after 30 days."
- *Retention page:* Hobby always keeps the last 3 deployments created, the last 3 ready production deployments, anything with a
  production alias, and a non-production deployment with a custom alias. Expiry is applied by a background job "typically ...
  within 48 hours"; a deleted deployment is restorable for 30 days.

**Three quantities, kept apart.**

| | Quantity | Value | Status |
|---|---|---|---|
| 1 | **Retained function bytes** (what is stored now, undeduplicated) | 3 Oct 00:00 UTC 7.345 GB (73.4%); 3 Oct 12:00 7.613 GB (76.1%); 5 Oct audit baseline 8.150 GB (81.5%); **now 8.325 GB = 7.753 GiB (83.3% of 10 GB)** | **Measured** from build outputs |
| 2 | **Billing-period usage** (daily maxima summed, GB-months, modelled) | cycle 3 Sep to 3 Oct 4.59 GB-months (45.9%); September 3.85 (38.5%); October to the 5th 1.29 (12.9%) | **Modelled** from (1); not read from Vercel |
| 3 | **Projected headroom** | table below | **Projection**, with stated assumptions |
| | The dashboard's own reading (Usage page, Functions Storage, by project) | not obtainable | **UNAVAILABLE**: there is no signed-in dashboard session here, `/v1/usage` answers "only available to Teams on the Pro or Enterprise plan", and `/v1/billing/charges` answers 404 |

**Which quantity the "75%" is.** Only quantity 1 reproduces it: 73 to 76% on 3 October. Quantity 2 gives 13 to 46% depending on
the window I assume, and never 75%, so the notification is unlikely to be a billing-period accrual. This is an **inference**, not a reading,
and it also assumes the 10 GB is compared with Functions Storage alone. The sources do not say whether Functions Storage and
Deployment Storage (static output, **not measured here**) share the 10 GB; if they do, the true figure is higher than 83.3%.

**When cleanup moves the metric.**

- Because the page records the **daily maximum**, deleting deployments during a day does not lower that day's figure; the effect
  appears from the **next billing day**. If a team is over the limit, Vercel deletes unprotected deployments immediately, but
  that is Vercel's action, not ours.
- A deleted deployment stays restorable for 30 days. Whether recovery-period bytes still count towards usage is **UNVERIFIED**.
- Natural expiry is not a lever yet: every project is under 30 days old, so nothing has expired. The 11 to 19 September burst
  starts expiring on 11 October.
- Output changes (item 2) only affect deployments made after they ship; they never shrink what is already stored.

**Projected headroom to 10 GB** (existing deployments expire at 30 days; each new one adds 42.5 MiB, the recent mean; the
experiment previews are included in "now"):

| Scenario | Peak | Reaches 10 GB |
|---|---:|---|
| 2.4 deployments a day (last 14 days) | 8.56 GB (86%) on 9 Oct | not within 40 days |
| 4.0 a day (last 7 days) | 8.77 GB (88%) on 9 Oct | not within 40 days |
| 7.7 a day (30-day mean) | 10.35 GB (104%) on 4 Nov | 2 Nov |
| 4.0 a day plus one 36-deployment burst on 12 Oct (like 16 Sep) | 9.32 GB (93%) on 12 Oct | not within 40 days |

Headroom today is 1.68 GB. **A burst is the realistic way to hit the limit, and at the limit Vercel deletes rollback history and
can block deploys.** The live production deployment is never deleted.

## 4. Cleanup inventory (proposed; nothing deleted)

Saved beside this document: **`vercel-cleanup-inventory-2026-10-05.csv`** (241 rows: id, created, age, target, state, bundles,
function bytes, aliases, Vercel's own retention protection, document references, KEEP/DELETE and the reason). Generated at
2026-10-05T16:24Z by `scripts/vercel/vercel-storage-inventory.ts`, which only issues GET requests and refuses to produce a list
that breaks the rule (`assertSafe`, with controls that make it fail).

**Rule.** Keep the live deployment, the 15 newest ready production deployments, and every ready production deployment in a
seven-day window. Previews are not rollback targets and are kept only while they hold an alias. Failed builds are not kept.

| | Deployments | Function bytes |
|---|---:|---:|
| Inventory | 241 | 7.753 GiB |
| **KEEP** | **28** | **1.163 GiB** |
| **DELETE (candidates)** | **213** | **6.591 GiB (85%)** |

The 213 are 208 superseded production deployments (5 to 28 Sep; 35 of them hold no function bytes: 33 static-only ones from
5 to 8 Sep and 2 errored previews), 3 experiment previews and 2 errored experiment builds. Without the experiments the
production candidates are 6.428 GiB.

**References and protections checked.**

- Aliases: 12 exist, one per project; **no DELETE row holds one.** The live deployment is KEEP.
- Retention exceptions: the live deployment and the 3 newest ready production deployments are KEEP. The "3 newest of any type"
  protection currently falls on experiment previews (DELETE rows); an explicit deletion is separate from Vercel's automatic one.
- `notebook.reader_url` and the other configuration rows use the alias (item 1).
- **Four deletion candidates are named in tracked release records** and are listed in the CSV: `dpl_GwmxkoNNac7MmfKia4VWVmxszdFD`
  (28 Sep; `production-deployment-2026-09-28/-29`, `release-candidate-2026-09-29`), `dpl_DwDy6otbfEEkxncUhvoPPtdHzXnr` and
  `dpl_7FBUNFQqVBVVAkSdwEPWQCruActw` (24 Sep) and `dpl_EafqeJb7PHg7BriEpBpDMkYyf5Pp` (23 Sep) (`production-promotion-2026-09-24`). These are
  history of superseded releases; the rule deletes them, and any can be kept by adding `--keep=<id>` when regenerating.

**To regenerate before approval** (the window and the newest-15 move with the clock):
`ALLOW_PRODUCTION_CHECKS=1 npx tsx scripts/vercel/vercel-storage-inventory.ts --out=<file.csv> [--keep=<id,id>] [--now=<ISO time>]`.

## 5. Prevention of unchanged and unnecessary redeployments (proposal, proven, not wired)

**Why it is needed.** 31 of 203 function-bearing production deployments produced bundles byte-identical to earlier ones
(1.16 GiB), 16 of them within ten minutes of the previous deployment, clustered on 13 and 16 September. `deploy:hq-page` only
refuses on a changed file *list*; it deploys when `--go` is given even if every file is the same, and `deploy:hq` always
redeploys the page, even when only the gateway changed.

**Design.** `scripts/deploy/lib/page-fingerprint.ts` hashes every input into one fingerprint. It would be stored on the
deployment itself as `meta.pageFingerprint` and compared with the **live production deployment's** copy, so it cannot go stale
on disk. **It skips only when the live deployment is READY and recorded exactly this fingerprint; every other case deploys**
(no fingerprint, an older deployment, not READY, a different algorithm version, `--force`).

**What the fingerprint covers, and the proof for each.**

| Input class | Covered by | Proof (test) |
|---|---|---|
| Page code and assets, the two functions, `act.py`, `requirements.txt`, `vercel.json` | content digest of every uploaded file | a same-length edit to each class changes it (so the digest, not the size, is what is tested) |
| The generated, gitignored `web/studio/config.js` (written by `config:site` from the environment) | content digest, **if present when collected** | changed, and absent, both change it; fingerprint **after** `config:site` runs |
| Files added, removed, renamed | the path list | one test each |
| Deployment request fields (name, target, projectSettings) | included | one test each |
| Project build settings and environment variable **names** | included | one test each |
| The reader secret value (a rotation changes what the functions accept; nothing in the files shows it) | a salted digest of each value the deploy supplies, never the value | rotation changes it |
| The algorithm itself | schema version | changing it changes it |

**Must not matter, and does not:** file modification times, rewriting identical bytes, input ordering, files under `raw/`.

**Completeness is also checked against the scripts, not assumed.**

- The upload set is defined once (`page-files.ts`). The tests parse `hq-page-delta.ts` and `hq.ts` and fail if either's own list
  or either's walk rules drift from it. The parsers were shown able to fail by removing a line from the real script.
- Every key either script sends to Vercel must be one the fingerprint knows, otherwise a test fails. Adding `env` to the real
  request turned it red; removing it restored green.
- Sabotage controls, each confirmed to have landed before reading the result: dropping the secret digest broke the two secret
  checks; ignoring content digests broke all nine file-class checks; deleting an upload line broke the parity check.

**Empirical check.** Against the experiment deployment built from this tree, all **221 of 221** files match by content digest,
so the file set and digest reproduce exactly what Vercel records. Against production, this working tree differs in 50 files (a
different commit, as expected) and production holds `config.js` and `studio/config.js`, which an unconfigured tree lacks. That is
how the generated-file input was found.

**Limits, stated.**

- A new release of an **unpinned** dependency is invisible to the fingerprint: `requirements.txt` says `notebooklm-py` without a
  version, so identical inputs can build to a different bundle. Skipping means a dependency update is picked up at the next real
  change; pinning it would remove the ambiguity (`unpinnedRequirements` reports it).
- Vercel's own build image is outside the inputs.
- Of the 31 historical repeats, none fall near the one secret-update time Vercel keeps (3 Oct 13:33 UTC), but only the **latest**
  update time exists, so earlier rotations cannot be excluded. Not all 31 are proven avoidable.
- Wiring it into `deploy:hq` and `deploy:hq-page` changes production deploy tooling, so it is **not done**; it needs your approval
  and a fingerprint-recording first deploy.

## Evidence rows (same format as the Supabase table)

| AREA | BASELINE | PROBLEM PROVEN? | CHANGE | AFTER | IMPROVEMENT | CONFIDENCE | NOTES |
|---|---|---|---|---|---|---|---|
| Vercel Functions Storage, retained bytes | 7.59 GiB (8.15 GB) at audit baseline; 7.3 to 7.6 GB on 3 Oct | Yes (retained). Dashboard 75% figure **inferred**, dashboard unreadable | None applied | 7.753 GiB now (+0.163 GiB from experiments) | None yet | High measured, medium on dashboard match | Only `ai-team-hq` has functions |
| Vercel billing-period usage | Not measurable (Hobby, no usage API) | UNPROVEN | None | n/a | n/a | Low | Modelled 13 to 46% by window; does not reproduce 75% |
| Vercel static in functions | Bundle 21.49 MiB with studio inside | **Yes** (probe lists `studio/` and root copies) | `excludeFiles` (preview only) | 17.16 MiB per function | **-20.2% measured on preview**, not in production | High | 15 of 15 requests identical; negative control fails correctly |
| Vercel `excludeFiles` limit | n/a | Yes: 256-character limit | Short brace pattern | Built | n/a | High | Enumerating 44 names (455 characters) failed |
| Vercel deployment volume | 241 deployments; peak 36 a day | Yes | Fingerprint skip designed and tested, not wired | Pending | Unmeasured | High | API uploads by two scripts; no Git or CI trigger |
| Vercel repeat deployments | 31 of 203 byte-identical, 1.16 GiB | Yes | As above | Pending | Up to 15% | High on repeats, medium on avoidability | Secret rotations cannot be excluded |
| Vercel retention | 30 days all states | Not a defect | None | n/a | n/a | High | Hobby default; exceeding 10 GB triggers immediate deletion of unprotected deployments |
| Vercel regions | `iad1` only | Disproved as a cause | None | n/a | None available | High | |
| Vercel reference safety | `notebook.reader_url` is the alias | Verified | None | n/a | n/a | High | Edge-function secret values and third-party redirect URIs UNVERIFIED |

## Storage before and after scorecard

| Measure | Before (measured) | After, **verified** | Available but not done |
|---|---:|---|---|
| Function bundle, each of two | 21.49 MiB | 17.16 MiB on a **preview** (-20.2%) | apply `vercel.proposed.json` and deploy |
| Behaviour of both notebook endpoints | n/a | 15 of 15 identical to baseline; control fails as designed | real-notebook probe at production deploy |
| Retained function bytes, `ai-team-hq` | 7.753 GiB | unchanged (**no deletion**) | 1.163 GiB if the list is approved |
| Deployments retained | 241 | unchanged | 28 |
| Steady state at 4 deployments a day, 30-day retention | about 5.0 GiB | unchanged | about 4.0 GiB with 17.16 MiB bundles; about 1.2 GiB with 7-day retention |
| Repeat deployments | 31 of 203 | unchanged | skipped by the fingerprint once wired |
| Headroom to 10 GB | 1.68 GB | unchanged | 8.7 GB |
| Tests added | 0 | 90 deploy tests, 4 files; typecheck and the safety, architecture, secrets and template checks pass | |

**Verified savings in production: none.** The only measured saving is on a preview deployment.

## Disclosures

- **Production reads:** four read-only queries (item 1), through the guard, authorised.
- **Vercel:** GET requests for the inventory; five preview deployments created (three ready, two errored). The production alias
  was verified unchanged afterwards. The experiment secret was random, per deployment, never printed, kept in a 0600 file outside
  the repository.
- **Process slips against the repository's file-editing rule:** one Python replace script and `biome format --write` were used on
  new files under `scripts/deploy` and `tests/deploy` (read back and tested); and `sed -i … /dev/null` was typed twice by
  reflex, targeting no file. Everything else went through Edit or Write.
- **Repository lint** reports one pre-existing formatting error in `scripts/isolated/p3-cases/20-projects.ts`, which this work
  did not touch; the new files lint clean.
- `npm ci` was run to install dependencies in this container.

## Decisions needed from you

1. Approve, change or reject the deletion rule in item 4 (and say if any of the four documented release deployments must stay).
2. Approve deploying the `excludeFiles` change to production, with `deploy:hq`'s real-notebook probe as the acceptance step.
3. Approve wiring the fingerprint into the two deploy scripts, and whether to pin `notebooklm-py`.
4. Read the dashboard's Usage page (Deployment Storage and Functions Storage, by project) and send me the two numbers, so the
   inferred match to quantity 1, and whether the 10 GB is shared, can be settled.
