# ADR-0004 — One shared Slack app for V1

**Status:** Accepted · **Date:** 2026-09-02
**Source:** Feasibility Audit Addendum §3.

## Context

Research established that Slack Free permits **10 app installs** including custom
apps, so eight per-staff apps technically fit. The first architecture therefore
proposed a tiered model: 3–5 senior staff with dedicated apps, the rest presented
via `chat:write.customize` on a shared app.

The addendum overrides this: multiple apps must **not** be a V1 requirement,
because current Free limits make the architecture brittle and the shared-app
approach is unproven.

Two research findings support the override independently:

- Identity overrides are **cosmetic only** — an overridden identity is not
  `@mentionable`, not DM-able, and absent from the member list. So dedicated apps
  buy *addressability*, which is a UX nicety, not a functional requirement.
- App-install limits are a shared, exhaustible workspace resource. Spending 8 of
  10 slots before proving the model works is irreversible in practice.

## Decision

**V1 uses ONE shared "AI Team HQ" Slack app.** Created programmatically:
app ID **`A0BUFRVSSLD`**.

- All eight permanent staff and all temporary specialists present through it,
  via `chat:write.customize` plus rich block-based identity.
- **True staff identity lives in Postgres**, never in Slack message authorship.
- HTTP Events API; **no Socket Mode**, so no `connections:write` and no
  `xapp-` token.
- Per-staff apps are reconsidered **only after** Gate 4 passes, install limits
  are re-verified, and a concrete UX benefit is demonstrated.

## Consequences

- 9 of 10 install slots remain free.
- Credentials are still stored **one row per app** in Postgres. This is not
  over-engineering for a single app: the schema must not need migrating the day
  a second app appears, and `process.env.SLACK_BOT_TOKEN` has no correct value
  in a multi-identity system.
- Staff are less addressable in Slack than they would be with dedicated apps.
  Accepted for V1; Telegram carries per-identity weight better.

## Standing constraint

> **Never enable public distribution on this app.** Slack's rate-limit
> restrictions exempt internal custom apps; distribution silently reclassifies
> the app and cuts history-reading throughput roughly 50× with no explanatory
> error. Explicit negative assertion in Gate 4.

## What would reverse this

Gate 4 passing, plus a demonstrated need for staff to be `@mentionable` or
DM-able individually.
