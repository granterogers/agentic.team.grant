/**
 * Does the CONVERSATION hold together? — the discovery oracle.
 *
 *   npm run shadow:coherence
 *   npm run shadow:coherence -- --prefix disc --verbose
 *
 * ## Why a second oracle rather than more checks in the first
 *
 * `shadow:alignment` asks one question per TURN: does this answer match the
 * rows this turn produced. It closed #302 and #304 and it is structurally
 * blind to everything that only exists BETWEEN turns — a task created twice,
 * a row landing on the wrong project, an answer that denies what the
 * conversation itself put there two turns ago, work done in silence.
 *
 * Those are the failures that make an office frustrating rather than wrong:
 * nothing in any single turn is false, and the conversation is unusable.
 *
 * ## Four properties, all from rows
 *
 * **SILENT ACTION** — the turn created something and the answer never
 * mentions it. The mirror of #302: not narration without action, but action
 * without narration. Grant has a row on his list he was never told about,
 * which is worse than a missing row because he cannot know to look.
 *
 * **DUPLICATE** — one conversation, two rows with the same title. Reported
 * with both turns, because "do that for the other one as well" legitimately
 * makes a second one and only the pair can say which happened.
 *
 * **LEAKED** — a row landed on a project the turn was not about. Project
 * switching without context leakage is a property of the SEQUENCE; a single
 * turn cannot see it because the row it wrote looks perfectly good.
 *
 * **CONTRADICTION** — a later answer states an absence that the session's own
 * still-live rows refute. This is the one Grant would notice first and the
 * one no per-turn check can reach, because both answers are locally true of
 * what their own turn did.
 *
 * ## Independent, and with a control
 *
 * Canonical state is queried here, not taken from the runner. And because
 * three of the four have "found nothing" as their happy path, each is shown
 * a planted violation before anything is reported — the zero and the ten
 * were once produced by the same code.
 */

import { readFile } from 'node:fs/promises'
import { ManagementApiExecutor } from '../../src/db/executor.ts'

const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? fallback : (process.argv[i + 1] ?? fallback)
}
const prefix = arg('prefix', 'disc')
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
  readonly projectSlug?: string
}

const lines = await readFile('.out/sessions.jsonl', 'utf8').catch(() => '')
const seen = new Map<string, Recorded>()
for (const line of lines.split('\n')) {
  if (line.trim() === '') continue
  try {
    const r = JSON.parse(line) as Recorded
    if (!r.session?.startsWith(prefix)) continue
    if (typeof r.jobId !== 'string' || r.jobId === '') continue
    seen.set(`${r.session}#${String(r.index)}`, r)
  } catch {
    /* a partial line from an interrupted run is not a finding */
  }
}
const turns = [...seen.values()].sort((a, b) =>
  a.session === b.session ? a.index - b.index : a.session < b.session ? -1 : 1,
)
if (turns.length === 0) {
  console.log(`\n  Nothing recorded for ${prefix}. Run the sessions first.\n`)
  process.exit(0)
}

/*
  Every row these turns created, with the project it landed on and whether it
  is still there. Asked of the database, never of the runner.
*/
const ids = turns.map((t) => `${lit(t.jobId)}::uuid`).join(',')
const rows = await db.execute(`
  select t.job_id, t.title, coalesce(p.slug, '') as slug, t.state
    from public.tasks t
    left join public.projects p on p.project_id = t.project_id
   where t.job_id in (${ids})
  union all
  select d.produced_by_job as job_id, d.title, coalesce(p.slug, '') as slug, d.state
    from public.documents d
    left join public.projects p on p.project_id = d.project_id
   where d.produced_by_job in (${ids})`)

/*
  AND THE WORK HANDED ON, which rows alone cannot show.

  The SILENT ACTION check counted tasks and documents, so a turn that fanned
  out to four specialists and said nothing about it read as a clean turn with
  no effects. That is the under-claiming half of #302 and the oracle was blind
  to it for the same reason the contract was: pending work is not a row in a
  table the reader was looking at.
*/
const kids = await db.execute(`
  select parent_job_id::text as parent, count(*) as n
    from public.jobs where parent_job_id in (${ids})
   group by 1`)
const childrenOf = new Map<string, number>()
for (const r of kids.rows as { parent: string; n: number }[]) {
  childrenOf.set(String(r.parent), Number(r.n))
}

interface Made {
  readonly jobId: string
  readonly title: string
  readonly slug: string
  readonly live: boolean
}
const made: Made[] = (rows.rows as Record<string, unknown>[]).map((r) => ({
  jobId: String(r.job_id),
  title: String(r.title ?? ''),
  slug: String(r.slug ?? ''),
  live: !['archived', 'cancelled', 'done', 'dropped'].includes(String(r.state ?? '')),
}))
const madeBy = new Map<string, Made[]>()
for (const m of made) madeBy.set(m.jobId, [...(madeBy.get(m.jobId) ?? []), m])

interface Finding {
  readonly kind: 'SILENT ACTION' | 'DUPLICATE' | 'LEAKED' | 'CONTRADICTION'
  readonly where: string
  readonly detail: string
  readonly answer: string
}
const findings: Finding[] = []

const plain = (s: string): string => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ')

/*
  The words of a title that could identify it in prose.

  Short and common words are dropped, because an answer containing "the" is
  not an answer that mentions the task. Four characters is the floor the rest
  of this repository uses for content words.
*/
const STOP = new Set([
  'the',
  'and',
  'for',
  'with',
  'that',
  'this',
  'from',
  'into',
  'about',
  'onto',
  'your',
  'our',
  'task',
  'note',
  'item',
  'thing',
  'please',
  'need',
  'needs',
  'have',
  'make',
  'made',
])
const contentWords = (title: string): string[] =>
  plain(title)
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !STOP.has(w))

/** Said it did something, in any tense — the weakest possible acknowledgement. */
const ACKNOWLEDGES =
  /\b(?:added|created|filed|logged|made|drafted|noted|put|saved|scheduled|set\s+up|opened|started|written|wrote|raised)\b/i

/** Any sign at all that the answer mentions work being carried on elsewhere. */
const HANDED_ON =
  /\b(?:handed|handing|passed|passing|asked|asking|looking\s+into|working\s+on|come\s+back|get\s+back|under\s+way|underway|in\s+hand|on\s+it|started|kicked\s+off|specialist|colleague|team|Emma|Tom|Daniel|Marcus|Ruby|Oliver|Grace|Claire)\b/i

export const silentAction = (answer: string, titles: readonly string[]): string | null => {
  if (titles.length === 0) return null
  const said = plain(answer)
  for (const title of titles) {
    const words = contentWords(title)
    /*
      A title with nothing distinctive in it cannot be looked for, so it is
      not evidence either way. Saying so rather than counting it as a pass is
      the difference between a check and a check that cannot fail.
    */
    if (words.length === 0) continue
    if (words.some((w) => said.includes(w))) return null
  }
  if (ACKNOWLEDGES.test(answer)) return null
  return titles[0] ?? null
}

/*
  An answer that says nothing exists.

  Narrow on purpose. "I have not done this" is about THIS turn and is #302's
  own sentence, so it is excluded by requiring a plural or a scope word: the
  contradiction is a claim about the CONVERSATION's state, not about one
  turn's outcome.
*/
const DENIES_ANY =
  /\b(?:no|nothing|none|not\s+any)\b[^.;!?]{0,44}?\b(?:tasks?|items?|notes?|entries|records?|to-?dos?)\b|\bnothing\s+(?:has\s+been|was)\s+(?:created|added|filed|logged|made)\b|\b(?:haven[\u2019']?t|have\s+not)\s+created\s+any\b/i

for (const t of turns) {
  const answer = String(t.answered ?? '')
  if (answer.trim() === '') continue
  const mine = madeBy.get(t.jobId) ?? []

  const silent = silentAction(
    answer,
    mine.map((m) => m.title),
  )
  if (silent !== null) {
    findings.push({
      kind: 'SILENT ACTION',
      where: `${t.session} turn ${String(t.index)}`,
      detail: `created ${String(mine.length)} row(s) and named none of them — e.g. "${silent}"`,
      answer,
    })
  }

  /*
    Work handed to a colleague, never mentioned. The test is deliberately
    generous — any acknowledgement at all counts — because the finding is an
    answer that says nothing whatsoever about it, which is what Grant got.
  */
  const handedOn = childrenOf.get(t.jobId) ?? 0
  if (handedOn > 0 && !HANDED_ON.test(answer)) {
    findings.push({
      kind: 'SILENT ACTION',
      where: `${t.session} turn ${String(t.index)}`,
      detail: `handed the work to ${String(handedOn)} colleague(s) and said nothing about it`,
      answer,
    })
  }

  /*
    The project the turn was about, as the RUNNER recorded it, against the
    project the row landed on. Only where both are known: an unnamed project
    is the office's own honest default and not a leak.
  */
  const about = String(t.projectSlug ?? '')
  if (about !== '' && about !== 'unnamed') {
    for (const m of mine) {
      if (m.slug !== '' && m.slug !== about) {
        findings.push({
          kind: 'LEAKED',
          where: `${t.session} turn ${String(t.index)}`,
          detail: `"${m.title}" landed on ${m.slug}, the turn was about ${about}`,
          answer,
        })
      }
    }
  }
}

/* Between turns, per session. */
const bySession = new Map<string, Recorded[]>()
for (const t of turns) bySession.set(t.session, [...(bySession.get(t.session) ?? []), t])

for (const [session, list] of bySession) {
  const titles = new Map<string, number[]>()
  for (const t of list) {
    for (const m of madeBy.get(t.jobId) ?? []) {
      const key = plain(m.title).trim()
      if (key === '') continue
      titles.set(key, [...(titles.get(key) ?? []), t.index])
    }
  }
  for (const [key, where] of titles) {
    if (where.length > 1) {
      findings.push({
        kind: 'DUPLICATE',
        where: `${session} turns ${where.join(', ')}`,
        detail: `"${key}" exists ${String(where.length)} times`,
        answer: list.find((t) => t.index === where[where.length - 1])?.answered ?? '',
      })
    }
  }

  /*
    A denial that the session's own live rows refute.

    Only rows created by an EARLIER turn count, because a turn denying what
    it did itself is the per-turn check's job and is already covered.
  */
  for (const t of list) {
    const answer = String(t.answered ?? '')
    if (!DENIES_ANY.test(answer)) continue
    const earlier = list
      .filter((x) => x.index < t.index)
      .flatMap((x) => madeBy.get(x.jobId) ?? [])
      .filter((m) => m.live)
    if (earlier.length > 0) {
      findings.push({
        kind: 'CONTRADICTION',
        where: `${session} turn ${String(t.index)}`,
        detail: `states an absence while ${String(earlier.length)} row(s) from earlier turns are live — e.g. "${String(earlier[0]?.title ?? '')}"`,
        answer,
      })
    }
  }
}

/*
  THE CONTROL, and it is four controls, because a check with three blind
  detectors and one working one reports the same clean sweep as a check that
  works. Each is shown a violation it MUST flag.
*/
{
  const fails: string[] = []
  /*
    The control sentence must carry NO acknowledgement verb, or it is
    testing the exemption rather than the detector. The first one was
    "Noted, thanks." and `noted` is in ACKNOWLEDGES, so the control failed —
    correctly, and about itself rather than about the product.
  */
  if (silentAction('Right, understood.', ['Confirm the printer quote']) === null) {
    fails.push('silent action')
  }
  if (
    silentAction('I added Confirm the printer quote to the bid.', ['Confirm the printer quote']) !==
    null
  ) {
    fails.push('silent action false-positives on a named row')
  }
  if (HANDED_ON.test('I have nothing from earlier in this conversation.')) {
    fails.push('handed-on fires on an answer that mentions no colleague')
  }
  if (!HANDED_ON.test('I have asked Emma to look at it and will come back to you.')) {
    fails.push('handed-on misses a plain hand-off')
  }
  if (!DENIES_ANY.test('There are no tasks on that project at the moment.')) {
    fails.push('contradiction')
  }
  /*
    THE WIDENING, and the case that forced it. The first version required
    the noun to follow the negator immediately, so the real finding —
    "I have no printer-or-signage tasks recorded right now", said while the
    conversation's own row from two turns earlier was live — was missed and
    reported as a clean sweep.
  */
  if (!DENIES_ANY.test('I have no printer-or-signage tasks recorded right now.')) {
    fails.push('contradiction misses a qualified noun')
  }
  /*
    And the bound on the widening. A window with no clause boundary in it
    would make "no reason to worry" plus a later mention of tasks into a
    denial, so the window stops at sentence punctuation and is 44 characters.
  */
  if (DENIES_ANY.test('There is no reason to worry. Your tasks are all on the board.')) {
    fails.push('contradiction false-positives across a sentence boundary')
  }
  if (DENIES_ANY.test('I have not done this. Say it again in a sentence and I will.')) {
    fails.push('contradiction fires on the #302 sentence, which is about one turn')
  }
  if (fails.length > 0) {
    console.error(`\n  THE ORACLE IS BLIND — ${fails.join('; ')}. Nothing below is evidence.\n`)
    process.exit(1)
  }
  console.log('\n  control: each detector flags a planted violation and spares its neighbour')
}

console.log(`\nconversation coherence — what only exists between turns\n`)
console.log(`  sessions          ${String(bySession.size)}`)
console.log(`  turns             ${String(turns.length)}`)
console.log(`  rows they made    ${String(made.length)}`)
console.log(`\n  FINDINGS  ${String(findings.length)}\n`)
if (findings.length === 0) {
  console.log('    None. Every row was narrated, on the right project, once, and never denied.\n')
} else {
  for (const f of findings) {
    console.log(`    ${f.kind}  ${f.where}`)
    console.log(`      ${f.detail}`)
    console.log(`      answer: ${f.answer.slice(0, 240).replace(/\n/g, ' ')}\n`)
  }
}

if (verbose) {
  for (const t of turns) {
    const mine = madeBy.get(t.jobId) ?? []
    console.log(
      `    ${t.session}#${String(t.index)}  project=${String(t.projectSlug ?? '')}  rows=${String(mine.length)}  ${mine.map((m) => `${m.title}@${m.slug}`).join(' | ')}`,
    )
  }
  console.log()
}
