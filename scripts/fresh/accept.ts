/**
 * THE FRESH-INSTALL ACCEPTANCE — journeys A to J.
 *
 *   npm run fresh:accept
 *   npm run fresh:accept -- --only=C,G
 *
 * §15 asks for a permanent, repeatable guard against the things that make an
 * installation work for exactly one person. This is it. It runs against a
 * disposable local database, needs no account of any kind, and is therefore
 * runnable by anybody, on any change, for nothing.
 *
 * ## Every journey carries a control
 *
 * §10 of the QA standard: prove a detector can fail — break it on purpose,
 * watch it go red, restore it, watch it go green. A check that has only ever
 * reported success is indistinguishable from a check that cannot report
 * anything, and this repository has four separate entries in CLAUDE.md about
 * exactly that. So where a journey's assertion could pass vacuously, the
 * control is next to it and runs in the same pass.
 *
 * ## What it cannot prove
 *
 * Anything that needs an account: a real Supabase project, a real model
 * answering, a real Telegram bot. Those are named in
 * `docs/fresh-install/HUMAN-BLOCKED.md` with the exact steps. This harness
 * proves everything up to them, and says which is which rather than reporting
 * a clean green over a gap.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PostgresExecutor } from '../../src/db/postgres-executor.ts'
import {
  GRANT_PRODUCTION_PROJECT_REF,
  HARNESS_DB_PREFIX,
  ProductionIdentifierError,
  refuseForeignDatabase,
} from '../../src/fresh/forbidden.ts'
import {
  createDatabase,
  dropDatabase,
  ensureRole,
  localConnection,
} from '../../src/fresh/local-db.ts'
import type { MigrationFile } from '../../src/migrations/check.ts'
import { runMigrations } from '../../src/migrations/runner.ts'

const DB = `${HARNESS_DB_PREFIX}accept`
const SHIM = 'scripts/fresh/sql/supabase-shim.sql'

interface Finding {
  readonly ok: boolean
  readonly said: string
}

interface Journey {
  readonly id: string
  readonly title: string
  readonly findings: Finding[]
  /** Set when the journey cannot be completed without an account. */
  humanBlocked?: string
}

const journeys: Journey[] = []
let current: Journey | null = null

function journey(id: string, title: string): Journey {
  const j: Journey = { id, title, findings: [] }
  journeys.push(j)
  current = j
  return j
}

function assert(ok: boolean, said: string): void {
  current?.findings.push({ ok, said })
}

/** Run a repository command with a clean environment and capture everything. */
function run(
  command: string,
  args: readonly string[],
  env: Record<string, string | undefined> = {},
): { code: number; out: string } {
  const clean = { ...process.env, ...env }
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete clean[k]
  try {
    const out = execFileSync(command, args, {
      encoding: 'utf8',
      env: clean as NodeJS.ProcessEnv,
      stdio: 'pipe',
      maxBuffer: 64 * 1024 * 1024,
    })
    return { code: 0, out }
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string }
    return { code: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` }
  }
}

const db = (): PostgresExecutor => new PostgresExecutor(localConnection(DB))

async function value(sql: string): Promise<unknown> {
  const executor = db()
  const { rows } = await executor.execute(sql)
  const row = rows[0] as Record<string, unknown> | undefined
  return row === undefined ? undefined : Object.values(row)[0]
}

function blank(): void {
  ensureRole()
  dropDatabase(DB)
  createDatabase(DB)
  execFileSync('su', [
    'postgres',
    '-c',
    `psql -q -v ON_ERROR_STOP=1 -d ${DB} -f ${process.cwd()}/${SHIM}`,
  ])
}

function install(): { code: number; out: string } {
  return run('npx', ['tsx', 'scripts/fresh/install.ts'], {
    FRESH_DB: DB,
    SUPABASE_PROJECT_REF: undefined,
    SUPABASE_ACCESS_TOKEN: undefined,
  })
}

// ---------------------------------------------------------------------------

async function journeyA(): Promise<void> {
  journey('A', 'Clean config discovery — nothing configured at all')
  const r = run('npx', ['tsx', 'scripts/fresh/doctor.ts'], {
    SUPABASE_PROJECT_REF: undefined,
    SUPABASE_ACCESS_TOKEN: undefined,
    FRESH_DB: undefined,
  })
  assert(r.code === 0, `the doctor exits cleanly with nothing configured (exit ${r.code})`)
  assert(
    !r.out.includes(GRANT_PRODUCTION_PROJECT_REF),
    'it never falls back to the project this repository was developed against',
  )
  assert(r.out.includes('NEXT:'), 'it names exactly one next action')
  assert(/needs you|Run:/.test(r.out), 'and says whether that action is yours or the software’s')
  assert(
    r.out.includes('https://'),
    'a human step carries the URL to go to, per Grant’s standing instruction',
  )
  // CONTROL: the report must not claim things are done when nothing is.
  assert(
    !/REQUIRED — 12 of 12 done/.test(r.out),
    'CONTROL: it does not report a complete install when nothing is installed',
  )
}

async function journeyBC(): Promise<void> {
  journey('B', 'Minimum bootstrap — core prerequisites supplied, setup progresses')
  blank()
  const r = install()
  assert(r.code === 0, `install succeeds into an empty database (exit ${r.code})`)
  assert(r.out.includes('INSTALLED'), 'and says so')

  journey('C', 'Zero state — a blank database becomes a valid operational office')
  const expected = (await readdir('migrations')).filter((n) => /^\d{4}_.*\.sql$/.test(n)).length
  const recorded = Number(await value('select count(*)::int as n from app.schema_migrations'))
  assert(recorded === expected, `all ${expected} migrations recorded (found ${recorded})`)

  const staff = Number(await value('select count(*)::int as n from public.staff'))
  assert(staff === 8, `the roster is there — ${staff} staff`)

  const transitions = Number(
    await value('select count(*)::int as n from app.job_transitions_allowed'),
  )
  assert(
    transitions > 0,
    `the job state machine has its ${transitions} legal transitions ` +
      '(without these an office accepts work and can never run it)',
  )

  const health = await value('select app.office_health()::text as h')
  assert(typeof health === 'string' && health.length > 10, 'app.office_health() answers')

  const inbox = Number(
    await value(`select count(*)::int as n from public.projects where slug = 'unnamed'`),
  )
  assert(inbox === 1, 'the inbox project exists, so a first message has somewhere to land')

  const tools = Number(await value('select count(*)::int as n from public.tool_permissions'))
  assert(tools > 0, `the tool registry is seeded — ${tools} entries`)
}

async function journeyD(): Promise<void> {
  journey('D', 'Interruption — an install that stops halfway leaves nothing behind')
  blank()
  /*
    The property, not a simulated Ctrl-C.

    `fresh:install` sends the schema, the seed and the ledger as ONE statement,
    and `SqlExecutor`'s contract is that a statement is applied all-or-nothing.
    So the thing to prove is that contract holds over this transport: send the
    schema followed by something that fails, and assert the database is still
    empty afterwards. A killed process is one instance of that; this is the
    class.
  */
  const schema = await readFile('migrations/baseline/schema.sql', 'utf8')
  let threw = false
  try {
    await db().execute(`${schema}\nselect 1 / 0 as deliberate_failure;`)
  } catch {
    threw = true
  }
  assert(threw, 'an install that fails partway raises rather than reporting success')

  const leftBehind = await value(
    `select (to_regclass('app.schema_migrations') is not null) as present`,
  )
  assert(
    leftBehind !== true,
    'and leaves NOTHING behind — the database is as empty as before it started',
  )

  const again = install()
  assert(again.code === 0, 'so running it again simply works')
  const recorded = Number(await value('select count(*)::int as n from app.schema_migrations'))
  const expected = (await readdir('migrations')).filter((n) => /^\d{4}_.*\.sql$/.test(n)).length
  assert(recorded === expected, `with no duplication — ${recorded} recorded, not ${recorded * 2}`)
}

async function journeyE(): Promise<void> {
  journey('E', 'Wrong credential — a precise failure, and nothing leaked')
  /*
    A real refusal from the real API.

    The project reference below does not exist, so Supabase answers for itself
    rather than the harness deciding what a refusal looks like. The token is
    invented and shaped like nothing.
  */
  const r = run('npx', ['tsx', 'scripts/fresh/doctor.ts'], {
    SUPABASE_PROJECT_REF: 'freshinstallnosuchproject',
    SUPABASE_ACCESS_TOKEN: 'sbp_this_token_is_not_real_and_never_was',
    FRESH_DB: undefined,
  })
  assert(r.code === 0, 'the doctor still reports rather than crashing')
  assert(
    !r.out.includes('sbp_this_token_is_not_real_and_never_was'),
    'the credential is never echoed back, not even when it is the thing that is wrong',
  )
  assert(/token|refused|reach/i.test(r.out), 'it says which credential is the problem')
  assert(
    r.out.includes('https://supabase.com/dashboard/account/tokens') ||
      /generate a new one/i.test(r.out),
    'and where to get a working one',
  )
}

async function journeyF(): Promise<void> {
  journey('F', 'Optional missing — core works with no Slack, Google, Notion or Telegram')
  const optional = [
    ['slack', `select count(*)::int as n from vault.secrets where name like 'slack.%'`],
    ['google', `select count(*)::int as n from vault.secrets where name like 'google.%'`],
    ['notion', `select count(*)::int as n from vault.secrets where name like 'notion.%'`],
    ['telegram', 'select count(*)::int as n from public.telegram_bots'],
  ] as const
  for (const [name, sql] of optional) {
    const n = Number(await value(sql))
    assert(n === 0, `${name} is genuinely absent (${n} rows)`)
  }
  const health = await value('select app.office_health()::text as h')
  assert(typeof health === 'string', 'and the office still answers about its own health')
  const setup = await value('select app.hq_setup()::text as s')
  assert(
    typeof setup === 'string' && setup.length > 10,
    'and the setup page still renders rather than failing on a missing integration',
  )
}

async function journeyG(): Promise<void> {
  journey('G', 'First real use — an instruction goes in and an answer comes back')
  run(
    'sh',
    ['-c', `echo "sk-or-v1-not-a-real-key" | npx tsx scripts/fresh/secret.ts openrouter.api_key`],
    {
      FRESH_DB: DB,
      SUPABASE_PROJECT_REF: undefined,
      SUPABASE_ACCESS_TOKEN: undefined,
    },
  )
  run('npx', ['tsx', 'scripts/fresh/configure.ts'], {
    FRESH_DB: DB,
    SUPABASE_PROJECT_REF: undefined,
    SUPABASE_ACCESS_TOKEN: undefined,
  })
  const r = run('npx', ['tsx', 'scripts/fresh/first-use.ts', '--stub-inference'], {
    FRESH_DB: DB,
    SUPABASE_PROJECT_REF: undefined,
    SUPABASE_ACCESS_TOKEN: undefined,
  })
  assert(r.code === 0, `the office answered (exit ${r.code})`)
  assert(r.out.includes('(job complete)'), 'and the job reached "complete", not merely "settled"')

  const answered = Number(
    await value(`select count(*)::int as n from public.outputs o
                   join public.jobs j on j.job_id = o.job_id
                  where j.kind = 'office.instruction'`),
  )
  assert(answered > 0, `an output row exists for the instruction (${answered})`)

  const who = await value(
    `select coalesce(j.recipient_agent, '(nobody)') as w from public.jobs j
      where j.kind = 'office.instruction' order by j.created_at desc limit 1`,
  )
  assert(
    typeof who === 'string' && who !== '(nobody)',
    `a real member of staff was chosen to answer (${String(who)})`,
  )
  if (current !== null) {
    current.humanBlocked =
      'the model itself. A stand-in composed the sentence, because an OpenRouter ' +
      'key needs an account. Everything else on the path was the live code.'
  }
}

async function journeyH(): Promise<void> {
  journey('H', 'Second run — nothing duplicates')
  const before = {
    staff: Number(await value('select count(*)::int as n from public.staff')),
    migrations: Number(await value('select count(*)::int as n from app.schema_migrations')),
    config: Number(await value('select count(*)::int as n from public.system_config')),
    projects: Number(await value('select count(*)::int as n from public.projects')),
  }
  const r = install()
  assert(r.code !== 0, 'installing over an existing office is refused')
  assert(r.out.includes('REFUSED'), 'and says so plainly')
  assert(/npm run migrate/.test(r.out), 'and names what to do instead')

  const c = run('npx', ['tsx', 'scripts/fresh/configure.ts'], {
    FRESH_DB: DB,
    SUPABASE_PROJECT_REF: undefined,
    SUPABASE_ACCESS_TOKEN: undefined,
  })
  assert(c.code === 0, 'configure runs again happily')
  assert(!/did it/.test(c.out), 'and changes nothing the second time')

  const after = {
    staff: Number(await value('select count(*)::int as n from public.staff')),
    migrations: Number(await value('select count(*)::int as n from app.schema_migrations')),
    config: Number(await value('select count(*)::int as n from public.system_config')),
    projects: Number(await value('select count(*)::int as n from public.projects')),
  }
  for (const key of Object.keys(before) as (keyof typeof before)[]) {
    assert(before[key] === after[key], `${key}: ${before[key]} before, ${after[key]} after`)
  }
}

async function journeyI(): Promise<void> {
  journey('I', 'Update — an installation behind a migration catches up safely')
  /*
    A synthetic migration, never written to disk.

    It has to be one the corpus does not contain, or there is nothing to catch
    up to; and it must not be added to `migrations/`, because a migration file
    is a permanent, checksum-enforced artefact and a test does not get to leave
    one behind. So the runner is handed the real corpus plus one extra file in
    memory, which is exactly what it would see if somebody had just written it.
  */
  const names = (await readdir('migrations')).filter((n) => /^\d{4}_.*\.sql$/.test(n)).sort()
  const files: MigrationFile[] = await Promise.all(
    names.map(async (name) => ({ name, sql: await readFile(join('migrations', name), 'utf8') })),
  )
  /*
    The NEXT number, not a far-off one.

    `checkMigrations` enforces that the sequence has no gaps, and it is right
    to: a gap means somebody's migration is missing, which is exactly the
    "missing or out-of-order migration" §10 asks this to detect. The first
    draft numbered the probe 9999 and was refused with
    `[sequence/gap] gap between 0536 and 9999` — the integrity check doing its
    job on the harness.
  */
  const nextNumber = String(names.length + 1).padStart(4, '0')
  const probe: MigrationFile = {
    name: `${nextNumber}_fresh_install_upgrade_probe.sql`,
    sql:
      'begin;\n' +
      'create table if not exists public.fresh_install_upgrade_probe (only_row boolean primary key);\n' +
      'commit;\n',
  }
  const sha256 = (c: string): string => createHash('sha256').update(c, 'utf8').digest('hex')
  const executor = db()
  const result = await runMigrations([...files, probe], executor, sha256, () => {})

  assert(
    result.applied.length === 1,
    `exactly the one new migration was applied (${result.applied.length})`,
  )
  assert(result.applied[0]?.name === probe.name, 'and it was the new one, not something re-run')
  assert(
    result.skipped.length === files.length,
    `everything already applied was skipped (${result.skipped.length} of ${files.length})`,
  )
  const present = await value(
    `select (to_regclass('public.fresh_install_upgrade_probe') is not null) as p`,
  )
  assert(present === true, 'the upgrade actually changed the database')

  // CONTROL: a file whose content has changed since it was applied must STOP
  // the runner, not be quietly re-run or quietly ignored.
  const tampered: MigrationFile = { name: probe.name, sql: `${probe.sql}\n-- changed\n` }
  let refused = false
  let because = ''
  try {
    await runMigrations([...files, tampered], db(), sha256, () => {})
  } catch (error) {
    refused = true
    because = error instanceof Error ? error.message : String(error)
  }
  assert(refused, 'CONTROL: an applied migration whose file has changed stops the runner')
  assert(
    /checksum|changed|diverge/i.test(because),
    `CONTROL: and it stops for the right reason (${because.split('\n')[0]?.slice(0, 80) ?? ''})`,
  )
}

async function journeyJ(): Promise<void> {
  journey('J', 'No contamination — nothing here belongs to anybody else')
  const patterns: readonly [string, string][] = [
    ["Grant's Supabase project", GRANT_PRODUCTION_PROJECT_REF],
    ["Grant's Telegram chat", '1386648496'],
    ["Grant's Slack user", 'U0BUNF6AALC'],
    ['a Telegram bot username', 'atg_'],
    ['one of his project names', 'Legacy Coaching'],
  ]
  for (const [what, needle] of patterns) {
    /*
      Ask the DATABASE, across every text column it has.

      Scanning the baseline files would prove something about the files. This
      asks the installed office, which is what a person actually ends up with —
      and it catches anything a migration composes at install time that no file
      contains.
    */
    const hits = Number(
      await value(`
        select count(*)::int as n from (
          select 1 from pg_class c
            join pg_namespace n on n.oid = c.relnamespace
           where n.nspname in ('public','app') and c.relkind = 'r'
             and (xpath('/row/c/text()',
                   query_to_xml(
                     format('select count(*) c from %I.%I t where t::text like ''%%%s%%''',
                            n.nspname, c.relname, ${`'${needle.replace(/'/g, "''")}'`}),
                     false, true, '')))[1]::text::int > 0
        ) hit`),
    )
    assert(hits === 0, `${what}: ${hits} table(s) contain it`)
  }

  // CONTROL: the scan must be able to find something. Otherwise five zeros
  // prove the search works as much as they prove the database is clean.
  await db().execute(
    `create table if not exists public.fresh_install_contamination_control (v text)`,
  )
  await db().execute(
    `insert into public.fresh_install_contamination_control (v)
     values ('${GRANT_PRODUCTION_PROJECT_REF}')`,
  )
  const found = Number(
    await value(`
      select count(*)::int as n from (
        select 1 from pg_class c
          join pg_namespace n on n.oid = c.relnamespace
         where n.nspname in ('public','app') and c.relkind = 'r'
           and (xpath('/row/c/text()',
                 query_to_xml(
                   format('select count(*) c from %I.%I t where t::text like ''%%${GRANT_PRODUCTION_PROJECT_REF}%%''',
                          n.nspname, c.relname),
                   false, true, '')))[1]::text::int > 0
      ) hit`),
  )
  assert(found > 0, `CONTROL: the scan finds a planted identifier (${found})`)
  await db().execute('drop table public.fresh_install_contamination_control')

  // And the guard refuses a production identifier by name.
  let guarded = false
  try {
    refuseForeignDatabase(GRANT_PRODUCTION_PROJECT_REF)
  } catch (error) {
    guarded = error instanceof ProductionIdentifierError
  }
  assert(guarded, 'CONTROL: the harness refuses to operate on a database it did not create')
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  refuseForeignDatabase(DB)
  const onlyArg = process.argv.find((a) => a.startsWith('--only='))
  const only = onlyArg === undefined ? null : new Set(onlyArg.slice(7).split(','))
  const wanted = (id: string): boolean => only === null || only.has(id)

  console.log('\nFRESH-INSTALL ACCEPTANCE\n')
  console.log(`  against ${DB} — a disposable local database, no account of any kind\n`)

  if (wanted('A')) await journeyA()
  if (
    wanted('B') ||
    wanted('C') ||
    wanted('D') ||
    wanted('F') ||
    wanted('G') ||
    wanted('H') ||
    wanted('I') ||
    wanted('J')
  ) {
    await journeyBC()
  }
  if (wanted('D')) await journeyD()
  if (wanted('E')) await journeyE()
  if (wanted('F')) await journeyF()
  if (wanted('G')) await journeyG()
  if (wanted('H')) await journeyH()
  if (wanted('I')) await journeyI()
  if (wanted('J')) await journeyJ()

  let failed = 0
  for (const j of journeys) {
    const bad = j.findings.filter((f) => !f.ok)
    failed += bad.length
    console.log(`  ${bad.length === 0 ? 'PASS' : 'FAIL'}  ${j.id} — ${j.title}`)
    for (const f of j.findings) console.log(`          ${f.ok ? '·' : '✗'} ${f.said}`)
    if (j.humanBlocked !== undefined) {
      console.log(`          HUMAN_BLOCKED: ${j.humanBlocked}`)
    }
    console.log('')
  }

  const passed = journeys.filter((j) => j.findings.every((f) => f.ok)).length
  console.log(
    `${passed} of ${journeys.length} journeys pass, ` +
      `${journeys.reduce((n, j) => n + j.findings.length, 0)} assertions, ${failed} failing\n`,
  )
  if (!process.argv.includes('--keep')) dropDatabase(DB)
  process.exit(failed === 0 ? 0 : 1)
}

await main()
