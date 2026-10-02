# P3 - the application conversion: record

Status: **complete on production, 2 October 2026.** Implements the rule in `P3-CONVERSION-RECIPE.md`; decisions in
ADR-0062. P2 (`P2-OWNERSHIP.md`, ADR-0061) made the database refuse a link across offices; P3 makes every function, job,
message, retrieval and integration know its office from a trusted identity.

**The rule.** `IDENTITY -> TRUSTED OFFICE CONTEXT -> RESOURCE CHECK`. A caller-reachable function takes `p_office` first, no
default, from a trusted component; calls `app.require_office(p_office)`; checks every row it touches against it; and answers
a foreign id exactly as it answers one that does not exist.

## What changed

| | before | after |
|---|---|---|
| functions with no office (`legacy-unscoped`) | 138 | **0** (53 reviewed overrides, each naming the proof case) |
| office-taking functions | - | 491, none with an office-less overload beside it |
| `app` functions a browser role can execute | 0 | 4, on purpose (`now_utc`, `normalise_name`, `normalise_reference_url`, `icon_key_ok`: called by defaults and an index) |
| compatibility bridge triggers | 52 | **0** (0860); the meter table is kept as evidence |
| global keys on what a person or a provider names | 8 | **0** (0862) |
| writers that inserted into a carrier without `office_id` | 6 (found late) | **0** (`check:carrier-writers`) |
| model calls with no job (8,099) | filed under the only person | the SYSTEM office, written explicitly |

Migrations applied to production, in four releases: R1/R2 (waves 1-2, earlier), **R3** (41 files: 0683-0688 channels and
identity doors, 0710-0711 tasks, 0720, 0730, 0740-0743 governance, 0750-0753, 0760, 0770-0775 retrieval and memory, 0780-0784
approvals and duties, 0800-0804 integrations, 0840-0842, 0850-0853 the worker and its scans), **R4** (0859 six writers,
0860 the bridge removed, 0861 its last helper, 0862 per-office keys).

## Verification, as it stands

* Attack suite on a fresh clone: **1421 of 1421**, Person A and Person B in both directions: a foreign id and a
  nonexistent id answer identically, the other office's rows are byte-identical afterwards, and its canary text appears
  nowhere. P2 ownership suite **96 of 96**. Unit tests **4000**, `tsc`, `biome ci` clean.
* Static gates, all green: `check:office-conversion`, `check:office-gateway`, `check:arity`, `check:carrier-writers`,
  `check:office-edges`, `check:ownership`, `check:machine-key`, `check:migrations` (732 of 732 recorded), `check:secrets`,
  `check:templates`, `check:anon-exposure`, `check:callers`, `check:consumed`, `check:answerable`, `check:undo`,
  `check:capabilities`, `check:gateway-wrappers`, `check:chatter`, `check:standing`. `check:leaks`: no harness delivery
  reached a real destination.
* Sabotage (red, restore, green): the bridge put back is caught by `check:office-edges`; the per-office keys put back to
  global turn the proposals and document cases red; removing 0842's four grants turns `98-merge-cleanup` red; the
  credential-resolver, usage-filing and google-credential unit tests are each proved against the defect they guard.
* Gate against the seven documented baseline reds: `verify:wrappers`, `verify:review`, `verify:backups`, `verify:recovers`,
  `verify:attests`, `verify:transport` are red for the same reasons as before (an `approve_document` wrapper signature, a
  hash-navigation check, a rehearsal-verdict chore, and the 0603 containment refusing a harness job a destination).
  `verify:mytasks`, which was red only by exceeding the shell's ceiling, ran to **89 of 89**. Everything else in the gate that
  was run passed after its fixtures were taught to name an office: schema, judge, unified, artifact, stop, proposes,
  connectors, organising, recovery, knowledge, mail, attests (baseline), handoff, tasks, history, identity, dryrun,
  security, upload, lastword, knows, delegation, tasks-ui, run1-4-live and run3-effects-live.
* **New red, by design:** `verify:hq` reads two connection-health checks as empty, because the office key now resolves to the
  TEST office and has no connection data. Not a regression; the suite needs a fixture row in the test office.

## The incident (0841)

0841 revoked EXECUTE on every `app` function from the browser roles and `public`. Column defaults, generated columns, CHECKs
and index expressions run with the writing role's privilege, and PostgREST writes as `service_role`, so every insert through
the Telegram, Slack and voice webhooks failed with `permission denied for function now_utc` for about five minutes
(00:26-00:31 UTC, 2 October). No real inbound message arrived in the window (only the probe row, deleted). 0842 granted the
four functions that defaults and an index call; `98-merge-cleanup` is red without it. The harness had written as the table
owner and could not see it. The lesson is in CLAUDE.md.

## Late findings worth keeping

* **Six operator and rare-path writers leaned on the bridge while the meter read zero** (0859). They were classed "trusted
  derived" with no door. Found when removing the bridge made a rehearsal fail on the document trigger that calls
  `record_signal`. `check:carrier-writers` now reads every function body.
* **About 110 verification suites under `scripts/verify` inserted into carrier tables with no office.** They failed closed
  when the bridge went. The ~40 in the gate were converted and re-run; the rest still fail closed on their first insert and
  are a recorded debt (below).
* **My own verification runs added 116 permanent fixture jobs to the person's office** (fixture jobs 1711 to 1827, harness
  jobs 3135 to 3251) before four suites that borrowed or used that office were pointed at the test office. They are flagged
  harness by `requested_by`, are excluded by every reader, can never be deleted, and no delivery was made for any of them.
  After the fix the count did not move again across `proposes`, `handoff`, `artifact`, `unified` and `waiting`.

## The machine key

The office key (`hq.api_token`) resolves to the **test office** (`resolve_machine_office`). It can no longer act as a person:
an MCP consent given with it binds the client to the test office, and gateway presses made with it are refused for a real
project as "no such project". **It has not been rotated, and there is no record of which devices hold it.** Rotation is
Grant's step (`P1-CLOSURE.md` §4.5); the gateway does not log which credential kind made a call, which is what would answer
"who holds it".

## Not done, and why it is not isolation

* ~70 verification suites outside the gate still insert into carriers without an office and fail closed (issue to file; each
  names a subject, so the conversion is mechanical: test office for harness-named subjects, the project's office for children).
* `verify:hq` connection rows (above).
* The MCP consent page takes a pasted session token as the person's consent; a proper sign-in flow is a UX task.
* The raw-SQL ratchet still lists 69 unscoped statements in handlers; each was reviewed and carries a reason in
  `raw-sql-baseline.json`, and it may only shrink.
* No second real user exists, and none is created here. Onboarding, organisations, billing and a public launch are out of
  scope for P3.

## Cost

Job-less model calls (8,099) are the system office's deployment overhead and are filed there. They are no longer part of a
person's usage. Nothing in P3 adds a paid dependency.
