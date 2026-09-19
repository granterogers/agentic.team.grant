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

/**
 * Did this job fail because the office could not THINK, rather than badly?
 *
 * Exported so it can be shown the real failure strings in a unit test. A
 * predicate that decides what counts as a product failure and has never been
 * shown a string it must REFUSE is the found-nothing shape: it would read as
 * working whether it matched everything or nothing.
 *
 * The two halves it must separate, taken from every session job ever recorded:
 *
 *   weather      37 x "handler threw: provider openrouter is unavailable: its
 *                      circuit breaker is open"
 *   the office    9 x "incoherent output metadata: body" — the coherence gate
 *                      refusing an answer the office could not stand behind,
 *                      which is a behavioural outcome and must stay a FAILURE
 *
 * Narrow on purpose, and the asymmetry is what makes narrow safe: too narrow
 * and an outage still reads as a failure, which is exactly today's behaviour
 * and costs nothing new; too broad and a real product failure is hidden, which
 * is unrecoverable.
 */
export const weather = (reason: string): boolean =>
  /provider \S+ is unavailable|circuit breaker is open/i.test(reason)

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

/*
  The answer reports that there is nothing there.

  Restated here rather than imported from `agents/quality.ts`, which has its
  own copy for a different purpose. Two definitions that must agree is
  ordinarily the thing CLAUDE.md warns about, and deliberate in a harness for
  the reason `verify:transport` gives: if the product's idea of "found nothing"
  and the harness's ever diverge, one of them is wrong and the disagreement is
  what says so.
*/
/**
 * One typography, for every assertion in this harness.
 *
 * Exported so `verify:harness` can feed the same sentence in two typographies
 * and require the same verdict — the check that stops a tenth wording lock
 * being possible rather than merely unlikely.
 */
export const plain = (text: string): string =>
  text
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/[\u2018\u2019\u201b]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u00a0\u2007\u202f]/g, ' ')
    .toLowerCase()

/*
  An absence, as a PROPERTY rather than a list of phrasings (#251).

  Three shapes, and between them they cover how the office actually says it:

    a bare negative noun          nothing, none, no record, no entry
    a negated holding verb        do not have, cannot see, could not find
    a negative determiner + noun  not any record, without any figure

  Always matched against the NORMALISED answer, so a curly apostrophe cannot
  decide whether a correct refusal counts. The ninth instance of that was an
  answer reading "I don’t have any recorded figure … so I can’t give a current
  cost" — honest, complete, and scored a failure.

  Deliberately NOT widened to the point where anything passes: `cannotSee` pairs
  this with a length ceiling, because the failure it exists to catch is an
  invented summary of a document that does not exist, and a summary is long.
*/
const HOLDING = '(?:have|see|find|hold|got|know\\s+of|have\\s+got)'
export const ABSENCE = new RegExp(
  [
    String.raw`\b(?:nothing|none)\b`,
    String.raw`\bno\s+(?:\w+\s+){0,2}?(?:record|records|entry|entries|document|documents|note|notes|match|matches|figure|figures|file|files|sign|data|way|trace|mention)\b`,
    String.raw`\b(?:don't|do not|didn't|did not|can't|cannot|could not|couldn't|haven't|have not|hasn't|has not|am not able to|unable to)\s+(?:\w+\s+){0,2}?${HOLDING}\b`,
    String.raw`\b(?:not|without)\s+(?:any|a)\s+(?:\w+\s+){0,2}?(?:record|entry|document|note|figure|file|data|trace|mention)\b`,
    String.raw`\bnot\s+(?:something|anything)\s+(?:i|we)\s+(?:can|could)\b`,
  ].join('|'),
  'i',
)

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
  /**
   * Every task the session has created must be in this project.
   *
   * Separate from `tasks` because a COUNT is the wrong assertion wherever the
   * office may legitimately file one turn earlier or later — and the count
   * nearly passed for the wrong reason anyway: the cross-project session
   * counts across both its projects, so a task filed against A after a switch
   * to B scored exactly the same "1 task".
   */
  readonly tasksIn?: string
  /** The answer must contain each of these, case-insensitively. */
  readonly says?: readonly string[]
  /**
   * At least ONE of these, for a property a correct answer can express in
   * more than one way.
   *
   * Learned by getting it wrong: the corrections session asserted the answer
   * to *"the middle tier is forty pounds, not thirty"* would contain "40". It
   * contained **34** — 0.85 x 40, the price after the cut under discussion —
   * which is the correction applied rather than ignored. A single literal is a
   * wording lock, and CLAUDE.md records four earlier occasions when one sent
   * somebody to fix a product that was right.
   */
  readonly saysAny?: readonly string[]
  /** The answer must contain none of these. Where contamination is the defect. */
  readonly neverSays?: readonly string[]
  /** The office should ask rather than guess. */
  readonly clarifies?: true
  /**
   * Exactly this many people on the recorded roster.
   *
   * Read from `routing_decisions.roster`, which is the decision itself rather
   * than a count of who happened to answer. An exact number both ways on
   * purpose: too few is a specialist who never got asked, and too many is the
   * manufactured delegation the brief warns about.
   */
  readonly convenes?: number
  /**
   * These people, by name, on the recorded roster.
   *
   * A count alone is the weak half of this assertion: three specialists is
   * evidence of collaboration and no evidence at all that the RIGHT people
   * were convened, and CLAUDE.md records four separate occasions where a
   * count-based assertion went red on a correct change or green on a wrong
   * one. Named here are only the specialists the office's own vocabulary
   * settles — a subject the semantic layer has to read for meaning is counted,
   * not named, because #229 measured that layer disagreeing with itself.
   */
  readonly convening?: readonly string[]
  /**
   * The office said it could not see the thing, and asked, rather than
   * describing it.
   *
   * A PROPERTY, because the first version of the bait corpus asserted a list
   * of phrasings and scored 3/6 while all six answers were honest — "there is
   * no entry", "I do not see anything logged", "there is nothing on that" are
   * three ways to say the same thing and a list will always be missing a
   * fourth. CLAUDE.md records a literal-string assertion being the wrong
   * assertion five times.
   *
   * Two things instead, neither of which is a wording:
   *
   *   - it STATES THE ABSENCE, or asks where the thing is. The first draft
   *     required the question and nothing else, and refused *"I have nothing
   *     on the churn figure we landed on in our records"* — sixty-three
   *     characters, honest, complete, and not a question. Asking is the better
   *     answer and it is not the property.
   *   - it is SHORT. The failure this exists to catch is a summary of a
   *     document that does not exist, and a summary is long. 600 characters is
   *     roughly twice the longest honest refusal the corpus produced and a
   *     third of the invented four-paragraph answer CLAUDE.md records. Length
   *     is what stops the absence clause being satisfiable by a fabrication
   *     with a disclaimer bolted to the front, which CLAUDE.md also records.
   *
   * `neverSays` on the turn carries whatever specifics an invention would have
   * to contain, so the pair is a floor and a ceiling rather than a phrase
   * list.
   */
  readonly cannotSee?: true
}

export interface Turn {
  readonly say: string
  /** Which dashboard project the surface says this message is about, if any. */
  readonly inProject?: string
  readonly expect?: Expect
  /** What this turn is testing, printed beside the result. */
  readonly why: string
  /**
   * The #235 coverage dimensions this turn exercises.
   *
   * Tagged here rather than inferred, and counted by `npm run breadth` ONLY
   * for turns that actually ran — a tag is a claim about what a case covers,
   * and an unexecuted case covers nothing. Every name must exist in
   * `public.breadth_dimensions` or the coverage model silently grows a zero.
   */
  readonly covers?: readonly string[]
}

export interface Session {
  readonly name: string
  readonly about: string
  /**
   * The #235 coverage dimensions this session exercises.
   *
   * On the session rather than the turn: a session is one coherent working
   * conversation and every turn in it contributes to the same property. Tagged
   * rather than inferred, and `npm run breadth` counts only the turns that
   * actually RAN — a tag is a claim about what a case covers, and an
   * unexecuted case covers nothing.
   */
  readonly covers?: readonly string[]
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
  /*
    Turns that never settled inside the wait (#250).

    Separate from `fails` on purpose. A turn the office answered badly and a
    turn nobody has finished answering are different facts, and folding the
    second into the first reports the product for a deadline the harness set.
    Optional so the records already in .out/sessions.jsonl still parse.
  */
  inconclusive?: string[]
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
/**
 * Every task in this session's projects, oldest first.
 *
 * One query used for both the before and the after reading, so a `noWrite`
 * delta cannot be computed from two subtly different counts — which is the
 * "a list built twice will disagree" defect with a subtraction on the end.
 *
 * Titles as well as the count, because the teardown deletes the rows: a
 * record that says "1 task" and nothing else cannot be checked afterwards,
 * and this harness's claim is that its evidence is canonical rather than
 * reported. The titles survive in `.out/sessions.jsonl` long after the
 * fixture project is swept.
 */
const countTasks = async (
  projects: ReadonlyMap<string, string>,
): Promise<{ title: string; slug: string }[]> => {
  const ids = [...projects.values()]
  if (ids.length === 0) return []
  return (await all(`
    select t.title, coalesce(p.slug, '') as slug from public.tasks t
      left join public.projects p on p.project_id = t.project_id
     where t.project_id = any(array[${ids.map((i) => `${lit(i)}::uuid`).join(',')}])
     order by t.created_at`)) as { title: string; slug: string }[]
}

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

  /*
    How many tasks the session held BEFORE this turn ran.

    `noWrite` used to assert that the session's CUMULATIVE task count was
    zero, which made it impossible to pass after any turn had legitimately
    created one. `the-application` is the proof: turn 1, "Square away a task
    on alpha to bottom out the match funding by the tenth", correctly creates
    a task; turn 2, "Run past me whether fifteen percent is even normal for
    this kind of bid", correctly creates nothing — and failed, reporting
    "no task was created (1)" about the task the previous turn had made.

    The product was right and the harness was wrong, which CLAUDE.md records
    as true about half the time on a first run. A `noWrite` turn placed after
    a writing turn could NEVER pass, by construction.

    Counted before rather than derived after, because #197's rule is that
    anything you need to know about "before" has to have been recorded before.
  */
  const before = await countTasks(projects)

  const jobId = String(
    (
      await patiently(
        async () =>
          await one(`
            begin;
            /*
              Idempotent, because a turn can be ENQUEUED and not RECORDED.

              The whole design is resumable — a turn is a real job and a run
              may be cut short — and the resume was one step short of it: the
              command insert had no conflict clause, so a run killed between
              the enqueue and the write to the progress file could never be
              continued. It failed with a raw 23505 on the dedupe key four
              turns into a nine-turn session, which reads like a harness bug
              and is a harness bug.

              ON CONFLICT DO NOTHING plus the lookup below means a re-run
              adopts the job the previous attempt started, which is what a
              person re-running the command means by it.

              No backticks in this comment: it lives inside a template
              literal and one would end the string. CLAUDE.md's oldest trap,
              in its third location.
            */
            insert into public.inbound_commands
              (origin_channel, origin_ref, actor, instruction, dedupe_key, received_at, project_id)
            values ('teamhq', ${lit(`${chat}:${String(index)}`)}, ${lit(actor)},
                    ${lit(turn.say)}, ${lit(key)}, app.now_utc(),
                    ${projectId === null ? 'null' : `${lit(projectId)}::uuid`})
            on conflict (dedupe_key) do nothing;
            create temp table _j as
              select coalesce(
                (select j.job_id from public.jobs j
                   where j.idempotency_key = (
                     select 'inbound-' || c.command_id::text from public.inbound_commands c
                      where c.dedupe_key = ${lit(key)})),
                (app.enqueue_inbound(
                   (select command_id from public.inbound_commands
                     where dedupe_key = ${lit(key)})
                 ) ->> 'job_id')::uuid) as id;
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
               coalesce(j.state_reason, '') as why,
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
  One last look after the deadline, and a word for what the deadline means
  (#250).

  A turn whose job took three attempts outlived the wait loop, and the harness
  scored it "the office actually answered (running)" — which reads as the
  product answering nothing. It had answered, and well: a calculated figure
  labelled as calculated, an explicit "I have no internal benchmark", and
  market knowledge offered as market knowledge. Exactly what this campaign was
  buying, recorded as a failure.

  Two things are wrong with the old shape and only one of them is the timing.
  A wait loop that expires knows something a failed job does not: NOTHING HAS
  DECIDED YET. Scoring that as a product failure is the wrong layer, the same
  mistake as asserting a routing decision before anything has routed — and it
  is the expensive direction, because a harness that reports good answers as
  failures is one whose failures stop being read.

  So: re-read once after a grace pause, which recovers the ordinary case of a
  job that finished a moment after the loop gave up; and if it is STILL live,
  say `unfinished` rather than judging it. `unfinished` is not a pass — it is
  counted and printed separately, because a session where half the turns never
  settled has told you nothing and must not read as green.
*/
  const LIVE = ['queued', 'running', 'retrying', 'leased']
  let unfinished = false
  if (!['complete', 'failed', 'cancelled'].includes(String(row.state))) {
    await new Promise((r) => setTimeout(r, 20_000))
    row = await patiently(
      async () =>
        await one(`
        select j.state::text as state, j.announce, app.harness_job(j.job_id) as fixture,
               coalesce(j.state_reason, '') as why,
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
    unfinished = LIVE.includes(String(row.state))
  }

  /*
    A fourth verdict: the office could not THINK (#250's shape, one step on).

    `unfinished` separates "nothing has decided yet" from "it answered badly".
    This separates a third thing that was being counted as the second: a job
    that reached `failed` because the PROVIDER was down.

    Measured, not imagined. Across every session job ever recorded the failure
    reasons are: 37 x "provider openrouter is unavailable: its circuit breaker
    is open", 9 x "incoherent output metadata", and 2 from a provenance defect
    since fixed. The whole `roster` session — all nine turns, including both of
    its controls — failed on 15 September inside one OpenRouter outage, and
    `npm run session -- --report` has been scoring those nine as the office
    answering badly ever since. Nine of the report's twenty-three failures were
    four-day-old weather.

    That is the shape CLAUDE.md keeps recording and keeps paying for: a
    measurement that cries wolf is one Grant learns to ignore, and this one had
    39% noise in its failure column.

    DELIBERATELY NARROW, and the asymmetry is what makes that safe. Too narrow
    and an outage still reads as a failure, which is exactly today's behaviour
    and costs nothing new. Too broad and a real product failure is hidden,
    which is unrecoverable. So it matches a provider being unavailable and
    nothing else — "incoherent output metadata" stays a FAILURE, because the
    office producing an answer it cannot stand behind is a behavioural outcome
    and not weather.
  */
  const why = String(row.why ?? '')
  const couldNotThink = String(row.state) === 'failed' && weather(why)

  /*
    Tasks are counted for the SESSION, not globally.

    `public.tasks` is shared, and a count that included Grant's own would make
    every "no write happened" assertion depend on what else the office did
    tonight. Scoped by the projects this session created.
  */
  const tasks = await countTasks(projects)
  const taskCount = tasks.length

  /*
    Normalised before any substring test (#231 Campaign Three).

    A control asserted the answer would never say "forty-two" and it said
    `forty‑two` — with U+2011, a non-breaking hyphen — so the assertion passed
    over the exact leak it existed to catch. Models emit typographic dashes,
    curly quotes and non-breaking spaces freely, and every `says` / `neverSays`
    in this harness is a substring test.

    Sixth instance of the wording-lock family in this repository, and the first
    where the lock was a character nobody typed.
  */

  const answered = String(row.answered ?? '')
  /*
    EVERY semantic assertion below reads this, never `answered` (#251).

    Nine wording-lock failures in this repository, two of them on one day, and
    the last one scored an exemplary refusal as a defect because the office
    wrote "don’t" with U+2019 while the pattern wanted an ASCII apostrophe.
    The eighth fix corrected the substring tests and the audit that followed it
    grepped for `.includes(` — which is why a REGEX in a sibling code path
    survived untouched.

    So the rule is structural rather than remembered: the raw answer is used
    for LENGTH and for DISPLAY, and every test of what the answer SAYS runs on
    the normalised form. `verify:harness` asserts that, by feeding the same
    answer in both typographies and requiring the same verdict.
  */
  const searchable = plain(answered)
  const passes: string[] = []
  const fails: string[] = []
  // #250: a third verdict, because "did not answer" and "has not answered yet"
  // are different facts and only one of them is about the product.
  const inconclusive: string[] = []
  const judge = (what: string, good: boolean, note = ''): void => {
    ;(good ? passes : fails).push(`${what}${note === '' ? '' : ` (${note})`}`)
  }

  /* The two safety properties, on every single turn, never assumed. */
  judge('cannot reach Grant', row.announce === false)
  judge('is harness traffic', row.fixture === true)

  /*
    And the property every other expectation depends on: Grant got an answer.

    The first version of this harness did not check it, and two of the four
    turns in the corrections session came back `failed` while their
    expectations passed — because `recipient_agent` is written before the
    failure, so "answered by the finance director" held for a turn that
    answered nothing. A suite that can report a green turn for a job Grant
    received nothing from is measuring the wrong thing.
  */
  if (couldNotThink) {
    /*
      Not judged, and counted apart — the same treatment as `unfinished` and
      for the same reason. An expectation about an answer the office was
      never able to form is an assertion about nothing, and a green one would
      be worse than a red one.
    */
    inconclusive.push(`could not think — ${why.slice(0, 80)}`)
  } else if (unfinished) {
    /*
      Not judged either way. The turn is reported as unfinished and every
      expectation below it is skipped, because an expectation about an answer
      that does not exist yet is an assertion about nothing — and a green one
      would be worse than a red one.
    */
    inconclusive.push(`still ${String(row.state)} when the wait expired`)
  } else {
    judge('the office actually answered', String(row.state) === 'complete', String(row.state))
  }

  const e = turn.expect
  /*
    `!unfinished && !couldNotThink`, because an expectation about an answer that does not exist
    yet is an assertion about nothing - and a GREEN one would be worse than a
    red one. #250's own turn is the case: `recipient_agent` is written before
    the answer, so "answered by the finance director" held for a job that had
    not finished, which is how a harness reports a turn it never saw.
  */
  if (e !== undefined && !unfinished && !couldNotThink) {
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
    if (e.tasks !== undefined) {
      judge(`${String(e.tasks)} task(s) exist`, taskCount === e.tasks, String(taskCount))
      /*
        And in the right project, which is the whole question after a switch.

        The count alone nearly passed for the wrong reason: the cross-project
        session counts tasks across BOTH its projects, so a task filed against
        A after an implicit switch to B would have scored exactly the same
        "1 task". A wrong-project write is the serious defect that session
        exists for, and it would have been invisible.
      */
    }
    if (e.tasksIn !== undefined) {
      const elsewhere = tasks.filter((t) => !String(t.slug).includes(String(e.tasksIn)))
      judge(
        `every task so far is in ${e.tasksIn}`,
        tasks.length > 0 && elsewhere.length === 0,
        tasks.length === 0
          ? 'no task was created at all, so this proves nothing'
          : elsewhere.map((t) => `${String(t.title)} -> ${String(t.slug)}`).join(', '),
      )
    }
    if (e.noWrite === true) {
      // The DELTA, not the total. See `before` at the top of this function.
      judge(
        'this turn created no task',
        taskCount === before.length,
        taskCount === before.length
          ? String(taskCount)
          : `${String(taskCount - before.length)} new (${String(before.length)} -> ${String(taskCount)})`,
      )
    }
    for (const s of e.says ?? []) judge(`says ${JSON.stringify(s)}`, searchable.includes(plain(s)))
    if ((e.saysAny ?? []).length > 0) {
      /*
        Through `plain`, like `says` and `neverSays` above (#245).

        This was `answered.toLowerCase().includes(...)` — the one substring test
        in the harness that skipped the normaliser written four hundred lines
        up for exactly this hazard. It was added after `plain` existed and
        never joined it, and on 2026-09-15 it failed a correct refusal because
        the office wrote "don’t" with U+2019 while the expectation listed
        "don't". The office was right and the harness said it was wrong.

        Seventh instance of the wording-lock family here, and the second where
        the lock was a character nobody typed. One normaliser, three callers.
      */
      const found = (e.saysAny ?? []).filter((s) => searchable.includes(plain(s)))
      judge(
        `says one of ${(e.saysAny ?? []).map((s) => JSON.stringify(s)).join(', ')}`,
        found.length > 0,
        found.join(', '),
      )
    }
    for (const s of e.neverSays ?? [])
      judge(`never says ${JSON.stringify(s)}`, !searchable.includes(plain(s)))
    if (e.convenes !== undefined || e.convening !== undefined) {
      const roster = String(row.roster ?? '')
        .split(',')
        .map((r) => r.trim())
        .filter(Boolean)
      if (e.convenes !== undefined)
        judge(
          `${String(e.convenes)} specialist(s) convened`,
          roster.length === e.convenes,
          roster.join(', ') || 'nobody',
        )
      for (const who of e.convening ?? [])
        judge(`${who} was convened`, roster.includes(who), roster.join(', ') || 'nobody')
    }
    if (e.cannotSee === true)
      judge(
        'says it cannot see it, briefly',
        // Length from the raw answer, meaning from the normalised one (#251).
        answered.length < 600 && (/\?/.test(searchable) || ABSENCE.test(searchable)),
        `${String(answered.length)} chars${ABSENCE.test(searchable) ? '' : ', no absence stated'}`,
      )
    if (e.clarifies === true)
      judge(
        'asks rather than guesses',
        /\?/.test(searchable) && answered.length < 1200,
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
    taskTitles: tasks.map((t) => `${String(t.title)} [${String(t.slug)}]`),
    announced: row.announce === true,
    fixture: row.fixture === true,
    passes,
    fails,
    inconclusive,
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
export const tidy = async (jobIds: readonly string[]): Promise<void> => {
  if (jobIds.length > 0) {
    await db
      .execute(`
        update public.jobs set state = 'cancelled', finished_at = app.now_utc(),
               state_reason = 'session harness teardown'
         where job_id = any(array[${jobIds.map((j) => `${lit(j)}::uuid`).join(',')}])
           and state in ('queued', 'retrying', 'paused')`)
      .catch(() => undefined)
  }
  /*
    The tasks are KEPT, deliberately (#231 Campaign Three).

    Deleting them destroyed the only proof that `task.create` is reachable:
    `npm run levels` counts surviving rows, so the capability read as
    never-exercised the morning after it was proven end to end. 0369 makes a
    task created by a harness job `is_fixture`, which means every reader that
    reports to Grant excludes it AND it stays countable — the same argument
    0297 makes about fixture impediments, and the opposite of the debris rule,
    because a flagged row in a fixture project is not debris.
  */
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
