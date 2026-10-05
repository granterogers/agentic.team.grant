/**
 * How much is the office saying to Grant that he did not ask for?
 *
 *   npm run check:chatter
 *
 * On 16 and 17 September `office.provision_channels` sent **756 messages to
 * his real Telegram chat** — 746 of them on one day, one about every ninety
 * seconds for twelve hours — because a sweep re-enqueued a channel that could
 * never be created and the handler answered courteously every time, with
 * `announce: true`.
 *
 * 0477 bounded THAT enqueuer. Nothing was watching the class. `check:leaks`
 * asks whether HARNESS traffic reached a real destination and had no opinion
 * about real traffic; `app.office_health()` reports failures, stalls and
 * waiting work, and a duty that runs perfectly and sends perfectly is none of
 * those. So the office could do it again tomorrow through a different duty and
 * the first thing to notice would be Grant's phone.
 *
 * ## What it counts, and what it deliberately does not
 *
 * Deliveries he did not ask for: everything except `office.instruction`, which
 * is a REPLY to a message he sent, so its volume is his own doing and bounding
 * it would be bounding the conversation. That kind is printed, never failed
 * on.
 *
 * ## The ceiling
 *
 * Measured against every day on record. The busiest legitimate duty-day is
 * `google.read_mail` at 48, then `google.read_calendar` at 24. The runaway was
 * 746. A hundred clears the honest maximum twice over and catches a
 * once-a-minute loop inside two hours.
 *
 * ## Its own positive control
 *
 * A check whose happy path is "found nothing" passes against a query that can
 * find nothing — three instances of that shape in CLAUDE.md, and the worst of
 * them printed a zero that read as a perfect score. This one does not need a
 * synthetic row: the incident is permanently in `public.deliveries`, so the
 * same predicate pointed at September 2026 must still report it. If the
 * control comes back quiet, the query has stopped working.
 */

import '../src/safety/require-production-checks.ts'
import { ManagementApiExecutor } from '../src/db/executor.ts'

const token = process.env.SUPABASE_ACCESS_TOKEN
if (token === undefined || token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}
const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  token,
)

/** Messages a day from one kind, above which nobody meant this to happen. */
const CEILING = 100
/** How far back the live check looks. */
const DAYS = 3

interface Row {
  kind: string
  day: string
  n: number
}

const talkers = async (where: string): Promise<Row[]> =>
  (
    await db.execute(`
      select j.kind, d.sent_at::date::text as day, count(*)::int as n
        from public.deliveries d
        join public.jobs j on j.job_id = d.job_id
       where d.state = 'sent'
         and d.channel in ('telegram', 'slack')
         and not app.harness_job(j.job_id)
         and ${where}
       group by 1, 2
       order by n desc
       limit 20`)
  ).rows as unknown as Row[]

/*
  THE CONTROL FIRST, because a query that has stopped working reports calm.
  September 2026 holds the incident and always will: deliveries are not
  deleted.
*/
const historical = await talkers(
  `j.kind <> 'office.instruction' and d.sent_at < '2026-09-18' and d.sent_at >= '2026-09-16'`,
)
const worstThen = historical[0]?.n ?? 0
if (worstThen < CEILING) {
  console.error(
    `CONTROL FAILED: the 16-17 September burst should still be visible to this query, ` +
      `and the worst day it can see is ${String(worstThen)}. The query is broken, not the office.`,
  )
  process.exit(1)
}
console.log(
  `control: the September burst is still visible — ${historical[0]?.kind ?? '?'} ` +
    `sent ${String(worstThen)} on ${historical[0]?.day ?? '?'}\n`,
)

const recent = await talkers(
  `j.kind <> 'office.instruction' and d.sent_at > now() - interval '${String(DAYS)} days'`,
)
const replies = await talkers(
  `j.kind = 'office.instruction' and d.sent_at > now() - interval '${String(DAYS)} days'`,
)

console.log(
  `unprompted messages to Grant, last ${String(DAYS)} days (ceiling ${String(CEILING)} a day):`,
)
if (recent.length === 0) console.log('  none')
for (const r of recent) {
  console.log(
    `  ${r.n > CEILING ? 'TOO MANY' : 'ok      '} ${r.day}  ${String(r.n).padStart(4)}  ${r.kind}`,
  )
}
/*
  Printed, never failed on: a reply is something he asked for, and bounding it
  would be bounding the conversation.
*/
if (replies.length > 0) {
  console.log('\nreplies to his own messages (reported, not bounded):')
  for (const r of replies) console.log(`  ${r.day}  ${String(r.n).padStart(4)}  ${r.kind}`)
}

const over = recent.filter((r) => r.n > CEILING)
if (over.length > 0) {
  console.error(
    `\n${String(over.length)} kind-day(s) above the ceiling. The office is talking at him.\n` +
      'Find what is re-enqueueing, bound it there, and check whether the handler should be ' +
      'raising a blocker once instead of answering every time.',
  )
  process.exit(1)
}
console.log('\nnothing is talking at him')
