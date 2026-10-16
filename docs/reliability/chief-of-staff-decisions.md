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

## DEC-011 — What an approval is consent to: the step id is out, the reason stays in
- **Date:** 15 October 2026 (implementation pass)
- **Decision:** The approval identity for a plan step is the material scope: capability, project, audience, specialist, inputs and reason. The step's `id` (its position in one plan) is excluded.
- **Why not exclude the reason too:** an approval given to "email the caterer about the allergy" must not carry to "email the caterer about cancelling". The reason is part of what Grant reads and agrees to. R45 (`an-answer-decides-the-step.test.ts`) pins it, and the unit test "an approval given to one reason does not carry to a different reason" pins it too.
- **Cost:** a planner that rewords the reason of the same work causes one more question. This is accepted for now. It is the conservative direction for consent.
- **Follow-up:** canonicalise `why` only after production evidence shows how plans are regenerated (COS-091). Do not do it on guesswork.
- **Legacy:** questions written before this change were fingerprinted with the id and reason too. `stepLegacyBinds` keeps that shape, so an approval given under it still matches. The pre-0611 shape is no longer consulted. An approval given only under that old shape will be asked again, once. That is the safe direction.

## DEC-015 — Three fingerprint shapes, tried newest first
- **Date:** 15 October 2026 (priority pass, after the critical gate)
- **Problem:** I had dropped the oldest fingerprint shape (pre-0611). The critical proof `authority` then failed: a No given to a pre-0611 question did not hold on resume, and the step would have proceeded against a refusal. That is a safety regression in my own change, found by the gate, not in a review.
- **Decision:** The policy takes one legacy fingerprint, so the lookup tries the material identity, then the shape written by questions just before this change, then the oldest shape. The first with an answer decides. A new question is always written under the material identity.
- **Consequence:** a No or Yes given under any earlier shape still decides the step. Verified by the critical gate (70/70).
- **Lesson recorded:** a legacy path removed from a change is not removed from the proofs. Run the critical gate before calling a consent change done.

## DEC-014 — Internal work does not bind its reason; outside work does
- **Date:** 15 October 2026 (priority pass)
- **Decision:** An approval for a step whose audience is `office` is bound to capability, project, specialist, audience and inputs. Its reason is not bound. A step whose audience is `outside` or `grant`, or has no audience, keeps its reason in the identity.
- **Why:** DEC-011 kept the reason for every step, which re-asked Grant when a planner reworded the same internal effect. That is the harmless re-ask the brief asked to remove. The consent boundary still holds where the words are the content: an email to an outside party, or work for Grant himself.
- **Risk accepted:** an internal step whose reason changes while its capability, inputs and specialist stay the same is covered by the earlier yes. Internal writes are reversible within the office (undo exists), and an external effect cannot be covered this way.
- **Tests:** `tests/reliability/step-approval.test.ts` (outside reason re-asked; internal reason not re-asked).

## DEC-012 — Plan tasks have an owner: the specialist, or the Chief of Staff
- **Date:** 15 October 2026 (implementation pass)
- **Decision:** A plan task is a project task owned by the step's specialist, or by `chief-of-staff` when none is named. It is on Grant's personal list only when the step's audience is `grant`, or when the plan has no project.
- **Basis:** COS-098 and COS-099 (the Chief of Staff keeps ownership; Grant is never the fallback owner for internal routing failures). The planner's question "who should own it" came from a task with nobody to own it.
- **Revised (same day):** a plan with no project no longer falls back to Grant's list. Its tasks go to the office's catch-all project, `app.unnamed_project`, which ADR-0024 defines as where a message that names no project lands, owned by the specialist or the Chief of Staff. Grant's list is now only for steps whose audience is `grant`.
- **Writer:** `app.task_add` with `p_assignee` is used for project tasks. It refuses an unknown owner with "nobody here is called", and that refusal is returned as a refusal, not stored.

## DEC-013 — One open question per job and action, enforced by the database
- **Date:** 15 October 2026 (implementation pass)
- **Decision:** A partial unique index `blockers_one_open_per_job_action` on `(job_id, action_fingerprint)` where the question is open. `raiseBlocker` uses `on conflict do nothing` and returns the open question's id.
- **Migration 1078** withdraws existing duplicate open questions (newest kept) with a resolution that says why, rather than deleting them, because blockers are an audit record. Withdrawal closes the question's task through the existing trigger.
- **Not applied to production.** The migration is written and proved on the local replica only. Applying it needs the production read of duplicate counts and Grant's authorisation for the write (DEC-009 and the production rules). The migration number 1078 is the next free number in this checkout. It has not been checked against production's migration ledger.

## DEC-010 — Historical specification header changed; hash re-recorded
- **Date:** 15 October 2026
- **Change:** The header of `chief-of-staff-master-spec.md` was edited to say it is historical and that the consolidated specification is authoritative. The verbatim body below the header was not changed.
- **Hash:** SHA-256 re-recorded in the register from `5daf076f…` to `18a98bd9…`. The old value was recorded at baseline `b0b006f6`, so the change stays auditable.

## DEC-009 — Production telemetry not read
- **Decision:** No production read was made in this checkpoint. Forensic items that need production records stay AMBER or GREY (COS-091, COS-144 to COS-146).
- **Basis:** ECS-021 and the repository's production-access rule require explicit authorisation for the specific read. None has been given.
- **Resolution:** Grant authorises a named read-only check (`ALLOW_PRODUCTION_CHECKS=1`, for the stated purpose). Until then, the forensic timeline is built from the repository and the incident transcript only.
