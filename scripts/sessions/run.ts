/**
 * A working session with the office, one turn at a time, through the real door.
 *
 * Issue #237. The vehicle for every conversational property Campaign One found
 * had no coverage: corrections, changed intent, contradictions, referents,
 * cross-project switching, action-versus-discussion, multi-clause fidelity.
 *
 * ## Why a runner rather than another suite
 *
 * Those properties are not about one message. They are about what the office
 * does with the SECOND message given the first, and with the eleventh given
 * the third — and a suite that plants two rows and reads them back cannot see
 * any of it. `verify:conversation` proves a two-message exchange is understood;
 * `verify:history` proves the store is scoped. Neither replays a session.
 *
 * ## Everything goes through the canonical door
 *
 *     inbound_commands -> app.enqueue_inbound -> the deployed worker
 *
 * Never a direct handler call, never a hand-written job. §5 of the master spec
 * is that every surface writes to `inbound_commands` and asks the canonical
 * layer, and a harness that skips that is testing a path nobody uses.
 *
 * Turns thread the way the product threads them: `app.conversation_before`
 * groups by `(origin_channel, chat, subject)`, so a session is one
 * `origin_ref` and one actor, and the office sees the earlier turns exactly as
 * it would see Grant's.
 *
 * ## Nothing here can reach Grant
 *
 * `announce` is closed in the SAME TRANSACTION as the enqueue — it defaults to
 * true and the worker ticks every minute, so a separate UPDATE is a race
 * against his phone. The actor is `verify-sess-…`, which makes
 * `jobs.is_fixture` generated true (0342), so none of this reaches his health
 * readings either. Both are asserted, per turn, not assumed.
 *
 * ## Resumable, because a turn is a real job
 *
 * The office's median instruction is 53 seconds and a Claude session may not
 * background work or spend more than ten minutes on one command. So state
 * lives in `.out/sessions.jsonl`, one line per completed turn, and a re-run
 * picks up where it stopped. Same reasoning as `scripts/e2e.ts` (#226).
 *
 *   npm run session -- --only corrections        # one session
 *   npm run session -- --list                    # what exists
 *   npm run session -- --reset corrections       # forget its progress
 *   npm run session -- --report                  # score everything recorded
 *
 * ## Evidence, never prose
 *
 * An expectation is checked against canonical state — `jobs.recipient_agent`,
 * `routing_decisions`, `public.tasks`, `consultations` — except where the
 * property genuinely IS about the words, in which case it is a substring test
 * on `outputs.body` and says so. A claimed task is not a task.
 */

import { existsSync } from 'node:fs'
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import type { SqlExecutor } from '../../src/db/executor.ts'
import { ManagementApiExecutor } from '../../src/db/executor.ts'

const token = process.env.SUPABASE_ACCESS_TOKEN
if (token === undefined || token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is not set')
  process.exit(2)
}
export const db: SqlExecutor = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  token,
)
export const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
const one = async (sql: string): Promise<Record<string, unknown>> =>
  ((await db.execute(sql)).rows as Record<string, unknown>[])[0] ?? {}
const all = async (sql: string): Promise<Record<string, unknown>[]> =>
  (await db.execute(sql)).rows as Record<string, unknown>[]

/*
  The Management API throttles, and a throttle is not an answer.

  Learned in #232: a 429 falling through as a result turns a correct decision
  into a miss and moves a headline figure for reasons that have nothing to do
  with the office.
*/
export const patiently = async <T>(what: () => Promise<T>): Promise<T> => {
  let last: unknown
  for (const wait of [0, 2_000, 5_000, 12_000, 25_000]) {
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    try {
      return await what()
    } catch (error) {
      last = error
      if (!String((error as Error).message).includes('Too Many Requests')) throw error
    }
  }
  throw last
}

/** What a turn must be true of, checked against canonical state. */
export interface Expect {
  /** `jobs.recipient_agent` — who actually answered. */
  readonly agent?: string
  /** Anybody but this. Used where the wrong specialist is the defect. */
  readonly notAgent?: string
  /** The project the job was filed against, by slug. */
  readonly project?: string
  /** No task, document or project mutation may result from this turn. */
  readonly noWrite?: true
  /** Exactly this many tasks must exist for the session after this turn. */
  readonly tasks?: number
  /** The answer must contain each of these, case-insensitively. */
  readonly says?: readonly string[]
  /** The answer must contain none of these. Where contamination is the defect. */
  readonly neverSays?: readonly string[]
  /** The office should ask rather than guess. */
  readonly clarifies?: true
}

export interface Turn {
  readonly say: string
  /** Which dashboard project the surface says this message is about, if any. */
  readonly inProject?: string
  readonly expect?: Expect
  /** What this turn is testing, printed beside the result. */
  readonly why: string
}

export interface Session {
  readonly name: string
  readonly about: string
  /** Projects to create for this session, by short label. */
  readonly projects?: readonly string[]
  readonly turns: readonly Turn[]
}

const RECORD = '.out/sessions.jsonl'

export interface TurnResult {
  session: string
  index: number
  at: string
  say: string
  why: string
  jobId: string
  state: string
  agent: string
  projectSlug: string
  roster: string
  intent: string
  answered: string
  taskCount: number
  /** The titles themselves, because teardown removes the rows. */
  taskTitles: string[]
  announced: boolean
  fixture: boolean
  passes: string[]
  fails: string[]
}

const recorded = async (): Promise<TurnResult[]> => {
  if (!existsSync(RECORD)) return []
  const raw = await readFile(RECORD, 'utf8')
  return raw
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as TurnResult)
}

/**
 * One turn, injected and waited on.
 *
 * Returns null when the office did not finish inside the deadline, which is a
 * result rather than an error: a turn that never lands is exactly the failure
 * Grant would experience, and the report needs to say so rather than crash.
 */
export const askOnce = async (
  session: Session,
  index: number,
  turn: Turn,
  chat: string,
  actor: string,
  projects: ReadonlyMap<string, string>,
  deadlineMs = 7 * 60 * 1000,
): Promise<TurnResult> => {
  const key = `teamhq:sess_${session.name.replace(/[^a-z0-9]/g, '_')}:${chat}-${String(index)}`
  const projectId = turn.inProject === undefined ? null : (projects.get(turn.inProject) ?? null)

  const jobId = String(
    (
      await patiently(
        async () =>
          await one(`
            begin;
            insert into public.inbound_commands
              (origin_channel, origin_ref, actor, instruction, dedupe_key, received_at, project_id)
            values ('teamhq', ${lit(`${chat}:${String(index)}`)}, ${lit(actor)},
                    ${lit(turn.say)}, ${lit(key)}, app.now_utc(),
                    ${projectId === null ? 'null' : `${lit(projectId)}::uuid`});
            create temp table _j as
              select (app.enqueue_inbound(
                        (select command_id from public.inbound_commands
                          where dedupe_key = ${lit(key)})
                      ) ->> 'job_id')::uuid as id;
            update public.jobs set announce = false where job_id = (select id from _j);
            select (select id from _j)::text as id;
            commit;`),
      )
    ).id,
  )

  const until = Date.now() + deadlineMs
  let row: Record<string, unknown> = {}
  while (Date.now() < until) {
    row = await patiently(
      async () =>
        await one(`
          select j.state::text as state, j.announce, app.harness_job(j.job_id) as fixture,
                 coalesce(j.recipient_agent, '') as agent,
                 coalesce(p.slug, '') as project_slug,
                 coalesce(r.intent_class, '') as intent,
                 coalesce(array_to_string(r.roster, ','), '') as roster,
                 coalesce((select left(o.body, 4000) from public.outputs o
                            where o.job_id = j.job_id order by o.created_at desc limit 1), '')
                   as answered
            from public.jobs j
            left join public.projects p on p.project_id = j.project_id
            left join public.routing_decisions r on r.job_id = j.job_id
           where j.job_id = ${lit(jobId)}::uuid`),
    )
    if (['complete', 'failed', 'cancelled'].includes(String(row.state))) break
    process.stdout.write('.')
    await new Promise((r) => setTimeout(r, 10_000))
  }

  /*
    Tasks are counted for the SESSION, not globally.

    `public.tasks` is shared, and a count that included Grant's own would make
    every "no write happened" assertion depend on what else the office did
    tonight. Scoped by the projects this session created.
  */
  const ids = [...projects.values()]
  /*
    Titles as well as the count, because the teardown deletes the rows.

    A record that says "1 task" and nothing else cannot be checked afterwards,
    and this harness's whole claim is that its evidence is canonical rather
    than reported. The titles survive in `.out/sessions.jsonl` long after the
    fixture project is swept.
  */
  const tasks =
    ids.length === 0
      ? []
      : await all(`
          select title from public.tasks
           where project_id = any(array[${ids.map((i) => `${lit(i)}::uuid`).join(',')}])
           order by created_at`)
  const taskCount = tasks.length

  const answered = String(row.answered ?? '')
  const passes: string[] = []
  const fails: string[] = []
  const judge = (what: string, good: boolean, note = ''): void => {
    ;(good ? passes : fails).push(`${what}${note === '' ? '' : ` (${note})`}`)
  }

  /* The two safety properties, on every single turn, never assumed. */
  judge('cannot reach Grant', row.announce === false)
  judge('is harness traffic', row.fixture === true)

  const e = turn.expect
  if (e !== undefined) {
    if (e.agent !== undefined)
      judge(`answered by ${e.agent}`, row.agent === e.agent, String(row.agent) || 'nobody')
    if (e.notAgent !== undefined)
      judge(`not answered by ${e.notAgent}`, row.agent !== e.notAgent, String(row.agent))
    if (e.project !== undefined)
      judge(
        `filed against ${e.project}`,
        String(row.project_slug).includes(e.project),
        String(row.project_slug) || 'no project',
      )
    if (e.tasks !== undefined)
      judge(`${String(e.tasks)} task(s) exist`, taskCount === e.tasks, String(taskCount))
    if (e.noWrite === true) judge('no task was created', taskCount === 0, String(taskCount))
    for (const s of e.says ?? [])
      judge(`says ${JSON.stringify(s)}`, answered.toLowerCase().includes(s.toLowerCase()))
    for (const s of e.neverSays ?? [])
      judge(`never says ${JSON.stringify(s)}`, !answered.toLowerCase().includes(s.toLowerCase()))
    if (e.clarifies === true)
      judge(
        'asks rather than guesses',
        /\?/.test(answered) && answered.length < 1200,
        `${String(answered.length)} chars`,
      )
  }

  return {
    session: session.name,
    index,
    at: new Date().toISOString(),
    say: turn.say,
    why: turn.why,
    jobId,
    state: String(row.state ?? 'never started'),
    agent: String(row.agent ?? ''),
    projectSlug: String(row.project_slug ?? ''),
    roster: String(row.roster ?? ''),
    intent: String(row.intent ?? ''),
    answered,
    taskCount,
    taskTitles: tasks.map((t) => String(t.title)),
    announced: row.announce === true,
    fixture: row.fixture === true,
    passes,
    fails,
  }
}

/**
 * Teardown.
 *
 * A completed job is terminal and `complete -> cancelled` is refused by
 * `enforce_job_transition`, correctly — a finished job did not later get
 * cancelled. Only what is still waiting is cancelled. Tasks the session created
 * are removed; the projects are left to `check:leaks`, because a project
 * holding a job can never be deleted (ADR-0022) and these are fixtures.
 */
export const tidy = async (
  jobIds: readonly string[],
  projects: ReadonlyMap<string, string>,
): Promise<void> => {
  if (jobIds.length > 0) {
    await db
      .execute(`
        update public.jobs set state = 'cancelled', finished_at = app.now_utc(),
               state_reason = 'session harness teardown'
         where job_id = any(array[${jobIds.map((j) => `${lit(j)}::uuid`).join(',')}])
           and state in ('queued', 'retrying', 'paused')`)
      .catch(() => undefined)
  }
  const ids = [...projects.values()]
  if (ids.length > 0) {
    await db
      .execute(
        `delete from public.tasks where project_id = any(array[${ids.map((i) => `${lit(i)}::uuid`).join(',')}])`,
      )
      .catch(() => undefined)
  }
}

export const remember = async (r: TurnResult): Promise<void> => {
  await mkdir('.out', { recursive: true })
  await appendFile(RECORD, `${JSON.stringify(r)}\n`)
}

export const forget = async (session: string): Promise<void> => {
  const kept = (await recorded()).filter((r) => r.session !== session)
  await mkdir('.out', { recursive: true })
  await writeFile(RECORD, kept.map((r) => `${JSON.stringify(r)}\n`).join(''))
}

export const done = async (session: string): Promise<number> =>
  (await recorded()).filter((r) => r.session === session).length

export { all, one, recorded }
