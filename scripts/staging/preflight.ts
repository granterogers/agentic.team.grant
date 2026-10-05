/**
 * Is this environment staging, and ONLY staging?  (Staging safety preflight, 5 October 2026.)
 *
 *   TARGET_ENVIRONMENT=staging SUPABASE_PROJECT_REF=<ref> STAGING_EXPECT_REF=<ref> ... npm run staging:preflight
 *   npm run staging:preflight -- --live      # also: are the timed duties held, so a worker may be deployed? (needs ALLOW_PRODUCTION_CHECKS=1)
 *   npm run staging:preflight -- --template  # print the variables it wants, with no values
 *
 * Offline by default: it reads the environment and a local, git-ignored list of production identifiers
 * (.staging/production-identifiers.json, or STAGING_DENYLIST_FILE) and contacts nothing. It exits 1 on ANY failed
 * check and prints which, naming variables and never printing a secret. See docs/staging-handoff-plan.md.
 */
import '../../src/safety/require-production-when-live.ts'
import { existsSync, readFileSync } from 'node:fs'
import {
  BUILTIN_DENYLIST,
  type Check,
  type Denylist,
  evaluate,
  mergeDenylists,
  shownValue,
  workerMayBeDeployed,
} from '../../src/staging/preflight.ts'

const WANTED = [
  'TARGET_ENVIRONMENT=staging',
  'SUPABASE_PROJECT_REF=<staging ref>',
  'STAGING_EXPECT_REF=<the same ref, typed again>',
  'STAGING_GATEWAY_URL=https://<ref>.supabase.co/functions/v1/hq-api',
  'STAGING_WORKER_URL=https://<ref>.supabase.co/functions/v1/worker',
  'STAGING_STORAGE_URL=https://<ref>.supabase.co/storage/v1/',
  'STAGING_SITE_URL=https://<the preview deployment>',
  'VERCEL_ENV=preview',
  'STAGING_GOOGLE_CLIENT_ID=<staging OAuth client id | unused>',
  'STAGING_TELEGRAM_BOT=<staging bot username | unused>',
  'STAGING_SLACK_TEAM=<staging workspace id | unused>',
  'STAGING_VIKUNJA_URL=<staging Vikunja address | unused>',
  'SUPABASE_DB_URL=<optional; must name the staging project>',
  'STAGING_DENYLIST_FILE=<optional path; default .staging/production-identifiers.json>',
]

if (process.argv.includes('--template')) {
  console.log(WANTED.join('\n'))
  process.exit(0)
}

const file = process.env.STAGING_DENYLIST_FILE ?? '.staging/production-identifiers.json'
let local: Partial<Denylist> = {}
const found = existsSync(file)
if (found) {
  try {
    local = JSON.parse(readFileSync(file, 'utf8')) as Partial<Denylist>
  } catch {
    console.error(
      `REFUSED: ${file} exists but is not valid JSON, so the production identifiers are unknown.`,
    )
    process.exit(1)
  }
}
const deny = mergeDenylists(BUILTIN_DENYLIST, local)
const report = evaluate(process.env, deny, { denylistFileFound: found })
const checks: Check[] = [...report.checks]

if (process.argv.includes('--live')) {
  // The one contact this command can make, and only when asked: read two config rows from the STAGING project.
  const { ManagementApiExecutor } = await import('../../src/db/executor.ts')
  const token = process.env.SUPABASE_ACCESS_TOKEN
  const ref = process.env.SUPABASE_PROJECT_REF ?? ''
  if (!report.ok || token === undefined || token === '' || ref === '') {
    checks.push({
      id: 'worker.duties-held',
      ok: false,
      detail: report.ok
        ? 'SUPABASE_ACCESS_TOKEN is unset, so the duty posture cannot be read'
        : 'not read: the offline checks failed, so nothing was contacted',
    })
  } else {
    const db = new ManagementApiExecutor(ref, token)
    const { rows } = await db.execute(
      "select key, value::text as v from public.system_config where key in ('duties.paused', 'duties.allow')",
    )
    const has = (
      await db.execute("select to_regprocedure('app.duty_allowed(text)') is not null as ok")
    ).rows[0] as { ok?: boolean } | undefined
    const byKey = new Map((rows as { key: string; v: string }[]).map((r) => [r.key, r.v]))
    const allow = (() => {
      try {
        const a = JSON.parse(byKey.get('duties.allow') ?? '[]') as unknown
        return Array.isArray(a) ? a.map(String) : []
      } catch {
        return []
      }
    })()
    checks.push(
      workerMayBeDeployed({
        paused: byKey.get('duties.paused') === 'true',
        allow,
        honoured: has?.ok === true,
      }),
    )
  }
}

for (const c of checks) console.log(`${c.ok ? 'ok  ' : 'FAIL'} ${c.id}: ${c.detail}`)
const shown = ['TARGET_ENVIRONMENT', 'SUPABASE_PROJECT_REF', 'STAGING_SITE_URL', 'VERCEL_ENV']
console.log(`\ntarget: ${shown.map((n) => `${n}=${shownValue(n, process.env[n])}`).join('  ')}`)
const ok = checks.every((c) => c.ok)
console.log(
  ok
    ? '\nSTAGING PREFLIGHT PASSED'
    : '\nSTAGING PREFLIGHT FAILED: do not deploy, migrate or connect anything.',
)
process.exitCode = ok ? 0 : 1
