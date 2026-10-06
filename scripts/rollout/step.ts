/**
 * ONE stabilisation step, applied or rolled back on its own, with the live state checked before and after.
 *
 *   npx tsx scripts/rollout/step.ts <1023|1025|1027|1028> plan                  offline: what the step is, and that it is minimal
 *   ALLOW_PRODUCTION_CHECKS=1 npx tsx scripts/rollout/step.ts <step> precheck   read: are the live definitions the predecessor?
 *   ALLOW_PRODUCTION_WRITES=1 npx tsx scripts/rollout/step.ts <step> apply        dry run (reads only; changes nothing)
 *   ALLOW_PRODUCTION_WRITES=1 npx tsx scripts/rollout/step.ts <step> apply --go   canary, precheck, apply, postcheck
 *   ALLOW_PRODUCTION_CHECKS=1 npx tsx scripts/rollout/step.ts <step> postcheck   read: are the live definitions the new ones?
 *   ALLOW_PRODUCTION_WRITES=1 npx tsx scripts/rollout/step.ts <step> rollback --go
 *   ALLOW_PRODUCTION_WRITES=1 npx tsx scripts/rollout/step.ts <step> record --go      one ledger row, once the step is live and kept
 *   ALLOW_PRODUCTION_WRITES=1 npx tsx scripts/rollout/step.ts <step> unrecord --go    removes that row (only after a rollback)
 *
 * Any action takes --replica=<database> to run the same logic against a marked local replica (rehearsal; no flag needed).
 *
 * Why this exists instead of `npm run migrate`: `migrate` applies EVERYTHING pending (on this line that would be the
 * unreviewed 0892-1022), and it knows nothing about what a step is meant to change. This tool accepts only the four steps
 * pinned in scripts/rollout/stabilisation/manifest.json, applies exactly the one file named there (its sha256 must match the
 * pin), refuses a file that holds any statement other than creating or replacing a function, dropping one of the named
 * functions, or its grants (so no data, table, index or column change is possible), and refuses to apply unless the live
 * definitions are exactly the predecessor. Rolling back is the same in reverse. It is not a general migration runner.
 *
 * The production guard modules are imported only for the actions that touch production, and before anything is sent.
 * A rollback is never gated on health (it is the remedy when health is worse); an apply is.
 */
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import type { SqlExecutor } from '../../src/db/executor.ts'
import { judgeShape, statementsOf } from './shape.ts'

type Obj = { sig: string; pre: string | null; post: string | null }
type Step = {
  migration: string
  migrationSha256: string
  rollback: string
  rollbackSha256: string
  requiresGatewayRolledBackFirst?: boolean
  objects: Obj[]
}
type Seen = { sig: string; present: boolean; fp: string | null; attrs: string | null }

const args = process.argv.slice(2)
const [stepId = '', action = ''] = args
const flag = (n: string): boolean => args.includes(n)
const replica = args.find((a) => a.startsWith('--replica='))?.slice('--replica='.length)
const go = flag('--go')
const ACTIONS = ['plan', 'precheck', 'apply', 'postcheck', 'rollback', 'record', 'unrecord']
const fail = (msg: string, code = 1): never => {
  console.error(msg)
  return process.exit(code)
}

const manifest = JSON.parse(
  await readFile(new URL('./stabilisation/manifest.json', import.meta.url), 'utf8'),
) as { steps: Record<string, Step> }
const step = manifest.steps[stepId]
if (step === undefined || !ACTIONS.includes(action)) {
  fail(
    `usage: step.ts <${Object.keys(manifest.steps).join('|')}> <${ACTIONS.join('|')}> [--go] [--replica=<db>]\n` +
      'Only the steps pinned in scripts/rollout/stabilisation/manifest.json exist. There is no wildcard.',
    2,
  )
}
const S = step as Step

const sha256 = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex')
const migrationSql = await readFile(S.migration, 'utf8')
const rollbackSql = await readFile(S.rollback, 'utf8')
if (sha256(migrationSql) !== S.migrationSha256)
  fail(`REFUSED: ${S.migration} is not the reviewed file (sha256 differs from the pin).`, 2)
if (sha256(rollbackSql) !== S.rollbackSha256)
  fail(`REFUSED: ${S.rollback} is not the reviewed file (sha256 differs from the pin).`, 2)

const declaredNames = new Set(S.objects.map((o) => o.sig.replace(/\(.*$/, '')))
const shapeProblems = [
  ...judgeShape(migrationSql, 'migration', declaredNames),
  ...judgeShape(rollbackSql, 'rollback', declaredNames),
]

if (action === 'plan') {
  console.log(`STEP ${stepId}`)
  console.log(
    `  migration  ${S.migration}  sha256 ${S.migrationSha256.slice(0, 16)}... (matches the pin)`,
  )
  console.log(
    `  rollback   ${S.rollback}  sha256 ${S.rollbackSha256.slice(0, 16)}... (matches the pin)`,
  )
  console.log('  objects changed:')
  for (const o of S.objects)
    console.log(
      `    ${o.sig}  predecessor ${o.pre ?? '(does not exist)'}  new ${o.post ?? '(removed)'}`,
    )
  console.log(
    `  statements in the migration: ${statementsOf(migrationSql).join(' | ').slice(0, 400)}`,
  )
  console.log(
    shapeProblems.length === 0
      ? '  shape: only function create/replace/drop and function grants (no data, table, index or column change is possible)'
      : `  SHAPE REFUSED:\n    ${shapeProblems.join('\n    ')}`,
  )
  process.exit(shapeProblems.length === 0 ? 0 : 1)
}
if (shapeProblems.length > 0) fail(`REFUSED:\n  ${shapeProblems.join('\n  ')}`, 2)

// ---- the executor: a marked local replica, or production behind its guard (the guard is imported BEFORE anything is sent) ----
const isWrite = ['apply', 'rollback', 'record', 'unrecord'].includes(action)
let db: SqlExecutor
let ref = ''
let token = ''
if (replica !== undefined) {
  const { isolated } = await import('../isolated/guard.ts')
  db = await isolated(replica)
} else {
  await import(
    isWrite
      ? '../../src/safety/require-production-writes.ts'
      : '../../src/safety/require-production-checks.ts'
  )
  token = process.env.SUPABASE_ACCESS_TOKEN ?? ''
  if (token === '') fail('SUPABASE_ACCESS_TOKEN is not set: nothing was asked', 2)
  ref = process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg'
  const { ManagementApiExecutor } = await import('../../src/db/executor.ts')
  db = new ManagementApiExecutor(ref, token)
}
const clip = (e: unknown): string =>
  (e instanceof Error ? e.message : String(e))
    .replace(/Bearer\s+\S+/gi, 'Bearer [held]')
    .replace(/sbp_[A-Za-z0-9]+/g, '[token]')
    .slice(0, 300)

const NORMALISED =
  "md5(regexp_replace(regexp_replace(regexp_replace(pg_get_functiondef(p.oid), '(?s)/\\*.*?\\*/', '', 'g'), '--[^\\n]*', '', 'g'), '\\s+', ' ', 'g'))"
const read = async (): Promise<Seen[]> => {
  const values = S.objects.map((o) => `('${o.sig}')`).join(', ')
  const { rows } = await db.execute(
    `select s.sig, p.oid is not null as present, ${NORMALISED} as fp,
            concat_ws('|', p.prosecdef, p.provolatile, p.proconfig::text, coalesce(p.proacl::text, ''), pg_get_userbyid(p.proowner)) as attrs
       from (values ${values}) s(sig) left join pg_proc p on p.oid = to_regprocedure(s.sig) order by s.sig`,
  )
  return (rows as { sig: string; present: boolean; fp: string | null; attrs: string | null }[]).map(
    (r) => ({
      sig: r.sig,
      present: r.present === true,
      fp: r.fp,
      attrs: r.attrs,
    }),
  )
}
/** Does what is live equal the predecessor ('pre') or the new definitions ('post')? */
const judge = (seen: Seen[], which: 'pre' | 'post'): { ok: boolean; lines: string[] } => {
  const lines: string[] = []
  let ok = true
  for (const o of S.objects) {
    const s = seen.find((x) => x.sig === o.sig)
    const want = o[which]
    const good = want === null ? s?.present === false : s?.present === true && s.fp === want
    if (!good) ok = false
    lines.push(
      `  ${good ? 'ok  ' : 'FAIL'} ${o.sig}: live ${s?.present ? (s.fp ?? '?') : '(absent)'}, expected ${which} ${want ?? '(absent)'}`,
    )
  }
  return { ok, lines }
}
/** Step 1028 adds functions, so who may call them is part of the result. A refusal for the wrong reason is not read as a pass. */
const reach = async (): Promise<string[]> => {
  if (!S.objects.some((o) => o.pre === null)) return []
  const out: string[] = []
  const q = async (role: string, sig: string): Promise<boolean> =>
    (
      (await db.execute(`select has_function_privilege('${role}', '${sig}', 'execute') as ok`))
        .rows[0] as {
        ok: boolean
      }
    ).ok
  for (const o of S.objects) {
    for (const role of ['anon', 'authenticated']) {
      const can = await q(role, o.sig)
      out.push(`${can ? 'FAIL' : 'ok  '} ${role} ${can ? 'CAN' : 'cannot'} execute ${o.sig}`)
    }
  }
  const gw = await q('service_role', 'public.cannot_think(uuid)')
  out.push(
    `${gw ? 'ok  ' : 'FAIL'} service_role ${gw ? 'can' : 'CANNOT'} execute public.cannot_think(uuid)`,
  )
  return out
}
const show = (lines: string[]): void => {
  for (const l of lines) console.log(l)
}
const where = replica !== undefined ? `replica ${replica}` : 'PRODUCTION'

try {
  if (action === 'precheck' || action === 'postcheck') {
    const j = judge(await read(), action === 'precheck' ? 'pre' : 'post')
    console.log(`${action} ${stepId} on ${where}: ${j.ok ? 'MATCHES' : 'DOES NOT MATCH'}`)
    show(j.lines)
    if (action === 'postcheck') show(await reach())
    process.exit(j.ok ? 0 : 1)
  }

  if (action === 'apply') {
    // The canary comes FIRST, before any read of this step, so nothing is asked of a host that is not healthy.
    if (go && replica === undefined) {
      const { canaryPrecondition, fetchProviderHealth } = await import('../../src/safety/canary.ts')
      const verdict = await canaryPrecondition({
        readHealth: () => fetchProviderHealth(ref, token),
        readRows: async (sql: string) => (await db.execute(sql)).rows as Record<string, unknown>[],
        sleep: (ms: number) => new Promise((r) => setTimeout(r, ms)),
      })
      for (const c of verdict.checks)
        console.log(`  ${c.ok ? 'ok  ' : 'FAIL'} ${c.name}: ${c.detail}`)
      if (!verdict.go) fail(`NO-GO: ${verdict.reasons.join('; ')} Nothing was changed.`)
    }
    const before = await read()
    const pre = judge(before, 'pre')
    console.log(`apply ${stepId} on ${where}: live state before`)
    show(pre.lines)
    if (!pre.ok)
      fail(
        'STOP: the live definitions are not the predecessor this step was written against. Nothing was changed.',
      )
    if (!go) {
      console.log(
        `DRY RUN: would execute ${S.migration} (${migrationSql.length} bytes) as ONE request. Add --go to apply.`,
      )
      process.exit(0)
    }
    await db.execute(migrationSql)
    const after = await read()
    const post = judge(after, 'post')
    console.log(
      `applied ${stepId}; live state after: ${post.ok ? 'MATCHES the new definitions' : 'DOES NOT MATCH'}`,
    )
    show(post.lines)
    const changedAttrs = S.objects
      .filter((o) => o.pre !== null)
      .filter(
        (o) =>
          before.find((b) => b.sig === o.sig)?.attrs !== after.find((a) => a.sig === o.sig)?.attrs,
      )
    if (changedAttrs.length > 0)
      console.log(
        `  FAIL attributes (security definer, volatility, search_path, grants, owner) changed for: ${changedAttrs.map((o) => o.sig).join(', ')}`,
      )
    else
      console.log(
        '  ok   attributes (security definer, volatility, search_path, grants, owner) unchanged',
      )
    const r = await reach()
    show(r)
    const good = post.ok && changedAttrs.length === 0 && r.every((l) => !l.startsWith('FAIL'))
    if (!good)
      console.log(`ROLLBACK RECOMMENDED: npx tsx scripts/rollout/step.ts ${stepId} rollback --go`)
    process.exit(good ? 0 : 1)
  }

  /*
    The migration LEDGER (app.schema_migrations: name, checksum), which `npm run migrate` keeps. `apply` deliberately writes only
    functions; the ledger row is bookkeeping and is its own authorised write, made once a step is live and KEPT, so that a later
    `migrate` does not apply the file again. `unrecord` is for the one case of a rollback after recording. One row, this file only.
  */
  if (action === 'record' || action === 'unrecord') {
    const name = S.migration.split('/').pop() ?? ''
    if (!/^[a-z0-9_.]+\.sql$/.test(name)) fail(`REFUSED: unexpected migration file name ${name}`, 2)
    const want = action === 'record' ? 'post' : 'pre'
    const j = judge(await read(), want)
    show(j.lines)
    if (!j.ok)
      fail(
        `STOP: the live functions are not the ${want === 'post' ? 'new' : 'predecessor'} definitions, so ${action} would make the ledger lie. Nothing was changed.`,
      )
    const held = (
      (
        await db.execute(
          `select count(*)::int as n from app.schema_migrations where name = '${name}'`,
        )
      ).rows[0] as { n: number }
    ).n
    console.log(`ledger row for ${name}: ${held === 1 ? 'present' : 'absent'}`)
    if (!go) {
      console.log(`DRY RUN: would ${action} exactly one row. Add --go to do it.`)
      process.exit(0)
    }
    await db.execute(
      action === 'record'
        ? `insert into app.schema_migrations (name, checksum, duration_ms) values ('${name}', '${S.migrationSha256}', 0)
             on conflict (name) do update set checksum = excluded.checksum`
        : `delete from app.schema_migrations where name = '${name}' and checksum = '${S.migrationSha256}'`,
    )
    const after = (
      (
        await db.execute(
          `select count(*)::int as n from app.schema_migrations where name = '${name}'`,
        )
      ).rows[0] as { n: number }
    ).n
    const ok = action === 'record' ? after === 1 : after === 0
    console.log(
      `${action} ${stepId}: ledger row now ${after === 1 ? 'present' : 'absent'}: ${ok ? 'OK' : 'UNEXPECTED'}`,
    )
    process.exit(ok ? 0 : 1)
  }

  // rollback
  if (S.requiresGatewayRolledBackFirst === true && !flag('--gateway-rolled-back'))
    fail(
      `REFUSED: step ${stepId} adds functions the gateway calls. Roll hq-api back first, then pass --gateway-rolled-back, or every read of that section would fail.`,
      2,
    )
  const now = await read()
  if (judge(now, 'pre').ok) {
    console.log(`rollback ${stepId} on ${where}: already at the predecessor, nothing to do`)
    process.exit(0)
  }
  const atPost = judge(now, 'post')
  console.log(`rollback ${stepId} on ${where}: live state before`)
  show(atPost.lines)
  if (!atPost.ok)
    fail(
      'STOP: the live definitions are neither the predecessor nor the new ones. Nothing was changed; look at it by hand.',
    )
  if (!go) {
    console.log(
      `DRY RUN: would execute ${S.rollback} (${rollbackSql.length} bytes) as ONE request. Add --go to roll back.`,
    )
    process.exit(0)
  }
  await db.execute(rollbackSql)
  const back = judge(await read(), 'pre')
  console.log(
    `rolled back ${stepId}; live state after: ${back.ok ? 'MATCHES the predecessor exactly' : 'DOES NOT MATCH'}`,
  )
  show(back.lines)
  process.exit(back.ok ? 0 : 1)
} catch (e) {
  fail(`ERROR on ${where}: ${clip(e)}`)
}
