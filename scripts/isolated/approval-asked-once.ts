/**
 * COS-092 / REG-006 — an unchanged plan step is asked about ONCE.
 *
 *   npx tsx scripts/isolated/approval-asked-once.ts <replica-db>
 *
 * Reproduction (before the fix): the plan executor calls `raiseBlocker` every time a step
 * comes back `ask`, and nothing in the database or the writer checks for an identical question
 * already open on the same job. The Canary incident shows the shape: the same stop message three
 * times (09:36, 09:53, 10:59), each a fresh open question for Grant to answer.
 *
 * Asserts, against the real writer and a real job:
 *   1. Two raises for the same job and the same action fingerprint leave ONE open question.
 *   2. The second raise returns the id of the question already open, not a new one.
 *   3. A raise for a DIFFERENT action on the same job still opens its own question.
 *   4. A question for the same action once answered is no longer open, so a later ask may open
 *      a new one (asked again only after an answer changed nothing).
 *   5. The database refuses a second open question for the same job and fingerprint even when a
 *      caller bypasses `raiseBlocker` (the writer check is not the only line of defence).
 *
 * The transport is not used: nothing here is delivered. Replica only; the guard refuses anything else.
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

const jobId = await realParent(db)
const fpA = `cos092-${Date.now().toString(36)}-a`
const fpB = `cos092-${Date.now().toString(36)}-b`

const draft = (fingerprint: string) => ({
  jobId,
  requestedAction: 'Create the comparison document',
  whyNeeded: 'The step is a write and the policy asks first.',
  consequencesOfDelay: 'The rest of the plan waits until you answer.',
  approvalOptions: ['Go ahead', 'Leave it'],
  originatingAgent: 'chief-of-staff',
  workCanContinue: false,
  actionFingerprint: fingerprint,
  declineOption: 'Leave it',
})

const openFor = async (fingerprint: string) =>
  Number(
    (
      (
        await db.execute(
          `select count(*)::int as n from public.blockers
            where job_id = '${jobId}'::uuid and action_fingerprint = '${fingerprint}' and state = 'open'`,
        )
      ).rows[0] as { n: number }
    ).n,
  )

const first = await raiseBlocker(db, draft(fpA))
const second = await raiseBlocker(db, draft(fpA))
const openA = await openFor(fpA)
check(
  'one open question for an unchanged step',
  openA === 1,
  `open questions for the same job and action: ${openA} (expected 1)`,
)
check(
  'a repeat raise returns the question already open',
  second === first,
  `first ${first.slice(0, 8)}, second ${second.slice(0, 8)} (expected equal)`,
)

const other = await raiseBlocker(db, draft(fpB))
check(
  'a different action on the same job opens its own question',
  other !== first && (await openFor(fpB)) === 1,
  `different action: ${other.slice(0, 8)}`,
)

await db.execute(
  `update public.blockers set state = 'resolved', resolved_at = app.now_utc(), resolution = 'proof: answered'
    where blocker_id = '${first}'::uuid`,
)
const afterAnswer = await raiseBlocker(db, draft(fpA))
check(
  'once answered, a later ask opens a new question',
  afterAnswer !== first && (await openFor(fpA)) === 1,
  `new question after answer: ${afterAnswer.slice(0, 8)}`,
)

let refused = ''
try {
  await db.execute(
    `insert into public.blockers (office_id, project_id, job_id, requested_action, why_needed,
        consequences_of_delay, approval_options, originating_agent, work_can_continue, action_fingerprint)
     select office_id, project_id, job_id, 'bypass attempt', 'bypass attempt', 'bypass attempt',
            array['Go ahead']::text[], 'proof', false, '${fpB}'
       from public.blockers where blocker_id = '${other}'::uuid`,
  )
} catch (e) {
  refused = e instanceof Error ? e.message : String(e)
}
check(
  'the database refuses a duplicate open question written around the writer',
  refused.includes('blockers_one_open_per_job_action'),
  refused === '' ? 'a duplicate row was written' : `refused: ${refused.slice(0, 120)}`,
)

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} ok`)
// The guard leaves the pool open; without this the process never exits.
await db.end()
process.exitCode = failed.length === 0 ? 0 : 1
