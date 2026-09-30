/**
 * Run 4 - a job keeps where it came from (0619).
 *
 *   npx tsx scripts/isolated/job-origin.ts <replica-db>
 *
 * Every attack here is a way to make work read as more trusted than the tree it hangs from, or to lose
 * what is already known. The positive controls are the real production shapes (a real Telegram turn, a
 * duty, a delegated child); each negative names the reason it is refused, never merely that something threw.
 */
import { isolated } from './guard.ts'
import { realParent } from './real-telegram.ts'

const db = await isolated(process.argv[2] ?? 'orig619')
const run = Date.now().toString(36)
const one = async (sql: string) => (await db.execute(sql)).rows[0] as Record<string, unknown>
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`
const results: { ok: boolean }[] = []
const check = (what: string, ok: boolean, detail: string) => {
  results.push({ ok })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what} - ${detail}`)
}
const origin = async (job: string) =>
  String((await one(`select app.job_origin(${lit(job)}::uuid) as o`)).o)
const child = async (parent: string, kind = 'office.instruction', payload = '{}') =>
  String(
    (
      await one(
        `select app.enqueue_child(${lit(parent)}::uuid, ${lit(kind)}, ${lit(payload)}::jsonb)::text as c`,
      )
    ).c,
  )
const refused = async (sql: string): Promise<string> => {
  try {
    await db.execute(sql)
    return ''
  } catch (e) {
    return String((e as Error).message)
  }
}

// ---- a real turn is recorded as trusted, with its command and channel -------------------------------------
const root = await realParent(db)
{
  const r = await one(
    `select root_job_id::text as r, origin_kind, origin_class, origin_channel, origin_command_id::text as c from public.jobs where job_id = ${lit(root)}::uuid`,
  )
  check(
    'a real Telegram turn records why it exists, that it is trusted, and which command began it',
    r.r === root &&
      r.origin_kind === 'inbound' &&
      r.origin_class === 'trusted' &&
      r.origin_channel === 'telegram' &&
      typeof r.c === 'string',
    JSON.stringify(r),
  )
  check('and reads as trusted', (await origin(root)) === 'trusted', await origin(root))
}

// ---- D2: deleting the command does not un-trust the tree ---------------------------------------------------
const kid = await child(root)
const grandkid = await child(kid)
{
  const r = await one(
    `select origin_kind, origin_class, root_job_id::text as r from public.jobs where job_id = ${lit(grandkid)}::uuid`,
  )
  check(
    'a grandchild carries its root, its kind (child) and the root trust, all fixed at creation',
    r.r === root && r.origin_kind === 'child' && r.origin_class === 'trusted',
    JSON.stringify(r),
  )
  const cmd = String(
    (
      await one(
        `select origin_command_id::text as c from public.jobs where job_id = ${lit(root)}::uuid`,
      )
    ).c,
  )
  await db.execute(`delete from public.inbound_commands where command_id = ${lit(cmd)}::uuid`)
  const after = [await origin(root), await origin(kid), await origin(grandkid)]
  check(
    'the command row is deleted and the whole tree still reads trusted (the evidence was taken while it existed)',
    after.every((x) => x === 'trusted'),
    after.join('/'),
  )
}

// ---- D1: a command id in a duty's config is not evidence ----------------------------------------------------
{
  const live = await realParent(db)
  const cmd = String(
    (
      await one(
        `select origin_command_id::text as c from public.jobs where job_id = ${lit(live)}::uuid`,
      )
    ).c,
  )
  const staff = String((await one(`select staff_id::text as s from public.staff limit 1`)).s)
  await db.execute(`insert into public.responsibilities (slug, staff_id, description, job_kind, period_minutes, pinned_config)
    values (${lit(`zz-launder-${run}`)}, ${lit(staff)}::uuid, 'a duty whose config carries a real command id, to launder trust', 'office.notice', 10,
            jsonb_build_object('command_id', ${lit(cmd)}))`)
  await db.execute(
    `update public.responsibilities set last_run_at = null where slug = ${lit(`zz-launder-${run}`)}`,
  )
  const fired = await one(
    `select fired_job_id::text as j from app.dispatch_due_responsibilities() where duty_slug = ${lit(`zz-launder-${run}`)}`,
  )
  const j = String(fired.j)
  const r = await one(
    `select origin_kind, origin_class, origin_command_id from public.jobs where job_id = ${lit(j)}::uuid`,
  )
  const o = await origin(j)
  check(
    'a duty root whose config names a real command is recorded as a duty, with no command, and reads internal (not trusted)',
    r.origin_kind === 'duty' && r.origin_command_id === null && o === 'internal',
    `${JSON.stringify(r)} / ${o}`,
  )
  // The same duty with its authorization removed reads unknown - it never becomes trusted.
  await db.execute(`delete from public.responsibilities where slug = ${lit(`zz-launder-${run}`)}`)
  const orphan = await origin(j)
  check('and once the duty is gone it reads unknown, never trusted', orphan === 'unknown', orphan)
}

// ---- forged origin: a caller cannot state its own -------------------------------------------------------------
{
  const j = String(
    (
      await one(
        `insert into public.jobs (correlation_id, idempotency_key, kind, requested_by, origin_kind, origin_class, root_job_id)
         values (gen_random_uuid(), ${lit(`forged-origin-${run}`)}, 'office.notice', 'telegram:grant', 'inbound', 'trusted', null)
         returning job_id::text as j`,
      )
    ).j,
  )
  const r = await one(
    `select origin_kind, origin_class, origin_command_id from public.jobs where job_id = ${lit(j)}::uuid`,
  )
  check(
    'a job that names its own origin as inbound/trusted is overwritten: not made by an inbound door, so it is not trusted',
    r.origin_class === null && r.origin_kind === 'system' && (await origin(j)) === 'unknown',
    `${JSON.stringify(r)} / ${await origin(j)}`,
  )
  const claim = String(
    (
      await one(
        `insert into public.jobs (correlation_id, idempotency_key, kind, requested_by)
         values (gen_random_uuid(), ${lit(`inbound-${crypto.randomUUID()}`)}, 'office.notice', 'telegram:grant')
         returning job_id::text as j`,
      )
    ).j,
  )
  const c = await one(
    `select origin_kind, origin_class from public.jobs where job_id = ${lit(claim)}::uuid`,
  )
  check(
    'a key that says inbound-<command> for a command that does not exist is recorded unknown',
    c.origin_kind === 'inbound' &&
      c.origin_class === 'unknown' &&
      (await origin(claim)) === 'unknown',
    JSON.stringify(c),
  )
}

// ---- written once ---------------------------------------------------------------------------------------------
{
  const said = await refused(
    `update public.jobs set origin_class = 'unknown' where job_id = ${lit(root)}::uuid`,
  )
  check(
    'the origin cannot be changed afterwards (refused for that reason)',
    /written once/.test(said),
    said.slice(0, 90),
  )
  const said2 = await refused(
    `update public.jobs set root_job_id = ${lit(kid)}::uuid where job_id = ${lit(grandkid)}::uuid`,
  )
  check('nor the root', /written once/.test(said2), said2.slice(0, 90))
  const same = await refused(
    `update public.jobs set state_reason = 'a retry is the same work' where job_id = ${lit(kid)}::uuid`,
  )
  check(
    'an ordinary update (a retry, a pause) still works and leaves the origin alone',
    same === '',
    same,
  )
}

// ---- children never gain trust ---------------------------------------------------------------------------------
{
  const unknownRoot = String(
    (
      await one(
        `insert into public.jobs (correlation_id, idempotency_key, kind, requested_by)
         values (gen_random_uuid(), ${lit(`stranger-root-${run}`)}, 'office.instruction', 'telegram:grant')
         returning job_id::text as j`,
      )
    ).j,
  )
  const c = await child(unknownRoot, 'office.instruction')
  check(
    'a child of an unknown root is unknown, however it is named and however deep',
    (await origin(c)) === 'unknown' && (await origin(await child(c))) === 'unknown',
    `${await origin(c)}`,
  )
  const said = await refused(
    `insert into public.jobs (parent_job_id, correlation_id, idempotency_key, kind, requested_by, origin_class)
     select ${lit(unknownRoot)}::uuid, correlation_id, ${lit(`up-${run}`)}, 'office.instruction', 'telegram:grant', 'trusted' from public.jobs where job_id = ${lit(unknownRoot)}::uuid`,
  )
  const forgedChild = await one(
    `select job_id::text as j, origin_class from public.jobs where idempotency_key = ${lit(`up-${run}`)}`,
  )
  check(
    'a child cannot state a higher class than its tree: the claim is overwritten and it reads unknown',
    said === '' &&
      forgedChild?.origin_class !== 'trusted' &&
      (await origin(String(forgedChild?.j))) === 'unknown',
    `${String(forgedChild?.origin_class)} / ${await origin(String(forgedChild?.j))}`,
  )
}

// ---- legacy jobs keep their old answer and gain nothing ---------------------------------------------------------
{
  const cmdRoot = await realParent(db)
  await db.execute(`alter table public.jobs disable trigger jobs_stamp_origin`)
  const legacyUnknown = String(
    (
      await one(
        `insert into public.jobs (correlation_id, idempotency_key, kind, requested_by)
         values (gen_random_uuid(), ${lit(`legacy-unknown-${run}`)}, 'office.instruction', 'telegram:grant')
         returning job_id::text as j`,
      )
    ).j,
  )
  const cmd = String(
    (
      await one(
        `select origin_command_id::text as c from public.jobs where job_id = ${lit(cmdRoot)}::uuid`,
      )
    ).c,
  )
  const legacyKey = crypto.randomUUID()
  const legacyTrusted = String(
    (
      await one(
        `insert into public.jobs (correlation_id, idempotency_key, kind, requested_by, pinned_config)
         values (gen_random_uuid(), ${lit(`legacy-cmd-${legacyKey}`)}, 'office.instruction', 'telegram:grant',
                 jsonb_build_object('command_id', ${lit(cmd)}))
         returning job_id::text as j`,
      )
    ).j,
  )
  await db.execute(`alter table public.jobs enable trigger jobs_stamp_origin`)
  const r = await one(
    `select origin_kind from public.jobs where job_id = ${lit(legacyTrusted)}::uuid`,
  )
  check(
    'a job from before the migration has no recorded origin',
    r.origin_kind === null,
    String(r.origin_kind),
  )
  check(
    'a legacy job with no evidence is unknown and stays unknown',
    (await origin(legacyUnknown)) === 'unknown',
    await origin(legacyUnknown),
  )
  check(
    'a legacy job whose command still exists is answered as it always was',
    (await origin(legacyTrusted)) === 'trusted',
    await origin(legacyTrusted),
  )
  // A child made AFTER the migration under a legacy parent records what the office said at that moment.
  const fromLegacy = await child(legacyTrusted)
  const fromUnknown = await child(legacyUnknown)
  const rr = await one(
    `select (select origin_class from public.jobs where job_id = ${lit(fromLegacy)}::uuid) a, (select origin_class from public.jobs where job_id = ${lit(fromUnknown)}::uuid) b`,
  )
  check(
    'a child of a legacy trusted root freezes trusted; a child of a legacy unknown root freezes unknown',
    rr.a === 'trusted' && rr.b === 'unknown',
    JSON.stringify(rr),
  )
  // and a later delete of the legacy command moves the legacy root (as before) but not the frozen child
  await db.execute(`delete from public.inbound_commands where command_id = ${lit(cmd)}::uuid`)
  check(
    'the legacy parent falls to unknown when its command goes (unchanged behaviour); the frozen child does not',
    (await origin(legacyTrusted)) === 'unknown' && (await origin(fromLegacy)) === 'trusted',
    `${await origin(legacyTrusted)}/${await origin(fromLegacy)}`,
  )
}

// ---- harness stays harness ---------------------------------------------------------------------------------------
{
  const h = String(
    (
      await one(
        `insert into public.jobs (correlation_id, idempotency_key, kind, requested_by)
         values (gen_random_uuid(), ${lit(`harness-${run}`)}, 'office.instruction', 'verify:run4')
         returning job_id::text as j`,
      )
    ).j,
  )
  const hc = await child(h)
  check(
    'a test job and its children read as harness, and never as trusted',
    (await origin(h)) === 'harness' && (await origin(hc)) === 'harness',
    `${await origin(h)}/${await origin(hc)}`,
  )
}

// ---- review B, F2 and F3: a real command's key does not lend trust to a different principal, and the root is not the caller's ----
{
  const live = await realParent(db)
  const cmd = String(
    (
      await one(
        `select origin_command_id::text as c from public.jobs where job_id = ${lit(live)}::uuid`,
      )
    ).c,
  )
  // a command with no job yet: another real turn whose enqueue we do not run
  const key = `telegram:message:8967954396:1386648496:${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`
  const fresh = String(
    (
      await one(`set local application_name = 'PostgREST 14.5';
        insert into public.inbound_commands (origin_channel, origin_ref, actor, instruction, dedupe_key, subject)
        values ('telegram', ${lit(`1386648496:${key.split(':').pop()}`)}, '1386648496', 'a command nobody enqueued yet', ${lit(key)}, 'grant')
        returning command_id::text as id`)
    ).id,
  )
  const wrongWho = String(
    (
      await one(`insert into public.jobs (correlation_id, idempotency_key, kind, requested_by)
        values (gen_random_uuid(), ${lit(`inbound-${fresh}`)}, 'office.instruction', 'telegram:attacker-999') returning job_id::text as j`)
    ).j,
  )
  const w = await one(
    `select origin_kind, origin_class, origin_command_id from public.jobs where job_id = ${lit(wrongWho)}::uuid`,
  )
  check(
    "B2: a job with a real command's key but a DIFFERENT principal is not trusted (recorded inbound, unknown, no command)",
    w.origin_class === 'unknown' &&
      w.origin_command_id === null &&
      (await origin(wrongWho)) === 'unknown',
    JSON.stringify(w),
  )
  const claimed = String(
    (
      await one(`insert into public.jobs (correlation_id, idempotency_key, kind, requested_by)
        values (gen_random_uuid(), ${lit(`inbound-${cmd}`)}, 'office.instruction', 'telegram:grant') returning job_id::text as j`).catch(
        () => ({ j: '' }),
      )
    ).j,
  )
  void claimed
  const dup = await one(
    `select count(*)::int as n from public.jobs where origin_command_id = ${lit(cmd)}::uuid and parent_job_id is null`,
  )
  check(
    "B2: a second root claiming a command that already has a job is not stamped as that command's (one job per command)",
    Number(dup.n) === 1,
    `${String(dup.n)} root(s) recorded for the command`,
  )
  const lie = String(
    (
      await one(`insert into public.jobs (correlation_id, idempotency_key, kind, requested_by, root_job_id)
        values (gen_random_uuid(), ${lit(`root-lie-${run}`)}, 'office.instruction', 'system:x', ${lit(live)}::uuid) returning job_id::text as j`)
    ).j,
  )
  const rr = await one(
    `select root_job_id::text as r from public.jobs where job_id = ${lit(lie)}::uuid`,
  )
  check('B3: a caller cannot name its own root: it is itself', rr.r === lie, String(rr.r === lie))
}

const failed = results.filter((r) => !r.ok).length
console.log(`\n${String(results.length - failed)}/${String(results.length)} passed`)
await db.end()
process.exitCode = failed === 0 ? 0 : 1
