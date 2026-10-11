/**
 * The handler seam for the Hermes engine (INTERFACE-CONTRACTS section 8).
 *
 * `src/handlers/instruction.ts` calls this module twice and changes nothing else:
 *
 *   (a) `engineRunFor`   - first thing after the payload is read: does this job already hold a Hermes run? Then it is a RESUME.
 *   (b) `commandEngine`  - once the instruction is resolved: did the person choose Hermes for this message? Then OPEN a run.
 *
 * What this file guarantees, because each is a rule the whole integration rests on:
 *
 *   - NO AUTOMATIC SWITCHING. An engine is chosen by a person, per message, and never changed by anything that fails. So a read that
 *     fails for any reason except "this database predates the engine" is RETHROWN: the worker retries the job, and the job never
 *     falls through to the team's paid path because a query hiccupped. (The first draft of the contract said to fail toward the team;
 *     that is an automatic switch, and is deviation D-17.)
 *   - An unavailable Hermes is an honest sentence, composed in code, with NO model call and no routing decision. Nothing else is done.
 *   - The run is opened once per job (the database makes it idempotent) and the job parks as `dependency_wait` until the bridge finishes.
 *   - Hermes's answer is an untrusted model answer: `hermesOutput` labels it inferred and grounds it only on what the tool gate served.
 *
 * Everything the handler already owns (reading a conversation, the gates, delivery) is passed in or done by the worker afterwards.
 */
import { guidanceFor } from '../../agents/guidance.ts'
import { howComposed, provenanceNote } from '../../agents/provenance.ts'
import type { SqlExecutor } from '../../db/executor.ts'
import { pauseJob, stopRequested } from '../../jobs/checkpoint.ts'
import type { HandlerOutput, Job } from '../../jobs/worker.ts'
import { currentPerson } from '../../office/person.ts'
import { CAN_DO, CANNOT_DO, hermesBrief, hermesHistory, type PriorTurn } from './brief.ts'
import {
  cancelledSentence,
  expiredSentence,
  failedSentence,
  hermesOutput,
  type RunGrounding,
  saying,
  unavailableSentence,
} from './result.ts'
import { LIMITS } from './timing.ts'
import { type EngineName, type EngineRunRow, engineOf, type HermesRunRequest } from './types.ts'

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

/**
 * The pause the job sits in while Hermes works, and how soon the worker may look again if nothing woke it.
 *
 * A finished run wakes the job at once, so this is only the safety look that notices a deadline passing or a bridge that went quiet
 * (nobody else settles those). Each look writes one parked output row, so it is a minute, not seconds: at most about fifteen rows a run.
 */
const RECHECK_MS = 60_000
const GRACE_MS = 60_000

export interface HermesTurnDeps {
  readonly db: SqlExecutor
  /** The conversation before this message, in the handler's own reader (it is local to `instruction.ts`). */
  readonly turnsBefore: (commandId: string, jobId: string) => Promise<readonly PriorTurn[]>
  readonly now?: () => Date
}

export interface OpenInput {
  /** What the person said, cleaned and paired exactly as the team path would read it. */
  readonly instruction: string
  readonly commandId: string
}

/** True only for "this database does not have the engine yet" (a missing function or column). Anything else is a real failure. */
const predatesEngine = (error: unknown): boolean =>
  /42883|42703|does not exist/i.test(String((error as Error)?.message ?? error))

const officeOf = (jobId: string): string => `app.job_office(${lit(jobId)}::uuid)`

const asJson = <T>(raw: unknown): T => (typeof raw === 'string' ? JSON.parse(raw) : raw) as T

/**
 * (a) The job's Hermes run, or null when it has none.
 *
 * Null means "not a Hermes job" ONLY when the answer is genuinely none, or the database predates the engine. A failed read throws: a
 * job that holds a run must never be answered by the team because a query failed.
 */
export async function engineRunFor(db: SqlExecutor, job: Job): Promise<EngineRunRow | null> {
  try {
    const { rows } = await db.execute(
      `select app.engine_run_for_job(${officeOf(job.jobId)}, ${lit(job.jobId)}::uuid) as r`,
    )
    const raw = (rows[0] as { r?: unknown } | undefined)?.r
    if (raw === null || raw === undefined) return null
    return asJson<EngineRunRow>(raw)
  } catch (error) {
    if (predatesEngine(error)) return null
    throw error
  }
}

/**
 * (b) Which engine the person chose for this message. `team` unless the command row says `hermes`.
 *
 * Fails toward the team only for a job with no command, or a database with no engine column. A read that fails any other way throws, so
 * a message the person sent to Hermes is never quietly answered by the team.
 */
export async function commandEngine(
  db: SqlExecutor,
  job: Job,
  commandId: string,
): Promise<EngineName> {
  if (commandId === '') return 'team'
  try {
    const { rows } = await db.execute(
      `select engine from public.inbound_commands
        where command_id = ${lit(commandId)}::uuid and office_id = ${officeOf(job.jobId)}`,
    )
    return engineOf((rows[0] as { engine?: unknown } | undefined)?.engine)
  } catch (error) {
    if (predatesEngine(error)) return 'team'
    throw error
  }
}

/** The person's own standing instructions, as written. A specialist's inferred belief is not an order and is not passed on. */
const statedRules = async (db: SqlExecutor, job: Job): Promise<string[]> => {
  const g = await guidanceFor(db, { jobId: job.jobId }, 'chief-of-staff', job.kind, job.projectId)
  return g.lessons.filter((l) => l.stated).map((l) => l.body)
}

interface ProjectRow {
  readonly slug: string
  readonly name: string
  readonly reserved: boolean
}

/** The open projects, and the one in focus. The same office, the same fixture filter, and the same question the team path asks. */
const openProjects = async (
  db: SqlExecutor,
  job: Job,
): Promise<{ open: ProjectRow[]; focus: ProjectRow | null }> => {
  const { rows } = await db.execute(
    `select slug, name, reserved_reason is not null as reserved, project_id::text as id
       from public.projects
      where office_id = ${officeOf(job.jobId)} and status = 'active'
        and (app.harness_job(${lit(job.jobId)}::uuid) or not is_fixture)
      order by reserved, updated_at desc limit 25`,
  )
  const all = rows as unknown as (ProjectRow & { id: string })[]
  return {
    open: all.map((p) => ({ slug: p.slug, name: p.name, reserved: p.reserved })),
    focus:
      job.projectId === null
        ? null
        : (() => {
            const hit = all.find((p) => p.id === job.projectId)
            return hit === undefined
              ? null
              : { slug: hit.slug, name: hit.name, reserved: hit.reserved }
          })(),
  }
}

/** Mirrors `projectSpine` in the handler (which is not importable from here without a cycle): same sentence, same exclusion of the reserved place. */
const spineOf = (rows: readonly ProjectRow[]): string => {
  const open = rows.filter((p) => !p.reserved).map((p) => p.name)
  const held = rows.filter((p) => p.reserved).map((p) => p.name)
  if (open.length === 0 && held.length === 0) return ''
  return (
    `The projects open right now, ${String(open.length)} of them: ${open.join(', ')}.` +
    (held.length === 0
      ? ''
      : ` There is also a reserved place called ${held.join(', ')}, where anything that names no project lands. It is not one of the person's projects.`)
  )
}

const quiet = async (db: SqlExecutor, job: Job): Promise<HandlerOutput> => ({
  ...saying('Hermes is working on it.', job.jobId, false),
  path: await howComposed(db, job.jobId),
})

/** Park the job until the bridge finishes the run (which wakes it), or until it is worth looking again. */
const waitForHermes = async (
  deps: HermesTurnDeps,
  job: Job,
  deadlineAt: string,
): Promise<HandlerOutput> => {
  const now = (deps.now ?? (() => new Date()))()
  await pauseJob(
    deps.db,
    job.jobId,
    {
      reason: 'dependency_wait',
      detail: 'Hermes is working on it.',
      resumeWhen: 'Waiting for Hermes to finish.',
      resumable: true,
      until: new Date(now.getTime() + RECHECK_MS),
      expiresAt: new Date(new Date(deadlineAt).getTime() + GRACE_MS),
    },
    job,
  )
  return quiet(deps.db, job)
}

/**
 * The Chief of Staff relays the turn, as she does for every message the person sends: the answer is attributed to her and reaches the
 * person through her bot ("I only get messages from the chief of staff"). That it was Hermes who wrote it is the engine run's fact, and the
 * label on the answer (Team HQ, M6) is read from the run, never from this column.
 */
const relayedByChief = async (db: SqlExecutor, job: Job): Promise<void> => {
  // raw-sql[2]: keyed by the claimed job; it sets one column of the job the worker holds.
  await db
    .execute(
      `update public.jobs set recipient_agent = 'chief-of-staff'
        where job_id = ${lit(job.jobId)}::uuid and office_id = ${officeOf(job.jobId)}`,
    )
    .catch(() => undefined)
}

const unavailable = async (db: SqlExecutor, job: Job, because: string): Promise<HandlerOutput> => {
  await relayedByChief(db, job)
  return {
    ...saying(unavailableSentence(because), job.jobId),
    path: await howComposed(db, job.jobId),
  }
}

/** First pass: open the run, park the job, say nothing yet. */
export async function openHermesTurn(
  deps: HermesTurnDeps,
  job: Job,
  said: OpenInput,
): Promise<HandlerOutput> {
  const { db } = deps
  const avail = asJson<{ available?: boolean; because?: string | null }>(
    (
      (await db.execute(`select app.engine_available(${officeOf(job.jobId)}, 'hermes') as r`))
        .rows[0] as { r?: unknown } | undefined
    )?.r ?? {},
  )
  if (avail.available !== true)
    return unavailable(db, job, avail.because ?? "Hermes isn't available right now")

  const [rules, projects, turns] = await Promise.all([
    statedRules(db, job),
    openProjects(db, job),
    deps.turnsBefore(said.commandId, job.jobId).catch(() => [] as readonly PriorTurn[]),
  ])
  const request: HermesRunRequest = {
    input: said.instruction.slice(0, LIMITS.input),
    instructions: hermesBrief({
      person: currentPerson().name,
      project:
        projects.focus === null ? null : { name: projects.focus.name, slug: projects.focus.slug },
      projectSpine: spineOf(projects.open),
      standingRules: rules,
      provenanceNote: provenanceNote(),
      canDo: CAN_DO,
      cannotDo: CANNOT_DO,
    }),
    conversation_history: hermesHistory(turns),
  }
  const opened = asJson<{ run_id?: string; error?: string; because?: string }>(
    (
      (
        await db.execute(
          `select app.engine_run_open(${officeOf(job.jobId)}, ${lit(job.jobId)}::uuid, 'hermes',
                                      ${lit(JSON.stringify(request))}::jsonb) as r`,
        )
      ).rows[0] as { r?: unknown } | undefined
    )?.r ?? {},
  )
  if (opened.error !== undefined || opened.run_id === undefined)
    return unavailable(db, job, opened.because ?? "Hermes isn't available right now")

  const run = await engineRunFor(db, job)
  if (run === null) return unavailable(db, job, "Hermes isn't available right now")
  return waitForHermes(deps, job, run.deadline_at)
}

interface StoredRun {
  readonly request: HermesRunRequest
  readonly minutes: number
}

const readStoredRun = async (db: SqlExecutor, job: Job, runId: string): Promise<StoredRun> => {
  const { rows } = await db.execute(
    `select request, round(extract(epoch from (deadline_at - created_at)) / 60)::int as minutes
       from public.engine_runs
      where run_id = ${lit(runId)}::uuid and office_id = ${officeOf(job.jobId)} and job_id = ${lit(job.jobId)}::uuid`,
  )
  const row = rows[0] as { request?: unknown; minutes?: number } | undefined
  return {
    request: asJson<HermesRunRequest>(
      row?.request ?? { input: '', instructions: '', conversation_history: [] },
    ),
    minutes: Number(row?.minutes ?? 15),
  }
}

/** Every later pass: the run is the state, and the answer is whatever it has become. */
export async function resumeHermesTurn(
  deps: HermesTurnDeps,
  job: Job,
  run: EngineRunRow,
): Promise<HandlerOutput> {
  const { db } = deps
  if (run.state === 'open' || run.state === 'running')
    return waitForHermes(deps, job, run.deadline_at)

  await relayedByChief(db, job)
  const stored = await readStoredRun(db, job, run.run_id)
  const done = async (said: ReturnType<typeof saying>): Promise<HandlerOutput> => ({
    ...said,
    path: await howComposed(db, job.jobId),
  })

  if (run.state === 'cancelled')
    return done(
      // A person who pressed Stop has their acknowledgement already; anyone else is told it stopped.
      saying(cancelledSentence(), job.jobId, !(await stopRequested(db, job.jobId))),
    )
  // The waiting pass wrote `announce = false` onto the job; the word that ends the turn must reach the person, so it says so.
  if (run.state === 'expired') return done(saying(expiredSentence(stored.minutes), job.jobId, true))
  if (run.state === 'failed') return done(saying(failedSentence(run.failure), job.jobId, true))

  // completed
  const grounding = asJson<RunGrounding>(
    (
      (
        await db.execute(
          `select app.engine_run_grounding(${officeOf(job.jobId)}, ${lit(run.run_id)}::uuid) as r`,
        )
      ).rows[0] as { r?: unknown } | undefined
    )?.r ?? { excerpts: [], domains: [], complete_domains: [], tools: [] },
  )
  const [rules, projects] = await Promise.all([statedRules(db, job), openProjects(db, job)])
  const history = stored.request.conversation_history
  const output = hermesOutput(run, {
    asked: stored.request.input,
    saidBefore: history.filter((m) => m.role === 'user').map((m) => m.content),
    answeredBefore: history.filter((m) => m.role === 'assistant').map((m) => m.content),
    grounding,
    openProjects: projects.open.filter((p) => !p.reserved).length,
    standingRules: rules,
  })
  if (output === null) return done(saying(failedSentence('empty answer'), job.jobId, true))
  // Hermes's usage row was written when the run finished, so the answer reads as model-composed.
  return { ...output, path: 'inference' }
}
