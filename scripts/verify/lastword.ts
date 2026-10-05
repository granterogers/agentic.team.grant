/**
 * A turn that died still speaks (#337).
 *
 *   npm run verify:lastword
 *
 * Grant sent a 17-second voice note to his real Telegram chat on 8 September.
 * The transcription path threw, the job retried to attempt 4 of 5, moved to
 * `failed`, and `public.deliveries` for it holds ZERO rows. He spoke into his
 * phone and nothing ever came back.
 *
 * ## Containment
 *
 * The job is authored `telegram:verify-lastword-<run>`, so `jobs.is_fixture`
 * is GENERATED true by 0342's `%:verify-%` branch — which means
 * `app.claim_delivery` refuses it any destination outside
 * `public.test_destinations` (0523). Asserted rather than assumed, because a
 * suite that believes its own traffic is contained is the defect CLAUDE.md
 * records five times over.
 *
 * The notifier here is a STUB. Nothing leaves the process: the question is
 * whether the office composes and records a last word, not whether Telegram
 * is up.
 */

import { ManagementApiExecutor } from '../../src/db/executor.ts'
import { lastWord } from '../../src/jobs/lastword.ts'
import type { HandlerOutput, Job } from '../../src/jobs/worker.ts'

const token = process.env.SUPABASE_ACCESS_TOKEN
if (token === undefined || token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}
const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  token,
)
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
const one = async (sql: string): Promise<Record<string, unknown>> =>
  ((await db.execute(sql)).rows[0] ?? {}) as Record<string, unknown>

const checks: { what: string; passed: boolean }[] = []
const check = (what: string, outcome: string, passed: boolean): void => {
  checks.push({ what, passed })
  console.log(`  ${passed ? 'ok  ' : 'FAIL'} ${what} — ${outcome}`)
}

const run = Math.random().toString(36).slice(2, 10)
const BY = `telegram:verify-lastword-${run}`

console.log('he spoke into his phone and heard nothing —\n')

/* The fixture turn: an inbound voice note that arrived and a job that died. */
const cmd = await one(`
  insert into public.inbound_commands
    (office_id, origin_channel, origin_ref, actor, subject, instruction, voice_file_id,
     voice_seconds, dedupe_key)
  values (app.test_office(), 'telegram', ${lit(`999${run}:7`)}, ${lit(`verify-lastword-${run}`)},
          'grant', '', ${lit(`voicefile-${run}`)}, 17, ${lit(`verify:lastword:${run}`)})
  returning command_id::text as id`)
const commandId = String(cmd.id)

const made = await one(`
  insert into public.jobs (office_id, kind, requested_by, state, pinned_config, max_attempts,
                          correlation_id, idempotency_key)
  values (app.test_office(), 'office.instruction', ${lit(BY)}, 'queued',
          jsonb_build_object('command_id', ${lit(commandId)}), 1,
          gen_random_uuid(), ${lit(`verify-lastword-${run}`)})
  returning job_id::text as id`)
const jobId = String(made.id)

const job: Job = {
  attempt: 1,
  correlationId: jobId,
  idempotencyKey: '',
  jobId,
  kind: 'office.instruction',
  projectId: null,
}

const fixture = await one(`
  select is_fixture, app.deliverable_to(job_id, 'telegram', '1386648496') as could_reach_grant
    from public.jobs where job_id = ${lit(jobId)}::uuid`)
check(
  'this suite’s turn is harness traffic and cannot reach his real chat',
  `is_fixture=${String(fixture.is_fixture)} deliverable_to_grant=${String(fixture.could_reach_grant)}`,
  fixture.is_fixture === true && fixture.could_reach_grant === false,
)

/* A turn still running owes nothing: apologising for an attempt about to be
   repeated is worse than silence. */
const running = await one(`select count(*)::int as n from app.owed_a_word(${lit(jobId)}::uuid)`)
check('a turn that has not died owes nothing', `${String(running.n)} owed`, running.n === 0)

await db.execute(`update public.jobs set state = 'running' where job_id = ${lit(jobId)}::uuid`)
await db.execute(
  `update public.jobs set state = 'failed', state_reason = 'handler threw: Buffer is not defined',
     finished_at = app.now_utc() where job_id = ${lit(jobId)}::uuid`,
)

const dead = await one(`
  select channel, target_ref from app.owed_a_word(${lit(jobId)}::uuid)`)
check(
  'once it dies, the person who asked is owed a sentence on the channel they used',
  `channel=${String(dead.channel ?? 'none')}`,
  dead.channel === 'telegram',
)

/* The stub. It records rather than sends. */
const told: { body: string; outputId: string }[] = []
const stub = async (_j: Job, o: HandlerOutput, outputId: string): Promise<never> => {
  told.push({ body: o.body, outputId })
  return { delivered: true, note: 'stub' } as never
}

const outcome = await lastWord(db, job, stub)
check('the office says something', `outcome=${outcome}`, outcome === 'told')
check('and says it once', `${String(told.length)} message(s)`, told.length === 1)

const said = told[0]?.body ?? ''
check(
  'it tells him the attempt failed, not that the office cannot',
  said.slice(0, 44).replace(/\s+/g, ' '),
  said.length > 0 && !/\bI (can'?t|cannot|am not able to)\b/i.test(said),
)
check(
  'it knows he SPOKE rather than typed',
  /sent/i.test(said) ? 'phrased for a voice note' : 'phrased as if typed',
  /sent/i.test(said),
)

const stored = await one(`
  select count(*)::int as n from public.outputs where job_id = ${lit(jobId)}::uuid`)
check(
  'the sentence is in the record, not only on his phone',
  `${String(stored.n)} output(s)`,
  stored.n === 1,
)

/*
  AND IT DOES NOT SAY IT TWICE.

  A worker restart, a recovery sweep or a second tick must not apologise
  again. `owed_a_word` excludes a turn that has already been answered, so the
  guard is the delivery itself rather than a flag somebody has to maintain.
*/
await db.execute(`
  insert into public.deliveries (office_id, job_id, channel, account_ref, target_ref, dedupe_key,
                                 purpose, state, lease_expires_at, sent_at, message_ref)
  values (app.job_office(${lit(jobId)}::uuid), ${lit(jobId)}::uuid, 'telegram', '9990001', '9990001', ${lit(`stub-${run}`)},
          'notice', 'sent', app.now_utc(), app.now_utc(), ${lit(`stub-${run}`)})`)
const again = await one(`select count(*)::int as n from app.owed_a_word(${lit(jobId)}::uuid)`)
check('a turn already answered is owed nothing more', `${String(again.n)} owed`, again.n === 0)
const twice = await lastWord(db, job, stub)
check('so a second tick stays quiet', `outcome=${twice}`, twice === 'nobody owed')

/* Teardown. A job can never be deleted, so it stays as the fixture 0342
   permits; everything that CAN go, goes. */
await db.execute(`delete from public.deliveries where job_id = ${lit(jobId)}::uuid`)
await db.execute(`delete from public.outputs where job_id = ${lit(jobId)}::uuid`)
await db.execute(`delete from public.inbound_commands where command_id = ${lit(commandId)}::uuid`)

const failed = checks.filter((c) => !c.passed).length
console.log(`\n${String(checks.length - failed)}/${String(checks.length)} checks passed`)
process.exitCode = failed === 0 ? 0 : 1
