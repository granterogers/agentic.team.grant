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

## DEC-002 — UPDATE (15 October 2026, resume instruction): blocker resolved
- The consolidated master specification and the original incident transcript were supplied with the resume instruction. They are preserved as `chief-of-staff-master-spec-consolidated.md` and `chief-of-staff-incident.md`.
- DEC-002's blocker is closed. The consolidated specification is authoritative (DEC-007). The historical execution-control specification is retained as evidence.

## DEC-006 — Register expansion and remapping
- **Decision:** Keep all 88 existing IDs unchanged. Append COS-069 to COS-146, ECS-021 to ECS-039 and REG-001 to REG-045. Map every consolidated §7 item (CONS-7.01 to CONS-7.76) and §25 item (CONS-25.01 to CONS-25.45) to exactly one ID in the register's traceability map.
- **Basis:** Consolidated §7 says to preserve existing IDs where practical and document any remapping. None was needed.
- **Note:** COS-011 to COS-068 are historical §3 topics (the execution-control spec). They are not the consolidated §7 list. Both lists are mapped; neither replaces the other.

## DEC-007 — Source hierarchy
- **Decision:** The consolidated master specification is authoritative. The historical execution-control specification is kept as evidence. Where they differ, the consolidated text governs and the difference is recorded here.
- **Discrepancy recorded:** The historical §3 list (58 topics plus 10 examples) and the consolidated §7 inventory (76 items) are different enumerations of overlapping subject matter. The register maps both. Neither was dropped.

## DEC-008 — Verbatim preservation limit
- **Decision:** The consolidated specification and the incident transcript were written by transcribing the supplied text into the repository. A byte-for-byte comparison against the original message cannot be run in this session.
- **Control:** The register records each file's SHA-256 from this checkpoint onward. `check:reliability` fails if a recorded file changes. Anyone holding the original message can confirm the transcription by comparing text, and should record any correction as a new dated decision, never by editing the hash in place.

## DEC-010 — Historical specification header changed; hash re-recorded
- **Date:** 15 October 2026
- **Change:** The header of `chief-of-staff-master-spec.md` was edited to say it is historical and that the consolidated specification is authoritative. The verbatim body below the header was not changed.
- **Hash:** SHA-256 re-recorded in the register from `5daf076f…` to `18a98bd9…`. The old value was recorded at baseline `b0b006f6`, so the change stays auditable.

## DEC-009 — Production telemetry not read
- **Decision:** No production read was made in this checkpoint. Forensic items that need production records stay AMBER or GREY (COS-091, COS-144 to COS-146).
- **Basis:** ECS-021 and the repository's production-access rule require explicit authorisation for the specific read. None has been given.
- **Resolution:** Grant authorises a named read-only check (`ALLOW_PRODUCTION_CHECKS=1`, for the stated purpose). Until then, the forensic timeline is built from the repository and the incident transcript only.
