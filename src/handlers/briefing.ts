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

import type { SqlExecutor } from '../db/executor.ts'
import type { Handler, HandlerOutput, Job } from '../jobs/worker.ts'
import type { ProviderRouter } from '../providers/router.ts'
import { count } from '../text/plain.ts'
import { sayAs } from '../text/voice.ts'

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
interface Adrift {
  project: string
  open_tasks: number
  last_touched_days: number
}
interface Cannot {
  who: string | null
  needs: string
  kind: string
  times: number
  for_instance: string | null
}
interface Facts {
  for_date: string
  timezone: string
  waiting_on_you: Waiting[]
  overnight: { finished: number; failed: number; still_going: number }
  stuck: Stuck[]
  diary: Diary[]
  adrift: Adrift[]
  office_cannot: Cannot[]
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
    lines.push(
      `${count(f.waiting_on_you.length, 'thing is', 'things are')} waiting on you` +
        (overdue === 0 ? '.' : `, and ${String(overdue)} are past a real deadline.`),
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
      lines.push(
        `${w.what.trimEnd()}${cut ? '…' : ''}${named}. ${w.why}` +
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

    Only two honest sources today: a project with open work that nothing has
    touched in a week, and a limitation the office has hit more than once
    (#47). Both are counted, neither is inferred. #52's noticing pass is what
    makes this section genuinely good, and until then it is thin rather than
    padded.
  */
  for (const a of f.adrift.slice(0, 2)) {
    lines.push(
      `${a.project} has not moved in ${count(a.last_touched_days, 'day', 'days')}` +
        (a.open_tasks > 0 ? ` with ${count(a.open_tasks, 'task', 'tasks')} still open.` : '.') +
        ' Worth deciding whether it is still live.',
    )
  }
  for (const c of f.office_cannot.slice(0, 2)) {
    lines.push(
      `We have been unable to ${c.needs.replace(/-/g, ' ')} ${count(c.times, 'time', 'times')} ` +
        `in the last fortnight${c.who === null ? '' : ` — ${c.who}`}.` +
        (c.for_instance === null ? '' : ` For instance: ${c.for_instance}`),
    )
  }

  return lines
}

export function briefingHandler(db: SqlExecutor, router: ProviderRouter | null = null): Handler {
  return {
    kind: 'briefing.morning',
    handle: async (job: Job): Promise<HandlerOutput> => {
      const facts = (await db.execute('select app.morning_briefing_facts() as f')).rows[0] as {
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
          select app.write_briefing('morning', '${f.for_date}'::date,
            $briefing$${assembled}$briefing$,
            (select app.morning_briefing_facts())) as r
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
            'morning into a busy-sounding one.',
          facts: lines,
          fallback: assembled,
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
        path: 'deterministic_retrieval',
        model: null,
      } satisfies HandlerOutput
    },
  }
}
