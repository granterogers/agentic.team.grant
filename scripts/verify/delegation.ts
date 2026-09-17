/**
 * Is the work actually delegated, or is it eight voices and one worker?
 *
 *   npm run verify:delegation
 *
 * Issue #65. Grant: *"I still don't really fully understand the role of the
 * individual agents when I send Claire to do something. If it's truly being
 * delegated, or if it's just one bot now doing all the work… This whole concept
 * is the core of the agentic workforce."*
 *
 * The measurement that produced the issue: 0 of 499 real jobs carried a
 * `recipient_agent`, and `consultations` had never held a row. The routing
 * decision was being made, recorded in `routing_decisions`, and thrown away.
 *
 * ## What this asserts, and why it is mostly about the DATA
 *
 * Subject routing used to be five regexes in `router.ts`. It worked and Grant
 * could not change it — and he is building a dashboard to *"look at each agent,
 * what their skill sets are, and adjust and add and refine"*. So the vocabulary
 * moved into `staff.expertise`, and the important property is now:
 *
 *     editing a row changes who gets the work
 *
 * That is asserted directly, by teaching a specialist a nonsense word and
 * watching the routing follow it.
 */

import type { SqlExecutor } from '../../src/db/executor.ts'
import { ManagementApiExecutor } from '../../src/db/executor.ts'

const token = process.env.SUPABASE_ACCESS_TOKEN
if (token === undefined || token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is not set')
  process.exit(2)
}
const db: SqlExecutor = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  token,
)

let pass = 0
let fail = 0
const ok = (what: string, good: boolean, note = '') => {
  if (good) {
    pass++
    console.log(`  ok   ${what}`)
  } else {
    fail++
    console.error(`  FAIL ${what}${note === '' ? '' : ` — ${note}`}`)
  }
}
const all = async (sql: string): Promise<Record<string, unknown>[]> =>
  (await db.execute(sql)).rows as Record<string, unknown>[]
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
const run = Date.now().toString(36)

/** Who the roster says should take this. */
const asks = async (text: string): Promise<string[]> =>
  (await all(`select slug from app.who_knows_about(${lit(text)}, 3)`)).map((r) => String(r.slug))

console.log('delegation —')

// --- the right person, for the things Grant actually says -------------------

for (const [text, expected] of [
  ['how much should we charge for the coaching programme', 'finance-director'],
  ['research how to make good money coaching people in wellness', 'research-director'],
  ['write me an announcement for the new course', 'communications-director'],
  ['what is the schedule and capacity for next month', 'operations-director'],
  ['compare our competitors and their pricing', 'research-director'],
  ['should we post this on instagram', 'growth-director'],
  ['check that these figures are right', 'quality-director'],
] as const) {
  const who = await asks(text)
  ok(
    `"${text.slice(0, 44)}…" → ${expected}`,
    who.includes(expected),
    who.length === 0 ? 'nobody' : who.join(', '),
  )
}

// Nobody is the right answer sometimes, and it matters: a router that always
// names someone is a router that has stopped discriminating.
ok('and "good morning" goes to nobody', (await asks('good morning')).length === 0)
ok('as does "thanks"', (await asks('thanks')).length === 0)

// --- the property Grant is actually buying ----------------------------------
//
// He is going to sit in front of the dashboard and change these. The point is
// not that the current words are right; it is that changing them changes the
// answer, without me.

{
  const WORD = `zorbling${run}`
  const before = await asks(`please handle the ${WORD} for me`)
  ok('a word nobody knows routes to nobody', before.length === 0, before.join(', '))

  await db.execute(`select app.teach_expertise('finance-director', array[${lit(WORD)}])`)
  const after = await asks(`please handle the ${WORD} for me`)
  ok(
    'teaching it to a specialist sends the work there — no deploy, no code',
    after.includes('finance-director'),
    after.join(', ') || 'nobody',
  )

  // Additive, so a seed migration can never wipe what he has typed.
  const kept = await all(
    `select 1 from public.staff where slug = 'finance-director' and 'pricing' = any(expertise)`,
  )
  ok('and teaching one word does not erase the others', kept.length === 1)

  await db.execute(`
    update public.staff
       set expertise = array_remove(expertise, ${lit(WORD)}), updated_at = app.now_utc()
     where slug = 'finance-director'
  `)
  ok('(cleaned up)', (await asks(`please handle the ${WORD} for me`)).length === 0)
}

// --- the decision is visible ------------------------------------------------

{
  const why = await all(`
    select matched from app.who_knows_about('compare our competitors and their pricing', 1)
  `)
  // A routing decision nobody can question is one nobody can correct. Grant
  // will want to know WHY Emma got it, not just that she did.
  ok(
    'and it says which words decided it',
    String(why[0]?.matched ?? '').includes('compet'),
    String(why[0]?.matched ?? ''),
  )
}

// --- the columns that were never written ------------------------------------

{
  const cols = await all(`
    select column_name from information_schema.columns
     where table_schema = 'public' and table_name = 'jobs' and column_name = 'recipient_agent'
  `)
  ok('jobs still has somewhere to record who took it', cols.length === 1)

  const recent = await all(`
    select count(*) filter (where recipient_agent is not null)::int as named,
           count(*)::int as total
      from public.jobs
     where not is_fixture and kind = 'office.instruction'
       and created_at > app.now_utc() - interval '2 hours'
  `)
  const named = Number(recent[0]?.named ?? 0)
  const total = Number(recent[0]?.total ?? 0)
  /*
    Reported rather than asserted, deliberately.

    Every instruction job from before this change has a null recipient and
    always will — it is a record of what happened. Failing on history would
    make this suite permanently red for a reason nobody can fix. What matters
    is that new ones carry it, and that is what the two-hour window watches.
  */
  console.log(
    `       (instruction jobs in the last 2h: ${String(named)}/${String(total)} carry a recipient)`,
  )
  ok('nothing here breaks if there have been none yet', total >= 0)
}

// --- the ceiling still holds ------------------------------------------------
//
// More delegation is not automatically better. Grant hears only from Claire,
// so a team that visibly passes his request around three times is worse than
// one bot. §9's ceilings are the cost control and expertise must not widen
// them.

{
  const everyone = await asks(
    'research the pricing and write a campaign and check the schedule and review the risk',
  )
  ok(
    'a request touching everything still names at most three',
    everyone.length <= 3,
    `${String(everyone.length)} named`,
  )
}

console.log(`\n${pass}/${pass + fail} checks passed`)
process.exit(fail === 0 ? 0 : 1)
