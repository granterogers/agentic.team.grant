# 12-hour RC1 completion run — 18 September 2026

**Mandate:** RECONCILE -> FINISH IMPLEMENTATION -> REAL EXERCISE -> CLOSE
SATISFIED ISSUES -> RC1 QUALIFICATION -> PREMIUM VISUAL POLISH -> FINAL
HANDOVER. Full prompt is the uploaded brief; the operative sections are
reproduced below so this survives a compaction.

## After a compaction

READ CLAUDE.md -> docs/RUN-LEDGER.md -> this file -> git log -> live issues ->
CONTINUE. Do not ask Grant to paste the prompt again.

## Starting state (verified, not assumed)

| | |
|---|---|
| starting HEAD | `e269057` |
| origin/main | `e269057` |
| branch | `claude/phase-7-communications-kh8ow8` |
| tree | clean |
| migrations | 494 |
| tests | 1,753 |

## Priorities, in the brief's order

1. **Browser/computer programme** — #16 + #135 + #261 as ONE capability.
   Preserve PUBLIC FETCH vs INTERACTIVE AUTHORIZED SESSION. Maintain SSRF
   protection incl. link-local/cloud metadata. Never weaken security to make a
   browser test pass. #135 needs the Browser tab to be a real surface: what,
   where, for which project, what it did, resulting files, and how to STOP it.
2. **#258 artifact generation** — full vertical slice to a rendered, visually
   inspected, delivered PDF. A DB row is not an artifact.
3. **#259 unified Personal Tasks** — Personal Tasks != Agent Jobs.
4. **#260 NotebookLM generated artifacts** — inspect real provider
   capabilities; do not design from assumptions.
5. **#172 Gmail project intelligence** — epistemic honesty preserved.
6. **#41** is the release-verification spine: CHECK + CONTROL + REAL EXECUTION.
7. **RC1 qualification** (clean start, core journeys, failure/recovery,
   provenance, security, performance) then **premium visual pass**.
8. **Final handover, pushed**, separating TESTED / INFERRED / NOT TESTED, and
   an honest RC1 READY / NOT READY decision.

#18 and #213 are Grant's own credential rotations. Documented, skipped, not to
be rediscovered.

## Standing constraints

- Do not commit or push a known-red tree. READ EXIT CODES.
- Do not weaken a gate to merge. Wire unreachable capability rather than
  deleting it.
- Never expose a secret value anywhere.
- Team Evolution must not derail release completion.

## Log

- **reconcile** — HEAD `e269057`, clean, == origin/main. Ledger's next action
  was the browser cluster; the brief makes that Priority 1 too.
