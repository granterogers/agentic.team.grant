/**
 * The morning briefing Grant asked for, from his chief of staff.
 *
 * Grant, 11 September 2026:
 *
 *     "Certainly, I should expect every morning a morning briefing from my
 *      chief of staff, you know, what's on the cards, what's to be done,
 *      recommendations, that kind of thing. Um, I appreciate it'll have much
 *      current data to go on. I think that's a good way to do things."
 *
 * Issue #56. §12 asked for this and the machinery was all present and unwired:
 * `briefings` had the right unique key and had never held a row, `today` and
 * `needs_me` existed, and `responsibilities` was already firing other duties
 * every minute.
 *
 * ## That last sentence is a licence for a thin briefing, not an invented one
 *
 * A model asked to write a morning briefing with little to go on will write a
 * good one anyway — that is what it is for — and the result reads exactly like
 * a briefing about a busy office. He would trust it, and it would be fiction.
 *
 * So every fact is counted in SQL (`app.morning_briefing_facts`, 0188) and the
 * model is handed FINISHED SENTENCES, never numbers to summarise. `capacity.ts`
 * established this and its reasoning holds here: a model given "35 of 40 by our
 * own count, because Google publishes no usage API" will helpfully produce "35
 * of 40 remaining", which is the same sentence with the only important part
 * removed.
 *
 * ## An empty section says it is empty
 *
 * A briefing that pads is a briefing he skims, and a skimmed briefing is worse
 * than none because the morning he actually needed to read one, he will not.
 * Quiet parts are left out entirely rather than printed as zeroes — the same
 * rule the capacity note arrived at after telling him "nothing failed" every
 * day for a month.
 *
 * ## Once a day, and Claire is the only one who sends it
 *
 * `telegram.only_chief_speaks` is true and this is exactly what it is for.
 * Idempotency is the unique index on `(kind, scope_ref, for_date)`, not a check
 * in this file: a check-then-insert has a race and an index does not. If the
 * briefing for today already exists, this returns quietly and announces
 * nothing — a duty re-attempted after a crash must not brief him twice.
 */

import { howComposed } from '../agents/provenance.ts'
import type { SqlExecutor } from '../db/executor.ts'
import type { Handler, HandlerOutput, Job } from '../jobs/worker.ts'
import type { ProviderRouter } from '../providers/router.ts'
import { count } from '../text/plain.ts'
import { sayAs } from '../text/voice.ts'

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

interface Waiting {
  what: string
  why: string
  project: string | null
  overdue: boolean
  deadline: string | null
  if_delayed: string | null
  work_continues: boolean
}
interface Stuck {
  kind: string
  project: string | null
  since_hours: number
  why: string
}
interface Diary {
  what: string
  at: string
}
/**
 * Something the office noticed without being asked (#52).
 *
 * The body is already a finished sentence, counted in SQL by `app.notice()`,
 * for the reason this file's header gives: a model handed the numbers writes a
 * better sentence with the hedge removed.
 */
interface Noticed {
  kind: string
  body: string
  because: Record<string, unknown>
  weight: number
}
/**
 * Something the office has asked to be able to reach, and cannot until Grant
 * answers (#53).
 */
interface Wanted {
  tool: string
  asked_by: string
  what_for: string
  exists_yet: boolean
  days: number
}
export interface Facts {
  for_date: string
  timezone: string
  waiting_on_you: Waiting[]
  overnight: { finished: number; failed: number; still_going: number }
  stuck: Stuck[]
  diary: Diary[]
  noticed: Noticed[]
  wanted: Wanted[]
  /**
   * How much is being held back, and how old the oldest is (#272, 0469).
   *
   * Optional because a briefing assembled before 0469 has no such key, and a
   * handler that threw on an older payload would take the whole briefing with
   * it for a line that is an addition rather than the point.
   */
  pressure?: {
    open_items: number
    cap: number
    suppressed: number
    oldest_days: number
  }
}

/** Local wall-clock time, in his zone, for a timestamp that is stored in UTC. */
const atLocal = (iso: string, tz: string): string =>
  new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: tz,
  }).format(new Date(iso))

/**
 * The briefing, as a list of sentences.
 *
 * Exported so the verification can assert on the same lines the handler sends,
 * rather than on whatever the model made of them. A test that asserts on model
 * output is a test that fails for the wrong reasons.
 */
export function briefingLines(f: Facts): string[] {
  const lines: string[] = []
  const tz = f.timezone

  /*
    What needs him, first and always.

    `needs_me`'s own comment says it: the only category a person can unblock.
    Everything else in this briefing is information; this part is a request,
    and burying a request under a status summary is how it gets missed.
  */
  if (f.waiting_on_you.length > 0) {
    const overdue = f.waiting_on_you.filter((w) => w.overdue).length
    /*
      What the cap is hiding, and how long the oldest has sat (#272).

      `needs_me` is CAPPED, so the sixth and seventh request are simply absent
      from this list — the cap working as designed and failing as a product,
      because being told about four of nine reads exactly like there being
      four. And a request nobody set a date on ages invisibly: "past a real
      deadline" counts only the ones with a deadline, so something eight days
      old with no date is never late and never mentioned.

      Both clauses are conditional. A line that appears every morning saying
      "nothing is being held back" is a line he stops reading, which is the
      same argument as the hourly sync that only speaks when something moved.
    */
    const p = f.pressure
    const held =
      p === undefined || p.suppressed <= 0
        ? ''
        : ` I am holding back ${count(p.suppressed, 'more', 'more')} so this stays readable.`
    /*
      Two days is not "waiting". Seven is, and it is the same threshold the
      quiet-thread reader uses, so the office does not have two ideas of how
      long is too long.
    */
    const aged =
      p === undefined || p.oldest_days < 7
        ? ''
        : ` The oldest has been waiting ${String(Math.floor(p.oldest_days))} days.`
    lines.push(
      `${count(f.waiting_on_you.length, 'thing is', 'things are')} waiting on you` +
        (overdue === 0 ? '.' : `, and ${String(overdue)} are past a real deadline.`) +
        held +
        aged,
    )
    // Named, not counted. "Three decisions are waiting" tells him there is work
    // to do; it does not let him do any of it from the message.
    for (const w of f.waiting_on_you.slice(0, 4)) {
      /*
        Two small things a reader notices immediately.

        The project name is only worth appending when the request does not
        already contain it. `Generate mind map for "AI Team HQ Test" (AI Team
        HQ Test)` is the kind of line that reads as machine-generated before
        you have finished it.

        And `requested_action` arrives truncated from upstream — one of these
        ends mid-word, at "inclusio". Not this file's bug to fix, but printing
        it raw makes the office look like it lost the end of the sentence, so
        an ellipsis says the text was cut rather than the thought.
      */
      const named = w.project !== null && !w.what.includes(w.project) ? ` (${w.project})` : ''
      const cut = /[a-z]$/.test(w.what.trimEnd()) && w.what.length > 100

      /*
        The first sentence of `why`, and no more.

        This file's own header says a model handed "35 of 40 by our own count,
        because Google publishes no usage API" will produce "35 of 40
        remaining" — the same sentence with the only important part removed. It
        then happened, in the first real briefing: Claire wrote "≈3 notebook
        units, 35/40 left", and an estimate became a fact on Grant's phone.

        Instructing the model not to is the weak fix and is one bad morning
        away from failing again. The strong fix is that the number is not in
        the briefing at all: notebook allowance accounting belongs in the
        evening capacity report, which is built to carry its own caveats. What
        a briefing needs is what the decision is and roughly what it costs.
      */
      const gist = (w.why.split(/(?<=\.)\s+/)[0] ?? w.why).trim()

      lines.push(
        `${w.what.trimEnd()}${cut ? '…' : ''}${named}. ${gist}` +
          (w.work_continues ? '' : ' Nothing else on that project moves until you answer.'),
      )
    }
    if (f.waiting_on_you.length > 4) {
      lines.push(`${String(f.waiting_on_you.length - 4)} more are on the dashboard.`)
    }
  } else {
    /*
      A quiet morning still has to be a briefing.

      `briefings_body_substantive` requires 40 characters, and "Nothing is
      waiting on you." is 26 — so the quietest possible morning, which is the
      most common one, would have been REFUSED by the table and Grant would
      have got silence on exactly the days the office was running smoothly.
      Caught by running it; the constraint is right and the sentence was wrong.
    */
    lines.push('Nothing is waiting on you, and nothing is stuck.')
  }

  /*
    What the office has asked for and cannot do until he answers (#53).

    Immediately after what is waiting on him, because it IS waiting on him —
    it is a question only he can answer, and the whole route that produces it
    (a skill names a tool nobody holds, three impediments, a briefing line)
    exists to get it in front of him once. Two at most: a list of asks reads
    as a wish list, and a wish list is a thing people stop reading.
  */
  for (const w of f.wanted.slice(0, 2)) {
    lines.push(
      `${w.asked_by} has asked to be able to use ${w.tool}` +
        (w.days >= 2 ? `, ${count(w.days, 'day', 'days')} ago` : '') +
        `. ${w.what_for}` +
        // The distinction ADR-0018 turns on, in the one sentence he reads. Yes
        // to one of these is a switch; yes to the other is a decision to build.
        (w.exists_yet
          ? ' Saying yes switches it on.'
          : ' We do not have that tool at all yet, so yes means building it.'),
    )
  }
  if (f.wanted.length > 2) {
    lines.push(`${String(f.wanted.length - 2)} more requests are on the dashboard.`)
  }

  // His day. Omitted entirely when the calendar is empty — "no meetings today"
  // every morning is a line that teaches him to stop reading.
  if (f.diary.length > 0) {
    lines.push(
      `Today: ${f.diary
        .slice(0, 5)
        .map((d) => `${d.what} at ${atLocal(d.at, tz)}`)
        .join(', ')}.`,
    )
  }

  // What we did while he slept.
  if (f.overnight.finished > 0 || f.overnight.failed > 0) {
    lines.push(
      f.overnight.failed === 0
        ? `We finished ${count(f.overnight.finished, 'piece', 'pieces')} of work overnight.`
        : // Finished and failed are separate counts over one window. "We
          // finished 70 pieces, 129 of them failed" is arithmetic nonsense and
          // makes a reader distrust every other number in the note.
          `We finished ${count(f.overnight.finished, 'piece', 'pieces')} of work overnight, ` +
            `and ${count(f.overnight.failed, 'one', 'others')} failed.`,
    )
  }

  // Stuck work, with the reason. A blocked job with no stated blocker is the
  // failure the Active Jobs section was built to fix.
  if (f.stuck.length > 0) {
    lines.push(
      `${count(f.stuck.length, 'piece', 'pieces')} of work has been stuck for hours: ` +
        f.stuck
          .slice(0, 3)
          .map((s) => `${s.kind}${s.project === null ? '' : ` on ${s.project}`} — ${s.why}`)
          .join('; ') +
        '.',
    )
  }

  /*
    Recommendations — his word, and the part that has to earn its place.

    One source now, not two: the noticing pass, `app.notice` (#52), which arrives already
    ranked and already stripped of anything he has dismissed. This section
    used to render `adrift` and `office_cannot` directly, and both were
    subsets of the noticing pass — so the briefing said the same thing twice
    in two different phrasings, which reads worse than either alone.

    Three, and no more. The failure mode of a recommendations section is not
    that it is thin, it is that it is long enough to skim.
  */
  for (const n of f.noticed.slice(0, 3)) {
    lines.push(
      // A quiet project is the one kind that is an observation without an
      // implied action, so it gets the nudge that turns it into one. The
      // others already name what to do by naming what is wrong.
      n.kind === 'project_quiet' ? `${n.body} Worth deciding whether it is still live.` : n.body,
    )
  }

  return lines
}

export function briefingHandler(db: SqlExecutor, router: ProviderRouter | null = null): Handler {
  return {
    kind: 'briefing.morning',
    handle: async (job: Job): Promise<HandlerOutput> => {
      const facts = (
        await db.execute(
          `select app.morning_briefing_facts(app.job_office(${lit(job.jobId)}::uuid)) as f`,
        )
      ).rows[0] as {
        f?: Facts
      }
      const f = facts.f
      if (f === undefined) {
        return {
          body: 'The briefing could not be assembled: no facts came back.',
          announce: false,
          confidence: 'low',
          evidence: 'speculative',
          sources: [`job:${job.jobId}`],
          contradictions: null,
          path: 'deterministic_retrieval',
          model: null,
        } satisfies HandlerOutput
      }

      const lines = briefingLines(f)
      let assembled = lines.join('\n\n')

      /*
        The floor, belt and braces.

        The quiet path above is comfortably over 40 characters now, but it is
        one edit away from not being, and the failure mode is silence on a good
        morning rather than an error anyone would see. So the guard is here as
        well, and it adds a true sentence rather than padding.
      */
      if (assembled.trim().length < 40) {
        assembled = `${assembled}\n\nA quiet start. I will say so if that changes.`
      }

      /*
        Written BEFORE it is voiced, and the insert decides whether to send.

        The alternative — voice it, send it, then record it — spends a model
        call and Grant's attention before discovering the briefing already went
        out this morning. The unique index is the authority on whether today
        has been briefed, so it is asked first.
      */
      const written = (
        await db.execute(`
          select app.write_briefing(app.job_office(${lit(job.jobId)}::uuid), 'morning', '${f.for_date}'::date,
            $briefing$${assembled}$briefing$,
            (select app.morning_briefing_facts(app.job_office(${lit(job.jobId)}::uuid)))) as r
        `)
      ).rows[0] as { r?: { already_written?: boolean } }

      if (written.r?.already_written === true) {
        return {
          body: `Grant has already been briefed for ${f.for_date}. Not sending a second one.`,
          // The whole point of the unique key. A duty re-attempted after a
          // crash must not brief him twice.
          announce: false,
          confidence: 'high',
          evidence: 'verified',
          sources: [`job:${job.jobId}`],
          contradictions: null,
          path: 'deterministic_retrieval',
          model: null,
        } satisfies HandlerOutput
      }

      return {
        body: await sayAs(db, router, 'chief-of-staff', {
          purpose:
            'Write Grant his morning briefing. You send this every morning, so ' +
            'vary the opening — some days there is something to remark on and ' +
            'most there is not. Lead with whatever actually needs him. Do not ' +
            'add anything that is not in the facts, and do not pad a quiet ' +
            'morning into a busy-sounding one. Where a fact says a number is ' +
            'an estimate or our own count, keep that — dropping the hedge ' +
            'turns a guess into a fact.',
          facts: lines,
          fallback: assembled,
          // #268: attributed, so the call lands under this job KIND rather than under (unattributed).
          job: { jobId: job.jobId, correlationId: job.correlationId },
          words: 130,
        }),
        announce: true,
        // He asked to receive this every morning, so it reaches the phone
        // rather than only Slack. §12 gives Telegram one interrupting voice
        // and this is the chief of staff using it once a day, as asked.
        severity: 'important',
        confidence: 'high',
        // Every line is counted from our own tables by 0188.
        evidence: 'verified',
        sources: [`job:${job.jobId}`],
        contradictions: null,
        /*
          Read from the record, never asserted (0489).

          This return spends a model — `sayAs` above — and claimed
          `deterministic_retrieval`, which `enforce_deterministic_claim`
          refuses on any correlation that recorded an inference. So the output
          was thrown away and the job FAILED, every time this branch ran.

          It is a class, not an instance: the same shape killed
          `office.slack_rotate` ten times, `briefing.morning` twice (including
          at 04:00 on 18 September — Grant simply got no briefing that
          morning), `office.capacity_report` twice and `office.sync` twice.
          `howComposed` is the one definition, in `agents/provenance.ts`.
        */
        path: await howComposed(db, job.jobId),
        model: null,
      } satisfies HandlerOutput
    },
  }
}
