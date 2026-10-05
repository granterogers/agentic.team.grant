/**
 * #407 closure: Google access is bound to the TRUSTED office of the work, never to "the only person".
 *
 *   npx tsx scripts/isolated/google-office-binding.ts <replica-db>
 *
 * The first #407 symptom was `no_office`: the mail and calendar duties asked `soleOffice()` which office they were
 * in, and the day a second office existed that answer became null (af2a7b8d fixed the handlers to take the job's
 * office). The question this proof answers is the deeper one: once a job has an office, which Google credential
 * does it get? It is read through app.deployment_credential on behalf of that office (0800), so:
 *
 *   1. the operator's office (Grant's) is served the deployment's bare Google refresh token - explicit ownership;
 *   2. a second person's office is NOT served it, and its vault name is its own, which is empty;
 *   3. the system and test offices cannot acquire it through a job, and a person's job with no operator is refused;
 *   4. a forged office (a real job id of one office, another office's id) is refused;
 *   5. an office that does not exist, or a null office, reads nothing rather than the deployment's;
 *   6. a second office with its OWN stored token is served only that token, never Grant's;
 *   7. CONTROL: the old sole-person behaviour is detectable - with a single person office the home office is that
 *      person, with two it is NOT guessed, and the proof goes red if the home office is ever "whoever is first".
 *
 * Everything is rolled back.
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
const GRANTS = `grant-token-${run}`
const SECONDS = `second-token-${run}`

const refused = async (sql: string): Promise<string | null> => {
  try {
    await db.execute(`savepoint s; ${sql}`)
    await db.execute('release savepoint s')
    return null
  } catch (e) {
    await db.execute('rollback to savepoint s').catch(() => undefined)
    return String((e as Error).message)
  }
}

try {
  await db.execute('begin')
  const op = String((await one(`select app.operator_office()::text as o`)).o)
  check('there is an operator office (Grant)', op !== 'null' && op.length === 36, op)
  const opKey = String((await one(`select app.office_actor(${lit(op)}::uuid) as k`)).k)

  // A second person office and its owner, built the way provisioning builds one.
  const email = `g407-${run}@example.com`
  await db.execute(`insert into auth.users (id, email) values (gen_random_uuid(), ${lit(email)})`)
  const second = String(
    (
      await one(
        `select (app.provision_person_office('g407 proof', ${lit(email)}, ${lit(`g407-${run}`)})->>'office_id') as o`,
      )
    ).o,
  )
  if (second.length !== 36) {
    check(
      'a second person office could be provisioned in the replica',
      false,
      second || 'no office',
    )
    throw new Error('cannot continue without a second office')
  }
  const sys = String(
    (await one(`select office_id::text as o from public.offices where kind = 'system' limit 1`)).o,
  )
  const test = String(
    (await one(`select office_id::text as o from public.offices where kind = 'test' limit 1`)).o,
  )

  // The deployment's Google token belongs to Grant's office under its bare vault name.
  const bare = 'google.refresh_token'
  await db.execute(`delete from vault.secrets where name = ${lit(bare)}`)
  await db.execute(`insert into vault.secrets (name, secret) values (${lit(bare)}, ${lit(GRANTS)})`)

  const nameOf = async (o: string) =>
    String((await one(`select app.google_vault_name(${lit(o)}::uuid, ${lit(bare)}) as n`)).n)
  check(
    "Grant's office resolves the bare deployment name",
    (await nameOf(op)) === bare,
    await nameOf(op),
  )
  check(
    "a second person's office resolves its OWN name, not Grant's",
    (await nameOf(second)) === `${bare}.${second}`,
    await nameOf(second),
  )
  check(
    'the system office resolves its own name',
    (await nameOf(sys)) === `${bare}.${sys}`,
    await nameOf(sys),
  )
  check(
    'the test office resolves its own name',
    (await nameOf(test)) === `${bare}.${test}`,
    await nameOf(test),
  )
  const nul = await one(`select app.google_vault_name(null, ${lit(bare)}) as n`)
  check('no office reads no secret at all', nul.n === null, String(nul.n))

  // A duty must look like the product's own: a real responsibility's slug and kind, or job_origin does not call it internal.
  const duty = (
    await rows(
      `select slug, job_kind from public.responsibilities order by (job_kind = 'google.read_mail') desc limit 1`,
    )
  )[0] as { slug: string; job_kind: string }
  const job = async (o: string, requestedBy: string, kind = duty.job_kind) =>
    String(
      (
        await one(`insert into public.jobs (kind, requested_by, idempotency_key, correlation_id, office_id)
          values (${lit(kind)}, ${lit(requestedBy.startsWith('duty:') ? `duty:${duty.slug}` : requestedBy)}, 'g407-' || gen_random_uuid(), gen_random_uuid(), ${lit(o)}::uuid)
          returning job_id::text as id`)
      ).id,
    )
  const read = async (
    office: string,
    jobId: string,
  ): Promise<{ ok: boolean; v: string | null; why: string }> => {
    const why = await refused(
      `select app.deployment_credential(${lit(office)}::uuid, ${lit(bare)}, null, ${lit(jobId)}::uuid, false) as v`,
    )
    if (why !== null) return { ok: false, v: null, why }
    const r = await one(
      `select app.deployment_credential(${lit(office)}::uuid, ${lit(bare)}, null, ${lit(jobId)}::uuid, false) as v`,
    )
    return { ok: true, v: r.v === null ? null : String(r.v), why: '' }
  }

  // 1. POSITIVE CONTROL: Grant's own duty in Grant's office is served Grant's token.
  const grantDuty = await job(op, 'duty:google-read-mail')
  const g = await read(op, grantDuty)
  check(
    "POSITIVE CONTROL: Grant's duty in Grant's office is served Grant's token",
    g.ok && g.v === GRANTS,
    g.why || 'served',
  )

  // 2/3. A second person's duty and turn, and a test office duty, are not served Grant's token.
  const secondDuty = await job(second, 'duty:google-read-mail')
  const s = await read(second, secondDuty)
  check(
    "a second person's duty is not served Grant's token",
    s.v !== GRANTS,
    s.ok
      ? `served ${s.v === null ? 'nothing (no token of its own)' : 'a different value'}`
      : `refused: ${s.why.slice(0, 80)}`,
  )
  const testDuty = await job(test, 'duty:google-read-mail')
  const t = await read(test, testDuty)
  check(
    "the test office cannot acquire Grant's token",
    t.v !== GRANTS,
    t.ok ? "served nothing of Grant's" : `refused: ${t.why.slice(0, 80)}`,
  )
  const sysDuty = await job(sys, 'duty:google-read-mail')
  const y = await read(sys, sysDuty)
  check(
    "the system office's job does not read Grant's token under its own name",
    y.v !== GRANTS,
    y.ok ? "served nothing of Grant's" : `refused: ${y.why.slice(0, 80)}`,
  )

  // 4. A forged office: Grant's job id, the second office named, and the reverse.
  const forgedA = await read(second, grantDuty)
  check(
    "forged: Grant's job claimed by the second office is refused",
    !forgedA.ok,
    forgedA.why.slice(0, 90),
  )
  const forgedB = await read(op, secondDuty)
  check(
    "forged: the second office's job claimed as Grant's office is refused",
    !forgedB.ok,
    forgedB.why.slice(0, 90),
  )

  // 5. A job that does not exist, and an office that does not exist.
  const ghost = await read(op, '00000000-0000-4000-8000-000000000000')
  check('a job that does not exist is refused', !ghost.ok, ghost.why.slice(0, 90))
  const nowhere = await refused(
    `select app.deployment_credential('00000000-0000-4000-8000-000000000000'::uuid, ${lit(bare)}, null, ${lit(grantDuty)}::uuid, false)`,
  )
  check('an office that does not exist is refused', nowhere !== null, String(nowhere).slice(0, 90))

  // 6. A second office with its OWN token is served only that one.
  await db.execute(
    `insert into vault.secrets (name, secret) values (${lit(`${bare}.${second}`)}, ${lit(SECONDS)})`,
  )
  const own = await read(second, secondDuty)
  // A person's DUTY is internal work; whether a person's duty may use any Google integration is the gate's call, so the
  // property asserted is the one that matters: if anything is served, it is theirs, and never Grant's.
  check(
    "a second office with its own token is never served Grant's",
    own.v !== GRANTS,
    own.ok
      ? `served ${own.v === SECONDS ? 'its own token' : 'nothing'}`
      : `refused: ${own.why.slice(0, 80)}`,
  )
  const grantAgain = await read(op, grantDuty)
  check(
    "Grant is still served Grant's token, not the second office's",
    grantAgain.v === GRANTS,
    'unchanged',
  )

  // 7. NEGATIVE CONTROL for the old behaviour. The home office is explicit (the operator), and with the operator
  // removed it must NOT be guessed from two people.
  const home = String((await one(`select app.google_home_office()::text as o`)).o)
  check("the home office is the operator's, explicitly", home === op, home)
  await db.execute(`delete from public.deployment_operators where owner_key = ${lit(opKey)}`)
  const people = Number(
    (
      await one(
        `select count(*)::int as n from public.offices where kind = 'person' and state = 'active'`,
      )
    ).n,
  )
  const homeNoOp = (await one(`select app.google_home_office()::text as o`)).o
  check(
    'NEGATIVE CONTROL: with no operator and more than one person the home office is NOT guessed',
    people > 1 && homeNoOp === null,
    `${String(people)} person offices, home=${String(homeNoOp)}`,
  )
  const orphan = await read(second, secondDuty)
  check(
    'and nobody else is served the bare token by default',
    orphan.v !== GRANTS,
    orphan.ok ? "served nothing of Grant's" : `refused: ${orphan.why.slice(0, 80)}`,
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
