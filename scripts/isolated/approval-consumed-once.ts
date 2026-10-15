/**
 * COS-073 / §25.5 — an approval is consumed once: a repeated or conflicting press does not answer it again.
 *
 *   npx tsx scripts/isolated/approval-consumed-once.ts <replica-db>
 *
 * Drives the real `raiseBlocker` (a real question on a real job) and the real `app.hq_answer_blocker`, the function
 * the Telegram and Slack press handlers call. The function locks the question row (`for update`) and answers a
 * question already answered with `already = true`.
 *
 * Asserts:
 *   1. The first valid press answers the question and records which option it was.
 *   2. A second press of the same option is refused as already answered, and nothing changes.
 *   3. A second press of a DIFFERENT option is also refused, and the recorded answer stays the first one.
 *   4. A press naming an option the question never offered is refused, and the question stays open.
 *
 * Replica only; the guard refuses anything else.
 */
import { raiseBlocker } from '../../src/inference/record.ts'
import { isolated } from './guard.ts'
import { realParent } from './real-telegram.ts'

const db = await isolated(process.argv[2] ?? 'post')
const results: { what: string; ok: boolean; detail: string }[] = []
const check = (what: string, ok: boolean, detail: string) => {
  results.push({ what, ok, detail })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what} — ${detail}`)
}
const one = async (sql: string) => (await db.execute(sql)).rows[0] as Record<string, unknown>

const jobId = await realParent(db)
const fp = `cos073-${Date.now().toString(36)}`
const blockerId = await raiseBlocker(db, {
  jobId,
  requestedAction: 'Create the comparison document',
  whyNeeded: 'The step is a write and the policy asks first.',
  consequencesOfDelay: 'The rest of the plan waits until you answer.',
  approvalOptions: ['Go ahead', 'Leave it'],
  originatingAgent: 'chief-of-staff',
  workCanContinue: false,
  actionFingerprint: fp,
  declineOption: 'Leave it',
})

const office = String((await one(`select app.job_office('${jobId}'::uuid)::text as o`)).o)
const press = async (answer: string) => {
  const raw = (
    await one(
      `select app.hq_answer_blocker('${office}'::uuid, '${blockerId}'::uuid, '${answer}', 'grant') as r`,
    )
  ).r
  return (typeof raw === 'string' ? JSON.parse(raw) : raw) as Record<string, unknown>
}
const stateOf = async () =>
  (
    await one(
      `select state, answered_option from public.blockers where blocker_id = '${blockerId}'::uuid`,
    )
  ) as { state: string; answered_option: string | null }

const first = await press('Go ahead')
const afterFirst = await stateOf()
check(
  'the first valid press answers the question',
  first.ok !== false && afterFirst.state === 'resolved' && afterFirst.answered_option === 'Go ahead',
  `state=${afterFirst.state} answered=${afterFirst.answered_option ?? 'none'}`,
)

const repeat = await press('Go ahead')
const afterRepeat = await stateOf()
check(
  'a repeated press is refused as already answered',
  repeat.already === true && afterRepeat.answered_option === 'Go ahead',
  `already=${String(repeat.already)} answered=${afterRepeat.answered_option ?? 'none'}`,
)

const conflicting = await press('Leave it')
const afterConflict = await stateOf()
check(
  'a conflicting press does not change the recorded answer',
  conflicting.already === true && afterConflict.answered_option === 'Go ahead',
  `already=${String(conflicting.already)} answered=${afterConflict.answered_option ?? 'none'}`,
)

const offered = await raiseBlocker(db, {
  jobId,
  requestedAction: 'Send the summary to the client',
  whyNeeded: 'The step sends mail outside the office.',
  consequencesOfDelay: 'The message waits until you answer.',
  approvalOptions: ['Send it', 'Hold it'],
  originatingAgent: 'chief-of-staff',
  workCanContinue: false,
  actionFingerprint: `${fp}-b`,
  declineOption: 'Hold it',
})
const notOffered = await one(
  `select app.hq_answer_blocker('${office}'::uuid, '${offered}'::uuid, 'Burn it', 'grant') as r`,
)
const rawNot = notOffered.r
const parsedNot = (typeof rawNot === 'string' ? JSON.parse(rawNot) : rawNot) as Record<string, unknown>
const offeredState = await one(
  `select state from public.blockers where blocker_id = '${offered}'::uuid`,
)
check(
  'an option the question never offered is refused and the question stays open',
  typeof parsedNot.error === 'string' &&
    parsedNot.error.includes('not one of the answers this asks for') &&
    offeredState.state === 'open',
  `error=${String(parsedNot.error ?? 'none')} state=${String(offeredState.state)}`,
)

await db.execute(
  `update public.jobs set state = 'cancelled', state_reason = 'proof: cleared' where job_id = '${jobId}'::uuid and state = 'queued'`,
)
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} ok`)
await db.end()
process.exitCode = failed.length === 0 ? 0 : 1
