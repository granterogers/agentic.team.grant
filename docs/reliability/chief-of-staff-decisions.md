# Chief of Staff Reliability — Decision Log (mirror)

**Canonical register:** `docs/reliability/chief-of-staff-requirements.md` · **Epic:** https://github.com/granterogers/agentic.team.grant/issues/476

Append-only. A decision is changed by adding a new entry that supersedes an earlier one, never by editing it.

## DEC-001 — Branch from main, leave main untouched
- **Date:** 15 October 2026
- **Decision:** Work on `claude/chief-of-staff-reliability`, created from `main` at `f23af36`. Do not modify `main`. No PR is opened as part of this checkpoint.
- **Basis:** Execution-control spec §1 (no merge, no production push) and the unblock instruction (create a development branch from the verified baseline).
- **Reversal cost:** Low. The branch can be deleted without affecting `main`.

## DEC-002 — Consolidated master prompt and incident transcript are a BLOCKER, not reconstructed
- **Date:** 15 October 2026
- **Facts:** The unblock instruction says the consolidated master prompt is "being provided with this instruction". The instruction text contains no master prompt, and no transcript appears in the conversation. A search of `main` (`git grep` for "coworking", "chief of staff", "reliability", "incident") and of GitHub issues (for an existing epic) found no source document.
- **Decision:** Record both documents as absent. Do not reconstruct either from memory or paraphrase, and do not invent their content. The verbatim execution-control specification (the one source that IS in hand) is saved as `chief-of-staff-master-spec.md`.
- **Effect:** All COS rows remain at seed level and no COS row may be GREEN. Every row is marked with this blocker.
- **Resolution path:** Commit the consolidated prompt to the repository (suggested: `docs/reliability/chief-of-staff-master-spec-consolidated.md`) and the transcript (`docs/reliability/chief-of-staff-incident.md`). Then this entry is superseded by DEC-005.
- **Discrepancy noted:** The brief says the consolidated prompt "is authoritative". The execution-control specification says the epic must contain it verbatim. These agree only once the file exists.

## DEC-003 — Topic seeds from spec §3 used as the register's interim requirement list
- **Date:** 15 October 2026
- **Decision:** The 58 topics in §3 and the ten named examples are registered as COS-001 to COS-068, one ID per topic, in the order given. Nothing is skipped.
- **Basis:** The specification says the topic list must not be collapsed, and it is the only enumeration in hand.
- **Correction:** The first draft mapped topics 1–44 onto COS-011 to COS-054 and left topics 45–54 unregistered. Fixed in the same checkpoint; the register now has 68 COS rows with no gap.
- **Reversal cost:** Low. Sub-requirements from the consolidated prompt add IDs above COS-068; existing IDs are never renumbered.

## DEC-004 — Numbering rule and no renumbering
- **Date:** 15 October 2026
- **Decision:** IDs are permanent. Sub-requirements get new IDs at the end of their section. A withdrawn requirement stays in the register with status and a reason. It is never deleted.
- **Basis:** Execution-control spec §3 and §8 ("no requirement was silently deleted").

## DEC-005 — Repository guards for ECS-001 to ECS-006 deferred
- **Date:** 15 October 2026
- **Decision:** These rules are followed by process at this checkpoint and recorded AMBER. An automated guard (a pre-push hook or CI check that refuses pushes to `main` and refuses deploy and migrate commands from this branch) is planned, not built.
- **Basis:** Those rules are in force regardless of a guard, so the guard is extra assurance. Building it now would be a new control that needs its own review.
- **Status:** Open. Resolve by adding a row to the test matrix.
