/**
 * A database function that calls another by a shape that no longer exists (multi-user P3).
 *
 * A plpgsql body is parsed, not run, and a SQL-language body is not tracked as a dependency, so dropping an overload (as the
 * office conversion does, on purpose, to close the office-less door) leaves every caller that still names the old argument
 * list compiled and broken until the day it is used. This reads every function body in `app` and `public`, finds each
 * schema-qualified call, counts its arguments the way the call is written (positional and `name => value`), and requires that
 * SOME overload of that name accepts them: right number of positionals (defaults honoured), and every named argument is a
 * parameter of that overload.
 *
 *   P3_DB=p3_attack_m npx tsx scripts/p3/check-arity.ts          # against a clone
 *   npx tsx scripts/p3/check-arity.ts                            # against production (read only)
 */

import { ManagementApiExecutor, type SqlExecutor } from '../../src/db/executor.ts'
import { PgExecutor } from '../../src/db/pg-executor.ts'

type Sig = { schema: string; name: string; args: string[]; required: number; variadic: boolean }

/** Remove comments and the CONTENT of string literals (dollar-quoted bodies of nested functions are left alone). */
const clean = (src: string): string => {
  let out = ''
  let i = 0
  while (i < src.length) {
    const two = src.slice(i, i + 2)
    if (two === '--') {
      while (i < src.length && src[i] !== '\n') i += 1
    } else if (two === '/*') {
      let depth = 1
      i += 2
      while (i < src.length && depth > 0) {
        if (src.slice(i, i + 2) === '/*') {
          depth += 1
          i += 2
        } else if (src.slice(i, i + 2) === '*/') {
          depth -= 1
          i += 2
        } else i += 1
      }
      out += ' '
    } else if (src[i] === "'") {
      i += 1
      while (i < src.length) {
        if (src[i] === "'" && src[i + 1] === "'") i += 2
        else if (src[i] === "'") break
        else i += 1
      }
      i += 1
      out += "''"
    } else {
      out += src[i]
      i += 1
    }
  }
  return out
}

/** The arguments of the call whose opening bracket is at `open`, split at depth zero. */
const argsAt = (text: string, open: number): string[] => {
  const out: string[] = []
  let depth = 0
  let from = open + 1
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i] as string
    if (ch === '(' || ch === '[' || ch === '{') depth += 1
    else if (ch === ')' || ch === ']' || ch === '}') {
      depth -= 1
      if (depth === 0) {
        const last = text.slice(from, i).trim()
        if (last !== '' || out.length > 0) out.push(last)
        return out
      }
    } else if (ch === ',' && depth === 1) {
      out.push(text.slice(from, i).trim())
      from = i + 1
    }
  }
  return out
}

export const checkArity = async (db: SqlExecutor): Promise<string[]> => {
  const sigs = (
    await db.execute(`
      select n.nspname as schema, p.proname as name, p.pronargs, p.pronargdefaults,
             p.provariadic <> 0 as variadic,
             coalesce(array_to_string(p.proargnames, ','), '') as names
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname in ('app', 'public') and p.prokind in ('f', 'p')`)
  ).rows as {
    schema: string
    name: string
    pronargs: number
    pronargdefaults: number
    variadic: boolean
    names: string
  }[]
  const by = new Map<string, Sig[]>()
  for (const s of sigs) {
    const key = `${s.schema}.${s.name}`
    const args = s.names === '' ? [] : s.names.split(',').slice(0, Number(s.pronargs))
    by.set(key, [
      ...(by.get(key) ?? []),
      {
        schema: s.schema,
        name: s.name,
        args,
        required: Number(s.pronargs) - Number(s.pronargdefaults),
        variadic: s.variadic,
      },
    ])
  }
  const bodies = (
    await db.execute(`
      select n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as fn, p.prosrc as body
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname in ('app', 'public') and p.prokind = 'f'
         and p.prolang in (select oid from pg_language where lanname in ('plpgsql', 'sql'))`)
  ).rows as { fn: string; body: string }[]

  const problems = new Set<string>()
  const re = /\b(app|public)\.([a-z_][a-z0-9_]*)\s*\(/g
  for (const f of bodies) {
    const text = clean(f.body)
    for (const m of text.matchAll(re)) {
      const key = `${m[1]}.${m[2]}`
      const options = by.get(key)
      if (options === undefined) continue // a table, a view or a name this check does not model: not its question
      // `create function app.x(...)` inside a body, or the function's own recursive call, is not a caller
      if (
        /create\s+(or\s+replace\s+)?function\s*$/i.test(
          text.slice(Math.max(0, (m.index ?? 0) - 40), m.index ?? 0),
        )
      )
        continue
      const open = (m.index ?? 0) + m[0].length - 1
      const given = argsAt(text, open)
      const named = given
        .filter((a) => /^[a-z_][a-z0-9_]*\s*=>/.test(a))
        .map((a) => a.split('=>')[0]?.trim() as string)
      const positional = given.length - named.length
      const ok = options.some(
        (o) =>
          (o.variadic || (given.length >= o.required && given.length <= o.args.length)) &&
          positional <= o.args.length &&
          named.every((n) => o.args.includes(n)),
      )
      // A count can fit and the MEANING still shift: `impediments_tally(p_days, p_min, false)` fits the office-first
      // `(p_office, p_days, p_min, p_include_fixtures)` by arity, and passes the number of days as the office. When every
      // overload of the name is office-first, the first positional argument must not be a number or another parameter.
      const officeOnly = options.every((o) => o.args[0] === 'p_office')
      const first = given.find((a) => !/^[a-z_][a-z0-9_]*\s*=>/.test(a)) ?? ''
      const shifted =
        officeOnly &&
        named.includes('p_office') === false &&
        (/^\d+$/.test(first) || (/^p_[a-z_]+$/.test(first) && first !== 'p_office'))
      if (shifted)
        problems.add(
          `${f.fn.split('(')[0]} calls ${key}(${first}, ...) - every overload takes the office first, and this passes ${first}`.slice(
            0,
            300,
          ),
        )
      if (!ok)
        problems.add(
          `${f.fn.split('(')[0]} calls ${key}(${given.length} argument(s)${named.length > 0 ? `, named ${named.join(',')}` : ''}) - no overload accepts that (has: ${options.map((o) => `(${o.args.join(',')})`).join(' | ')})`.slice(
            0,
            300,
          ),
        )
    }
  }
  return [...problems].sort()
}

if (process.argv[1]?.endsWith('check-arity.ts')) {
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
  const problems = await checkArity(db)
  console.log(
    `function bodies checked for a call by a shape that no longer exists: ${String(problems.length)} problem(s)`,
  )
  for (const p of problems) console.error(`FAIL ${p}`)
  if (problems.length > 0) process.exitCode = 1
  else console.log('check:arity OK')
  if (db instanceof PgExecutor) await db.end()
}
