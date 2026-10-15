# Chief of Staff Reliability — Progress Register (mirror)

**Canonical register:** `docs/reliability/chief-of-staff-requirements.md`
**Epic:** https://github.com/granterogers/agentic.team.grant/issues/476
**Development branch:** `claude/chief-of-staff-reliability` (from `main` at `f23af36`; `main` not modified; no merge; no production contact)
**Baseline:** `b0b006f6`. **Source-preservation checkpoint:** recorded in the epic comment for this checkpoint.

**Reload order after compaction or restart (ECS-017):** epic #476 → `chief-of-staff-master-spec-consolidated.md` (authoritative) → `chief-of-staff-incident.md` → `chief-of-staff-requirements.md` → this file → `chief-of-staff-decisions.md` → `chief-of-staff-test-matrix.md` → `git status` and `git log` on the development branch. Then run `npm run check:reliability`.

## Reconciliation (must match the register; checked by `npm run check:reliability`)

🟢 3 | 🟡 40 | 🔴 0 | ⚪ 187 — Total 230/230 tracked

- Execution-control rules (ECS): 39 — 🟢 3 · 🟡 31 · 🔴 0 · ⚪ 5
- Chief of Staff requirements (COS): 146 — 🟢 0 · 🟡 8 · 🔴 0 · ⚪ 138
- Mandatory regression tests (REG): 45 — 🟢 0 · 🟡 1 · 🔴 0 · ⚪ 44

## Sources

| Source | Status |
|---|---|
| Consolidated master specification | Preserved, authoritative. `chief-of-staff-master-spec-consolidated.md` |
| Original Telegram incident transcript (Canary Coworking, 15 October 2026) | Preserved. `chief-of-staff-incident.md`. Eight timestamped entries |
| Historical execution-control specification | Retained as evidence. `chief-of-staff-master-spec.md` |

The consolidated file was written by transcribing the supplied text. Its SHA-256 is recorded in the register from this point. Byte-level equality with the original message cannot be machine-checked in this session (DEC-008).

## Completed (this checkpoint)
- Verified the branch and tree at `b0b006f6` before changes.
- Saved the consolidated specification and the incident transcript; recorded SHA-256 for all three sources.
- Expanded the register from 88 to 230 IDs. Preserved all 88 existing IDs. Added COS-069 to COS-146, ECS-021 to ECS-039, REG-001 to REG-045 (DEC-006).
- Mapped all 76 consolidated §7 inventory items and all 45 §25 regression items to register IDs.
- Extended `check:reliability` to detect missing source requirements, unmapped items, changed or unrecorded source hashes, a dropped transcript entry, and a dropped historical topic. Self-test extended to 11 sabotages.

## Investigation done (repository only, no production read)
- `chief-of-staff-forensics-code.md`: five findings (F1–F5) from code and transcript. Confirmed in code: F1 (duplicate guard names the job by its text) and F2 (callback dedupe is per click). Supported hypotheses: F3 (button carries no approval identity), F4 (one stop raised three times). F5 (optional details block the start) is user-visible only.
- COS-074, COS-092, COS-108, COS-144, COS-145 moved GREY → AMBER on that evidence. None is GREEN: each needs a test or production records.

## Working (next checkpoints, in order)
1. Forensic timeline (COS-091, COS-144 to COS-146): read the Canary Coworking records. Requires authorised read access. Until then this stays AMBER/GREY.
2. Approval lifecycle investigation and repair (COS-020 to COS-024, COS-072 to COS-074, COS-092 to COS-095, REG-001 to REG-006).
3. Duplicate-objective and existing-run handling (COS-033, COS-034, COS-108 to COS-110, REG-009 to REG-011).
4. Worker leasing, stall detection and safe recovery (COS-030 to COS-032, COS-111 to COS-114, REG-012 to REG-015).
5. Automatic delegation and reassignment (COS-005, COS-006, COS-014 to COS-019, COS-096 to COS-102, REG-016 to REG-020).
6. Gmail research, artifacts and status truthfulness (COS-035 to COS-050, COS-082, COS-083, COS-103 to COS-131, REG-022 to REG-039).
7. End-to-end Canary simulation (COS-136 to COS-138, REG-045).

## Blocked
- **Production telemetry for the incident.** Reading production requires `ALLOW_PRODUCTION_CHECKS=1` and Grant's explicit authorisation for that read. It has not been given for this checkpoint. Forensic items that need production records remain AMBER or GREY.
- **Repository guards for ECS-001 to ECS-006.** Not built (DEC-005).

## Production verification (ECS-013, pending, recorded separately)
- No production verification has been performed. No deploy, migration, configuration or secret change has been made.
- Production verification of every requirement: **pending**.
