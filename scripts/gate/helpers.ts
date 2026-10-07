/**
 * Files under scripts/isolated/ that are NOT proofs: the libraries, fixtures, emulators, schema and setup scripts the
 * proofs are built from. Listed so that a new file in that folder which is neither a proof nor a helper fails
 * tests/gate/registry.test.ts: that failure is the point, it is how a proof stops living outside every gate.
 *
 * Entries are the file's path under scripts/isolated/ without its extension, or `dir/*` for a whole directory.
 */
export const HELPERS: readonly { readonly stem: string; readonly role: string }[] = [
  { stem: 'guard', role: 'the connection every proof uses and the refusal that keeps it isolated (marker table, local socket)' },
  { stem: 'fixtures-approvals', role: 'fixtures: a real turn, a shown question, the door application name' },
  { stem: 'fixtures-jobs', role: 'fixtures: the office and project columns a hand-built job or command needs' },
  { stem: 'real-telegram', role: 'fixtures: a Telegram turn as the production adapter writes it' },
  { stem: 'shown', role: 'fixture: a question that reached him (superseded by fixtures-approvals markShown)' },
  { stem: 'telegram-door', role: 'emulator: the Telegram webhook door' },
  { stem: 'voice-door', role: 'emulator: the voice door' },
  { stem: 'edge-emulator', role: 'emulator: runs the real edge functions in Node with every non-replica URL refused' },
  { stem: 'storage-emulator', role: 'emulator: the Storage endpoints the backup code calls' },
  { stem: 'office-ownership-lib', role: 'library of the P2 attack suite' },
  { stem: 'p3-app-lib', role: 'library of the P3 application attack suite' },
  { stem: 'p3-cases/*', role: 'the case files p3-app-attack runs in name order' },
  { stem: 'policy-lib', role: 'library of the seven policy proofs' },
  { stem: 'replica', role: 'builds the replica databases base / pre / post from this repository\'s migrations' },
  { stem: 'p2-attack', role: 'setup: clones the candidate into a p2_attack_* database (the name the attack suite demands)' },
  { stem: 'p3-attack', role: 'setup: clones the candidate into a p3_attack_* database' },
  { stem: 'platform', role: 'the platform schemas the replica needs (auth, vault, storage, cron stand-ins)' },
  { stem: 'extensions/*', role: 'stand-ins for pg_cron and pg_net, copied into the server by replica.sh' },
  { stem: 'recovery-matrix.sql', role: 'recovery-matrix fixture' },
  { stem: 'recovery-matrix-run.sql', role: 'recovery-matrix driver' },
  { stem: 'restore-probe-schema', role: 'probe tables the typed restore proof builds to make each claim falsifiable' },
  { stem: 'schema-fingerprint', role: 'the catalogue fingerprint query replay-parity compares' },
  { stem: 'fresh-replay', role: 'the replay ENGINE replay-parity drives (an empty database in, 802+ migrations replayed with the committed tolerances)' },
  { stem: 'dump-memory-probe', role: 'one table dumped in a fresh process, called by backup-restore-typed' },
  { stem: 'run-all', role: 'the old runner, now a shim that calls the gate runner' },
  { stem: 'quarantine/README', role: 'why each quarantined proof is quarantined, and what replaced it' },
]
