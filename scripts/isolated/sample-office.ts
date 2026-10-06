/**
 * The public Sample Office (migration 0897): a visitor with no account can read it, ask its team a question, and change
 * nothing; and nothing a visitor does reaches Grant, another person, or another visitor.
 *
 *   npx tsx scripts/isolated/sample-office.ts <replica-db>
 *
 * Everything runs in ONE transaction that is rolled back, so the replica is left as it was found. The sabotage groups
 * replace a function inside a savepoint and roll it back: each proves a check can fail, then the real definition returns.
 *
 *   1. what a guest is: the principal kind, the refusals, and that a person and a harness member are unchanged;
 *   2. the door a visitor knocks on (sample_login): closed while the office is open for seeding, open once sealed;
 *   3. asking the team: the turn lands in the sample office, is tagged with the visitor, is nobody's real work, and
 *      threads only with that visitor's own turns;
 *   4. refusals: a person, a stranger's key, another office's project, a bad visitor id, an over-long question;
 *   5. limits: per visitor per hour, per day, in flight, and across the whole office, with a positive control;
 *   6. isolation: visitor B never reads visitor A, the ordinary conversation of a sample office is empty, and a real
 *      person's conversation is untouched (the control that the early return is not a blanket empty);
 *   7. SABOTAGE: remove the visitor clause from harness_job, and the early return from conversation_history.
 */
import { isolated } from './guard.ts'

const db = await isolated(process.argv[2] ?? 'post')
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`
const results: boolean[] = []
const check = (what: string, ok: boolean, detail: string) => {
  results.push(ok)
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what} - ${detail}`)
}
const rows = async (sql: string) => (await db.execute(sql)).rows as Record<string, unknown>[]
const one = async (sql: string) => (await rows(sql))[0] ?? {}
const run = Date.now().toString(36)
const VISITOR_A = `a${run}${'x'.repeat(20)}`
const VISITOR_B = `b${run}${'y'.repeat(20)}`

const refused = async (sql: string): Promise<string | null> => {
  try {
    await db.execute(`savepoint r; ${sql}`)
    await db.execute('release savepoint r')
    return null
  } catch (e) {
    await db.execute('rollback to savepoint r').catch(() => undefined)
    return String((e as Error).message)
  }
}

try {
  await db.execute('begin')
  const op = String((await one(`select app.operator_office()::text as o`)).o)
  const opKey = String((await one(`select app.office_actor(${lit(op)}::uuid) as k`)).k)

  // ---- a sample office, built the way the operator tooling builds it ---------------------------------------------
  const email = `sample-${run}@example.invalid`
  const guestKey = `sample-${run}`
  await db.execute(`insert into auth.users (id, email) values (gen_random_uuid(), ${lit(email)})`)
  const made = (await one(
    `select app.provision_sample_office('Sample Office', ${lit(email)}, ${lit(guestKey)}) as r`,
  )) as { r: { office_id?: string } | string }
  const result = typeof made.r === 'string' ? JSON.parse(made.r) : made.r
  const S = String(result.office_id ?? '')
  check('a sample office was provisioned', S.length === 36, S)
  check(
    "it is kind 'sample' and a second sample office is refused",
    String(
      (await one(`select kind from public.offices where office_id = ${lit(S)}::uuid`)).kind,
    ) === 'sample' &&
      (await refused(
        `select app.provision_sample_office('Another', 'x-${run}@example.invalid', 'x${run}')`,
      )) !== null,
    'one active sample office',
  )

  // ---- 2. the door -----------------------------------------------------------------------------------------------
  const login = async () =>
    (await one(`select app.sample_login() as r`)).r as { ok?: boolean; email?: string }
  const parse = (v: unknown) =>
    (typeof v === 'string' ? JSON.parse(v) : v) as { ok?: boolean; email?: string }
  check(
    'while the office is OPEN for seeding nobody can enter it',
    parse(await login()).ok === false,
    'sample_login says no',
  )
  await db.execute(`select app.sample_office_open(${lit(S)}::uuid, false)`)
  const entered = parse(await login())
  check(
    'once SEALED a visitor can enter, and as exactly its login',
    entered.ok === true && entered.email === email,
    String(entered.email),
  )
  check(
    'sealing made the member a guest',
    String(
      (await one(`select kind from public.office_members where owner_key = ${lit(guestKey)}`)).kind,
    ) === 'guest',
    'guest',
  )
  check(
    'sample_office_open refuses an office that is not a sample',
    (await refused(`select app.sample_office_open(${lit(op)}::uuid, false)`)) !== null,
    "Grant's office cannot be sealed as a sample",
  )

  // ---- 1. what a guest is ----------------------------------------------------------------------------------------
  const kindOf = async (k: string) =>
    String((await one(`select app.principal_kind(${lit(k)}) as k`)).k)
  const refusal = async (k: string) => (await one(`select app.authority_refusal(${lit(k)}) as r`)).r
  check("a guest's key is a guest", (await kindOf(guestKey)) === 'guest', await kindOf(guestKey))
  check("Grant's key is still a person", (await kindOf(opKey)) === 'person', await kindOf(opKey))
  check(
    'a harness label is still a harness',
    (await kindOf('verify-whatever')) === 'harness',
    await kindOf('verify-whatever'),
  )
  check(
    'an unknown key is still unknown',
    (await kindOf('nobody-at-all')) === 'unknown',
    await kindOf('nobody-at-all'),
  )
  const guestRefusal = String((await refusal(guestKey)) ?? '')
  check(
    'a guest is refused every decision, in words',
    /sample office/i.test(guestRefusal),
    guestRefusal.slice(0, 90),
  )
  check('a person is not refused', (await refusal(opKey)) === null, 'null')

  // ---- projects for the sample office, one for Grant's side to try to reach ---------------------------------------
  const P = String(
    (
      await one(
        `insert into public.projects (slug, name, status, office_id) values ('sample-p-${run}', 'Sample project', 'active', ${lit(S)}::uuid) returning project_id::text as id`,
      )
    ).id,
  )
  const PX = String(
    (
      await one(
        `insert into public.projects (slug, name, status, office_id) values ('sample-q-${run}', 'Other', 'active', ${lit(op)}::uuid) returning project_id::text as id`,
      )
    ).id,
  )
  const say = async (
    visitor: string,
    text = 'What is left to do on the launch?',
    by = guestKey,
    project = P,
  ) =>
    // As the gateway reaches it: through PostgREST, so the command is stamped as a production request, not synthetic.
    (
      await one(
        `set local application_name = 'PostgREST 14.5'; select app.sample_say(${lit(S)}::uuid, ${lit(project)}::uuid, ${lit(text)}, ${lit(visitor)}, ${lit(by)}) as r`,
      )
    ).r as
      | { ok?: boolean; error?: string; job?: string; command?: string; limited?: boolean }
      | string
  const asObj = (v: unknown) =>
    (typeof v === 'string' ? JSON.parse(v) : v) as {
      ok?: boolean
      error?: string
      job?: string
      command?: string
      limited?: boolean
    }

  // ---- 3. asking the team ----------------------------------------------------------------------------------------
  const first = asObj(await say(VISITOR_A))
  check(
    'a visitor can ask the sample team a question',
    first.ok === true && typeof first.job === 'string',
    String(first.error ?? first.job),
  )
  const cmd = (await one(
    `select office_id::text as office, origin_ref, context ->> 'visitor' as visitor, dedupe_key, project_id::text as project from public.inbound_commands where command_id = ${lit(String(first.command))}::uuid`,
  )) as { office: string; origin_ref: string; visitor: string; dedupe_key: string; project: string }
  check(
    "the turn is in the sample office and the visitor's project",
    cmd.office === S && cmd.project === P,
    `${cmd.office.slice(0, 8)} ${cmd.project.slice(0, 8)}`,
  )
  check(
    'it carries the visitor id and its own chat',
    cmd.visitor === VISITOR_A && cmd.origin_ref.startsWith(`guest-${VISITOR_A}:`),
    cmd.origin_ref.slice(0, 40),
  )
  check(
    "its dedupe key is the dashboard's ordinary shape",
    /^teamhq:message:[0-9a-f]{32}$/.test(cmd.dedupe_key),
    cmd.dedupe_key.slice(0, 30),
  )
  const jobOffice = String(
    (
      await one(
        `select office_id::text as o from public.jobs where job_id = ${lit(String(first.job))}::uuid`,
      )
    ).o,
  )
  check('the job it started is in the sample office', jobOffice === S, jobOffice.slice(0, 8))
  const harness = async (job: string) =>
    (await one(`select app.harness_job(${lit(job)}::uuid) as h`)).h === true
  check(
    "a visitor's turn is nobody's real work",
    await harness(String(first.job)),
    'harness_job is true',
  )
  const origin = String(
    (await one(`select app.job_origin(${lit(String(first.job))}::uuid) as o`)).o,
  )
  check(
    "and so it may not act outside (job_origin is not 'trusted' or 'internal')",
    origin !== 'trusted' && origin !== 'internal',
    origin,
  )

  // ---- 4. refusals -----------------------------------------------------------------------------------------------
  const no = async (what: string, r: unknown, want: RegExp) => {
    const o = asObj(r)
    check(what, o.ok === false && want.test(String(o.error)), String(o.error).slice(0, 90))
  }
  await no(
    'a person cannot use the visitor door',
    await say(VISITOR_B, 'hello', opKey),
    /only for the sample office/,
  )
  await no(
    'a stranger key cannot use it',
    await say(VISITOR_B, 'hello', 'not-a-member'),
    /only for the sample office/,
  )
  await no(
    'a harness key cannot use it',
    await say(VISITOR_B, 'hello', 'verify-someone'),
    /only for the sample office/,
  )
  await no(
    "another office's project is refused",
    await say(VISITOR_B, 'hello', guestKey, PX),
    /no such project/,
  )
  await no('a short visitor id is refused', await say('short', 'hello'), /which visitor/)
  await no(
    'an upper-case visitor id is refused',
    await say('A'.repeat(30), 'hello'),
    /which visitor/,
  )
  await no('an empty question is refused', await say(VISITOR_B, '   '), /nothing to say/)
  await no(
    'a very long question is refused',
    await say(VISITOR_B, 'x'.repeat(601)),
    /600 characters/,
  )
  const otherOffice = JSON.stringify(
    (
      await one(
        `select app.sample_say(${lit(op)}::uuid, ${lit(PX)}::uuid, 'hi', ${lit(VISITOR_B)}, ${lit(guestKey)}) as r`,
      )
    ).r,
  )
  check(
    "the guest door will not speak in Grant's office",
    /only for the sample office/.test(otherOffice),
    otherOffice.slice(0, 70),
  )

  // ---- 6. isolation ----------------------------------------------------------------------------------------------
  const theirs = async (visitor: string, project = P) =>
    (
      await one(
        `select app.sample_conversation(${lit(S)}::uuid, ${lit(project)}::uuid, ${lit(visitor)}, 50) as r`,
      )
    ).r as unknown
  const list = (v: unknown) =>
    (typeof v === 'string' ? JSON.parse(v) : v) as { kind: string; body: string }[]
  const a = list(await theirs(VISITOR_A))
  check(
    'visitor A reads their own question back',
    a.length === 1 && a[0]?.kind === 'said' && /left to do/.test(a[0]?.body ?? ''),
    `${String(a.length)} message(s)`,
  )
  check(
    'visitor B reads nothing of visitor A',
    list(await theirs(VISITOR_B)).length === 0,
    '0 messages',
  )
  check(
    'a malformed visitor id reads nothing',
    list(await theirs('short')).length === 0,
    '0 messages',
  )
  check(
    'a non-sample office reads nothing through it',
    (
      await one(
        `select app.sample_conversation(${lit(op)}::uuid, ${lit(PX)}::uuid, ${lit(VISITOR_A)}, 50) as r`,
      )
    ).r !== undefined &&
      list(
        (
          await one(
            `select app.sample_conversation(${lit(op)}::uuid, ${lit(PX)}::uuid, ${lit(VISITOR_A)}, 50) as r`,
          )
        ).r,
      ).length === 0,
    '0 messages',
  )
  const ordinary = (
    await one(`select app.conversation_history(${lit(S)}::uuid, ${lit(P)}::uuid, 50, null) as r`)
  ).r
  check(
    "the sample office's ordinary conversation is empty (nobody's turn leaks through it)",
    list(ordinary).length === 0,
    `${String(list(ordinary).length)} message(s)`,
  )
  // The control that the early return is not a blanket empty: a real person's office still reads its conversation.
  // A real person speaking the ordinary way (say_in_project, through PostgREST): the control for both new clauses.
  const realSaid = asObj(
    (
      await one(
        `set local application_name = 'PostgREST 14.5'; select app.say_in_project(${lit(op)}::uuid, ${lit(PX)}::uuid, 'a real message ${run}', null, '{}', ${lit(opKey)}) as r`,
      )
    ).r,
  ) as { ok?: boolean; job?: string; error?: string }
  check(
    'CONTROL: a real person can still say something in their own project',
    realSaid.ok === true,
    String(realSaid.error ?? realSaid.job),
  )
  const realRead = list(
    (
      await one(
        `select app.conversation_history(${lit(op)}::uuid, ${lit(PX)}::uuid, 50, null) as r`,
      )
    ).r,
  )
  check(
    "CONTROL: a real person's conversation still reads (the early return is only for a sample office)",
    realRead.some((m) => /a real message/.test(m.body)),
    `${String(realRead.length)} message(s)`,
  )
  check(
    "a real person's own turn is not harness (the new clause does not reach it)",
    typeof realSaid.job === 'string' && !(await harness(realSaid.job)),
    'harness_job is false for a real message',
  )
  const firstSynthetic = (
    await one(`select synthetic from public.jobs where job_id = ${lit(String(first.job))}::uuid`)
  ).synthetic
  check(
    "the visitor's job is not synthetic, so harness_job is true because of the visitor clause and nothing else",
    firstSynthetic === false,
    String(firstSynthetic),
  )

  // ---- 5. limits -------------------------------------------------------------------------------------------------
  const allowed = async (visitor: string) =>
    (await one(`select app.guest_allow(${lit(S)}::uuid, ${lit(visitor)}) as r`)).r
  check('a visitor within the limits is allowed', (await allowed(VISITOR_B)) === null, 'null')
  // A question settles when its job is cancelled (queued to cancelled is a legal move; nothing here ever runs one).
  const settle = async () => {
    const why = await refused(
      `update public.jobs set state = 'cancelled', finished_at = now() where office_id = ${lit(S)}::uuid and state = 'queued'`,
    )
    if (why !== null) check('a queued job can be settled for the test', false, why.slice(0, 90))
  }
  await settle()
  const asked: boolean[] = []
  for (let i = 0; i < 6; i += 1) {
    asked.push(asObj(await say(VISITOR_B, `question ${String(i)}`)).ok === true)
    await settle()
  }
  check(
    'six questions in an hour are answered',
    asked.every(Boolean),
    asked.map((a) => (a ? 'y' : 'n')).join(''),
  )
  const seventh = asObj(await say(VISITOR_B, 'question 6'))
  check(
    'the seventh is refused, in words, as a limit',
    seventh.ok === false &&
      seventh.limited === true &&
      /a lot just now/.test(String(seventh.error)),
    String(seventh.error).slice(0, 80),
  )
  check(
    "and the limit is that visitor's, not everybody's",
    (await allowed(`c${run}${'z'.repeat(20)}`)) === null,
    'another visitor is allowed',
  )
  const D = `d${run}${'q'.repeat(20)}`
  const busy = asObj(await say(D, 'one'))
  const busy2 = asObj(await say(D, 'two'))
  const busy3 = asObj(await say(D, 'three'))
  check(
    'two questions in flight is the most one visitor may have',
    busy.ok === true &&
      busy2.ok === true &&
      busy3.ok === false &&
      /still being answered/.test(String(busy3.error)),
    String(busy3.error).slice(0, 70),
  )
  await settle()
  await db.execute(
    `insert into public.system_config (key, value, description) values ('sample.turns_per_day', '1'::jsonb, 'proof') on conflict (key) do update set value = excluded.value`,
  )
  const crowded = String((await allowed(`e${run}${'w'.repeat(20)}`)) ?? '')
  check(
    'the whole office has a daily ceiling too (set small to see it)',
    /great many visitors/.test(crowded),
    crowded.slice(0, 70),
  )
  await db.execute(`delete from public.system_config where key = 'sample.turns_per_day'`)

  // ---- 7. SABOTAGE: each proves a check above can fail ------------------------------------------------------------
  const sabotage = async (what: string, sql: string, probe: () => Promise<boolean>) => {
    await db.execute('savepoint sab')
    await db.execute(sql)
    const caught = await probe()
    await db.execute('rollback to savepoint sab')
    check(
      `SABOTAGE: ${what} is detected`,
      caught,
      caught ? 'the check went red' : 'THE CHECK STAYED GREEN',
    )
  }
  await sabotage(
    'removing the visitor clause from harness_job',
    `create or replace function app.harness_job(p_job_id uuid) returns boolean language sql stable security definer set search_path to 'public','pg_catalog'
       as $f$ select coalesce((select j.synthetic or j.is_fixture from public.jobs j where j.job_id = p_job_id), false) $f$`,
    async () => !(await harness(String(first.job))),
  )
  await sabotage(
    "removing conversation_history's sample-office early return",
    `create or replace function app.conversation_history(p_office uuid, p_project_id uuid, p_limit integer default 50, p_before timestamp with time zone default null)
       returns jsonb language sql stable security definer set search_path to 'public','pg_catalog'
       as $f$ select coalesce(jsonb_agg(jsonb_build_object('body', c.instruction)), '[]'::jsonb) from public.inbound_commands c where c.office_id = p_office $f$`,
    async () =>
      list(
        (
          await one(
            `select app.conversation_history(${lit(S)}::uuid, ${lit(P)}::uuid, 50, null) as r`,
          )
        ).r,
      ).length > 0,
  )
  await sabotage(
    'letting a guest decide (authority_refusal without the guest branch)',
    `create or replace function app.authority_refusal(p_by text, p_job uuid default null, p_project uuid default null) returns text language sql stable security definer set search_path to ''
       as $f$ select null::text $f$`,
    async () => (await refusal(guestKey)) === null,
  )
  check(
    'after the sabotage the real definitions are back',
    parse(await login()).ok === true &&
      (await harness(String(first.job))) &&
      /sample office/i.test(String((await refusal(guestKey)) ?? '')),
    'harness_job, conversation_history and authority_refusal restored',
  )
} catch (e) {
  console.log(`FAIL aborted - ${(e as Error).message}`)
  results.push(false)
} finally {
  await db.execute('rollback').catch(() => undefined)
}
const passed = results.filter(Boolean).length
console.log(`\n${String(passed)}/${String(results.length)} passed`)
process.exit(passed === results.length && results.length > 0 ? 0 : 1)
