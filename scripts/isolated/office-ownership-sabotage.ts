/**
 * Mutation proof for the ownership foundation (multi-user P2).
 *
 *   npx tsx scripts/isolated/office-ownership-sabotage.ts p2_attack
 *
 * For each way the structure could be weakened: break it, print something that proves the break LANDED (a sabotage that
 * did not apply is not a passing control), run the attack suite and the two structural checks, require the ones that
 * should go red to go red and say which check fired, restore it, and require everything green again. A suite that stays
 * green over a broken structure is the failure this exists to find.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isolated } from './guard.ts'
import { suite } from './office-ownership-lib.ts'

const target = process.argv[2] ?? 'p2_attack'
if (!/^p2_attack/.test(target)) {
  console.error(`REFUSED: ${target} is not a throwaway clone`)
  process.exit(2)
}
const db = await isolated(target)
const env = { ...process.env, ISOLATED_PG_DB: target }

const gate = (script: string, extra: NodeJS.ProcessEnv = {}): { ok: boolean; first: string } => {
  try {
    execFileSync('npx', ['tsx', script, '--replica'], {
      env: { ...env, ...extra },
      encoding: 'utf8',
      stdio: 'pipe',
    })
    return { ok: true, first: '' }
  } catch (e) {
    const out = String((e as { stdout?: string }).stdout ?? '')
    const line =
      out.split('\n').find((l) => /^ {2}\S/.test(l)) ??
      out.split('\n').find((l) => l.startsWith('FAIL')) ??
      ''
    return { ok: false, first: line.trim().slice(0, 130) }
  }
}

type Sabotage = {
  name: string
  break: string
  prove: string
  restore: string
  /** substrings of suite checks that must FAIL while broken */
  suiteRed: string[]
  /** which structural check must go red */
  gates: ('edges' | 'ownership')[]
  manifest?: (m: { tables: Record<string, Record<string, unknown>> }) => void
}

const sabotages: Sabotage[] = [
  {
    name: 'drop a composite foreign key (jobs_project_same_office)',
    break: 'alter table public.jobs drop constraint jobs_project_same_office',
    prove:
      "select count(*)::int as n from pg_constraint where conname = 'jobs_project_same_office'",
    restore: `alter table public.jobs add constraint jobs_project_same_office foreign key (project_id, office_id) references public.projects (project_id, office_id) not valid;
              alter table public.jobs validate constraint jobs_project_same_office`,
    suiteRed: ["A's job on B's project", "pointing A's job at B's project"],
    gates: ['edges'],
  },
  {
    name: 'remove immutability of office_id on jobs',
    break: 'drop trigger a1_office_write_once on public.jobs',
    prove:
      "select count(*)::int as n from pg_trigger where tgname = 'a1_office_write_once' and tgrelid = 'public.jobs'::regclass",
    restore:
      'create trigger a1_office_write_once before update of office_id on public.jobs for each row execute function app.office_id_is_write_once()',
    suiteRed: ["moving A's job to B"],
    gates: ['edges'],
  },
  {
    name: 'make a derivation nullable (outputs.job_id)',
    break: 'alter table public.outputs alter column job_id drop not null',
    prove:
      "select count(*)::int as n from information_schema.columns where table_name = 'outputs' and column_name = 'job_id' and is_nullable = 'NO'",
    restore: 'alter table public.outputs alter column job_id set not null',
    suiteRed: ['a derived output with no job'],
    gates: ['ownership'],
  },
  {
    name: 'misclassify a table (jobs becomes derived with no path)',
    break: 'select 1',
    prove: 'select 1 as n',
    restore: 'select 1',
    suiteRed: [],
    gates: ['ownership'],
    manifest: (m) => {
      m.tables.jobs = { class: 'OFFICE_DERIVED' }
    },
  },
  {
    name: 'misclassify a table (tasks becomes GLOBAL)',
    break: 'select 1',
    prove: 'select 1 as n',
    restore: 'select 1',
    suiteRed: [],
    gates: ['ownership'],
    manifest: (m) => {
      m.tables.tasks = {
        class: 'GLOBAL',
        why: 'sabotage: pretend tasks are a shared catalogue every office reads',
      }
    },
  },
  {
    name: 'remove the system/person distinction (a system office may have a login)',
    break: 'alter table public.offices drop constraint offices_system_has_no_login',
    prove:
      "select count(*)::int as n from pg_constraint where conname = 'offices_system_has_no_login'",
    restore:
      "alter table public.offices add constraint offices_system_has_no_login check (kind <> 'system' or auth_user_id is null)",
    suiteRed: ['a system office with a login is refused'],
    gates: [],
  },
  {
    name: 'remove the identity trigger on offices (a login can be attached to the system office)',
    break: 'drop trigger offices_identity_is_immutable on public.offices',
    prove:
      "select count(*)::int as n from pg_trigger where tgname = 'offices_identity_is_immutable'",
    restore:
      'create trigger offices_identity_is_immutable before update on public.offices for each row execute function app.offices_identity_is_immutable()',
    suiteRed: [
      'the system office cannot be given a login afterwards',
      "an office's kind cannot be changed",
    ],
    gates: [],
  },
  {
    name: 'remove the derived-edge guard on job_impediments',
    break: 'drop trigger a2_office_edges on public.job_impediments',
    prove:
      "select count(*)::int as n from pg_trigger where tgname = 'a2_office_edges' and tgrelid = 'public.job_impediments'::regclass",
    restore:
      'create trigger a2_office_edges before insert or update of job_id, project_id on public.job_impediments for each row execute function app.p2_edge_job_impediments()',
    suiteRed: ["a derived impediment on A's job naming B's project"],
    gates: ['edges'],
  },
  {
    name: 'remove the relations endpoint guard',
    break: 'drop trigger a3_relation_endpoints on public.relations',
    prove: "select count(*)::int as n from pg_trigger where tgname = 'a3_relation_endpoints'",
    restore:
      'create trigger a3_relation_endpoints before insert or update of project_id, from_kind, from_id, to_kind, to_id on public.relations for each row execute function app.relations_stay_in_one_office()',
    suiteRed: [
      "a relation in A pointing at B's task",
      "a relation in A starting from B's document",
      'a relation to an endpoint that does not exist',
    ],
    gates: ['edges'],
  },
  {
    name: 'put a global unique key back on projects.slug (an existence oracle)',
    break: 'alter table public.projects add constraint sabotage_global_slug unique (slug)',
    prove: "select count(*)::int as n from pg_constraint where conname = 'sabotage_global_slug'",
    restore: 'alter table public.projects drop constraint sabotage_global_slug',
    suiteRed: ['B can take a slug A already holds', 'two offices use the same project slug'],
    gates: ['edges'],
  },
  {
    name: 'remove the declared-test-chat rule (test chats would bind to the one person again)',
    break: 'drop trigger a00_declared_test_origin on public.telegram_chats',
    prove: "select count(*)::int as n from pg_trigger where tgname = 'a00_declared_test_origin'",
    restore:
      'create trigger a00_declared_test_origin before insert on public.telegram_chats for each row execute function app.telegram_chat_origin()',
    suiteRed: ["a chat the harness declared a test origin is the TEST office's"],
    gates: [],
  },
  {
    name: 'let a writer that names no office default to the test office again',
    break:
      "alter table public.jobs alter column office_id set default '00000000-0000-0000-0000-000000000000'::uuid",
    prove:
      "select count(*)::int as n from pg_attrdef d join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum where d.adrelid = 'public.jobs'::regclass and a.attname = 'office_id'",
    restore: 'alter table public.jobs alter column office_id drop default',
    suiteRed: ['a harness-named writer with no office is refused'],
    gates: [],
  },
]

let failed = 0
const say = (ok: boolean, what: string, detail: string) => {
  if (!ok) failed += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what} - ${detail}`)
}

const base = await suite(db)
const baseFail = base.filter((r) => !r.ok)
say(
  baseFail.length === 0,
  'before any sabotage the suite is green',
  `${base.length - baseFail.length}/${base.length}`,
)
const g0e = gate('scripts/check-office-edges.ts')
const g0o = gate('scripts/check-ownership.ts')
say(
  g0e.ok && g0o.ok,
  'before any sabotage both structural checks are green',
  `edges=${String(g0e.ok)} ownership=${String(g0o.ok)}`,
)

const manifestPath = new URL('../../docs/multi-user/ownership-manifest.json', import.meta.url)
for (const s of sabotages) {
  console.log(`\n--- ${s.name}`)
  let manifestFile = ''
  if (s.manifest !== undefined) {
    const m = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      tables: Record<string, Record<string, unknown>>
    }
    s.manifest(m)
    manifestFile = join(mkdtempSync(join(tmpdir(), 'own-')), 'manifest.json')
    writeFileSync(manifestFile, JSON.stringify(m))
  }
  const before = ((await db.execute(s.prove)).rows[0] as { n: number }).n
  await db.execute(s.break)
  const after = ((await db.execute(s.prove)).rows[0] as { n: number }).n
  say(
    s.manifest !== undefined || before !== after,
    'the sabotage landed',
    `${s.prove.slice(0, 60)}: ${String(before)} -> ${String(after)}`,
  )

  const red = (await suite(db)).filter((r) => !r.ok)
  for (const needle of s.suiteRed)
    say(
      red.some((r) => r.what.includes(needle)),
      `the suite went red on "${needle}"`,
      red.find((r) => r.what.includes(needle))?.detail.slice(0, 90) ?? 'STAYED GREEN',
    )
  const unexpected = red.filter((r) => !s.suiteRed.some((n) => r.what.includes(n)))
  say(
    unexpected.length === 0,
    'nothing else went red (the sabotage is the cause)',
    unexpected
      .map((r) => r.what)
      .join(' | ')
      .slice(0, 160) || 'none',
  )
  for (const gname of s.gates) {
    const r =
      gname === 'edges'
        ? gate('scripts/check-office-edges.ts')
        : gate(
            'scripts/check-ownership.ts',
            manifestFile === '' ? {} : { OWNERSHIP_MANIFEST: manifestFile },
          )
    say(
      !r.ok,
      `check:${gname === 'edges' ? 'office-edges' : 'ownership'} went red`,
      r.ok ? 'STAYED GREEN' : r.first,
    )
  }

  await db.execute(s.restore)
  const back = (await suite(db)).filter((r) => !r.ok)
  say(
    back.length === 0,
    'restored: the suite is green again',
    back
      .map((r) => r.what)
      .join(' | ')
      .slice(0, 160) || 'green',
  )
  const e = gate('scripts/check-office-edges.ts')
  const o = gate('scripts/check-ownership.ts')
  say(
    e.ok && o.ok,
    'restored: both structural checks are green again',
    `edges=${String(e.ok)} ownership=${String(o.ok)} ${e.first}${o.first}`,
  )
}
await db.end()
console.log(
  `\n${failed === 0 ? 'all sabotage controls behaved' : `${String(failed)} control(s) misbehaved`}`,
)
process.exitCode = failed === 0 ? 0 : 1
