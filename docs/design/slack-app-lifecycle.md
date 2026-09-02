# Slack app lifecycle automation and config-token rotation

**Status:** Accepted — directive from Grant, 2026-09-02, corroborated by independent research
**Spec sections:** §19 (Slack), §26 (Secrets/Connections), §27 Gate 4, §28 Phase 2/7
**Evidence:** `docs/research/slack-telegram.md`

---

## Provenance

Grant issued this as a direct instruction. The Slack/Telegram research pass,
run independently and concurrently, reached the same conclusions from Slack's
current documentation — same 12-hour expiry, same `tooling.tokens.rotate`
mechanism, same both-tokens-rotate behaviour, same single-use refresh token.
Two independent derivations agreeing is the strongest signal we have on this,
so it is recorded as **accepted**, not provisional.

**Standing principle it establishes:** do not have Grant manually create Slack
apps or walk OAuth & Permissions screens. Automate app lifecycle via the
manifest APIs. Human involvement is limited to what is genuinely human-only.

---

## The one human-only step

Grant does this **once**:

1. Go to <https://api.slack.com/apps>.
2. Scroll **below** the app list to **"Your App Configuration Tokens"** →
   **Generate Token**, selecting the AI Team HQ workspace.
3. This yields **two** values, both of which Grant provides:
   - config token — `SLACK_APP_CONFIG_TOKEN`, format `xoxe.xoxp-…`
   - refresh token — format `xoxe-…`

Scope characteristics that matter for the design:

- Scoped to **one user + one workspace**.
- Works across **all apps in that workspace** — it does **not** need
  regenerating per app or per staff member. So one bootstrap covers all eight
  staff apps.

---

## The constraint that must be built before anything else

> **The config token expires 12 hours after generation.**

Rotation must therefore exist **before** manifest automation is implemented, not
after. Requirements:

1. Call `tooling.tokens.rotate` with the stored `refresh_token` **proactively,
   before expiry** — never reactively after a call has already failed.
2. **Both values rotate on every call.** Store the new `token` *and* the new
   `refresh_token`. **The old refresh token is single-use** — losing the new one
   means falling back to the manual UI step, which defeats the purpose.
3. Persist current token, current refresh token, and issued/expiry timestamps in
   **Supabase, encrypted**.
4. A **scheduled job rotates every 6–8 hours**, comfortably inside the 12-hour
   window, so long-running automation cannot silently fail mid-session.

### Correction to the directive, for the record

Grant's note said to persist these "not just in `.secrets.local`". There is **no
`.secrets.local` in this project at all** — the spec's "Development Environment:
Fully Cloud-Based" section removed it, because such a file only makes sense when
a session runs on someone's own machine, which never happens here. The intent
is honoured and sharpened:

- **Bootstrap** (the two values Grant generates) → Claude Code cloud
  environment's Environment variables, later migrated to API credentials.
- **Operational, rotating state** (current token, refresh token, timestamps) →
  Supabase, encrypted. This is the correct home because rotation is a runtime
  behaviour of the deployed system, not a build-time input.

This matters beyond pedantry: a rotating credential **cannot** live in a static
config store, because the store would go stale within 12 hours.

---

## Two distinct credential families — do not conflate

The research flagged this as an easy and damaging mistake, and Grant's note
calls it out too:

| | Config token | Per-app credentials |
|---|---|---|
| Scope | one user + one workspace, **all apps** | **one specific app** |
| Lifetime | **12 hours**, rotating | long-lived |
| Purpose | create/modify app configuration | run the app at runtime |
| Obtained | manual UI bootstrap, then `tooling.tokens.rotate` | issued on app install |

Per-app credentials, captured and stored **per app** after
`apps.manifest.create` and installation:

- `SLACK_BOT_TOKEN` (`xoxb-…`) — issued on install
- `SLACK_SIGNING_SECRET` — issued with the app
- `SLACK_APP_TOKEN` (`xapp-…`) — **only** if the manifest enables Socket Mode
  with `connections:write`

On that last one, see [Socket Mode](#socket-mode-not-used) — we do not expect to
need it.

---

## Credential storage architecture

**Directive from Grant, 2026-09-02. Accepted.** This section is the reasoning
that `docs/architecture.md` must carry under its Slack integration section, so a
future developer or coding agent does not "fix" this by flattening it back into
environment variables.

### The rule

> **One row per Slack app, not one flat environment variable.**

Only the **human-provided config token pair** belongs in the bootstrap store:

```
SLACK_APP_CONFIG_TOKEN=
SLACK_APP_CONFIG_REFRESH_TOKEN=
```

`SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET` and `SLACK_APP_TOKEN` must **not** be
declared as blank environment variables anywhere.

### Why — the reasoning a future maintainer needs

These are **per-app credentials, not global constants.** The moment a second
staff Slack app exists, a single flat environment variable cannot hold them
both. `process.env.SLACK_BOT_TOKEN` is not merely untidy here — it is
*unrepresentable*: there is no correct value for it in a system with eight bot
identities. Any code path that reads one of these from `process.env` is
therefore a latent bug that appears to work while exactly one app exists and
breaks silently on the second.

> **Every code path needing Slack credentials reads them from Supabase, keyed by
> the app it is acting as. Never from `process.env`.**

This also follows from the rotation constraint established above: credentials
that are created, installed and re-verified at runtime are runtime state, and
runtime state does not belong in build-time configuration.

### Table: `slack_app_credentials`

To be designed **from the start, before the Chief of Staff app is built** — not
retrofitted once a second app forces it.

| Column | Notes |
|---|---|
| `staff_id` / `app_identifier` | FK to the staff/agent this app belongs to |
| `slack_app_id` | Slack's own app identifier |
| `bot_token` | **encrypted at rest** (`xoxb-…`) |
| `signing_secret` | **encrypted at rest** |
| `app_token` | **encrypted at rest, nullable** — only if Socket Mode is enabled, which per the decision below it is not |
| `installed_at` | |
| `last_verified_at` | supports the §23 connector-health page |

Design notes consistent with the rest of the system:

- `app_token` being nullable is not hypothetical laxity — it is the correct
  shape given the HTTP-over-Socket-Mode decision. Expect it to be `NULL` for
  every row, and treat a non-null value as a signal that something enabled
  Socket Mode unintentionally.
- `last_verified_at` is what lets connector health distinguish "never worked"
  from "worked and has now broken", which §23 needs in order to alert only when
  automatic recovery has actually failed.

### Write and handling rules

1. When `apps.manifest.create` successfully creates **and installs** an app,
   write its resulting credentials into this table **immediately**. Never hold
   them only in memory, and never only in logs.
2. **Never print these values in logs or console output.** Same standing rule as
   every other secret in this project.
3. Local dev/debugging that needs Slack credentials without reaching Supabase
   uses an **explicit local-only override** from a gitignored file,
   `.slack-dev-override.local` — already added to `.gitignore`. This is an
   opt-in escape hatch, never a default expectation, and no production code path
   may depend on it.

### Note on `.secrets.local` — flagged, not silently overridden

Grant's instructions refer to `.secrets.local` as the home for the config token
pair. The specification removed that file: its "Development Environment: Fully
Cloud-Based" section states there is **no `.secrets.local` and no other local
bootstrap file**, because such a file only matters when a session runs on
someone's own machine, which never happens in this project. §26 repeats it.

**Nothing in the directive's substance depends on the resolution.** The
architecture is identical either way — config token pair in the bootstrap store,
per-app credentials in Supabase. Only the *name of the bootstrap store*
differs. So this is recorded, not blocked on:

- **Proceeding on the spec's model:** the config token pair goes into the Claude
  Code cloud environment's **Environment variables**, migrating to **API
  credentials** once proven working. That store plays exactly the role
  `.secrets.local` plays in the directive.
- `.secrets.local` has nonetheless been added to `.gitignore` as a defensive
  backstop, so no harm results if one is ever created.

If Grant wants a literal `.secrets.local` file instead, say so and it is a
one-line change — but it would reintroduce a secret-bearing file into a
repository whose stated operating rule is that none should exist, so the
cloud-environment store is the safer default and is what the spec asks for.

---

## Manifest APIs to use

Once a valid config token exists:

| API | Use |
|---|---|
| `apps.manifest.validate` | validate manifest JSON **before** create/update |
| `apps.manifest.create` | create each staff app from a manifest |
| `apps.manifest.update` | modify an existing app's config |
| `apps.manifest.export` | pull current config for reference/debugging |
| `apps.manifest.delete` | remove an app |

**Always `validate` before `create`/`update`.** It is free, and a rejected
manifest mid-rollout across eight apps is a partial-state problem we should
never create.

> **Research the current manifest schema at implementation time** at
> <https://docs.slack.dev/reference/app-manifest> rather than assuming the field
> names in the directive or in this document are still current. This mirrors the
> spec's standing rule against blindly implementing assumptions.

### Residual manual step

Automation is *near*-total, not total. The research found that **each app still
requires an OAuth install step to the workspace** — the manifest APIs create and
configure an app, but installation grants the tokens. So the honest shape is:

**one-time human bootstrap → unattended forever, plus one install click per app
at creation time.**

Claimed-to-be-fully-programmatic would be wrong, and the prerequisites document
says so plainly.

---

## Socket Mode: not used

Slack's own guidance recommends HTTP for production and *requires* it for
Marketplace apps. Socket Mode also needs a persistently connected process, which
the chosen serverless edge host cannot provide.

**Decision: HTTP Events API, not Socket Mode.** Consequences: manifests do not
enable Socket Mode, `connections:write` is not requested, and no
`SLACK_APP_TOKEN` is issued or stored. This also happens to align with the
platform research's hosting recommendation, so the two decisions reinforce
rather than fight each other.

---

## Cliff edge: do not enable public distribution

The most dangerous finding in the Slack research, recorded here because it is a
one-click irreversible-feeling mistake:

Slack's 2025 rate-limit restrictions **do not** apply to internal
customer-built apps. Verbatim from Slack: *"Internal customer-built applications
are not impacted… For Custom apps, `conversations.history` and
`conversations.replies` are limited to 50+ requests per minute… limit parameter
1,000 objects."* The punitive 1-request/minute, 15-object limit applies only to
**commercially distributed non-Marketplace** apps.

> **Therefore: never enable public distribution on any AI Team HQ Slack app.**
> Doing so silently reclassifies it and would cripple any agent that reads
> channel history — a ~50x throughput cut with no error message saying why.

This belongs in the manifest review checklist and in the Gate 4 test plan as an
explicit negative assertion.

---

## Implementation order (Phase 2, before Phase 7)

1. Encrypted credential storage for the rotating token pair.
2. `tooling.tokens.rotate` client + 6–8 hourly scheduled rotation + health
   signal on the §23 health page.
3. **Prove rotation survives a restart and a full expiry window** before
   building on it. A rotation mechanism that has not been observed rotating is
   an assumption, not a mechanism.
4. `apps.manifest.validate` wrapper.
5. Create the first single app end-to-end (Chief of Staff) and install it.
6. Only then create remaining staff apps, per the tiered identity architecture
   in the Slack research — and mind the workspace app-install cap while doing
   so.

Step 3 is the gate. Everything after it depends on a credential that expires
twice a day.
