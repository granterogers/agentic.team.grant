/**
 * Decision 7 - the office may be proactive; proactivity is not authority.
 *
 *   npx tsx scripts/isolated/policy-proactive.ts <replica-db>
 *
 * Every verdict here is the REAL `app.authorize_effect`, asked about a job a DUTY made (requested_by `duty:*`, the
 * shape of every proactive job: nobody asked for it), at every setting of the one dial. Three tiers: think (reads),
 * prepare (internal, reversible), and the consequential/external, which asks whatever the dial says. There is no
 * second dial: the assertions also pin that the setting's values are still exactly the four it always had.
 */
import { lit, policyWorld } from './policy-lib.ts'

const w = await policyWorld('ppr')
const { db, one, rows, check } = w
const DIALS = ['observe', 'suggest', 'act_with_review', 'act'] as const

const verdict = async (tool: string, audience: string | null = null): Promise<string> => {
  const job = await w.dutyJob('office.chores')
  const r = (
    await one(
      `select (app.authorize_effect(p_office => app.job_office(${lit(job.jobId)}::uuid), p_project => null, p_tool => ${lit(tool)}, p_audience => ${audience === null ? 'null' : lit(audience)},
                 p_job => ${lit(job.jobId)}::uuid, p_fingerprint => ${lit(`fp-${tool}-${w.run}`)})) ->> 'verdict' as v`,
    )
  ).v
  return String(r)
}
const table: Record<string, Record<string, string>> = {}
const READ = ['db.read', 'notebook.read', 'calendar.read', 'gmail.read']
const PREPARE = ['draft.create', 'document.create', 'task.create', 'task.extract', 'web.read']
const OUTWARD = ['slack.post', 'drive.ingest', 'notebook.write', 'slack.channel']
const CONSEQUENTIAL = ['task.board.delete', 'slack.rotate']
const SWITCHED_OFF = ['gmail.send', 'db.delete', 'production.write', 'spend.money', 'github.write']
for (const dial of DIALS) {
  await one(`select app.hq_autonomy_set(${lit(dial)}, null, 'grant') as r`)
  const t: Record<string, string> = {}
  for (const tool of [
    ...READ,
    ...PREPARE,
    ...OUTWARD,
    ...CONSEQUENTIAL,
    ...SWITCHED_OFF,
    'calendar.write',
  ])
    t[tool] = await verdict(tool)
  t['slack.post@outside'] = await verdict('slack.post', 'outside')
  t['draft.create@outside'] = await verdict('draft.create', 'outside')
  table[dial] = t
}
const all = (dial: string, tools: string[], want: string) =>
  tools.every((t) => table[dial]?.[t] === want)

// ---- tier 1: observe and think ------------------------------------------------------------------------------------
for (const dial of DIALS) {
  check(
    `tier 1 - reading proceeds at "${dial}": the office may notice, look things up and think`,
    all(dial, READ, 'proceed'),
    JSON.stringify(table[dial]?.['db.read']),
  )
}
// ---- tier 2: prepare / safe internal work, according to the dial ------------------------------------------------------
check(
  'tier 2 - at "observe" the office prepares nothing (not even a draft)',
  all('observe', PREPARE, 'refuse'),
  PREPARE.map((t) => table.observe?.[t]).join(','),
)
for (const dial of ['suggest', 'act_with_review', 'act']) {
  check(
    `tier 2 - at "${dial}" drafts, recommendations and internal work proceed without anyone asking`,
    all(dial, PREPARE, 'proceed'),
    PREPARE.map((t) => table[dial]?.[t]).join(','),
  )
}
// ---- tier 3: consequential / external -------------------------------------------------------------------------------------
check(
  'tier 3 - at "suggest" and "act_with_review" an outward write by a duty asks',
  all('suggest', OUTWARD, 'ask') && all('act_with_review', OUTWARD, 'ask'),
  JSON.stringify(OUTWARD.map((t) => table.suggest?.[t])),
)
check(
  'tier 3 - at "observe" nothing leaves the building',
  all('observe', OUTWARD, 'refuse'),
  OUTWARD.map((t) => table.observe?.[t]).join(','),
)
for (const dial of DIALS) {
  check(
    `tier 3 - contacting somebody OUTSIDE the office asks at "${dial}", even for a draft-level tool`,
    table[dial]?.['slack.post@outside'] !== 'proceed' &&
      table[dial]?.['draft.create@outside'] !== 'proceed',
    `${String(table[dial]?.['slack.post@outside'])}/${String(table[dial]?.['draft.create@outside'])}`,
  )
  check(
    `tier 3 - deleting and rotating a credential never proceed on their own at "${dial}"`,
    CONSEQUENTIAL.every((t) => table[dial]?.[t] !== 'proceed'),
    CONSEQUENTIAL.map((t) => table[dial]?.[t]).join(','),
  )
  check(
    `tier 3 - sending mail, deleting data, writing production and spending are switched off at "${dial}"`,
    all(dial, SWITCHED_OFF, 'refuse'),
    SWITCHED_OFF.map((t) => table[dial]?.[t]).join(','),
  )
}
check(
  'control: at "act" an ordinary internal-audience outward write by a duty proceeds (the dial is what it says)',
  table.act?.['slack.post'] === 'proceed',
  String(table.act?.['slack.post']),
)

// The one outward tool that proceeds at "suggest" does so on a standing yes Grant gave, and says so.
const calendarStanding = Number(
  (
    await one(
      `select count(*)::int as n from public.standing_authorizations where tool = 'calendar.write' and revoked_at is null`,
    )
  ).n,
)
check(
  'control: calendar.write proceeds at "suggest" only because a recorded standing yes covers it',
  table.suggest?.['calendar.write'] === 'proceed' && calendarStanding === 1,
  `${String(table.suggest?.['calendar.write'])}; ${String(calendarStanding)} standing row`,
)

// ---- one dial, not two ---------------------------------------------------------------------------------------------------
const values = (
  await rows(
    `select e.enumlabel::text as v from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'autonomy_level' order by e.enumsortorder`,
  )
).map((r) => String(r.v))
check(
  'there is no second dial: the autonomy setting still has exactly its four values',
  JSON.stringify(values) === JSON.stringify(DIALS),
  values.join(','),
)
const copy = JSON.stringify((await one(`select app.autonomy_choices() as c`)).c)
check(
  'the four sentences describe the tiers and no longer claim any duty is ungoverned',
  /notices/.test(copy) &&
    /still (stop and )?ask|waits for you/.test(copy) &&
    !/not governed|does not govern/.test(copy),
  copy.slice(0, 140),
)
// A proactive internal result is in front of him afterwards; the noticing pass runs without asking anybody anything.
const noticed = await one(`select app.raise_suggestions(app.sole_person_office()) as r`).catch(
  (e: Error) => ({
    r: `error ${e.message}`,
  }),
)
check(
  'proactive noticing runs and asks nobody (it offers; it does not act)',
  !String(noticed.r).startsWith('error'),
  JSON.stringify(noticed.r).slice(0, 80),
)
await one(`select app.hq_autonomy_set('suggest', null, 'grant') as r`)
void db
await w.finish()
