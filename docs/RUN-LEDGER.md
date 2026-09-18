# RUN LEDGER — Overnight Completion, RC1 & Wow-Factor Run (12h)

**Started 18 September 2026.** This file is the durable mission. After a
compaction reconstruct from: CLAUDE.md -> this file -> latest handover ->
git history / current diff -> live issues. **Never ask Grant to repaste.**

## The mission, in order

RECONCILE -> FINISH PRODUCT -> REAL EXERCISE -> FIX -> RC1 GATE ->
FF-MERGE main -> TAG v1.0.0-rc.1 -> DEPLOY/VERIFY -> FUNCTIONAL UX +
EXHAUSTIVE WOW-FACTOR BEAUTIFICATION -> REGRESSION -> FINAL HANDOVER.

Do not stop for intermediate reports. Batch done -> verify -> commit/push ->
update this file -> begin the next priority immediately.

## SETTLED DECISIONS — never ask again

| | |
|---|---|
| **#259 Vikunja** | Agentic Team's own Personal Tasks are CANONICAL. Vikunja is OPTIONAL and **must not be hosted**. Build a mature native system whose provider boundary is deliberately compatible with future two-way sync. Study Vikunja's model; respect its licence; copy no incompatible code. |
| **#172 Gmail** | Grant AUTHORISES caching/indexing relevant message **bodies** in the private data layer, with provenance, isolation and anti-injection controls. Document the change from the metadata-only posture. |
| **#261 Computer** | RESCOPED: Grant needs the **browser**, not a persistent remote desktop, agent filesystem or terminal. Do not buy compute. If existing work satisfies the narrowed requirement, PROVE it and close/update. |
| **Google Drive** | OPTIONAL one-way knowledge source (DRIVE -> AGENTIC TEAM). Indexed, searchable, provenance-bearing; changes/deletions update the index. Explicit user-requested export to Drive is allowed. No auto reverse mirroring. No Drive dependency. |
| **RELEASE AUTHORITY** | If qualification passes, Grant AUTHORISES: ff-merge branch -> main, push main, annotated tag `v1.0.0-rc.1`, push tag, deploy/verify. **Do NOT stop at "awaiting tag".** |
| **#18 / #213** | Grant-owned credential rotations. Never request, print or reconstruct secrets. May stay open with exact safe instructions. |

## Standing rules for this run

- A check matters only if it can fail. Sabotage where practical and **verify
  the sabotage actually landed** before believing a red or a green.
- READ EXIT CODES. `$?` after a pipe is the pipe's — redirect to a file.
- Fix cheap defects on the fly and regress them. Do not build an issue
  graveyard.
- Never weaken security, provenance, accessibility or tests for prettier
  screenshots.
- Do not trust screenshots alone where geometry can be measured; this repo has
  recorded false visual findings from capture fixtures.

## Log

(appended as the run proceeds)
