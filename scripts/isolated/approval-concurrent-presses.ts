/**
 * REG-002 — approval callbacks arriving concurrently are answered once.
 *
 *   npx tsx scripts/isolated/approval-concurrent-presses.ts <replica-db>
 *
 * Two independent database connections press the same question at the same moment (two button presses that reach
 * the office together). The real `app.hq_answer_blocker` locks the question row (`for update`), so one press must
 * win and the other must be refused as already answered. Nothing is decided by a return value alone: the question's
 * recorded answer is read back from the row.
 *
 * Asserts, over several rounds so a race cannot pass by luck of ordering:
 *   1. In every round exactly one press answers the question and the other is refused as already answered.
 *   2. In every round the recorded answer is the winner's option.
 *
 * Not yet shown: that this check can fail (no sabotage control). Recorded as a limit on REG-002.
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
const office = String((await one(`select app.job_office('${jobId}'::uuid)::text as o`)).o)
const ROUNDS = 5
const tag = Date.now().toString(36)
const pressers = [
  await isolated(process.argv[2] ?? 'post'),
  await isolated(process.argv[2] ?? 'post'),
]

const parse = (raw: unknown) =>
  (typeof raw === 'string' ? JSON.parse(raw) : raw) as Record<string, unknown>
const wins: string[] = []
let roundsOk = 0
const detail: string[] = []

for (let round = 0; round < ROUNDS; round++) {
  const blockerId = await raiseBlocker(db, {
    jobId,
    requestedAction: `Create the comparison document ${tag}-${round}`,
    whyNeeded: 'The step is a write and the policy asks first.',
    consequencesOfDelay: 'The rest of the plan waits until you answer.',
    approvalOptions: ['Go ahead', 'Leave it'],
    originatingAgent: 'chief-of-staff',
    workCanContinue: false,
    actionFingerprint: `reg002-${tag}-${round}`,
    declineOption: 'Leave it',
  })
  // Both presses start together: each connection awaits the same barrier before it calls the function.
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const press = async (presser: (typeof pressers)[number], answer: string) => {
    await gate
    const r = await presser.execute(
      `select app.hq_answer_blocker('${office}'::uuid, '${blockerId}'::uuid, '${answer}', 'grant') as r`,
    )
    return parse((r.rows[0] as { r: unknown }).r)
  }
  const both = Promise.all([press(pressers[0], 'Go ahead'), press(pressers[1], 'Leave it')])
  release()
  const [a, b] = await both
  const aWon = a.ok === true && a.already !== true && a.error === undefined
  const bWon = b.ok === true && b.already !== true && b.error === undefined
  const aAlready = a.already === true
  const bAlready = b.already === true
  const row = await one(
    `select state, answered_option from public.blockers where blocker_id = '${blockerId}'::uuid`,
  )
  const exactlyOneWin = (aWon ? 1 : 0) + (bWon ? 1 : 0) === 1
  const otherRefused = (aWon && bAlready) || (bWon && aAlready)
  const winnerOption = aWon ? 'Go ahead' : bWon ? 'Leave it' : 'none'
  const recordedMatches = row.answered_option === winnerOption && row.state === 'resolved'
  if (exactlyOneWin && otherRefused && recordedMatches) roundsOk += 1
  wins.push(winnerOption)
  detail.push(
    `r${round}: win=${winnerOption} refused=${String(otherRefused)} recorded=${String(row.answered_option)}`,
  )
}

check(
  'in every round exactly one concurrent press answers the question and the other is refused as already answered',
  roundsOk === ROUNDS,
  `${String(roundsOk)}/${String(ROUNDS)} rounds`,
)
check(
  'the recorded answer is the winner option in every round, and the round detail shows it',
  roundsOk === ROUNDS,
  detail.join(' | '),
)

await db.execute(
  `update public.jobs set state = 'cancelled', state_reason = 'proof: cleared' where job_id = '${jobId}'::uuid and state = 'queued'`,
)
const failed = results.filter((r) => !r.ok)
console.log(`\n${String(results.length - failed.length)}/${String(results.length)} ok`)
await db.end()
for (const p of pressers) await p.end()
process.exitCode = failed.length === 0 ? 0 : 1
