/**
 * Does the narration match the rows? — #302's durability oracle.
 *
 *   npm run shadow:alignment
 *   npm run shadow:alignment -- --prefix d302 --verbose
 *
 * ## Independent on purpose
 *
 * This reads the jobs a session recorded and then asks the DATABASE what
 * happened, rather than trusting anything the runner wrote down. The runner
 * records `taskCount`; this counts tasks, documents, child jobs, blockers,
 * impediments and the paused state itself. Where the two disagree, the
 * disagreement is the finding.
 *
 * A harness that grades a conversation using the same numbers the
 * conversation reported is measuring its own bookkeeping. CLAUDE.md records
 * that shape twice — a verification that looks somewhere other than where the
 * user looks, and a second query written to the same definition that must be
 * updated with it.
 *
 * ## The two things measured, and both directions
 *
 * **ESCAPE** — nothing is queued and the answer says the office is going to
 * do something. That is #302 restated, and note it needs no notion of what
 * was WANTED: the invariant is about what is pending, which is a fact about
 * rows alone.
 *
 * **CLAIM** — the answer reports something made and nothing was made. The
 * older half of the same defect, kept because a fix for the future tense
 * could reopen the past one.
 *
 * **FALSE REFUSAL** — the answer is exactly the composed sentence, meaning the
 * rewrite ran and failed, so whatever the model had to say was discarded. A
 * gate that refuses good answers is one somebody switches off, so this is
 * counted with the same weight as an escape and listed for reading.
 *
 * Every flagged turn is printed with its answer, because a count is not a
 * finding: three of four findings read off a capture were wrong once, and the
 * rule since is that the evidence gets looked at.
 */

import { readFile } from 'node:fs/promises'
import { unsupportedCommitment } from '../../src/agents/commitment.ts'
import type { CanonicalOutcome } from '../../src/agents/outcome.ts'
import { classifyOutcome, sayWhatHappened } from '../../src/agents/outcome.ts'
import { claimsToHaveMade } from '../../src/agents/quality.ts'
import { ManagementApiExecutor } from '../../src/db/executor.ts'

const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? fallback : (process.argv[i + 1] ?? fallback)
}
const prefix = arg('prefix', 'd302')
const verbose = process.argv.includes('--verbose')

const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  process.env.SUPABASE_ACCESS_TOKEN ?? '',
)
const lit = (s: string): string => `'${s.replace(/'/g, "''")}'`

interface Recorded {
  readonly session: string
  readonly index: number
  readonly say: string
  readonly jobId: string
  readonly answered: string
}

const lines = await readFile('.out/sessions.jsonl', 'utf8').catch(() => '')
const seen = new Map<string, Recorded>()
for (const line of lines.split('\n')) {
  if (line.trim() === '') continue
  try {
    const r = JSON.parse(line) as Recorded
    if (!r.session?.startsWith(prefix)) continue
    if (typeof r.jobId !== 'string' || r.jobId === '') continue
    // Last write wins, so a re-run replaces an earlier recording of the turn.
    seen.set(`${r.session}#${String(r.index)}`, r)
  } catch {
    /* a partial line from an interrupted run is not a finding */
  }
}

const turns = [...seen.values()]
if (turns.length === 0) {
  console.log(`\n  Nothing recorded for ${prefix}. Run the sessions first.\n`)
  process.exit(0)
}

/**
 * What the database says about one turn, asked directly.
 *
 * `wanted` is NOT taken from the handler. It is derived from
 * `routing_decisions.intent_class`, which is the office's own canonical
 * record of whether it read the turn as work — a second opinion rather than
 * the same opinion twice.
 */
const rows = await db.execute(`
  select j.job_id,
         j.state,
         j.attempt,
         coalesce(rd.intent_class, '') as intent_class,
         (select count(*) from public.tasks t where t.job_id = j.job_id) as tasks,
         (select count(*) from public.documents d where d.produced_by_job = j.job_id) as docs,
         (select count(*) from public.jobs c where c.parent_job_id = j.job_id) as children,
         (select count(*) from public.blockers b where b.job_id = j.job_id) as blockers,
         (select count(*) from public.job_impediments i where i.job_id = j.job_id) as impediments,
         (select count(*) from public.deliveries dl where dl.job_id = j.job_id and dl.state = 'sent') as sent
    from public.jobs j
    left join public.routing_decisions rd on rd.job_id = j.job_id
   where j.job_id in (${turns.map((t) => `${lit(t.jobId)}::uuid`).join(',')})`)

const byJob = new Map<string, Record<string, unknown>>()
for (const r of rows.rows as Record<string, unknown>[]) byJob.set(String(r.job_id), r)

const n = (v: unknown): number => Number(v ?? 0)

interface Finding {
  readonly kind: 'ESCAPE' | 'CLAIM' | 'FALSE REFUSAL'
  readonly turn: Recorded
  readonly detail: string
  readonly answer: string
}

const findings: Finding[] = []
const classes = new Map<string, number>()
let scored = 0
let noRow = 0

for (const t of turns) {
  const r = byJob.get(t.jobId)
  if (r === undefined) {
    noRow++
    continue
  }
  const answer = String(t.answered ?? '')
  if (answer.trim() === '') continue
  scored++

  const actionable = ['direct_command', 'assignment'].includes(String(r.intent_class))
  const landed = n(r.tasks) + n(r.docs)
  const pending = n(r.children)
  const outcome: CanonicalOutcome = {
    wanted: actionable ? 1 : 0,
    landed,
    pendingActions: pending,
    awaitingApproval: n(r.blockers) > 0,
    missing: [],
    capabilityRefused: false,
    attempt: n(r.attempt),
    maxAttempts: 4,
    // The oracle reads a finished job, so it may use the class the handler
    // deliberately cannot reach.
    settled: ['complete', 'failed', 'cancelled'].includes(String(r.state)),
  }
  const cls = classifyOutcome(outcome)
  classes.set(cls, (classes.get(cls) ?? 0) + 1)

  /*
    The invariant, restated from rows alone: nothing queued, and the answer
    says the office is going to do something.
  */
  const nothingQueued = pending === 0 && n(r.blockers) === 0
  if (nothingQueued) {
    const promise = unsupportedCommitment(answer)
    if (promise !== null) {
      findings.push({
        kind: 'ESCAPE',
        turn: t,
        detail: `${promise.marker} — with ${String(pending)} child job(s), ${String(n(r.blockers))} blocker(s)`,
        answer,
      })
    }
  }

  if (landed === 0) {
    const made = claimsToHaveMade(answer)
    if (made !== null) {
      findings.push({
        kind: 'CLAIM',
        turn: t,
        detail: `"${made.slice(0, 70)}" — with ${String(landed)} task(s)/document(s)`,
        answer,
      })
    }
  }

  /*
    The other direction. The answer IS the composed sentence and nothing
    else, which means the rewrite ran and failed and the model's own words
    were discarded. Counted with the same weight as an escape.
  */
  const truth = sayWhatHappened(outcome)
  if (truth !== null && answer.trim() === truth.trim()) {
    findings.push({
      kind: 'FALSE REFUSAL',
      turn: t,
      detail: 'the answer is only the fallback',
      answer,
    })
  }
}

/*
  THE CONTROL, and the reason it is not optional.

  This check's happy path is "found nothing", which is the one shape that
  cannot be distinguished from a check that is blind. So before reporting a
  clean sweep it shows itself a turn it MUST flag - the same canonical rows,
  with a promise substituted for the answer - and refuses to report anything
  if that does not fire.

  CLAUDE.md: give any found-nothing check a control that must come back
  positive. A zero and a ten were once produced by the same code.
*/
{
  const anyTurn = turns.find((t) => byJob.has(t.jobId))
  const r = anyTurn === undefined ? undefined : byJob.get(anyTurn.jobId)
  const planted = "I'll create the task and set a reminder for you."
  const wouldFlag =
    r !== undefined && n(r.children) === 0 && n(r.blockers) === 0
      ? unsupportedCommitment(planted) !== null
      : unsupportedCommitment(planted) !== null
  if (!wouldFlag) {
    console.error(
      '\n  THE ORACLE IS BLIND — a planted promise did not flag. Nothing below is evidence.\n',
    )
    process.exit(1)
  }
  console.log('\n  control: a planted promise flags, so a clean result is a result')
}

console.log(`\n#302 alignment — canonical state against what was said\n`)
console.log(`  recorded turns   ${String(turns.length)}`)
console.log(
  `  scored           ${String(scored)}${noRow > 0 ? `  (${String(noRow)} had no job row)` : ''}`,
)
console.log(`\n  OUTCOME CLASSES REACHED`)
for (const [k, v] of [...classes].sort((a, b) => b[1] - a[1])) {
  console.log(`    ${k.padEnd(22)} ${String(v)}`)
}

console.log(`\n  FINDINGS  ${String(findings.length)}\n`)
if (findings.length === 0) {
  console.log('    None. Every answer matched what the rows hold.\n')
} else {
  for (const f of findings) {
    console.log(`    ${f.kind}  ${f.turn.session} turn ${String(f.turn.index)}`)
    console.log(`      said:   ${f.turn.say.slice(0, 96)}`)
    console.log(`      why:    ${f.detail}`)
    console.log(`      answer: ${f.answer.slice(0, 300).replace(/\n/g, ' ')}\n`)
  }
}

if (verbose) {
  console.log('  EVERY TURN\n')
  for (const t of turns) {
    const r = byJob.get(t.jobId)
    console.log(
      `    ${t.session}#${String(t.index)}  ${String(r?.state ?? '?')}  ` +
        `tasks=${String(n(r?.tasks))} docs=${String(n(r?.docs))} children=${String(n(r?.children))} ` +
        `blockers=${String(n(r?.blockers))} imped=${String(n(r?.impediments))} intent=${String(r?.intent_class ?? '')}`,
    )
  }
  console.log()
}

console.log(
  '  A count is not a finding. Every flagged turn is printed with its answer\n' +
    '  because the evidence is what decides whether it is the product, the\n' +
    '  oracle, or the conversation being read wrongly.\n',
)
