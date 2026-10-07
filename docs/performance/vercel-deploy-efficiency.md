# Vercel deploy efficiency: what was built, how each guarantee is proven, and how to roll it out

Branch `claude/eff-vercel-deploy`, 5 October 2026. **Everything here is local: nothing was deployed, no Vercel or Supabase call
was made, no deployment was deleted, no secret was read.** Every guarantee is proven by unit tests or local scripts. The
only figures that come from Vercel are the preview-experiment ones in
`vercel-storage-audit-2026-10-05.md`, and they are marked **EXPERIMENTAL / NOT DEPLOYED** wherever they appear below.

This follows the Vercel storage audit. It is separate from, and does not complete, the Supabase efficiency audit.

## 1. What was built

| # | Change | Where | Status |
|---|---|---|---|
| 1 | `excludeFiles` on both Python functions | `vercel.json`, `scripts/deploy/lib/function-exclude.ts` | In the repository; **NOT DEPLOYED** |
| 2 | A bundle-size budget test | `tests/deploy/function-bundle-budget.test.ts` | Runs in `npm test` |
| 3 | A deployment fingerprint and a fail-open skip | `scripts/deploy/lib/page-fingerprint.ts`, `page-deploy-guard.ts`, `page-files.ts` | Wired into `deploy:hq` and `deploy:hq-page`; **NOT DEPLOYED** (no deploy was run) |
| 4 | A preservation-first retention planner (proposals only) | `scripts/deploy/lib/vercel-retention.ts`, `scripts/vercel/vercel-storage-inventory.ts` | Read-only tooling; **has not been run** |

### 1.1 `excludeFiles`

Both functions carry `{*.css,*.html,*.js,studio/**,bc/**,fonts/**,logos/**,samples/**,textures/**,vendor/**}` (86
characters; Vercel refuses more than 256 with `INVALID_VERCEL_CONFIG`). It removes the static site, which every Python
function bundle otherwise carries a copy of, because the page deployment uploads the studio under `studio/` and again at the
root.

**Measured on a preview (EXPERIMENTAL, NOT DEPLOYED):** each bundle 21.49 to 17.16 MiB (-4,542,417 bytes, -20.2%); 15 of 15
requests identical to the unexcluded variant; a negative control that also excluded `scripts/**` failed exactly the one check
that needs `act.py`. Source: `vercel-storage-audit-2026-10-05.md` section 2.

**What the pattern must never match, and the proof.** `scripts/notebook/act.py` is spawned by `api/notebook-act.py` at run
time and is never excluded; nor are `api/*.py`, `requirements.txt` or `vercel.json`.

- It was re-derived against this tree, which has 108 tracked studio files (more than on 5 October). Every uploaded path is
  covered by the pattern except the runtime files (`uncovered(...)` is empty), so nothing is left in a bundle by an extension
  the pattern does not name. A new studio file type or directory fails that test until the pattern is extended; the bundle is
  then bigger, never broken.
- `tests/deploy/function-exclude.test.ts` enumerates **every tracked file in the repository** (`git ls-files`) and proves no
  `.py`, no `requirements*.txt`, no `vercel.json`, no `pyproject.toml`, nothing under `api/` and nothing under
  `scripts/notebook/` is matched; and that everything the pattern does match in the upload set comes from `web/studio`.
- The three Python sources contain no reference to a static asset (a test greps them), so none can be needed at run time.
- The real `vercel.json` must equal the configuration the preview experiment measured
  (`vercel-experiment/vercel.proposed.json`), so the measured behaviour is the behaviour that ships.

**Budget test.** For every `api/*.py` it requires a `functions` entry whose `excludeFiles` is this exact pattern and within
256 characters, no stale function key, and a modelled count of static bytes left in the bundle (computed from the real upload
set) of zero; and that the exclusion saves at least 3 MiB per function, so a budget of zero cannot pass on an empty tree.
**Sabotage:** removing `excludeFiles` from `api/notebook-act.py` (the `excludeFiles` count in `vercel.json` printed 1 instead of
2) turned 4 tests red in 2 files; restored byte-for-byte (`cmp` identical), green again. The sabotage is not in any commit.

### 1.2 The fingerprint and the skip

`deploy:hq` and `deploy:hq-page` now call `assessPageDeploy` (one function, one test suite) before creating a deployment.

**What it hashes** (schema version 2):

| Input class | How | Proof (a test changes it and the fingerprint changes) |
|---|---|---|
| Every uploaded file: page, assets, the two functions, `act.py`, `requirements.txt`, `vercel.json` | path and SHA-1 content digest | same-length edits to each class, so the digest and not the size is what is tested |
| The generated, gitignored `web/studio/config.js` | content digest if present | changed, and absent, both change it; fingerprint **after** `config:site` runs |
| Files added, removed, renamed | the path list | one test each |
| Request fields: name, target, projectSettings | included | one test each; the request and the fingerprint read the same constant |
| Project build settings (framework, build and install commands, node version, function region, ...) | read live from the project | node version and region tested |
| Environment variable **names** | read live | added, removed |
| Each variable's environments and type | read live, never values | re-scoped, retyped |
| For a variable the script does **not** supply: when Vercel last updated it | `updatedAt` | an edit by hand changes it |
| For a secret the script **does** supply (the notebook reader secret): a **salted SHA-256 of the value**, never the value | `envDigest` | rotation changes it; the value is never in a request, a log or a result |
| The algorithm | schema version | changing it changes it |
| `requirements.txt` pin state | reported (`unpinned`), file content hashed | not changed; see limits |

**The skip rule fails open.** It skips only when `project.targets.production.id` names a deployment that is `READY`, is not
marked as another target, and recorded exactly this fingerprint in `meta.pageFingerprint`. All of these deploy: no project, no
production deployment, state not READY, no `meta`, an empty, garbage or non-string fingerprint, a different algorithm version,
`--force`, any HTTP error, any response of an unexpected shape, a truncated environment list, an environment variable with no
update time, a tree that cannot be read. `assessPageDeploy` never throws. The reader it takes can only `GET`; the real one
(`makeVercelReader`) has no other method, and tests inject a fake: **no unit test makes an HTTP call.**

**The first deploy after this change deploys.** No live deployment holds a `pageFingerprint` yet, so the answer is "deploy";
that deployment records it. The next run, with the same inputs, is the first that can skip.

**Wiring (both scripts).** The file set comes from `page-files.ts` alone (no private list or walk; the previous copies could
drift). `deploy:hq-page` sends the digests of the same list it fingerprints. `deploy:hq` encodes the same bytes as before
(base64 for the binary extensions, UTF-8 otherwise). On a skip `deploy:hq-page` exits 0 and says so; `deploy:hq` skips only the
deployment request and still runs its reader and writer probes against the live page. Tests assert, structurally and with
controls: the assessment runs before the request; `--force` is passed; `meta` is sent; the skip returns before the request;
every environment variable the script sets is one it declares as supplied; the file set is the shared one.

**Other scripts that create a Vercel deployment** were found by scanning `scripts/deploy`: `site.ts`
(`agentic-team-hq-basecamp`, previews), `vercel.ts` (`ai-team-hq-voice`, static) and `ux-review-preview.ts` (a throwaway review).
They are different projects with no Python functions, and a skip would be wrong for previews, so they are **deliberately not
wired**; a test names each with its reason and fails if a new creator appears without either.

**Sabotage, each confirmed to have landed before reading the result:** a `decideSkip` that never compares fingerprints turned
12 tests red; a guard that digests a constant instead of the secret turned the rotation test red (an earlier sabotage that kept
the length failed to turn it red, which is why the test and sabotage were made stricter); removing `...deploymentMeta` from
`hq.ts` and defeating the skip branch in `hq-page-delta.ts` turned 2 wiring tests red; and in-file controls show that a
fingerprint ignoring one input class (content digests, secret digests, update times, project settings) misses that mutation.

### 1.3 Retention planner (proposal only)

Keep, in order of reading: the live deployment; anything with an alias; the newest 15 `READY` production deployments; every
`READY` production deployment of the last 7 days; the **last `READY` production deployment of each UTC day for the previous 30
days**; every deployment id named in a tracked document; ids named with `--keep`. Everything else is a candidate. A `READY`
production deployment is the only kind a rollback can use, so previews and failed builds are kept only through an alias or a
document.

`assertSafe` refuses to emit a list that breaks any clause (live, alias, newest 15, window, daily keeper, document id, reviewer
name, duplicate id, missing live deployment, totals that do not add up); each refusal has a control that builds the bad list.

**The planner cannot delete.** The library imports nothing (no client, no filesystem, no network) and names no request method.
The inventory script imports `require-production-checks`, `node:child_process` (for `git grep`), `node:fs` and the library,
issues requests only through one `get` function and contains no `method:`, `DELETE`, `POST`, `PUT` or `PATCH`. A test asserts all
of that and a control shows the assertion can fail. There is no deletion tool in this change, by design.

**Offline check against the saved 5 October inventory** (241 deployments, 7.753 GiB), with the 5 October 16:24 UTC clock and
the 22 deployments that tracked documents then named. **Computed from a CSV, not from Vercel; the clock moves the result.**

| | Deployments | Function bytes |
|---|---:|---:|
| Inventory | 241 | 7.753 GiB |
| KEEP | **49** | **1.843 GiB** |
| DELETE (candidates) | **192** | **5.911 GiB** (76.2%) |

The 49 are: 1 live, 1 aliased (the same one), 15 newest, 28 in the 7-day window (overlapping the 15), 27 daily keepers and 22
named in documents (reasons overlap; a deployment may have several). The earlier rule (live, newest 15, window) kept 28; the
four release records that it would have deleted are kept now (a test asserts it). The test also runs the narrower rule over the
same data as a control, so 49 is the new clauses and not the data.

Document ids are gathered by `git grep` over `docs` and every `*.md`, outside `docs/performance` (the audit and this note name
experiment deployments as evidence, not as records that depend on them).

## 2. Tests

`npx vitest run tests/deploy`: 6 files, 192 tests, all passing (the four pre-existing `bundle` tests included). New or changed:
`function-exclude`, `function-bundle-budget`, `page-fingerprint`, `page-deploy-guard`, `vercel-retention`. `npx tsc --noEmit`,
`npx biome ci` on the changed files, `npm run check:secrets` and `npm run check:templates` pass. `tests/safety` and
`tests/architecture` (78 tests) pass. The full `npm test` has two known pre-existing failures that were not touched.

## 3. Limits and what could not be verified

- **Not exercised against Vercel.** The shapes of `GET /v9/projects`, `/v9/projects/{id}/env` and `/v13/deployments/{id}` (the
  `readyState`, `meta`, `target`, and per-variable `updatedAt`, `target`, `type` fields) are taken from the earlier audit and
  Vercel's documented API; the guard is written to deploy if any is missing, so a wrong assumption costs a skipped optimisation,
  never a missed deployment. Whether `meta` set on a deployment is returned by the read is UNVERIFIED until the first real
  deploy; if it is not, the run after it will deploy again and the log will say "recorded no fingerprint".
- **An unpinned dependency is invisible.** `requirements.txt` says `notebooklm-py` with no version, so identical inputs can build
  to a different bundle, and a skip means a new release is picked up at the next real change. `requirements.txt` was **not**
  changed; every run prints the unpinned lines. Pinning is a decision for a person.
- Vercel's own build image, team-level settings and a deployment-protection change are outside the inputs; none changes what a
  deployment serves.
- **The two scripts do not share a fingerprint.** `deploy:hq` supplies the reader secret and so records a digest; `deploy:hq-page`
  supplies none and reads that variable's update time instead. After the other script has run, the next run deploys once
  (the safe direction). `deploy:hq` also upserts the secret each run, which moves its update time and so makes the next
  `deploy:hq-page` deploy once. Use one script consistently to get repeated skips.
- **`deploy:hq` writes a text file as UTF-8** for extensions outside its binary list (for example the studio's `.wav` and `.zip`),
  exactly as before this change; the fingerprint is over the source bytes and is unaffected. This is an existing behaviour, not
  changed, and probably worth a look separately.
- The skip needs the live deployment to have been made by a script that records the fingerprint; a deployment made by hand or
  by `deploy:preview` does not, so the next run deploys.
- **The real-notebook probe for the exclusion lives only in `deploy:hq`.** `deploy:hq-page` checks that the new page is served but
  does not call the reader or writer. `deploy:hq`'s page step is known to exceed Vercel's 10 MB request limit (the reason
  `hq-page-delta` exists). So the acceptance step for the exclusion needs a decision (see section 4, step 5).

**Attempts to break the fingerprint** (every one has a test unless stated): editing a file without changing its length; adding,
removing, renaming a file; deleting the generated `config.js`; changing `vercel.json` or `requirements.txt`; changing a
request field; changing a project setting; adding or removing an environment variable; editing a variable by hand without
changing its name; re-scoping or retyping the secret (**this one the first version missed**; it is now covered); rotating the
secret; a live deployment that is not READY, not production, has no meta, has a garbage fingerprint or an older algorithm
version; every kind of failed or malformed read. Not covered, by design: unpinned dependency releases and the build image.
Changes that must **not** change it, and do not: file times, rewriting identical bytes, input order, files under `raw/`.

## 4. Rollout, for later human approval (nothing below has been done)

Every step that touches production needs a person to set the production flags for that one operation, as `CLAUDE.md` requires.

1. **Review and merge** `claude/eff-vercel-deploy` into the integration branch. Nothing deploys on merge (GitHub Actions are off).
2. **Dry run.** `npm run config:site`, then `npx tsx scripts/deploy/hq-page-delta.ts` (no `--go`). Expect: the file count,
   `fingerprint: ... deploy (the live deployment recorded no fingerprint ...)`, the unpinned-requirements line, `dry run`.
   That script's gate requires the write flag even for a dry run.
3. **First deploy, with the exclusion.** `npx tsx scripts/deploy/hq-page-delta.ts --go`. It deploys because no fingerprint is
   recorded, and records one. Note the printed rollback point (the previous deployment).
4. **Check the bundle on the build output** (a Vercel GET): each Python function should be about 17.2 MiB, not about 21.5
   (**EXPERIMENTAL figures from a preview**; the real number is the acceptance evidence).
5. **Acceptance of `act.py` and the reader against a real notebook.** Decide how: either run the read and write probes that
   `deploy:hq` performs (they need the reader secret from the vault and the stored cookie jar) against the new deployment, or
   add the same probe to `hq-page-delta` as a separate change. Do not accept the exclusion on "the page loads" alone: the one
   behaviour the exclusion could break is `act.py` being found by the writer.
6. **Prove the skip.** Run `hq-page-delta.ts --go` again with no change. Expect `SKIP`, `nothing to deploy`, exit 0, and no new
   deployment in the project list. Then change one studio byte and confirm it deploys. If the first run did not record the
   fingerprint, the log says so and nothing is lost.
7. **Retention (separate approval).** With the read flag, `npx tsx scripts/vercel/vercel-storage-inventory.ts --out=<file>.csv`
   (GET only). Review the CSV; add `--keep=<id>` for anything else to preserve; regenerate (the window and the newest 15 move with
   the clock). Nothing in this change deletes: removal is a separate, explicitly approved act, with a tool that must be written
   and reviewed on its own. Deleted deployments are recoverable for 30 days per Vercel (UNVERIFIED whether they still count
   towards usage meanwhile).
8. **Rollback.** Promote the printed previous deployment, and revert the `vercel.json` commit if the exclusion is at fault.

## 5. Decisions this leaves to a person

1. Approve the rollout above, and choose the acceptance probe for `act.py` (step 5).
2. Whether to pin `notebooklm-py` (changes `requirements.txt`, not done here).
3. Whether to wire the fingerprint into any other deploy script (none is recommended).
4. The retention rule, in particular 30 daily keepers and the exclusion of `docs/performance` from the document-id scan.
