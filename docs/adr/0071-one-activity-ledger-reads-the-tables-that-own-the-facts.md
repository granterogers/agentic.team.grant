# ADR-0071: one activity ledger reads the tables that already own each fact

Status: proposed (built on `feature/unified-activity-ledger`, default off, not merged). Date: 11 October 2026.

## Context

Grant asked for one authoritative, searchable, auditable history of meaningful activity across the office: what the team did, who did it, why,
what it cost, what needs him, how a request became a delivery. The audit (`docs/activity-ledger/ARCHITECTURE.md`) found the office already records
each fact in the table that owns it: job transitions by trigger in the same transaction as the state change, requests, routing, approvals,
deliveries, outputs, model usage, impediments, and the action ledger `public.events` with its reversals. What was missing was a way to read them as
one history, a home for activity that has no other record (a recovery sweep, a throttle, a threshold, an external worker's report), and a status
vocabulary that does not blur `attempted`, `completed` and `confirmed`.

## Decision

1. **Do not copy.** The ledger is a read model, `app.activity_read`, over the owning tables. A copy would be a second source of truth that can
   disagree with the first, and an audit row written beside a change can be omitted by a path nobody remembered; the transition trigger already
   makes "no transition without its record" true.
2. **One small native table** for what has no other record: `public.activity_events`, append-only, typed, office-scoped, idempotent on
   `(office, key)`, reachable only through three writers (strict, safe, external).
3. **The taxonomy is data**, `public.activity_event_types`, because a list in code is one Grant cannot add to (the 0366 lesson).
4. **Default off**, failing closed. **Additive** migrations 1060 and 1061; nothing existing is altered.
5. **No backfill**, because nothing is copied: history is visible with its original timestamps the moment the switch is on.
6. **An external worker enters through one SQL door** that forces its actor and provenance and refuses critical severity, confirmation and
   authorisation; the authenticated boundary that will call it is not built and is the Hermes branch's work.
7. **The existing Activity page is not redesigned.** An adapter returns the page's own row shape; the page uses it only when it is on and non-empty.

## Consequences

- One reader applies the office, harness and visibility rules once, instead of each page re-deriving them (the repository has paid for that
  divergence repeatedly: CLAUDE.md, "A reader's counters and its list can filter differently").
- Historical coverage is exactly what the source tables hold. The ledger claims no more.
- Reading costs more than reading one table. Measured: about 100 ms for the newest page at 24 000 transitions; selective filters up to 1.5 s there.
- Eleven additive indexes lock their tables while they build.
- A native event type needs a writer; the taxonomy may run ahead of its writers, and a test names which, so it is a decision rather than drift.

## Alternatives considered

- **Extend `public.events` with the lifecycle columns and write job, delivery and approval events into it.** Rejected: it duplicates the transition
  table, `events` is the audit-with-reversal ledger whose consumers (undo, the existing Activity page) would then see lifecycle noise, and a
  state change would need a second write that can be omitted.
- **A materialised or trigger-maintained feed table.** Rejected for now: it is the copy this decision avoids; revisit only on measured need.
- **A transactional outbox for every event.** Rejected: the owning tables already are the outbox for everything but the few native events, and
  those either commit with the caller's transaction (strict writer) or are best effort by design (safe writer).

## Not decided here

Retention beyond "nothing is deleted"; the external-agent boundary; any richer Activity UI; the rollout date.
