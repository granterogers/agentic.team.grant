/**
 * What actually happened, read from canonical state.
 *
 * §11: *"Do not ask a model what Postgres can answer."* Every field below is
 * counted from a table, never inferred from the office's prose, because the
 * whole point of the `reality` dimension is that a claim and an effect are
 * different things and the interesting case is when they disagree.
 *
 * ## The correlation family, not just the job
 *
 * A turn's effects do not all land on the job that started it. The office
 * spawns children — `artifact.report` is the case CLAUDE.md records, where
 * three children finished and deposited three PDFs — and a child carries
 * its parent's `correlation_id`. Counting only the parent would report a
 * turn that created three documents as having created none, which is
 * exactly the false green this dimension exists to catch.
 *
 * ## Why `claimed` is separate from the counts
 *
 * The claim detectors are the PRODUCT's own (`src/agents/quality.ts`), not
 * reimplementations. Two reasons: a second implementation of "does this
 * sentence claim a send" would drift from the one the office polices itself
 * with, and CLAUDE.md records a row list built twice being a list that will
 * disagree. Using the product's detector also means the harness is measuring
 * the same notion of a claim the office is.
 */

import type { SqlExecutor } from '../db/executor.ts'

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

/** Counted from canonical state, for one turn's whole correlation family. */
export interface CanonicalEffects {
  readonly jobs: number
  readonly tasksCreated: number
  readonly tasksChanged: number
  readonly documentsCreated: number
  readonly blockersRaised: number
  readonly deliveriesAttempted: number
  readonly deliveriesSent: number
  readonly lessonsLearned: number
  readonly consultations: number
  readonly impediments: number
  readonly outputs: number
  /** The roster actually recorded, so delegation is measured not guessed. */
  readonly roster: readonly string[]
  readonly delegationDepth: number
  /**
   * The family is AT REST - every job terminal, or waiting on a person.
   *
   * Not the same as terminal. A job paused on `awaiting_approval` has
   * decided: it decided to ask, which is the approval boundary working.
   * Treating it as unsettled made the runner wait 420 seconds and then
   * report a correctly-behaving turn as one that never finished.
   */
  readonly settled: boolean
  /** Jobs in the family stopped, correctly, to ask a person. */
  readonly awaitingApproval: number
  /**
   * The titles of what this turn actually created.
   *
   * Needed because "did the office act" is the wrong question for a
   * withdrawal: a message that withdraws one clause and keeps another
   * SHOULD produce work. The question is whether it acted on the clause
   * that was taken back, and only the content can answer that.
   */
  readonly createdTitles: readonly string[]
  /** Any job in the family ended `failed`. */
  readonly anyFailed: boolean
  /** The office's own provenance label on the answer. */
  readonly evidence: string
  /** Sources the answer cited, as stored. */
  readonly sources: readonly string[]
}

export const NO_EFFECTS: CanonicalEffects = {
  jobs: 0,
  tasksCreated: 0,
  tasksChanged: 0,
  documentsCreated: 0,
  blockersRaised: 0,
  deliveriesAttempted: 0,
  deliveriesSent: 0,
  lessonsLearned: 0,
  consultations: 0,
  impediments: 0,
  outputs: 0,
  roster: [],
  delegationDepth: 0,
  settled: false,
  awaitingApproval: 0,
  createdTitles: [],
  anyFailed: false,
  evidence: '',
  sources: [],
}

/**
 * Read every effect this turn had, in one statement.
 *
 * One query rather than eleven, because the Management API throttles and
 * CLAUDE.md records a throttle entering a measurement as data.
 *
 * `since` bounds the counts to this turn. Without it a second turn in the
 * same conversation would inherit the first one's rows and every arc would
 * report effects increasing for free.
 */
export const readEffects = async (
  db: SqlExecutor,
  jobId: string,
  since: string,
): Promise<CanonicalEffects> => {
  const { rows } = await db.execute(`
    with family as (
      select j.job_id, j.state, j.state_reason, j.correlation_id
        from public.jobs j
       where j.job_id = ${lit(jobId)}::uuid
          or j.parent_job_id = ${lit(jobId)}::uuid
          or j.correlation_id = (select correlation_id from public.jobs
                                  where job_id = ${lit(jobId)}::uuid)
    )
    select
      (select count(*)::int from family) as jobs,
      (select count(*)::int from public.tasks t
        where t.job_id in (select job_id from family)
          and t.created_at >= ${lit(since)}::timestamptz) as tasks_created,
      (select count(*)::int from public.tasks t
        where t.job_id in (select job_id from family)
          and t.created_at < ${lit(since)}::timestamptz
          and t.updated_at >= ${lit(since)}::timestamptz) as tasks_changed,
      (select count(*)::int from public.documents d
        where d.produced_by_job in (select job_id from family)
          and d.created_at >= ${lit(since)}::timestamptz) as documents_created,
      (select count(*)::int from public.blockers b
        where b.job_id in (select job_id from family)
          and b.created_at >= ${lit(since)}::timestamptz) as blockers_raised,
      (select count(*)::int from public.deliveries dl
        where dl.job_id in (select job_id from family)) as deliveries_attempted,
      (select count(*)::int from public.deliveries dl
        where dl.job_id in (select job_id from family)
          and dl.sent_at is not null) as deliveries_sent,
      (select count(*)::int from public.lessons l
        where l.from_job in (select job_id from family)) as lessons_learned,
      (select count(*)::int from public.consultations c
        where c.job_id in (select job_id from family)) as consultations,
      (select count(*)::int from public.job_impediments i
        where i.job_id in (select job_id from family)) as impediments,
      (select count(*)::int from public.outputs o
        where o.job_id in (select job_id from family)) as outputs,
      coalesce((select array_agg(t.title) from public.tasks t
                 where t.job_id in (select job_id from family)
                   and t.created_at >= ${lit(since)}::timestamptz), '{}') as created_titles,

      coalesce((select rd.roster from public.routing_decisions rd
                 where rd.job_id = ${lit(jobId)}::uuid
                 order by rd.decided_at desc limit 1), '{}') as roster,
      coalesce((select rd.delegation_depth from public.routing_decisions rd
                 where rd.job_id = ${lit(jobId)}::uuid
                 order by rd.decided_at desc limit 1), 0) as delegation_depth,
      (select bool_and(
                f.state in ('complete','failed','cancelled')
                or f.state = 'waiting_user'
                or (f.state = 'paused' and coalesce(f.state_reason,'') like 'awaiting_approval%'))
         from family f) as settled,
      (select count(*)::int from family f
        where f.state = 'paused'
          and coalesce(f.state_reason,'') like 'awaiting_approval%') as awaiting_approval,
      (select bool_or(f.state = 'failed') from family f) as any_failed,
      coalesce((select o.evidence::text from public.outputs o
                 where o.job_id = ${lit(jobId)}::uuid
                 order by o.created_at desc limit 1), '') as evidence,
      coalesce((select o.sources from public.outputs o
                 where o.job_id = ${lit(jobId)}::uuid
                 order by o.created_at desc limit 1), '{}') as sources
  `)

  const r = (rows[0] ?? {}) as Record<string, unknown>
  const n = (k: string): number => Number(r[k] ?? 0)
  const list = (k: string): string[] => {
    const v = r[k]
    if (Array.isArray(v)) return v.map(String)
    // The executor hands an array column back as a string sometimes.
    const s = String(v ?? '')
    if (s === '' || s === '{}') return []
    return s
      .replace(/^\{|\}$/g, '')
      .split(',')
      .filter((x) => x !== '')
  }

  return {
    jobs: n('jobs'),
    tasksCreated: n('tasks_created'),
    tasksChanged: n('tasks_changed'),
    documentsCreated: n('documents_created'),
    blockersRaised: n('blockers_raised'),
    deliveriesAttempted: n('deliveries_attempted'),
    deliveriesSent: n('deliveries_sent'),
    lessonsLearned: n('lessons_learned'),
    consultations: n('consultations'),
    impediments: n('impediments'),
    outputs: n('outputs'),
    roster: list('roster'),
    delegationDepth: n('delegation_depth'),
    settled: r.settled === true || String(r.settled) === 'true',
    awaitingApproval: n('awaiting_approval'),
    createdTitles: list('created_titles'),
    anyFailed: r.any_failed === true || String(r.any_failed) === 'true',
    evidence: String(r.evidence ?? ''),
    sources: list('sources'),
  }
}

/** Did anything at all change in the world because of this turn? */
export const actedAtAll = (e: CanonicalEffects): boolean =>
  e.tasksCreated > 0 ||
  e.tasksChanged > 0 ||
  e.documentsCreated > 0 ||
  e.blockersRaised > 0 ||
  e.deliveriesSent > 0 ||
  e.lessonsLearned > 0

/** A one-line summary for a finding's `because`, so a verdict names its evidence. */
export const describe = (e: CanonicalEffects): string => {
  const parts: string[] = []
  if (e.tasksCreated > 0) parts.push(`${String(e.tasksCreated)} task(s) created`)
  if (e.tasksChanged > 0) parts.push(`${String(e.tasksChanged)} task(s) changed`)
  if (e.documentsCreated > 0) parts.push(`${String(e.documentsCreated)} document(s)`)
  if (e.blockersRaised > 0) parts.push(`${String(e.blockersRaised)} blocker(s)`)
  if (e.lessonsLearned > 0) parts.push(`${String(e.lessonsLearned)} lesson(s)`)
  if (e.deliveriesSent > 0) parts.push(`${String(e.deliveriesSent)} delivery(s) SENT`)
  return parts.length === 0 ? 'nothing was written' : parts.join(', ')
}
