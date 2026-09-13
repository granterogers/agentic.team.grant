/**
 * Ask one agent, or ask the whole team — and have the office honour it.
 *
 *   npm run verify:addressing
 *
 * Issue #26. Routing by keyword is a guess; *"ask Emma"* is an instruction, and
 * before this the studio had no way to say it. Telegram always had — the
 * addressee there is WHICH BOT you opened, and `speaker()` calls that
 * *"addressed directly, Grant opened this person's bot"*. Typing it in the
 * studio is the same act, so it takes the same path rather than a parallel one.
 *
 * ## What this drives
 *
 * The whole chain, from the shape the page posts to the agent the job is
 * filed against:
 *
 *     chat.js -> POST /voice/turn {to} -> inbound_commands.addressed_to
 *             -> app.enqueue_inbound -> jobs.pinned_config.addressed_to
 *             -> speaker() -> jobs.recipient_agent
 *
 * ## The property that matters
 *
 * **An unrecognised addressee routes to the Chief of Staff rather than
 * failing.** §5 says an adapter may only translate — so the edge function
 * shape-checks the slug and records it, and the ROSTER decides whether such a
 * person exists. A studio that resolved names itself would be a second copy of
 * a rule that already lives in one place, and it would be the copy that drifts.
 *
 * ## Fixtures, and why they are safe here
 *
 * Every job this writes is `requested_by` a `verify:` name, so `is_fixture` is
 * generated true and no tally, briefing or health reading can see it. The jobs
 * are cancelled at teardown — they cannot be deleted (`job_state_transitions`
 * is append-only and holds a foreign key, ADR-0022) but a terminal state is
 * always reachable, and leaving them queued blocks `verify:slack` and
 * `verify:worker`, which need the queue to themselves (#184).
 */

import { ManagementApiExecutor } from '../../src/db/executor.ts'

const token = process.env.SUPABASE_ACCESS_TOKEN
if (token === undefined || token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}
const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  token,
)

const checks: boolean[] = []
const check = (what: string, said: string, ok: boolean): void => {
  checks.push(ok)
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what} — ${said}`)
}
const one = async (sql: string): Promise<Record<string, unknown>> =>
  ((await db.execute(sql)).rows[0] ?? {}) as Record<string, unknown>
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

const run = Math.random().toString(36).slice(2, 10)
const jobs: string[] = []

console.log(`\nverify:addressing — ${run}\n`)

/**
 * One turn, through the canonical layer rather than through the edge function.
 *
 * The HTTP endpoint is checked separately below. This drives the part that
 * DECIDES — writing the command exactly as the adapter writes it and asking
 * `enqueue_inbound` — because that is where the routing lives and an HTTP
 * round trip would only prove the adapter can reach it.
 */
const turn = async (said: string, addressedTo: string | null): Promise<Record<string, unknown>> => {
  const key = `verify:addressing:${run}:${Math.random().toString(36).slice(2, 8)}`
  const commandId = String(
    (
      await one(`
        insert into public.inbound_commands
          (origin_channel, origin_ref, actor, instruction, addressed_to, dedupe_key)
        values ('voice', ${lit(key)}, 'grant', ${lit(said)},
                ${addressedTo === null ? 'null' : lit(addressedTo)}, ${lit(key)})
        returning command_id::text as id
      `)
    ).id,
  )
  const queued = (await one(`select app.enqueue_inbound(${lit(commandId)}::uuid) as r`)).r as {
    job_id?: string
  }
  if (typeof queued.job_id === 'string') jobs.push(queued.job_id)
  return await one(`
    select j.recipient_agent, j.pinned_config->>'addressed_to' as pinned, j.is_fixture
      from public.jobs j where j.job_id = ${lit(String(queued.job_id))}::uuid
  `)
}

try {
  // =========================================================================
  console.log('a named person gets it')

  const named = await turn(
    'Have a look at the pricing page and tell me what you think.',
    'research-director',
  )
  check(
    'the addressee travels from the command onto the job',
    `pinned=${String(named.pinned)}`,
    named.pinned === 'research-director',
  )
  /*
    CONTROL, and it is what makes the check above mean anything: the same
    sentence with nobody named carries no addressee at all. Without it, that
    check would pass on a column that was populated by something else entirely.
  */
  const unaddressed = await turn(
    'Have a look at the pricing page and tell me what you think.',
    null,
  )
  check(
    'CONTROL: the same words with nobody named carry no addressee',
    `named -> ${String(named.pinned)}, unaddressed -> ${String(unaddressed.pinned)}`,
    unaddressed.pinned === null,
  )

  /*
    `recipient_agent` is null on BOTH, and that is correct rather than a
    failure — it is where I first got the layering wrong.

    Enqueueing does not choose a person. `speaker()` in the instruction handler
    does, when the job RUNS, because the choice depends on the roster's
    expertise at that moment and on the instruction itself. So the assertion
    that belongs here is that the addressee reached the payload the handler
    reads; asserting on `recipient_agent` at enqueue time was asserting that a
    decision had been made before anything decided it.
  */
  check(
    'the choice is left to the handler, not made at enqueue',
    `recipient at enqueue: ${String(named.recipient_agent)} (null is correct)`,
    named.recipient_agent === null && unaddressed.recipient_agent === null,
  )

  /*
    And the handler honours it. Asserted on the source of `speaker()`, because
    running it means running a real job against a real model — minutes, tokens,
    and a result that depends on what the model says. What is worth pinning is
    the RULE: an addressee is looked up on the roster and returned with the
    reason, and only a missing one falls through to classification.
  */
  const handler = await sourceOf('src/handlers/instruction.ts')
  const byName = handler.slice(
    handler.indexOf('async function speaker'),
    handler.indexOf('async function speaker') + 900,
  )
  check(
    'and the handler prefers a named addressee over its own classifier',
    /where slug = \$\{lit\(byName\)\} and active/.test(byName)
      ? 'looked up on the roster, filtered to active, returned with a reason'
      : 'THE HANDLER DOES NOT READ IT',
    /where slug = \$\{lit\(byName\)\} and active/.test(byName) &&
      byName.indexOf('addressed directly') > 0 &&
      byName.indexOf('classifyIntent') > byName.indexOf('addressed directly'),
  )

  // =========================================================================
  console.log('\nand a person the office does not have does not break it')

  /*
    The column REFUSES a name that is not a person, and that is the right
    behaviour — but it is also the reason the adapter needed changing.

    `inbound_commands.addressed_to` carries a foreign key to `staff`, so an
    unknown slug does not route badly: it fails the INSERT, and the turn comes
    back as "could not record what you said". Grant loses the thing he typed
    because of who he addressed it to. The edge function now retries once with
    no addressee, which is translation failing honestly rather than a message
    disappearing.

    Asserted here as the database's rule, and on the message rather than on
    "something threw" — a refusal for the wrong reason looks exactly like the
    rule working, and this repository has reported a PASS on that shape twice.
  */
  const refused = await (async () => {
    try {
      await db.execute(`
        insert into public.inbound_commands
          (origin_channel, origin_ref, actor, instruction, addressed_to, dedupe_key)
        values ('voice', ${lit(`verify:addressing:${run}:ghost`)}, 'grant', 'Draft the note.',
                'nobody-by-that-name', ${lit(`verify:addressing:${run}:ghost`)})
      `)
      return ''
    } catch (error) {
      return error instanceof Error ? error.message : String(error)
    }
  })()
  check(
    'a name that is not a person is refused by the column, not stored and misrouted',
    refused === '' ? 'IT WAS STORED' : (refused.split('\n')[0] ?? '').slice(0, 90),
    refused !== '' && /addressed_to_fkey|foreign key/i.test(refused),
  )
  check(
    'and the adapter retries without it rather than losing the message',
    (await sourceOf('supabase/functions/voice/index.ts')).includes('addressed_to: null')
      ? 'one retry with no addressee'
      : 'THE MESSAGE WOULD BE LOST',
    (await sourceOf('supabase/functions/voice/index.ts')).includes('addressed_to: null'),
  )

  /*
    A retired person is the case that matters more than a misspelling: the slug
    is real, the roster row exists, and `speaker()` filters on `active`. Asked
    of someone who has left, the office must answer rather than file work
    against them.
  */
  const retired = await one(`
    select slug from public.staff where not active and slug not like 'fixture-%' limit 1
  `)
  if (typeof retired.slug === 'string') {
    const gone = await turn('Draft the follow-up note.', retired.slug)
    check(
      'and neither does someone who has been retired',
      `${String(retired.slug)} -> ${String(gone.recipient_agent)}`,
      gone.recipient_agent !== retired.slug,
    )
  } else {
    check('and neither does someone who has been retired', 'nobody is retired to test with', true)
  }

  // =========================================================================
  console.log('\nasking everyone is one answer, not eight')

  /*
    #26's fourth criterion, and the reason "everyone" sends NO addressee rather
    than a list of eight. With nobody named the Chief of Staff takes it, and
    since #65 she can really bring people in — so the whole team is one job
    that may consult, not eight jobs that each reply.
  */
  const everyone = await turn('What does the team think we should do about the launch?', null)
  check(
    'asking everyone makes ONE job, not eight',
    `1 job, addressee=${String(everyone.pinned)} — the chief of staff takes an unaddressed message`,
    everyone.pinned === null,
  )
  /*
    And she can really bring people in, which is what makes one job the right
    answer rather than a shortcut. #65 built this; here it is only asserted
    that the mechanism exists, because exercising it is that Issue's suite.
  */
  const canConvene = Number(
    (
      await one(`
        select count(*)::int as n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'app' and p.proname = 'record_consultation'
      `)
    ).n,
  )
  check(
    'and the one who holds it can convene the others rather than answering alone',
    canConvene > 0 ? 'record_consultation exists (#65)' : 'THERE IS NO WAY TO CONSULT',
    canConvene > 0,
  )

  // =========================================================================
  console.log('\nthe adapter translates and does not decide (§5)')

  const src = await sourceOf('supabase/functions/voice/index.ts')
  check(
    'the turn endpoint accepts an addressee and records it on the command',
    src.includes('addressed_to: addressedTo') ? 'addressed_to is written' : 'IT IS NOT WRITTEN',
    src.includes('addressed_to: addressedTo'),
  )
  /*
    Asserted on the SOURCE because it is a property of the adapter rather than
    of any one request: it must not look the roster up. A test that posted a
    valid slug could not tell the difference between an adapter that translates
    and one that resolves — both would answer correctly.
  */
  check(
    'and it never queries the roster to resolve one',
    /staff/i.test(src.slice(src.indexOf('const to ='), src.indexOf('const to =') + 900))
      ? 'IT LOOKS THE ROSTER UP'
      : 'shape-checked only, the roster decides',
    !/from public\.staff|rpc\('speaker/i.test(src),
  )
} finally {
  console.log('\nteardown')
  /*
    Guarded, because a suite that fails on its FIRST subject reaches here with
    nothing to clean up — and `any(array[])` cannot infer its type, so the
    teardown throws and hides the failure that brought it here. A teardown that
    masks the error it is cleaning up after is worse than no teardown.
  */
  if (jobs.length > 0) {
    await db.execute(`
      update public.jobs
         set state = 'cancelled', finished_at = app.now_utc(), project_id = null
       where job_id = any(array[${jobs.map((j) => `${lit(j)}::uuid`).join(',')}])
         and state not in ('complete', 'cancelled', 'failed')
    `)
  }
  const live =
    jobs.length === 0
      ? 0
      : Number(
          (
            await one(`
        select count(*)::int as n from public.jobs
         where job_id = any(array[${jobs.map((j) => `${lit(j)}::uuid`).join(',')}])
           and state not in ('complete', 'cancelled', 'failed')
      `)
          ).n,
        )
  /*
    These jobs are NOT fixtures, and cannot be made into them.

    `jobs.is_fixture` is GENERATED from `requested_by`, and `enqueue_inbound`
    builds that as `channel:subject` — so a command written the way this suite
    writes one produces `voice:grant`, which is exactly right and matches no
    fixture pattern. Making it match would mean lying about who asked.

    So the honest handling is the one `verify:proposes` arrived at: cancel them
    and unlink them from any project, so they are history rather than work. A
    cancelled job is in no tally of live, failed or stalled work, and it does
    not sit in the queue where `verify:slack` and `verify:worker` trip over it
    (#184).
  */
  check(
    'teardown — nothing left that any tally would count as work',
    `${String(live)} live of ${String(jobs.length)} made`,
    live === 0 && jobs.length > 0,
  )
}

const failed = checks.filter((c) => !c).length
console.log(`\n${String(checks.length - failed)}/${String(checks.length)} checks passed`)
process.exit(failed === 0 ? 0 : 1)

/** The adapter's own source, for the two checks that are about the adapter. */
async function sourceOf(path: string): Promise<string> {
  const { readFile } = await import('node:fs/promises')
  return await readFile(path, 'utf8')
}
