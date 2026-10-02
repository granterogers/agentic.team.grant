/**
 * P4 step 12: the rollback. Retiring the second person's office must stop their session working, everywhere, and
 * re-enabling must restore it - proved against the live gateway, then left exactly as found.
 *   npx tsx scripts/p4/retire.ts
 * Retirement is `app.retire_person_office` (state = 'disabled'; offices are never deleted). The cache in front of session
 * resolution is measured, not assumed: the time from retirement to refusal is reported.
 */
import { check, db, REF, read, results, SECOND_OFFICE, secondSession } from './lib.ts'

const rows = async (sql: string): Promise<Record<string, unknown>[]> =>
  (await db.execute(sql)).rows as Record<string, unknown>[]
const S = (await secondSession()).access_token
const state = async (): Promise<string> =>
  String(
    (await rows(`select state v from public.offices where office_id = '${SECOND_OFFICE}'`))[0]?.v,
  )
const before = await state()
check('the second office starts active', before === 'active', before)
check('green: the session works', (await read(S, 'projects')).status === 200)

const t0 = Date.now()
await rows(`select app.retire_person_office('${SECOND_OFFICE}'::uuid) v`)
check('the office is now disabled', (await state()) === 'disabled')
// the operator office can never be retired by this function
const refused = await db.execute(`select app.retire_person_office(app.operator_office()) v`).then(
  () => 'ACCEPTED',
  (e: Error) => e.message,
)
check(
  "retire_person_office refuses Grant's office, with its own sentence",
  /not retired by this function/.test(String(refused)),
  String(refused).slice(0, 100),
)
let refusedAfter = -1
for (let i = 0; i < 40; i++) {
  const r = await read(S, 'projects')
  if (r.status === 401 || r.status === 403) {
    refusedAfter = Date.now() - t0
    break
  }
  await new Promise((ok) => setTimeout(ok, 3000))
}
console.log(
  `   time from retirement to the gateway refusing the session: ${refusedAfter < 0 ? 'NEVER within 2 minutes' : `${Math.round(refusedAfter / 1000)}s`}`,
)
check("the retired person's session is refused by the gateway", refusedAfter >= 0)
const v = await fetch(`https://${REF}.supabase.co/functions/v1/voice-token`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    Origin: 'https://ai-team-hq.vercel.app',
    Authorization: `Bearer ${S}`,
  },
  body: '{}',
})
check('and so is the voice surface', [401, 403].includes(v.status), `http ${v.status}`)
// NOT driven here: that dequeue_job skips a disabled office's queued work (P3's claim; nothing was queued to prove it on).

// restore exactly what was there
await rows(
  `update public.offices set state = 'active', disabled_at = null where office_id = '${SECOND_OFFICE}' returning office_id`,
)
check('re-enabled', (await state()) === 'active')
let back = false
for (let i = 0; i < 40 && !back; i++) {
  back = (await read(S, 'projects')).status === 200
  if (!back) await new Promise((ok) => setTimeout(ok, 3000))
}
check(
  "and the second person's session works again, with their data intact",
  back && (await read(S, 'projects')).text.includes('Personal'),
)

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} ok`)
process.exitCode = failed.length === 0 ? 0 : 1
