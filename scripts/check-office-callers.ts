/**
 * Every call to an office-explicit function passes an office (multi-user P3).
 *
 * tsc cannot see inside a SQL string, so a caller written as `select app.my_tasks('all', ...)` compiles and then fails
 * (or, worse, resolves to another overload) at run time. This reads the repository for calls to every function whose
 * first argument is `p_office uuid` and requires the first argument at the call site to name one: `p_office =>`,
 * `app.job_office(...)`, or an expression that visibly mentions an office.
 *
 *   npm run check:office-callers                    # against production (read only)
 *   P3_DB=p3_attack npx tsx scripts/check-office-callers.ts
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { ManagementApiExecutor, type SqlExecutor } from '../src/db/executor.ts'
import { PgExecutor } from '../src/db/pg-executor.ts'

const ROOTS = ['src', 'supabase', 'scripts', 'tests']
const OK_FIRST =
  /^(office_id\b|app\.operator_office\s*\(|o\.office_id|p_office\s*(=>|:=)|null::uuid|uuid\b.*|app\.test_office\s*\(|app\.sole_person_office\s*\(|app\.job_office\s*\(|app\.require_office\s*\(|.*\boffice\b.*|.*\bOFFICE\b.*|[A-Za-z_.]*\.office\b|\$\{[^}]*(office|Office|OFFICE)[^}]*\}|'?\$\{)/

export type Call = { file: string; line: number; fn: string; first: string }

const firstArgument = (text: string, from: number): string => {
  let depth = 0
  let i = from
  let quote = ''
  for (; i < text.length; i += 1) {
    const ch = text[i] as string
    if (quote !== '') {
      if (ch === quote) quote = ''
      continue
    }
    if (ch === "'" || ch === '"') quote = ch
    else if (ch === '(' || ch === '[' || ch === '{') depth += 1
    else if (ch === ')' || ch === ']' || ch === '}') {
      if (depth === 0) break
      depth -= 1
    } else if (ch === ',' && depth === 0) break
  }
  return text.slice(from, i).replace(/\s+/g, ' ').trim()
}

export const calls = (names: readonly string[]): Call[] => {
  if (names.length === 0) return []
  const alt = names.join('|')
  let files = ''
  try {
    files = execFileSync(
      'grep',
      [
        '-rlE',
        `(app|public)\\.(${alt})[[:space:]]*\\(`,
        ...ROOTS,
        '--include=*.ts',
        '--include=*.sql',
      ],
      { encoding: 'utf8' },
    )
  } catch {
    return []
  }
  const out: Call[] = []
  const re = new RegExp(`\\b(?:app|public)\\.(${alt})\\s*\\(`, 'g')
  for (const file of files.split('\n').filter(Boolean)) {
    // Migrations are history: they define and drop these functions and are not callers.
    if (file.startsWith('migrations/')) continue
    const text = readFileSync(file, 'utf8')
    for (const m of text.matchAll(re)) {
      const at = m.index ?? 0
      // A definition or a comment mention is not a call.
      const lineStart = text.lastIndexOf('\n', at) + 1
      const prefix = text.slice(lineStart, at)
      if (
        /^\s*(\*|\/\/|--|\/\*)/.test(prefix) ||
        /\b(create|drop)\s+(or replace\s+)?function\s*$/i.test(prefix)
      )
        continue
      out.push({
        file,
        line: text.slice(0, at).split('\n').length,
        fn: m[1] as string,
        first: firstArgument(text, at + m[0].length),
      })
    }
  }
  return out
}

export const offenders = (list: Call[], zeroArgBad: ReadonlySet<string> = new Set()): Call[] =>
  list.filter((c) => (c.first === '' ? zeroArgBad.has(c.fn) : !OK_FIRST.test(c.first)))

/**
 * Rewrite a suite's call so it names an office. For harness code only (scripts/, tests/): a suite that does not care
 * which office it works in works in the TEST office, which is where harness traffic belongs. Production code in src/
 * is never rewritten blind - it must say which office, from the claimed job.
 */
export const fixSuites = (list: Call[], expr = 'app.test_office()'): number => {
  const byFile = new Map<string, Call[]>()
  for (const c of list)
    if (!c.file.startsWith('src/') && !c.file.startsWith('supabase/'))
      byFile.set(c.file, [...(byFile.get(c.file) ?? []), c])
  let n = 0
  for (const [file, cs] of byFile) {
    let text = readFileSync(file, 'utf8')
    const re = new RegExp(
      `\\b((?:app|public)\\.(?:${[...new Set(cs.map((c) => c.fn))].join('|')}))\\s*\\(`,
      'g',
    )
    text = text.replace(re, (whole, head: string, offset: number) => {
      const first = firstArgument(text, offset + whole.length)
      if (first === '' || OK_FIRST.test(first)) return whole
      n += 1
      return /^p_[a-z_0-9]+\s*(=>|:=)/.test(first)
        ? `${head}(p_office => ${expr}, `
        : `${head}(${expr}, `
    })
    writeFileSync(file, text)
  }
  return n
}

if (process.argv[1]?.endsWith('check-office-callers.ts')) {
  const local = process.env.P3_DB
  let db: SqlExecutor
  if (local !== undefined) {
    const pg = new PgExecutor(`postgresql://postgres@/${local}?host=/tmp/pgs&port=55432`)
    await pg.connect()
    db = pg
  } else
    db = new ManagementApiExecutor(
      process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
      process.env.SUPABASE_ACCESS_TOKEN ?? '',
    )
  const found = (
    await db.execute(
      `select p.proname,
              bool_or(p.pronargs = 0) over (partition by p.proname) as has_zero_arg
         from pg_proc p
        where p.pronamespace in ('app'::regnamespace,'public'::regnamespace)
          and pg_get_function_arguments(p.oid) like 'p_office uuid%'`,
    )
  ).rows as { proname: string; has_zero_arg: boolean }[]
  const names = [...new Set(found.map((r) => r.proname))]
  // A call with NO arguments to a name that has no zero-argument form cannot be passing an office (the old
  // `app.hq_studio()` shape): it compiles and fails on first use.
  const needsOffice = new Set(
    (
      await db.execute(
        `select distinct p.proname from pg_proc p
          where p.pronamespace in ('app'::regnamespace,'public'::regnamespace)
            and not exists (select 1 from pg_proc q where q.pronamespace in ('app'::regnamespace,'public'::regnamespace)
                             and q.proname = p.proname and q.pronargs = 0)
            and pg_get_function_arguments(p.oid) like 'p_office uuid%'`,
      )
    ).rows.map((r) => String((r as { proname: string }).proname)),
  )
  let all = calls(names)
  let bad = offenders(all, needsOffice)
  // The database calls itself too, and tsc and grep cannot see inside a plpgsql body. A function that still calls a
  // converted function without an office is a defect that only shows on first use (a plpgsql body is parsed, not run).
  const bodies = (
    await db.execute(`
      select n.nspname || '.' || p.proname as fn,
             regexp_replace(regexp_replace(coalesce(p.prosrc, ''), '/[*].*?[*]/', ' ', 'gs'), '--[^' || chr(10) || ']*', ' ', 'g') as body
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname in ('app', 'public') and p.prokind = 'f'`)
  ).rows as { fn: string; body: string }[]
  const dbBad: string[] = []
  if (names.length > 0) {
    const reDb = new RegExp(`\\b(?:app|public)\\.(${names.join('|')})\\s*\\(`, 'g')
    for (const f of bodies) {
      const callerName = f.fn.split('.')[1] as string
      for (const m of f.body.matchAll(reDb)) {
        if (m[1] === callerName) continue
        const first = firstArgument(f.body, (m.index ?? 0) + m[0].length)
        if (
          (first !== '' || needsOffice.has(m[1] as string)) &&
          !OK_FIRST.test(first) &&
          !/^v_office|^c\.office_id|^new\.office_id|^b\.office_id|^p_office|^t\.office_id|^r\.office_id|^d\.office_id|^v_parent\.office_id/.test(
            first,
          )
        )
          dbBad.push(`${f.fn} calls ${m[1] as string}(${first.slice(0, 40)}`)
      }
    }
  }
  if (process.argv.includes('--fix-suites')) {
    console.log(`rewrote ${String(fixSuites(bad))} suite call site(s) to work in the test office`)
    all = calls(names)
    bad = offenders(all, needsOffice)
  }
  console.log(
    `${String(names.length)} office-explicit functions, ${String(all.length)} call sites, ${String(bad.length)} without an office, ${String(dbBad.length)} database calls without one`,
  )
  for (const b of bad)
    console.error(`FAIL ${b.file}:${String(b.line)} ${b.fn}(${b.first.slice(0, 50)}`)
  for (const b of dbBad) console.error(`FAIL (database) ${b}`)
  if (bad.length > 0 || dbBad.length > 0) process.exitCode = 1
  else console.log('check:office-callers OK')
  if (db instanceof PgExecutor) await db.end()
}
