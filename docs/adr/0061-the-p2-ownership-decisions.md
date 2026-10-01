# 0061 - the P2 ownership decisions

Status: **accepted** (1 October 2026). Implements ADR-0060 (now accepted); records what implementing it decided that a
later reader could reverse by accident. Canonical record: `docs/multi-user/P2-OWNERSHIP.md`.

## Decisions

1. **ADR-0060 is accepted as implemented**, with two corrections to its text: the carriers are **52 of 136** (the manifest is
   authoritative; "44 of 129" is superseded), and there is **no `uses_system_integrations` column** - the credential
   resolver already decides integration use from operator authority and job origin.
2. **Terminal history that nothing can attribute goes to the SYSTEM office, never to a person** (8,484 rows: model calls with
   no job, settled undo offers naming no row, ledger lines whose subject was deleted, signals for deleted documents). It is
   counted under rules named `UNATTRIBUTABLE`. Eligible only: append-only rows nothing reads to decide behaviour. A live row
   that is not proved aborts the wave. The alternative - the person's office - is "unknown -> Grant" under another name.
3. **A harness row linked by a database key to the person's project or job is in the person's office**, flagged and counted
   (5,821), never silently relabelled. A composite key cannot express "a test row inside this project"; the two ways out are
   to remove the link (destroying the evidence) or to give the harness its own projects (P3). `office_id = Grant` therefore
   does **not** mean real, and every reader that excludes harness traffic keeps excluding it.
4. **An existing cross-office edge in an append-only ledger is recorded, not hidden and not corrected.** One row
   (`lessons.supersedes`) is named in `office_edge_exceptions`; its key stays `NOT VALID`; the check fails if the violating
   set is anything else. A ledger you can correct is not a ledger.
5. **Derived tables are guarded by triggers, carriers by composite keys.** A derived table has no office column, so a
   composite key cannot reach it. The triggers compute the owner both ways and refuse a disagreement and a move; they run as
   their owner (0664), because a guard that depends on what the writer can see fails for the writers it exists to constrain.
6. **The compatibility bridge** binds a legacy write to the sole person only while he is the only real (person or sample)
   office; with a second it is NULL and the insert fails. It is metered. It is removed in P3, table by table, as the meter
   reaches zero. It is never consulted by a read.
7. **Per-office names for what a person chooses; global keys for what identifies a thing across the deployment.** A credential
   hash, a system-composed dedupe or idempotency key and an external provider id stay global.
8. **Row security is a tripwire, not a boundary.** One `ai_team_app` policy, `using (true)`, on the 46 tables that lacked
   any; no setting, no act-as role, no per-office predicate. `service_role` and `postgres` bypass it and the suite attacks as
   both.
9. **No callable function takes an office from its caller.** `provision_office` and `office_of_auth` were created and then
   removed because nothing called them; P3 adds them with their callers. `check:office-edges` fails if a public function
   gains a parameter named like an office.
10. **No second real office while an MCP client is enabled** until the office-bound MCP conversion is recorded
    (`system_config['mcp.office_bound']`); this is a gate failure, not a sentence.

## What would reverse this

Dropping a `*_same_office` key, the write-once triggers, the derived guards, or making a guard run as its invoker fails
`check:office-edges` and the isolated attack suite (13 sabotages each prove they go red). Moving harness rows out of the
person's office needs the harness to own projects first (P3).
