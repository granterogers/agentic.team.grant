# Staging plan and rollback: the aesthetic release candidate

Candidate: branch `integration/aesthetic-release-candidate` (see the head in `aesthetic-main-reconciliation.md`). **Nothing here has been run.**
No staging deployment was made, no production alias was created, production was not contacted, and nothing was merged to `main`.

## 1. What a deployment of this candidate changes

Against `origin/main` (3caaebf) the candidate changes **24 files under `web/studio/` and nothing else that ships**: no migration, no `src/`, no
`supabase/` function, no worker, no environment variable. The rest of the diff is tests, QA tooling and documentation.

So the only artefact to release is the **static Team HQ page** (hosted on Vercel; `hq-api` and every other function stay as they are).
Consequences:
- No database step, and therefore no migration rollback. Production's ledger (814 applied, `migrations/applied.json`) is untouched.
- Persisted browser state is additive: `studio.appearance` (localStorage) gains the optional keys `look`, `glass`, `depth`; an older value without them
  reads as the defaults (Original, Soft, Soft). `bg`, layout and note storage are unchanged. A person who rolls back keeps working: the older page ignores the
  extra keys.
- Layout rows in the office (`hq_layout` / `layout_board`) are not altered by this branch.

## 2. What is verified without any deployment

See `aesthetic-main-reconciliation.md` section 4 for the numbers. In one line: typecheck, lint, 6,843 unit tests, the maintained replica gate (68 critical and
73 extended proofs), main's three real-page browser proofs (My Tasks series, chat dock, combined shell as a person and as a Sample visitor at nine
viewports) and the aesthetic QA (289) are green on the candidate.

## 3. What staging must still prove (and this environment cannot)

1. The page served by a real host: fonts, CSP, caching headers, the HTTPS-only behaviours (the sandbox browser cannot reach public origins without
   `npm run trust:proxy-ca`, and the local server is HTTP).
2. A **real signed-in office with real data** through the deployed gateway: long task lists, many contacts, a real Google-connected calendar, large documents.
   (The isolated replica is real code and real SQL but not real data.)
3. A real phone: iOS Safari (keyboard resize, safe-area insets, the 16px input rule, momentum scroll over the board), and a real microphone for dictation and
   live voice. None of these is testable here.
4. Real Telegram / Slack / voice-note round trips (the candidate does not touch them; run the existing acceptance only to confirm the page still drives them).

## 4. Preconditions before any deployment (check, do not assume)

| Check | How |
|---|---|
| Target is not production | `TARGET_ENVIRONMENT=staging`; `npm run staging:preflight` prints `STAGING PREFLIGHT PASSED`; `docs/staging-handoff-plan.md` sections C and E apply |
| Database destination | none: this candidate does not write to a database; the staged page must be pointed at the **staging** gateway (`SUPABASE_FUNCTIONS_URL` / project ref of the staging project) |
| Environment | `VERCEL_TOKEN` for a **separate preview project**, never the production project; no production identifiers in the shell |
| Cost | a Vercel preview on the free Hobby plan is £0; no new paid dependency |
| Real users | a preview URL is unlisted and unaliased; it must not be attached to the production domain, and the preview must not be given the production gateway |
| Rollback ready | section 6 |

What exists in the repository, and what each can and cannot do:

| Mechanism | Isolation | Good for | Not good for |
|---|---|---|---|
| `npm run deploy:ux-review` (`scripts/deploy/ux-review-preview.ts`) | its **own** Vercel project `team-hq-ux-review`; uploads `web/studio` only; no secret, no environment variable, no SSO setting, no allow-list, no function; cannot move an alias or a setting of `ai-team-hq` | a **signed-out** look at the candidate on a real host (fonts, headers, HTTPS, a real phone's browser): the page shows the example projects and cannot sign in | anything that needs an office |
| the staging project in `docs/staging-handoff-plan.md` (separate Supabase, separate Vercel preview, separate credentials) | a full stage | signed-in checks against real services | it does not exist yet (it needs Grant to create it) |
| `npm run deploy:hq` / `deploy:page` | **production** (`ai-team-hq`; `deploy:hq` also redeploys `hq-api` and touches the access token) | not for this candidate | never use for staging |

No Vercel token, staging project or authorisation was available in this session, and `deploy:ux-review` is a write the production-access guard governs
(`require-production-writes`), so **no preview artefact was produced and none was deployed**. It is the first thing to run once Grant says go.

## 5. Exact commands, for when staging is authorised (not executed)

Step 1, a signed-out preview on a real host (isolated; the deploy writes nothing but its own project):

```
git fetch origin integration/aesthetic-release-candidate
git checkout integration/aesthetic-release-candidate
git status --short && git log -1 --format=%H        # tree must be clean and the commit pushed (ADR-0067)
git diff --stat origin/main HEAD -- web              # the page is main's plus these 24 web/studio files
export VERCEL_TOKEN=<token for the account that owns team-hq-ux-review>
ALLOW_PRODUCTION_WRITES=1 npm run deploy:ux-review   # the guard names this as a write: set the flag ONLY for this command, with Grant's say-so
```

Open the printed `team-hq-ux-review` URL on a desktop and on a real iPhone (Safari) and walk section 3 items 1 and 3.

Step 2, signed-in staging (only once the staging project exists; follow `docs/staging-handoff-plan.md` C and E):

```
export TARGET_ENVIRONMENT=staging                    # in a shell holding ONLY staging values
npm run staging:preflight                            # must print STAGING PREFLIGHT PASSED
```

then deploy the page from this branch to the staging preview project and walk section 3 as the Sample Person (`npm run sample:tour`,
`sample:release-acceptance`) and as a real test office. No migration is involved in either step.

## 6. Rollback

The candidate is one merge commit on its own branch, so every form of rollback is a plain revert or a redeploy of the previous page; no history is rewritten.

| Situation | Action |
|---|---|
| Not yet merged | do nothing; delete nothing. `main` is untouched and the aesthetic branch `claude/lucid-mendel-ubvlk4` (a7eae0e) is intact |
| Merged to `main`, not deployed | `git revert -m 1 <merge commit>` on `main` (a new commit; does not rewrite history) |
| Deployed, a defect is found | redeploy the previous page: the production deployment that preceded it is retained by Vercel (promote it from the Vercel dashboard / `vercel rollback`), or deploy `origin/main` as it was before the merge with the same deploy command. The release is page-only, so no function, worker or database rollback is needed |
| A person's saved appearance misbehaves | the keys are additive; clearing `studio.appearance` returns them to the defaults, and nothing is lost server-side |
| Layouts | not changed by this candidate (a person's saved arrangement and "Before fitting" copies are untouched) |

**Migrations or persisted state needing special handling: none.**
