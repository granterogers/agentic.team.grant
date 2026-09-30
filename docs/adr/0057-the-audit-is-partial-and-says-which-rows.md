# 0057 - the original audit is reconciled row by row, and it is not closed

Status: accepted, 30 September 2026.

## Decision
The original architecture audit (`docs/testing/original-architecture-audit-bbe9956.md`) is reconciled as 145 rows in
`docs/final-audit/FINAL-RECONCILIATION.md`, one per finding, never merged. The verdict is **AUDIT PARTIAL**: the rows still
STILL OPEN are named there. This is stated rather than rounded up because a row is closed only by a behavioural test with a
positive control and a sabotage that lands, and most of the open rows have neither.

## Recorded choices
- **B12** (the model-call retry cap of four) is accepted debt: the job ceiling is `max_attempts` and `settle_exhausted_jobs`
  (0620) ends a job that runs out, with a word to the person owed one.
- **D24** (unledgered sends): the edge functions are scanned for direct sends (`tests/jobs/containment.test.ts`). The one
  remaining direct send is the dormant voice-refusal reply; it is named with its reason and sits behind
  `voice.transcription = 'api'`.
- **A forwarded turn** gets `noneEntitled`, a silent twin of every consequence-bearing reader, rather than a guard at each
  writer: the class is closed by construction and a new reader is forced by the type to declare its silent form.
- **A worker that lost its claim** cannot create a child or park the job (`claim_gen`, 0625/0628). `pauseJob` falls back
  to the unfenced arity only when the fenced one does not exist (42883); a stale-claim refusal always propagates.
- **An answer to a called-off question** is recorded and starts nothing (0632).
- **Decisions (a), (b), (c) and #389 are Grant's.** No default was chosen for him.

## Consequences
The next work is product work, hardening of the named open rows, and the three decisions - not a new architecture run.
