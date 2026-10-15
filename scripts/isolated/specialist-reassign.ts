/**
 * COS-006 / COS-019 / REG-018 / REG-019 — a specialist's failed hand-off goes to the Chief of Staff, once.
 *
 *   npx tsx scripts/isolated/specialist-reassign.ts <replica-db>
 *
 * Drives the real `app.enqueue_child_once` (the writer the instruction handler uses to hand a request to a
 * specialist) and the real `app.reassign_failed_specialist` (migration 1075), on a real parent job. The state moves
 * are the legal ones (`queued -> failed`), enforced by the job-state trigger.
 *
 * Asserts:
 *   1. A hand-off that has NOT failed is not reassigned (control: the function refuses to act early).
 *   2. A failed hand-off to a specialist is reassigned: one new child, addressed to the Chief of Staff, same parent.
 *   3. Calling again reuses that child: no second replacement.
 *   4. The Chief of Staff's own failed work is not reassigned, and says why.
 *   5. A failed job that is not a specialist hand-off is not reassigned, and says why.
 */
import { isolated } from './guard.ts'
import { realParent } from './real-telegram.ts'

const db = await isolated(process.argv[2] ?? 'post')
const results: { what: string; ok: boolean; detail: string }[] = []
const check = (what: string, ok: boolean, detail: string) => {
  results.push({ what, ok, detail })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what} — ${detail}`)
}

const parent = await realParent(db)
const tag = Date.now().toString(36)
const one = async (sql: string) => (await db.execute(sql)).rows[0] as Record<string, unknown>

const handOff = async (slug: string, instruction: string, kind = 'office.instruction') => {
  const r = await one(`
    select app.enqueue_child_once(
      app.job_office('${parent}'::uuid), '${parent}'::uuid, '${kind}',
      '${slug}: ${instruction} ${tag}',
      jsonb_build_object('instruction', '${instruction} ${tag}', 'addressed_to', '${slug}',
                         'origin_channel', 'telegram', 'command_id', '', 'handed_off_by', 'chief-of-staff'),
      false, null, null, null, null) as r`)
  return String((r.r as { job_id: string }).job_id)
}

const fail = (job: string) =>
  db.execute(
    `update public.jobs set state = 'failed', state_reason = 'proof: ran out of attempts' where job_id = '${job}'::uuid`,
  )

const reassign = async (job: string) =>
  (await one(`select app.reassign_failed_specialist('${job}'::uuid) as r`)).r as {
    reassigned: boolean
    to?: string
    job_id?: string
    created?: boolean
    why?: string
  }

const specialist = await handOff('research-director', 'Draft the comparison of the venue replies')

const early = await reassign(specialist)
check(
  'a hand-off that has not failed is not reassigned',
  early.reassigned === false && early.why === 'the job did not fail',
  `answer: ${early.why ?? 'reassigned'}`,
)

await fail(specialist)
const first = await reassign(specialist)
check(
  'a failed specialist hand-off is reassigned to the Chief of Staff',
  first.reassigned === true && first.to === 'chief-of-staff' && first.created === true,
  `reassigned=${String(first.reassigned)} to=${first.to ?? '-'} created=${String(first.created)}`,
)

const replacement = first.job_id ?? ''
const addressed = replacement
  ? String(
      (
        await one(`select pinned_config ->> 'addressed_to' as a, parent_job_id::text as p from public.jobs
                    where job_id = '${replacement}'::uuid`)
      ).a,
    )
  : ''
const sameParent = replacement
  ? String(
      (
        await one(
          `select parent_job_id::text as p from public.jobs where job_id = '${replacement}'::uuid`,
        )
      ).p,
    ) === parent
  : false
check(
  'the replacement is addressed to the Chief of Staff, under the same parent',
  addressed === 'chief-of-staff' && sameParent,
  `addressed_to=${addressed || '-'} same_parent=${String(sameParent)}`,
)

const again = await reassign(specialist)
const count = Number(
  (
    await one(`select count(*)::int as n from public.jobs where parent_job_id = '${parent}'::uuid
                and pinned_config ->> 'reassigned_from' = 'research-director'
                and pinned_config ->> 'instruction' like '%${tag}%'`)
  ).n,
)
check(
  'a second call does not make a second replacement',
  again.reassigned === true && again.created === false && count === 1,
  `created=${String(again.created)} replacements=${String(count)}`,
)

const cosOwn = await handOff('chief-of-staff', 'Summarise the week')
await fail(cosOwn)
const own = await reassign(cosOwn)
check(
  "the Chief of Staff's own failed work is not reassigned, and says why",
  own.reassigned === false && typeof own.why === 'string' && own.why.includes('owns this'),
  `answer: ${own.why ?? 'reassigned'}`,
)

const notHandOff = await handOff('research-director', 'Extract the tasks', 'office.extract_tasks')
await fail(notHandOff)
const other = await reassign(notHandOff)
check(
  'a failed job that is not a specialist hand-off is not reassigned, and says why',
  other.reassigned === false && other.why === 'it is not a specialist hand-off',
  `answer: ${other.why ?? 'reassigned'}`,
)

// Clear the queued work this proof made, so a later proof's dequeue cannot claim it (#184).
await db.execute(
  `update public.jobs set state = 'cancelled', state_reason = 'proof: cleared'
    where (job_id = '${parent}'::uuid or parent_job_id = '${parent}'::uuid) and state = 'queued'`,
)
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} ok`)
await db.end()
process.exitCode = failed.length === 0 ? 0 : 1
