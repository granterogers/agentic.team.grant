/**
 * What every final-policy suite needs, once (final policy closure).
 *
 * The real `hq-api` gateway runs against the replica with a verified PERSON (the owner) and a verified TEST member,
 * the way `principals.ts` does, so a connection or a project creation arrives with the principal the gateway wrote and
 * not one a suite typed in. Jobs a duty would make are inserted with the requester a duty has; a person's own turn is
 * built with `realParent`, from the adapter's own key. The database is then asked what happened.
 */
import type { PgExecutor } from '../../src/db/pg-executor.ts'
import type { Job } from '../../src/jobs/worker.ts'
import { startEdge } from './edge-emulator.ts'
import { isolated } from './guard.ts'
import { realParent } from './real-telegram.ts'

export const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
export const json = (v: unknown): Record<string, unknown> =>
  (typeof v === 'string' ? JSON.parse(v) : (v ?? {})) as Record<string, unknown>

const GRANT_EMAIL = 'grant.e.rogers@gmail.com'
const HARNESS_EMAIL = 'verify.operator@example.com'
const S_GRANT = `aaa.bbb.${'g'.repeat(70)}`
const S_HARNESS = `aaa.bbb.${'h'.repeat(70)}`
export const TOKEN = 'isolated-hq-token'

export interface World {
  readonly db: PgExecutor
  readonly run: string
  readonly one: (sql: string) => Promise<Record<string, unknown>>
  readonly rows: (sql: string) => Promise<Record<string, unknown>[]>
  readonly check: (what: string, ok: boolean, detail: string) => void
  readonly finish: () => Promise<void>
  /** A gateway action as a verified person / as the office key / as a verified test member. */
  readonly asPerson: (action: string, args: Record<string, unknown>) => Promise<GwResult>
  readonly asKey: (action: string, args: Record<string, unknown>) => Promise<GwResult>
  readonly asTest: (action: string, args: Record<string, unknown>) => Promise<GwResult>
  /** A job a duty made: queued, requested by `duty:<name>`, no person behind it. */
  readonly dutyJob: (kind: string, project?: string | null) => Promise<Job>
  /** A job as it would reach a handler, from its row. */
  readonly jobOf: (id: string) => Promise<Job>
  /** A person's own turn (Grant's chat, through a production door). */
  readonly personTurn: () => Promise<string>
  /** A child of `parent`, of `kind`, the way a person's turn makes one. */
  readonly childOf: (parent: string, kind: string, project?: string | null) => Promise<Job>
  readonly answer: (
    blocker: string,
    option: string,
    by?: string,
  ) => Promise<Record<string, unknown>>
}
export interface GwResult {
  readonly status: number
  readonly body: Record<string, unknown>
}

export async function policyWorld(defaultDb: string): Promise<World> {
  const db = await isolated(process.argv[2] ?? defaultDb)
  const run = Date.now().toString(36)
  const results: { ok: boolean }[] = []
  const one = async (sql: string) => (await db.execute(sql)).rows[0] as Record<string, unknown>
  const rows = async (sql: string) => (await db.execute(sql)).rows as Record<string, unknown>[]
  const check = (what: string, ok: boolean, detail: string) => {
    results.push({ ok })
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${what} - ${detail}`)
  }
  const gw = await startEdge({
    db,
    edgeFile: 'supabase/functions/hq-api/index.ts',
    env: {
      HQ_API_TOKEN: TOKEN,
      SUPABASE_SERVICE_ROLE_KEY: 'isolated-service-key',
      SUPABASE_ANON_KEY: 'isolated-anon',
      SIGNIN_ALLOWED_ORIGIN: 'https://page.invalid',
    },
    authUsers: { [S_GRANT]: GRANT_EMAIL, [S_HARNESS]: HARNESS_EMAIL },
  })
  const act =
    (bearer: string) =>
    async (action: string, args: Record<string, unknown>): Promise<GwResult> => {
      const r = await gw.call(
        new Request('https://gw.invalid/functions/v1/hq-api', {
          method: 'POST',
          headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, args }),
        }),
      )
      return {
        status: r.status,
        body: (await r.json().catch(() => ({}))) as Record<string, unknown>,
      }
    }
  const jobOf = async (id: string): Promise<Job> => {
    const r =
      await one(`select job_id::text as id, kind, correlation_id::text as c, project_id::text as p,
        idempotency_key as k, attempt from public.jobs where job_id = ${lit(id)}::uuid`)
    return {
      jobId: String(r.id),
      kind: String(r.kind),
      correlationId: String(r.c),
      projectId: r.p === null ? null : String(r.p),
      idempotencyKey: String(r.k),
      attempt: Number(r.attempt ?? 1),
    }
  }
  return {
    db,
    run,
    one,
    rows,
    check,
    finish: async () => {
      const failed = results.filter((r) => !r.ok).length
      console.log(`\n${results.length - failed}/${results.length} passed`)
      await db.end?.()
      process.exitCode = failed === 0 ? 0 : 1
    },
    asPerson: act(S_GRANT),
    asKey: act(TOKEN),
    asTest: act(S_HARNESS),
    dutyJob: async (kind, project = null) =>
      jobOf(
        String(
          (
            await one(`insert into public.jobs (kind, requested_by, project_id, idempotency_key, correlation_id)
              values (${lit(kind)}, 'duty:' || coalesce((select slug from public.responsibilities where job_kind = ${lit(kind)} limit 1), (select slug from public.responsibilities order by slug limit 1)), ${project === null ? 'null' : `${lit(project)}::uuid`},
                      'pol-' || gen_random_uuid(), gen_random_uuid())
              returning job_id::text as id`)
          ).id,
        ),
      ),
    jobOf,
    personTurn: () => realParent(db),
    childOf: async (parent, kind, project = null) => {
      const made = String(
        (
          await one(
            `select app.enqueue_child(app.job_office(${lit(parent)}::uuid), ${lit(parent)}::uuid, ${lit(kind)}, '{}'::jsonb)::text as c`,
          )
        ).c,
      )
      const id = /[0-9a-f-]{36}/.exec(made)?.[0]
      if (id === undefined) throw new Error(`no child made: ${made}`)
      if (project !== null) {
        await one(
          `update public.jobs set project_id = ${lit(project)}::uuid where job_id = ${lit(id)}::uuid returning 1 as x`,
        )
      }
      return jobOf(id)
    },
    answer: async (blocker, option, by = 'grant') =>
      json(
        (
          await one(
            `select app.hq_answer_blocker(${lit(blocker)}::uuid, ${lit(option)}, ${lit(by)}) as r`,
          )
        ).r,
      ),
  }
}
