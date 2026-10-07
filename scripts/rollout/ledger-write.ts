/**
 * The one-row migration LEDGER write that `step.ts record` / `unrecord` performs, and what it leaves in the rollout write log.
 * Moved out of step.ts so it can be driven with a fake executor: step.ts exits the process, so nothing in it can be tested.
 *
 * It imports nothing that reaches a network. The caller supplies the executor and the logger.
 */

import type { SqlExecutor } from '../../src/db/executor.ts'

export type LedgerAction = 'record' | 'unrecord'

export interface LedgerWrite {
  db: Pick<SqlExecutor, 'execute'>
  action: LedgerAction
  stepId: string
  /** The migration file name; the caller has already checked its shape. */
  name: string
  /** The pinned sha256 of that file. */
  sha256: string
  logWrite: (what: string, ok: boolean, detail?: string) => void
}

const count = async (db: LedgerWrite['db'], name: string): Promise<number> =>
  (
    (
      await db.execute(
        `select count(*)::int as n from app.schema_migrations where name = '${name}'`,
      )
    ).rows[0] as { n: number }
  ).n

/**
 * Writes (or removes) exactly one ledger row and reports whether the table now says what was asked.
 *
 * The write log is the audit trail, so every call that gets as far as an attempt closes it with a completed entry named like the
 * action (`record 1023`): ok:true only when the table says what was asked, ok:false with a reason otherwise. A bare
 * `*-attempt` line therefore means the process died between the two, and nothing else. (Apply and rollback already did this;
 * record and unrecord logged the attempt and stopped, so a successful record read as a failed one.) The reason for a throw is
 * the word `threw`, never the message: an executor error can carry a request.
 */
export async function writeLedgerRow(w: LedgerWrite): Promise<{ ok: boolean; after: number }> {
  const done = `${w.action} ${w.stepId}`
  w.logWrite(`${w.action}-attempt ${w.stepId}`, false)
  let after: number
  try {
    await w.db.execute(
      w.action === 'record'
        ? `insert into app.schema_migrations (name, checksum, duration_ms) values ('${w.name}', '${w.sha256}', 0)
             on conflict (name) do update set checksum = excluded.checksum`
        : `delete from app.schema_migrations where name = '${w.name}' and checksum = '${w.sha256}'`,
    )
    after = await count(w.db, w.name)
  } catch (e) {
    w.logWrite(done, false, 'threw')
    throw e
  }
  const ok = w.action === 'record' ? after === 1 : after === 0
  w.logWrite(done, ok, ok ? undefined : `ledger row count is ${String(after)}, not what was asked`)
  return { ok, after }
}
