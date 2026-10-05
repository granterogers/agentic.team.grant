# Legacy branch review — what multi-user work already exists

> Research only. Baseline `origin/main` = `41de1965` (1 October 2026). Nothing was merged, rebased or cherry-picked.

## 1. The headline: the branch the brief describes is not in this repository

The brief refers to *"the historical multi-user branch"* that *"predates substantial architectural hardening."*
**No such implementation exists in any reachable ref of `granterogers/agentic.team.grant`.** This is the most
important finding of Phase 1 and it is stated plainly because the rest of the brief assumes the opposite.

What was searched, and what each search returned:

| Search | Scope | Result |
|---|---|---|
| Branch inventory | all 27 `origin/*` refs, fetched fresh | no branch is named or described as multi-user, tenancy, account, workspace or organization work |
| Commit messages | `git log --all -i -E --grep='multi-?user\|multi-?tenant\|tenant\|tenancy\|workspace\|membership\|sample user\|demo'` | hits are about *workspace* as a UI word ("The project home becomes a workspace"), the Slack *workspace* binding (0630), and fresh-install onboarding — none implement per-user ownership |
| Schema | `git grep` for `tenant_id`, `account_id`, `org_id`, `user_id`, `owner_id`, `auth.uid()` in `migrations/`, `src/`, `supabase/` across every branch | **zero hits in migrations or source on any branch**; the only `auth.uid()` is a stub in `scripts/isolated/platform.sql` for the local replica |
| Pull requests | GitHub search `multi-user tenant account workspace` | 0 results |
| Issues | GitHub search `multi-user tenant account ownership RLS onboarding sample user` | 0 results; **#399** (row policies, deferred to this phase) is the only related issue |
| Docs | `grep -ril 'multi-user\|tenant'` | four mentions, all *deferring* the question: `FINAL-OPEN-FINDINGS-TRIAGE.md:72` ("Invariant 40: Single-user product. A tenant/user seam is future architecture"), ADR-0059, `373-project-provenance.md` ("Multi-user" section) and `HANDOFF.md` |

**Possible explanations, none verifiable from here:** the branch lives in a different repository; it was local to a
machine and never pushed; it was deleted (not checked: this session's tools list branches but not deleted refs); or it is the
`fresh-install-onboarding` workstream, which is about a *second deployment*, not a second user (§3, item F).

**What this changes about the plan.** Nothing blocks, because the design in this folder is derived from `41de1965`
and the brief already says that baseline wins every conflict. It does mean there is **no legacy schema, RLS or test
suite to salvage** — only the adjacent artefacts below. If a branch does exist elsewhere, point the implementation
session at it and run it through §4's classification before using any of it; nothing in the design depends on its
absence.

## 2. Repository history facts that affect any archaeology

- `origin/main` has **54 commits**; every other branch shares **no merge-base** with it (`git merge-base` returns
  nothing). `main` was re-rooted, so "commits ahead/behind `41de1965`" for other branches is meaningless (1,000–1,500
  "ahead" is the whole of their separate histories). A branch's age is the only comparable fact.
- `origin/claude/great-volta-v77py4` is `41de1965` itself.
- `architecture-run-4-lifecycle` and `-5-binding` are 0 ahead of main (fully contained).
- Migrations on branches beyond main's are historical artefacts of branch-time numbering collisions (CLAUDE.md records
  0539, 0543, 0577, 0584 as cross-branch collisions).

## 3. The nearest historical artefacts, in order of relevance

| # | Artefact | Where | Age | What it actually is |
|---|---|---|---|---|
| A | **`office_members`** + the `signin` function + gateway session verification | migration 0580, ADR-0043, `a1a2b534` (23 Sep) — **already in `main`** | 8 days | "A person signs in; a machine presents a key." A *gate*, not ownership: email-keyed allow-list with a free-text `owner_key` defaulting to `'grant'` |
| B | **Principal kinds** `person` / `harness` / `service`, `SERVICE_MAY`, `app.principal_refusal`, `app.authority_refusal` | 0608, 0614, 0615, ADR-0054 — in `main` | 1 day | Who *answered*. Explicitly "does not say whose the work is" |
| C | **Text `owner` columns** on 9 layout/preference tables | ADR-0021, 0380, 0381 — in `main` | ~3 weeks | A per-person key defaulting to `'grant'`; the first, partial attempt at the concept |
| D | **373 project provenance** "Multi-user" section | `docs/design/373-project-provenance.md` | 3 days | One paragraph: *"the project is a claim the page makes and the office validates, never a fact the adapter trusts."* The right invariant, stated before there was anything to enforce it |
| E | **Isolated replica** (`scripts/isolated/replica.sh`, `platform.sql`, 74 proof scripts) | `main` | 1 week | Builds the full schema from migrations into local Postgres with real role shapes (`service_role` BYPASSRLS). **Not multi-user work, but exactly the instrument a two-user suite needs** |
| F | **`claude/fresh-install-onboarding`** | branch, 22 Sep, 916 commits on a separate history | 9 days | "Can a genuinely new person, with no Grant-specific infrastructure… take this repository from zero to a running office?" — a **second deployment** per person, not a second person in one deployment. Produced the setup contract, `doctor`, and ADR-0048 (the dashboard resolves its own office) |
| G | **Prototype mode** in `web/studio` (invented projects when no token) and `web/studio/samples/` | `main` | long-standing | A UI-only demo. Not an architecture, not a user |
| H | `trial/integration-*`, `three-branch-reconnaissance` | branches / docs | 23–24 Sep | integration trials of unrelated workstreams |

## 4. Forensic questions from the brief, answered from what exists

| Question | Answer |
|---|---|
| **Authentication — how were users identified?** | Supabase Auth email session, then `office_members(email)`. The mapping from person to anything is `owner_key`, a free string. Not an auth UID. |
| **Ownership basis** | Neither UID, nor tenant membership: an email allow-list. |
| **One user → one tenant, or many?** | There is no tenant. The deployment is the tenant (one operator). |
| **Tables with `user_id` / `tenant_id` / `workspace_id` / `account_id`** | None. 9 tables have text `owner`; 1 has `owner_key`. |
| **RLS** | 117 policies, all `using (true)`, role `ai_team_app` (116) / `service_role` (1). Identifiers are guessable only in the sense that nothing checks them: the gateway trusts a caller-supplied `p_project_id`, `p_job_id`, `p_blocker_id` for any signed-in member. |
| **Could service-role code bypass isolation?** | There is no isolation to bypass. The service key *is* the gateway. |
| **Workers — ownership through jobs, children, retries, pause, defer, scheduled work** | None carried. `requested_by` is a text string; children copy it; `enqueue_child` accepts any `p_project`. 0619 added immutable `root_job_id`/`origin_*` — the nearest anchor and the thing `office_id` extends. |
| **Retrieval scoped before model context?** | Scoped by project only; `search_documents` with a null project searches the whole deployment. |
| **Credentials user-scoped?** | No: fixed Vault names are deployment singletons (`google.refresh_token`, `notion.integration_token`, …). The ref-based tables (`slack_app_credentials`, `mcp_providers`, `browser_sessions`) are the good pattern to extend. |
| **Slack / Telegram / voice → user** | `subject_identities(origin_channel, actor) → subject text`, seeded with one `grant`. Voice maps every signed-in member to env `VOICE_SUBJECT='grant'`. |
| **UI — onboarding / account / project** | A sign-in page and a project switcher. No account or onboarding flow for a second person. |
| **Demo / sample — was there a seeded user?** | No seeded user. `office_members` seeds Grant; the `verify-operator` test member exists; the prototype mode is UI-only. |
| **Tests — genuine A-versus-B isolation?** | None. No suite creates two principals with colliding data and attacks across them. `verify:addressing`/`approver-identity` prove *who answered*, not *whose it was*. |

## 5. Classification of what could be reused

| Item | Class | Reason |
|---|---|---|
| Session verification at the gateway (`GET /auth/v1/user`, nothing decodes the JWT) | **PORT CANDIDATE** — already in `main` | keep as is; change only what it resolves *to* (auth uid → `offices`, not email → `owner_key`) |
| Principal kinds and `SERVICE_MAY` allow-list (ADR-0054) | **PORT CANDIDATE** — in `main` | compatible; the machine key stays a machine and names an office explicitly |
| 0619 write-once `root_job_id` / `origin_*` trigger | **PORT CANDIDATE** — in `main` | extend the same trigger to `office_id` |
| `app.harness_job`, `app.job_origin`, `app.adapter_key_ok`, `test_origins` | **PORT CANDIDATE** — in `main` | stay; `offices.kind` becomes the primary classifier for *new* test traffic and these remain for historical rows |
| Isolated replica + `guard.ts` + `policy-sabotage.sh` | **PORT CANDIDATE** — in `main` | the platform for the A/B suite and its sabotage runs |
| Vault ref pattern (`app.store_secret`, `app.resolve_secret(uuid)`, `credential_ref` columns) | **PORT CANDIDATE** — in `main` | extend with `office_credentials` |
| `office_members` table (email PK, `owner_key` default `'grant'`) | **OBSOLETE** for multi-user, **UNSAFE** as an ownership key | email is mutable; the default is a global fallback; retired in the last phase |
| Text `owner` columns | **CONCEPT ONLY** | right idea (per-person layout), wrong key; replaced by `office_id`, same tables |
| 373 "validate the project against the caller" | **CONCEPT ONLY → becomes the design** | §10 of ARCHITECTURE |
| Fixed-name Vault slots | **UNSAFE** for a second human | a second connect overwrites the first silently |
| `VOICE_SUBJECT` env, `telegram.direct_to_grant`, the seven hard-coded `'grant'` literals | **UNSAFE** | each is a global Grant fallback |
| `fresh-install-onboarding` (one deployment per person) | **OVER-ENGINEERED FOR V1** as an answer to *"second user"*; **CONCEPT ONLY** for the setup contract | a deployment per person costs a Supabase project, a Vercel project, a Vault and a worker each; it also cannot give the Sample User an acceptance environment *inside* the product being accepted. Rejected in ADR-0060 |
| Prototype/demo mode and `web/studio/samples` | **UNSAFE** as the acceptance environment, **PORT** the sample files as fixtures | demo behaviour bypasses the architecture, which is exactly what the brief forbids |
| Organizations / memberships / invitations / roles | **OVER-ENGINEERED FOR V1** — and not present anywhere to port | |

## 6. What the implementation session should take from this

1. Treat the absence of a legacy implementation as a feature: **there is no inherited authorization assumption to
   unpick.** Every guarantee in `41de1965` (ADR-0049 two chokepoints for test traffic, ADR-0054 principals, ADR-0055
   a job remembers where it came from, ADR-0056 a message names its question, ADR-0059 policies) stands unchanged
   and the design narrows what they read.
2. Do not trust the fresh-install branch's ownership-adjacent work for anything but its setup contract and `doctor`.
3. If a real multi-user branch is found elsewhere, the first act is a diff of its schema against
   `TABLE-REVIEW-399.md` and a run of its tests against the A/B attacks in `ACCEPTANCE-PLAN.md`. A branch whose
   tests cannot be turned red by the sabotage plan is archaeology, not a base.
