/**
 * The P3 application attack harness (multi-user P3). Person A and Person B are ordinary person offices with the
 * SAME project slug and distinct canary text; every converted function is driven as A against B's ids and B's data,
 * and then as B against A's. The proof is two-sided on purpose:
 *
 *   - a foreign id and a nonexistent id must produce THE SAME ANSWER (no existence oracle), and
 *   - the other office's rows must be byte-identical afterwards (no write crossed), and
 *   - the other office's canary text must appear nowhere in what A is given.
 *
 * Each cluster of converted functions adds a file to `p3-cases/` that exports `cases(ctx)`. They are all run, in
 * file order, by `p3-app-attack.ts`, against a clone made by `scripts/isolated/p3-attack.sh`.
 */
import { prepare } from './office-ownership-lib.ts'
import type { isolated } from './guard.ts'

export type Db = Awaited<ReturnType<typeof isolated>>
export type Result = { ok: boolean; what: string; detail: string }

export type Ctx = {
  db: Db
  /** Person A, Person B (ordinary person offices), Grant, the test office, the system office. */
  A: string
  B: string
  G: string
  T: string
  SYS: string
  /** A canary for each office: text that must never reach the other. */
  canary: { A: string; B: string }
  /** Record a result. */
  check(ok: boolean, what: string, detail?: string): void
  /**
   * Run `sql` as `role` in its own transaction and COMMIT. Returns the first column of the last row (a jsonb comes
   * back as an object), or throws with the database's message.
   */
  exec(role: string, sql: string): Promise<unknown>
  /** Run `sql` as `role` and ROLL BACK. Returns the error message, or '' if it was accepted. */
  refusal(role: string, sql: string): Promise<string>
  /** `exec` that returns the error message instead of throwing ('' => no error is not distinguishable: see `try_`). */
  try_(
    role: string,
    sql: string,
  ): Promise<{ ok: true; value: unknown } | { ok: false; error: string }>
  /** The database's own text for a value, to compare answers byte for byte. */
  json(v: unknown): string
  /** A uuid that exists nowhere. */
  nobody(): string
  /** A digest of everything an office owns in the given tables, to prove nothing of B's moved. */
  snapshot(office: string, tables: readonly string[]): Promise<string>
}

const stable = (v: unknown): string =>
  v === null || typeof v !== 'object'
    ? JSON.stringify(v)
    : Array.isArray(v)
      ? `[${v.map(stable).join(',')}]`
      : `{${Object.keys(v as object)
          .sort()
          .map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`)
          .join(',')}}`

export const lit = (s: string): string => `'${s.replaceAll("'", "''")}'`

export async function context(db: Db): Promise<{ ctx: Ctx; results: Result[] }> {
  const { A, B, G, T, SYS } = await prepare(db)
  const results: Result[] = []
  const ctx: Ctx = {
    db,
    A,
    B,
    G,
    T,
    SYS,
    canary: {
      A: `CANARY-A-${Math.random().toString(36).slice(2, 10)}`,
      B: `CANARY-B-${Math.random().toString(36).slice(2, 10)}`,
    },
    check: (ok, what, detail = '') => {
      results.push({ ok, what, detail })
    },
    exec: async (role, sql) => {
      try {
        await db.execute(`begin; set local role ${role}`)
        const r = await db.execute(sql)
        await db.execute('commit')
        const row = r.rows.at(-1) as Record<string, unknown> | undefined
        return row === undefined ? undefined : Object.values(row)[0]
      } catch (e) {
        await db.execute('rollback').catch(() => undefined)
        throw e
      }
    },
    refusal: async (role, sql) => {
      try {
        await db.execute(`begin; set local role ${role}; ${sql}`)
        return ''
      } catch (e) {
        return String((e as Error).message)
      } finally {
        await db.execute('rollback').catch(() => undefined)
      }
    },
    try_: async (role, sql) => {
      try {
        return { ok: true, value: await ctx.exec(role, sql) }
      } catch (e) {
        return { ok: false, error: String((e as Error).message) }
      }
    },
    json: (v) => stable(v),
    nobody: () => '99999999-9999-4999-8999-999999999999',
    snapshot: async (office, tables) => {
      const parts: string[] = []
      for (const t of tables) {
        const r = await db.execute(
          `select coalesce(md5(string_agg(x::text, '|' order by x::text)), '-') as h from public.${t} x where x.office_id = '${office}'`,
        )
        parts.push(`${t}=${String((r.rows[0] as { h: string }).h)}`)
      }
      return parts.join(',')
    },
  }
  return { ctx, results }
}

/** Every committed grant a caller-reachable function must NOT have. */
export const callerRoles = ['anon', 'authenticated'] as const
