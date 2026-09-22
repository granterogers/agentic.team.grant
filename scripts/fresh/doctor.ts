/**
 * WHAT IS DONE, WHAT IS MISSING, AND THE ONE THING TO DO NEXT.
 *
 *   npm run fresh:doctor
 *
 * Journey A of the fresh-install acceptance: run this with no project-specific
 * variables set at all and it must produce an accurate report of what is
 * missing — not a crash, and not a quiet fall back to somebody else's
 * infrastructure.
 *
 * ## One next action
 *
 * It ends with a single instruction. §14: *"no wall of red integrations; clear
 * required-now vs optional-later; one next action."* A person who is handed
 * eleven things to do does not start; a person handed one does. Optional
 * integrations are not shown as missing at all until core is complete, because
 * a red Slack row on somebody's first minute is a failure that is not theirs.
 *
 * ## It never prints a secret
 *
 * Presence is reported as presence. A value is never echoed, never logged and
 * never written anywhere — including when it is wrong, where the temptation to
 * show what was found is strongest.
 */
import { access } from 'node:fs/promises'
import { ManagementApiExecutor, type SqlExecutor } from '../../src/db/executor.ts'
import { PostgresExecutor } from '../../src/db/postgres-executor.ts'
import { CONTRACT, humanEffort } from '../../src/fresh/contract.ts'
import { GRANT_PRODUCTION_PROJECT_REF, HARNESS_DB_PREFIX } from '../../src/fresh/forbidden.ts'
import { localConnection } from '../../src/fresh/local-db.ts'

type State = 'ok' | 'missing' | 'blocked' | 'unknown'
interface Result {
  readonly state: State
  /** What was established, in words. Never a value. */
  readonly detail: string
}

const ok = (detail: string): Result => ({ state: 'ok', detail })
const missing = (detail: string): Result => ({ state: 'missing', detail })
const unknown = (detail: string): Result => ({ state: 'unknown', detail })

/** Connect to whatever office this environment names, or to nothing. */
async function office(): Promise<{ db: SqlExecutor; where: string } | null> {
  const ref = process.env.SUPABASE_PROJECT_REF
  const token = process.env.SUPABASE_ACCESS_TOKEN
  if (ref !== undefined && ref !== '' && token !== undefined && token !== '') {
    return { db: new ManagementApiExecutor(ref, token), where: `Supabase project ${ref}` }
  }
  const local = process.env.FRESH_DB
  if (local?.startsWith(HARNESS_DB_PREFIX) === true) {
    return {
      db: new PostgresExecutor(localConnection(local)),
      where: `local database ${local}`,
    }
  }
  return null
}

async function one(db: SqlExecutor | null, sql: string): Promise<unknown> {
  if (db === null) return undefined
  const { rows } = await db.execute(sql)
  const row = rows[0] as Record<string, unknown> | undefined
  return row === undefined ? undefined : Object.values(row)[0]
}

const CHECKS: Record<string, (db: SqlExecutor | null) => Promise<Result>> = {
  node: async () => {
    const major = Number(process.versions.node.split('.')[0] ?? 0)
    return major >= 22
      ? ok(`Node ${process.versions.node}`)
      : missing(`Node ${process.versions.node} — this office needs 22 or newer`)
  },
  deps: async () => {
    try {
      await access('node_modules/pg/package.json')
      return ok('installed')
    } catch {
      return missing('node_modules is not there')
    }
  },
  'supabase-project': async (db) => {
    if (db === null) return missing('no project named — nothing to check')
    try {
      const n = await one(db, 'select 1 as n')
      return n === 1 || n === '1'
        ? ok('reachable, and it answered')
        : unknown('it answered something unexpected')
    } catch (error) {
      const m = error instanceof Error ? error.message : String(error)
      return missing(`could not reach it — ${m.split('\n')[0] ?? m}`)
    }
  },
  SUPABASE_PROJECT_REF: async () => {
    const v = process.env.SUPABASE_PROJECT_REF
    if (v === undefined || v === '') return missing('not set')
    if (v === GRANT_PRODUCTION_PROJECT_REF) {
      return {
        state: 'blocked',
        detail:
          'this names the project this repository was developed against, not one of yours. ' +
          'Create your own — the setup document has the steps.',
      }
    }
    return ok('set')
  },
  SUPABASE_ACCESS_TOKEN: async (db) => {
    if (process.env.SUPABASE_ACCESS_TOKEN === undefined || process.env.SUPABASE_ACCESS_TOKEN === '')
      return missing('not set')
    if (db === null) return ok('set (not yet verified — no project to try it against)')
    try {
      await one(db, 'select 1 as n')
      return ok('set, and it works')
    } catch {
      // Never say what the token was. Say what to do.
      return missing(
        'set, but the project refused it. It may be for a different project, or expired. ' +
          'Generate a new one at https://supabase.com/dashboard/account/tokens',
      )
    }
  },
  database: async (db) => {
    if (db === null) return missing('no office to look in')
    try {
      const n = Number(
        await one(
          db,
          `select case when to_regclass('app.schema_migrations') is null then 0
                       else (select count(*)::int from app.schema_migrations) end as n`,
        ),
      )
      if (n === 0) return missing('empty — the office is not installed yet')
      return ok(`installed — ${n} migration(s) recorded`)
    } catch {
      return unknown('could not read the migration ledger')
    }
  },
  'db.project_ref': async (db) => {
    if (db === null) return missing('no office to look in')
    try {
      const v = await one(
        db,
        `select coalesce(nullif(btrim(value #>> '{}'), ''), '') as v
           from public.system_config where key = 'db.project_ref'`,
      )
      return v === undefined || v === ''
        ? missing('the office does not know its own address yet')
        : ok('set')
    } catch {
      return unknown('could not read system_config')
    }
  },
  'openrouter-key': async (db) => {
    if (db === null) return missing('no office to look in')
    try {
      /*
        Ask whether the provider is CONNECTED, not whether a key exists.

        §5 lists "credential presence mistaken for working connection" as a
        thing to hunt for, and this is where it lived: `app.store_secret` writes
        the key to the vault exactly as asked and sets `providers.secret_ref` to
        nothing, so a check that counted vault rows would report the office
        ready to think while every job failed for want of a credential in the
        same database. 0536 gave the office a way to connect the two; this asks
        whether it has been done.
      */
      const stored = Number(
        await one(
          db,
          `select (select count(*)::int from vault.secrets where name = 'openrouter.api_key') as n`,
        ),
      )
      const connected =
        (await one(
          db,
          `select (select secret_ref is not null from public.providers
                    where provider = 'openrouter') as c`,
        )) === true
      if (connected)
        return ok('stored and connected — run npm run fresh:first-use to prove it thinks')
      if (stored > 0)
        return missing('a key is stored but nothing is using it yet — run: npm run fresh:configure')
      return missing('no key stored — the office cannot think yet')
    } catch {
      return unknown('could not read the vault')
    }
  },
  'hq-token': async (db) => {
    if (db === null) return missing('no office to look in')
    try {
      const v = await one(
        db,
        `select (select count(*)::int from vault.secrets where name = 'hq.api_token') as n`,
      )
      return Number(v) > 0 ? ok('generated') : missing('not generated yet')
    } catch {
      return unknown('could not read the vault')
    }
  },
  worker: async () => deployed('worker'),
  'hq-api': async () => deployed('hq-api'),
  'telegram-bot': async (db) => {
    if (db === null) return missing('no office to look in')
    try {
      const v = await one(
        db,
        `select (select count(*)::int from public.telegram_bots
                  where is_pager and enabled and token_ref is not null) as n`,
      )
      return Number(v) > 0 ? ok('registered, with a token') : missing('no Chief of Staff bot yet')
    } catch {
      return unknown('could not read the bot registry')
    }
  },
  'first-use': async (db) => {
    if (db === null) return missing('no office to ask')
    try {
      const v = await one(
        db,
        `select (select count(*)::int from public.outputs o
                   join public.jobs j on j.job_id = o.job_id
                  where not j.is_fixture) as n`,
      )
      return Number(v) > 0
        ? ok('the office has answered at least once')
        : missing('the office has never answered anything')
    } catch {
      return unknown('could not read the office’s outputs')
    }
  },
}

async function deployed(fn: string): Promise<Result> {
  const ref = process.env.SUPABASE_PROJECT_REF
  if (ref === undefined || ref === '') return missing('nothing deployed — no project named')
  try {
    // Functionally, not by presence: ask the deployed thing whether it is there.
    const response = await fetch(`https://${ref}.supabase.co/functions/v1/${fn}`, {
      method: 'GET',
    })
    // Any answer at all means something is deployed at that address. A 401 is a
    // deployed function refusing an unauthenticated caller, which is correct.
    return response.status === 404
      ? missing('not deployed')
      : ok(`deployed (it answered ${response.status})`)
  } catch {
    return unknown('could not reach it')
  }
}

function paint(state: State): string {
  return state === 'ok'
    ? '  ok  '
    : state === 'missing'
      ? ' todo '
      : state === 'blocked'
        ? 'BLOCKED'
        : '  ?   '
}

async function main(): Promise<void> {
  const target = await office()
  console.log('\nYOUR AGENTIC TEAM — SETUP\n')
  console.log(
    target === null
      ? 'No office named yet. Nothing below has been checked against a database.\n'
      : `Office: ${target.where}\n`,
  )

  const results = new Map<string, Result>()
  for (const entry of CONTRACT) {
    const check = CHECKS[entry.id]
    if (check === undefined) {
      results.set(entry.id, unknown('no check written for this yet'))
      continue
    }
    try {
      results.set(entry.id, await check(target?.db ?? null))
    } catch (error) {
      results.set(
        entry.id,
        unknown(`the check itself failed — ${(error as Error).message.split('\n')[0]}`),
      )
    }
  }

  const core = CONTRACT.filter((e) => e.requirement === 'REQUIRED_FOR_CORE')
  const coreDone = core.filter((e) => results.get(e.id)?.state === 'ok').length

  console.log(`REQUIRED — ${coreDone} of ${core.length} done\n`)
  for (const entry of core) {
    const r = results.get(entry.id)
    if (r === undefined) continue
    console.log(`  [${paint(r.state)}]  ${entry.title}`)
    if (r.state !== 'ok') console.log(`            ${r.detail}`)
  }

  const next = core.find((e) => results.get(e.id)?.state !== 'ok')

  if (next === undefined) {
    console.log('\nEverything required is done. Your office works.\n')
    const optional = CONTRACT.filter((e) => e.requirement !== 'REQUIRED_FOR_CORE')
    console.log('OPTIONAL — add any of these whenever you want one:\n')
    for (const entry of optional) {
      const r = results.get(entry.id)
      const mark = r?.state === 'ok' ? 'added' : 'not added'
      console.log(`  ${entry.title} — ${mark}`)
      console.log(`      ${entry.feature ?? entry.why}`)
    }
    console.log('\n  Run: npm run fresh:doctor -- --optional   for the steps for any of them')
    return
  }

  console.log(`\nNEXT: ${next.title}\n`)
  console.log(`  Why: ${next.why}\n`)
  if (next.human !== undefined) {
    console.log(
      `  This one needs you — ${next.human.because}, which no software may do on your behalf.`,
    )
    console.log(`  About ${next.human.minutes} minutes. Cost: ${next.human.cost}\n`)
    for (const [i, step] of next.human.steps.entries()) console.log(`    ${i + 1}. ${step}`)
  } else if (next.automatedBy !== undefined) {
    console.log('  This one is automatic. Run:\n')
    console.log(`    ${next.automatedBy}`)
  }

  const left = core.filter((e) => results.get(e.id)?.state !== 'ok')
  const effort = humanEffort(left)
  console.log(
    `\n  ${left.length} step(s) left in total, of which ${
      left.filter((e) => e.human !== undefined).length
    } need you — about ${effort.minutes} minutes of your time.`,
  )
  console.log('  Run npm run fresh:doctor again at any point to pick up where you left off.\n')
}

await main()
