/**
 * Morning and evening briefings (§12).
 *
 * ## Why this is composed rather than generated
 *
 * The obvious implementation puts the day's state in front of a model and asks
 * for a summary. This one assembles the text from the numbers directly, and
 * calls a model for nothing.
 *
 * A briefing is the thing Grant reads to decide what to do. Every sentence in
 * it is therefore load-bearing, and every sentence a model writes is a
 * sentence that has to be reviewed under §16 before it can be relied on -
 * which means a model-written briefing is either unreviewed (and so must not
 * be relied on, defeating its purpose) or reviewed (by whom, at 07:00?).
 *
 * Composed text sidesteps the whole question: "3 things need you, 1 overdue"
 * is a count, not a claim, and a count is `verified` in §12's sense. The
 * briefing is deliberately the least interesting prose in the system.
 *
 * §6 also says not to call a model where ordinary code will do, and this is a
 * case where that rule and the quality rule point the same way.
 */
import type { SqlExecutor } from '../db/executor.ts'

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

export type BriefingKind = 'morning' | 'evening'

export interface BriefingInputs {
  readonly openBlockers: number
  readonly overdueBlockers: number
  readonly liveJobs: number
  readonly waitingOnGrant: number
  readonly stalledJobs: number
  readonly failedJobs24h: number
  readonly completed24h: number
  readonly projectsNeedingAttention: readonly string[]
  readonly staleBriefs: readonly string[]
}

export interface Briefing {
  readonly kind: BriefingKind
  readonly forDate: string
  readonly body: string
  readonly inputs: BriefingInputs
}

const plural = (n: number, one: string, many: string): string =>
  `${String(n)} ${n === 1 ? one : many}`

/**
 * Today's date in Grant's timezone.
 *
 * Taken from a timezone rather than from the server clock, because "which day
 * is this for" is the one decision in a briefing that a UTC server gets wrong
 * at exactly the hours a briefing is sent.
 */
export const localDate = (now: Date, timeZone: string): string =>
  // en-CA gives ISO-shaped output, which is the only reason it is used here.
  new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)

export const gatherInputs = async (db: SqlExecutor, office: string): Promise<BriefingInputs> => {
  const { rows } = await db.execute(`
    select
      (select count(*)::int from public.blockers where office_id = ${lit(office)}::uuid and state = 'open') as open_blockers,
      (select count(*)::int from public.blockers
        where office_id = ${lit(office)}::uuid and state = 'open' and real_deadline is not null and real_deadline <= app.now_utc())
        as overdue_blockers,
      (select count(*)::int from app.today_in(${lit(office)}::uuid)) as live_jobs,
      (select count(*)::int from app.today_in(${lit(office)}::uuid) where state = 'waiting_user') as waiting_on_grant,
      (select count(*)::int from app.today_in(${lit(office)}::uuid) where minutes_since_change >= 60) as stalled_jobs,
      (select count(*)::int from public.jobs
        where office_id = ${lit(office)}::uuid and state = 'failed' and finished_at >= app.now_utc() - interval '24 hours')
        as failed_24h,
      (select count(*)::int from public.jobs
        where office_id = ${lit(office)}::uuid and state = 'complete' and finished_at >= app.now_utc() - interval '24 hours')
        as completed_24h
  `)
  const r = rows[0] ?? {}

  const attention = await db.execute(`
    select name, open_blockers, failed_jobs_24h, stalled_jobs, brief_is_stale, has_brief
    from app.project_attention(${lit(office)}::uuid)
  `)

  return {
    openBlockers: Number(r.open_blockers ?? 0),
    overdueBlockers: Number(r.overdue_blockers ?? 0),
    liveJobs: Number(r.live_jobs ?? 0),
    waitingOnGrant: Number(r.waiting_on_grant ?? 0),
    stalledJobs: Number(r.stalled_jobs ?? 0),
    failedJobs24h: Number(r.failed_24h ?? 0),
    completed24h: Number(r.completed_24h ?? 0),
    projectsNeedingAttention: attention.rows
      .filter(
        (p) =>
          Number(p.open_blockers) > 0 ||
          Number(p.failed_jobs_24h) > 0 ||
          Number(p.stalled_jobs) > 0,
      )
      .map((p) => String(p.name)),
    staleBriefs: attention.rows
      .filter((p) => p.brief_is_stale === true && p.has_brief === true)
      .map((p) => String(p.name)),
  }
}

/**
 * Compose the text.
 *
 * The ordering rule: what needs Grant comes first, then what is moving, then
 * what went wrong. A briefing that opens with activity and buries a blocker on
 * line five is a briefing that gets skimmed.
 */
export const compose = (kind: BriefingKind, forDate: string, i: BriefingInputs): string => {
  const lines: string[] = []

  if (i.openBlockers === 0) {
    lines.push(
      kind === 'morning' ? 'Nothing needs you this morning.' : 'Nothing is waiting on you tonight.',
    )
  } else {
    const overdue = i.overdueBlockers > 0 ? `, ${String(i.overdueBlockers)} overdue` : ''
    lines.push(`${plural(i.openBlockers, 'thing needs', 'things need')} you${overdue}.`)
  }

  if (i.waitingOnGrant > 0) {
    lines.push(`${plural(i.waitingOnGrant, 'job is', 'jobs are')} paused waiting for an answer.`)
  }

  lines.push(
    i.liveJobs === 0
      ? 'No work is in flight.'
      : `${plural(i.liveJobs, 'job is', 'jobs are')} in flight.` +
          (i.stalledJobs > 0
            ? ` ${plural(i.stalledJobs, 'has', 'have')} not changed state in over an hour.`
            : ''),
  )

  if (kind === 'evening') {
    lines.push(
      i.completed24h === 0
        ? 'Nothing completed today.'
        : `${plural(i.completed24h, 'job', 'jobs')} completed today.`,
    )
  }

  if (i.failedJobs24h > 0) {
    lines.push(`${plural(i.failedJobs24h, 'job', 'jobs')} failed in the last 24 hours.`)
  }

  if (i.projectsNeedingAttention.length > 0) {
    lines.push(`Worth a look: ${i.projectsNeedingAttention.join(', ')}.`)
  }

  if (i.staleBriefs.length > 0) {
    lines.push(`Sources changed since the last brief on: ${i.staleBriefs.join(', ')}.`)
  }

  // The date is in the text as well as the column. A briefing forwarded or
  // screenshotted loses its row, and a briefing with no date is one you cannot
  // tell is yesterday's.
  return `${kind === 'morning' ? 'Morning' : 'Evening'} briefing — ${forDate}\n\n${lines.join('\n')}`
}

/**
 * Generate and store, or report that today's already exists.
 *
 * The uniqueness is the index's job, not a pre-check: a SELECT-then-INSERT
 * loses the race that actually happens here, which is two workers picking up
 * the same due duty after a restart.
 *
 * Returns null when one already exists. Not an error: that is the correct
 * outcome of a re-attempted duty, and the caller is a scheduler that will see
 * it most of the time it runs.
 */
export const generateBriefing = async (
  db: SqlExecutor,
  kind: BriefingKind,
  forDate: string,
  scopeRef: string | null,
  office: string,
): Promise<Briefing | null> => {
  const inputs = await gatherInputs(db, office)
  const body = compose(kind, forDate, inputs)

  const { rows } = await db.execute(`
    insert into public.briefings (office_id, kind, for_date, scope_ref, body, inputs)
    values (${lit(office)}::uuid, ${lit(kind)}::public.briefing_kind, ${lit(forDate)}::date,
            ${scopeRef === null ? `app.office_actor(${lit(office)}::uuid)` : lit(scopeRef)},
            ${lit(body)}, ${lit(JSON.stringify(inputs))}::jsonb)
    on conflict (office_id, kind, scope_ref, for_date) do nothing
    returning briefing_id::text as id
  `)

  if (rows.length === 0) return null
  return { kind, forDate, body, inputs }
}
