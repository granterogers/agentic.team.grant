/**
 * Files under scripts/isolated/ that are NOT proofs: the libraries, fixtures, emulators, schema and setup scripts the
 * proofs are built from. Listed so that a new file in that folder which is neither a proof nor a helper fails
 * tests/gate/registry.test.ts: that failure is the point, it is how a proof stops living outside every gate.
 *
 * Entries are the file's path under scripts/isolated/ without its extension, or `dir/*` for a whole directory.
 */
export const HELPERS: readonly { readonly stem: string; readonly role: string }[] = [
  {
    stem: 'activity-ledger-perf',
    role: 'NOT a gate: measures what the unified activity ledger costs (read latency against history, write cost, concurrency, footprint) and reports; run by hand with a job count',
  },
  {
    stem: 'activity-ledger-sabotage',
    role: 'NOT a proof: breaks each protection of the unified activity ledger on a copy and requires the named proof to go red, then runs the unmodified control; run by hand (about 15 minutes)',
  },
  {
    stem: 'activity-migration-rehearsal',
    role: 'NOT a gate: rehearses the ledger deployment failure modes (a failing migration, an interrupted concurrent index build, a transaction-wrapped connection) on a clone with only 1060 applied; run by hand through its .sh wrapper',
  },
  {
    stem: 'activity-read-concurrency',
    role: 'NOT a gate: p50 and p95 of the newest page, a diagnostic page and a sparse filter for one reader and for several at once, on a database activity-ledger-perf has seeded; reports and asserts shape only',
  },
  {
    stem: 'activity-mixed-version',
    role: "NOT a gate: the new worker's ledger writers over a schema WITHOUT the ledger (a deploy ordering mistake); run by hand on a clone of a replica built from main",
  },
  {
    stem: 'activity-ui-browser',
    role: 'NOT a gate: draws the Activity screen from genuine ledger rows through the real gateway in a real browser at 1440, 390 and 320; run by hand through its .sh wrapper (about 4 minutes)',
  },
  {
    stem: 'activity-ui-seed',
    role: 'the genuine ledger records activity-ui-browser draws (written to the owning tables and through the ledger writers); not a proof',
  },
  {
    stem: 'activity-ux-browser',
    role: 'NOT a gate: the Activity UX (timeline, filters, Needs attention, details, related activity) in a real browser through the real gateway at 1440, 768, 390 and 320 with two signed-in offices; run by hand through its .sh wrapper (about 7 minutes); --baseline photographs the page before a change',
  },
  {
    stem: 'activity-ux-checks',
    role: 'the assertions activity-ux-browser runs (compared with the gateway answer and the database); not a proof on its own',
  },
  {
    stem: 'activity-ux-seed',
    role: 'the genuine multi-day, mixed-actor records activity-ux-browser draws (jobs, approvals, deliveries, native and external events; backdated in a disposable replica only); not a proof',
  },
  {
    stem: 'guard',
    role: 'the connection every proof uses and the refusal that keeps it isolated (marker table, local socket)',
  },
  {
    stem: 'reference/dequeue.efficiency-1030',
    role: "frozen text: efficiency's unapplied 1030 as written, the CONTROL dequeue-reconciled installs in a scratch schema to show the conflict with 1044 is real; never applied",
  },
  {
    stem: 'fixtures-approvals',
    role: 'fixtures: a real turn, a shown question, the door application name',
  },
  {
    stem: 'fixtures-jobs',
    role: 'fixtures: the office and project columns a hand-built job or command needs',
  },
  { stem: 'real-telegram', role: 'fixtures: a Telegram turn as the production adapter writes it' },
  {
    stem: 'real-model-acceptance',
    role: 'NOT a proof: the controlled real-model run (a real provider, a few cents, answers vary); it reports deterministic and model-dependent lines separately and is read by a person, so it is never a gate',
  },
  {
    stem: 'shown',
    role: 'fixture: a question that reached him (superseded by fixtures-approvals markShown)',
  },
  { stem: 'telegram-door', role: 'emulator: the Telegram webhook door' },
  { stem: 'voice-door', role: 'emulator: the voice door' },
  {
    stem: 'edge-emulator',
    role: 'emulator: runs the real edge functions in Node with every non-replica URL refused',
  },
  { stem: 'storage-emulator', role: 'emulator: the Storage endpoints the backup code calls' },
  { stem: 'office-ownership-lib', role: 'library of the P2 attack suite' },
  { stem: 'p3-app-lib', role: 'library of the P3 application attack suite' },
  { stem: 'p3-cases/*', role: 'the case files p3-app-attack runs in name order' },
  { stem: 'policy-lib', role: 'library of the seven policy proofs' },
  {
    stem: 'replica',
    role: "builds the replica databases base / pre / post from this repository's migrations",
  },
  {
    stem: 'p2-attack',
    role: 'setup: clones the candidate into a p2_attack_* database (the name the attack suite demands)',
  },
  { stem: 'p3-attack', role: 'setup: clones the candidate into a p3_attack_* database' },
  {
    stem: 'platform',
    role: 'the platform schemas the replica needs (auth, vault, storage, cron stand-ins)',
  },
  {
    stem: 'extensions/*',
    role: 'stand-ins for pg_cron and pg_net, copied into the server by replica.sh',
  },
  { stem: 'recovery-matrix.sql', role: 'recovery-matrix fixture' },
  { stem: 'recovery-matrix-run.sql', role: 'recovery-matrix driver' },
  {
    stem: 'restore-probe-schema',
    role: 'probe tables the typed restore proof builds to make each claim falsifiable',
  },
  { stem: 'schema-fingerprint', role: 'the catalogue fingerprint query replay-parity compares' },
  {
    stem: 'fresh-replay',
    role: 'the replay ENGINE replay-parity drives (an empty database in, every migration replayed with the committed tolerances)',
  },
  {
    stem: 'dump-memory-probe',
    role: 'one table dumped in a fresh process, called by backup-restore-typed',
  },
  { stem: 'run-all', role: 'the old runner, now a shim that calls the gate runner' },
  {
    stem: 'quarantine/README',
    role: 'why each quarantined proof is quarantined, and what replaced it',
  },
]
