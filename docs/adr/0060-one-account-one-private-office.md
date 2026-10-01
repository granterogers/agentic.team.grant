# 0060 - one auth account, one private office, many projects

Status: **proposed** (multi-user research, 1 October 2026). Becomes accepted when the implementation session is
authorised. Baseline `41de1965`. Full design: `docs/multi-user/ARCHITECTURE.md`.

## Context

The office has one owner. Nothing in the schema says whose a row is: 0 of 129 tables carry a tenant, account, user or
organisation column; all 117 RLS policies are `using (true)`; the gateway holds the service key and the database never
sees who is asking; ownership is enforced by one bearer token and the gateway's code. That was correct for one person
and is the thing that must change before a second person has an office of their own. The product requirement is
deliberately small: **one auth account → one private Agentic Team office → many projects**, with no organisations,
shared workspaces, memberships, tenant switching or roles. Issue #399 (row policies for the 43/46 tables 0642 closed
to a public key) was deferred to this decision.

No prior multi-user implementation exists in the repository (`LEGACY-BRANCH-REVIEW.md`), so there is nothing to port.

## Decision

1. **The ownership primitive is a row in `public.offices`**, with its own `office_id uuid` and a `unique(auth_user_id)`
   reference to `auth.users`. One auth account owns at most one office. `kind` is `person | sample | test`; `state` is
   `active | disabled`.
2. **A person is identified by their auth user id, never their email.** Email is a login credential. An unknown,
   disabled, missing or duplicated binding fails closed.
3. **`office_id` is written, `NOT NULL` and immutable on the carriers** — roots, press targets, retrieval-critical
   tables and bindings (50 of 129 tables). Everything else derives ownership through a foreign key. A carried column
   beside a parent key is made unable to disagree by **composite foreign keys** `(parent_id, office_id)`.
4. **Every function reached by a person, a channel or a worker takes a required `p_office` with no default**, supplied by
   trusted code from a verified session or a durable row, never from a request, and verifies every id it receives
   against it. A job-derived function derives the office from the job. A miss and a foreign row are indistinguishable.
5. **RLS is turned on for all 46 tables and given an office policy on the 56 private ones; it is a backstop, not the
   boundary.** The gateway and worker bypass RLS by role. `anon` and `authenticated` get no policy and no grant, ever.
6. **Test containment is derived from `offices.kind`**, joined at the one question both external boundaries ask
   (`app.may_act_outside`), never copied onto rows.
7. **The shared staff roster, the capability catalogue and the autonomy matrix with its level-3 floor stay global.**
   Everything they *learn, hold or are granted* is office-owned.
8. **Nothing about organisations, memberships, invitations, roles or tenant switching is built.**

## Alternatives considered

Scored on the brief's criteria (✓ good, ~ acceptable, ✗ poor).

| Criterion | **A. `offices` row, own key (chosen)** | B. auth uid as the key everywhere | C. reuse `office_members.owner_key` | D. one deployment per user | E. organisation + membership |
|---|:-:|:-:|:-:|:-:|:-:|
| Schema disruption | ~ (50 carriers) | ~ (same) | ✓ (a text column) | ✓ (none) | ✗ (more tables, more joins) |
| RLS / FK simplicity | ✓ composite FKs | ✓ composite FKs | ✗ text has no FK, so no structural guarantee | ✓ (nothing to isolate) | ✗ membership joins in every policy |
| FK integrity | ✓ | ✓ | ✗ | n/a | ~ |
| Workers | ✓ `office_id` on the job | ✓ | ✗ `requested_by` text | ✓ | ✗ |
| Integrations / credentials | ✓ per-office slot | ✓ | ✗ | ✓ but N copies | ✓ |
| Retrieval | ✓ one indexed predicate | ✓ | ✗ | ✓ | ~ |
| Migration of Grant | ✓ derive from existing mapping | ✓ | ✓ | ✓ | ✗ |
| Testing (A-vs-B in one DB) | ✓ | ✓ | ✗ | ✗ cannot test isolation, only separation | ✓ |
| Recoverability if the identity is recreated | ✓ one `UPDATE` | ✗ re-key ~130k rows | n/a | n/a | ✓ |
| Test/Sample classification | ✓ `kind` | ✗ needs a side table | ✗ | ✗ | ~ |
| Cost at the free tier | ✓ | ✓ | ✓ | ✗ a Supabase + Vercel + worker per person | ✓ |
| Future safety | ✓ | ✓ | ✗ mutable string, global `'grant'` default | ~ | ~ over-built |

- **B** is what A would be if the identity provider were permanent. It is rejected for one reason that matters: the
  key would be baked into every row and tied to `auth.users`' lifecycle, so replacing an auth identity would be a
  data migration rather than an `UPDATE`. It also gives the Sample/test classification nowhere to live.
- **C** is the existing mechanism: email-keyed `office_members`, `owner_key` text defaulting to `'grant'`, and nine
  layout tables with a text `owner`. It cannot carry a foreign key and its default *is* the global fallback this
  decision exists to remove.
- **D** (`fresh-install-onboarding`) answers *"can a new person stand up their own copy"*, not *"can a second person
  use this product"*, and it cannot host the Sample User **inside** the product being accepted. Its setup contract
  remains valuable and is unaffected.
- **E** is the generic SaaS framework the brief rules out. It would put a membership join in every policy to express a
  relation that has one possible shape.

## Consequences

- **Good.** Cross-office relationships become impossible to *store*, for every writer including the service role.
  Classification survives retries, children and restarts without a flag. Grant's migration is derived from data the
  system already holds. The Sample User is the same code path as Grant.
- **Costly.** ~41 new columns, ~14 re-scoped unique indexes, every id-taking function gains a parameter (a wave of
  conversions), and a one-time backfill into append-only ledgers that needs a sanctioned trigger suspension.
- **Not solved by this decision, stated plainly.** RLS cannot bound `postgres`/`service_role`; the protection for
  those paths is the composite foreign keys, the required `p_office`, and the isolation suite. A converted function
  that receives `p_office` and ignores it is invisible to a signature check — only a per-function attack finds it,
  which is why the plan requires one for each.
- **Binds the future.** A feature that wants *shared* offices (two humans, one office) would have to introduce the
  membership table this decision omits. That is a new ADR with evidence, not a quiet extension.
- **Does not reopen** ADR-0054 (principals), ADR-0055/0056 (job and message provenance) or ADR-0059 (the seven
  policies); it narrows what each reads.

## Open decisions (recommended defaults, not questions)

D1 harness traffic stays in Grant's office with its flags; new suites use test offices · D2 the test principal and the
quarantine share one test office · D3 system `events` with no derivable office carry a null `office_id` constrained to
`actor = 'system'`, never Grant · D4 moving Grant's fixed-name Vault secrets behind refs is a separate,
operator-confirmed step · D5 Telegram/Slack linking is operator-provisioned in V1.
