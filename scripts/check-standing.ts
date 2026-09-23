/**
 * Every standing rule the office holds is one it would store today.
 *
 *   npm run check:standing
 *
 * `STANDING` in `teaching.ts` contains the bare word `never`, so
 * *"Okay, never mind about that."* was read as a standing instruction and
 * stored at 0.95 confidence, `learned_by grant` — live in every Chief of
 * Staff prompt from 15 September until it was found by reading the three
 * rules the office actually holds.
 *
 * The code fix stops the next one. It cannot see the one already stored, and
 * nothing anywhere was looking: `check:leaks` asks whether HARNESS lessons
 * reach a real prompt and had no opinion about whether a REAL one makes
 * sense. A rule the office would not accept today is one nobody meant to
 * give it, whatever route it took in.
 *
 * Reported per rule rather than as a count, because "1 bad rule" tells you
 * nothing about which prompt is carrying what.
 */

import { opensByDroppingIt } from '../src/agents/clarify.ts'
import { readTeaching } from '../src/agents/teaching.ts'
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

/*
  The REAL set, asked the way the prompt asks for it: harness rows excluded by
  the same two predicates `app.lessons_for` uses, so this and the prompt cannot
  disagree about which rules are Grant's.
*/
const { rows } = await db.execute(`
  select lesson_id::text as id, scope::text as scope, coalesce(staff_slug, '') as who,
         coalesce(learned_by, '') as by, body
    from public.lessons_live
   where not is_fixture and not coalesce(app.harness_job(from_job), false)
   order by created_at`)
const held = rows as { id: string; scope: string; who: string; by: string; body: string }[]

/*
  CONTROL, because a check whose happy path is "found nothing" passes against
  a reader that can find nothing — three instances of that shape in CLAUDE.md,
  and the worst of them printed a zero that read as a perfect score.
*/
if (held.length === 0) {
  console.error('the office holds NO standing rules at all, which is not a pass — check the reader')
  process.exit(1)
}
const canary = 'Okay, never mind about that.'
if (!opensByDroppingIt(canary) || readTeaching(canary) !== null) {
  console.error(`CONTROL FAILED: the detector no longer refuses ${JSON.stringify(canary)}`)
  process.exit(1)
}

const wrong = held.filter((l) => opensByDroppingIt(l.body) || readTeaching(l.body) === null)

console.log(`standing rules the office holds: ${String(held.length)}`)
for (const l of held) {
  const bad = opensByDroppingIt(l.body) || readTeaching(l.body) === null
  console.log(
    `  ${bad ? 'WOULD NOT STORE' : 'ok             '} ${l.scope}${l.who === '' ? '' : `/${l.who}`} — ${l.body.slice(0, 90)}`,
  )
}

if (wrong.length > 0) {
  console.error(
    `\n${String(wrong.length)} standing rule(s) the office would not accept today are in its prompts.\n` +
      'Retire through app.retract_lesson — never a DELETE: withdrawal is the mechanism a person has.',
  )
  process.exit(1)
}
console.log('\nevery one of them is a rule the office would store today')
