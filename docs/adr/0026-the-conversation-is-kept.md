# ADR-0026 — The conversation is kept, and the window is what is bounded

- **Date:** 2026-09-13
- **Status:** Accepted
- **Issue:** [#204](https://github.com/granterogers/agentic.team.grant/issues/204),
  split out of [#192](https://github.com/granterogers/agentic.team.grant/issues/192)
- **Migration:** `0344_the_conversation_can_be_measured_rather_than_guessed.sql`

## The question

#192 made the conversation load-bearing. Before it, nothing read
`inbound_commands` and `outputs` as a history; after it the studio does, Slack
and Telegram write into it from two more surfaces, and the arrival path
subscribes to it. #192 listed retention as an acceptance criterion and
deliberately did not tick it rather than claim it silently.

#204 then asked three specific questions rather than for a policy, and said to
answer them once two surfaces were really syncing. They are, so they are
answered from measurement.

## What was measured, 13 September 2026

Fixtures excluded — which is not a detail. Measured naively, Slack showed 117
rows; with harness traffic excluded it is 45. Reporting verification traffic as
growth is a mistake this repository has made before and has a standing note
about.

| surface | rows | a day |
|---|---|---|
| voice | 81 | 13.5 |
| telegram | 75 | 7.5 |
| slack | 45 | 4.1 |
| teamhq | 2 | 0.7 |

**25.8 messages a day**, about **495 bytes each** across both tables. The
database is **48 MB of the free tier's 500 MB**. At this rate, assuming two
rows per exchange, there is room for roughly **fifty years** of conversation.

## The decision

**Nothing is deleted, and no retention policy is written.**

Three reasons, in order of how much they settle it:

1. **It is not needed, and not marginally.** A decade would be a comfortable
   margin; fifty years means the constraint is somewhere else entirely. A
   deletion policy written now would be inventing work and putting the record
   at risk to solve a problem that does not exist.

2. **It is largely not possible, by design.** `outputs` hangs off `jobs`, and a
   job can never be deleted — `job_state_transitions` is append-only under §6
   of the master spec. So "delete old messages" is not a lever this schema
   offers for the office's half of the conversation, and building one would
   mean unpicking the append-only guarantee that makes the ledger worth having.

3. **The real unboundedness was in the READER, not the storage**, and that is
   fixed rather than deferred. See below.

## What was actually wrong

`app.conversation_history` had two defects that only volume would have exposed:

- The office's half filtered on
  `coalesce(j.project_id, app.unnamed_project()) = p_project_id`. A function
  call wrapped around the column is opaque to the planner, so
  `jobs_project_state_idx` could not be used and **every job in the table was
  read** on every conversation load. Rewritten as an explicit `or`, the common
  branch is an index condition.

- Both halves were unioned **in full** before the limit, so the sort grew with
  the project's entire history rather than with the fifty rows asked for. Each
  half now takes its own window first, so the sort sees at most 2N rows however
  long the conversation gets.

Measured on the real database: **116ms → 32ms**, with the same rows in the same
order. That is the difference between a reader that degrades with history and
one that does not, and it was worth more than any deletion policy would have
been.

## What replaces the policy

`app.conversation_growth()`, wrapped for PostgREST and read by the studio's
Usage page. It reports rows and messages-a-day per surface, bytes a message,
and years of room at the current rate.

A function rather than a script, deliberately, for the standing instruction
that outranks most others:

> *"I want to reduce my dependence on Claude or another coding interface for
> maintaining and extending the system."*

A number somebody has to ask an agent to compute is a number Grant does not
have. This one is on a page he already opens.

## When to revisit

Three triggers, any one of which invalidates the arithmetic above:

- **The database passes 250 MB** (half the tier) — the growth card shows the
  percentage, so this announces itself.
- **Messages a day passes 500** — twenty times today's rate. That is the point
  at which fifty years becomes two and a half.
- **A new surface starts writing conversation** that is not one of the four
  measured here. The rate is per surface; a fifth changes the sum.

Until one of those, the answer to "what is the retention policy" is: *the
conversation is the record, it is kept, and the page reads a window of it.*

## Consequences

- Nothing is lost, which is the property #192 exists to provide.
- The reader is O(window) rather than O(project history).
- The growth question is answerable by Grant, at any time, without an agent.
- If the rate turns, the archival conversation happens with a number in hand
  rather than at 90% of the tier — which is exactly what #204 was raised to
  avoid.

## Related

ADR-0025 (the project is the conversation) · #192 (the reader) ·
#193, #194 (the surfaces that set the rate) · #21 (the build diary's own
retention pass — the same shape, still open, and its storage grows with
screenshots rather than with text)
