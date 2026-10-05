/**
 * The staging worker's start-up posture: hold the timed duties until each one is deliberately allowed.
 *
 *   npm run staging:posture -- status
 *   npm run staging:posture -- hold              # BEFORE the first worker deploy: nothing timed fires
 *   npm run staging:posture -- allow drive-index,calendar-event-sync
 *   npm run staging:posture -- release           # lift the hold entirely (not for a first staging run)
 *
 * Refuses unless the staging preflight passes first. Writes system_config duties.paused / duties.allow in the project
 * named by SUPABASE_PROJECT_REF, which app.due_responsibilities honours (migration 1020). Jobs a person asks for are not held.
 * Needs ALLOW_PRODUCTION_CHECKS=1 and ALLOW_PRODUCTION_WRITES=1: the guard cannot tell staging from production, so the
 * preflight (not the flags) is what says this is staging.
 */
import '../../src/safety/require-production-writes.ts'
import { existsSync, readFileSync } from 'node:fs'
import { ManagementApiExecutor } from '../../src/db/executor.ts'
import {
  BUILTIN_DENYLIST,
  type Denylist,
  evaluate,
  mergeDenylists,
} from '../../src/staging/preflight.ts'

const [verb = 'status', list = ''] = process.argv.slice(2)
const file = process.env.STAGING_DENYLIST_FILE ?? '.staging/production-identifiers.json'
const found = existsSync(file)
const local = found ? (JSON.parse(readFileSync(file, 'utf8')) as Partial<Denylist>) : {}
const report = evaluate(process.env, mergeDenylists(BUILTIN_DENYLIST, local), {
  denylistFileFound: found,
})
if (!report.ok) {
  for (const c of report.checks.filter((x) => !x.ok)) console.error(`FAIL ${c.id}: ${c.detail}`)
  console.error('\nREFUSED: the staging preflight did not pass, so nothing was changed.')
  process.exit(1)
}
const token = process.env.SUPABASE_ACCESS_TOKEN ?? ''
if (token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required (it is never printed).')
  process.exit(2)
}
const db = new ManagementApiExecutor(process.env.SUPABASE_PROJECT_REF ?? '', token)
if (verb !== 'status') {
  const has = (
    await db.execute("select to_regprocedure('app.duty_allowed(text)') is not null as ok")
  ).rows[0] as { ok?: boolean } | undefined
  if (has?.ok !== true) {
    console.error(
      'REFUSED: this database does not have migration 1020 (app.duty_allowed), so holding duties would change nothing. Apply the migrations first.',
    )
    process.exit(1)
  }
}
const put = (k: string, v: string): Promise<unknown> =>
  db.execute(
    `insert into public.system_config (key, value, description, updated_by) values ('${k}', '${v}'::jsonb, 'staging posture: timed duties held until allowed', 'staging-posture')
     on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = 'staging-posture'`,
  )
if (verb === 'hold') {
  await put('duties.paused', 'true')
  await put('duties.allow', '[]')
  console.log('Timed duties are HELD. Nothing timed will fire until a duty is allowed.')
} else if (verb === 'allow') {
  const slugs = list
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(s))
  if (slugs.length === 0) {
    console.error(
      'Name the duties to allow, comma separated (for example: drive-index,calendar-event-sync).',
    )
    process.exit(2)
  }
  await put('duties.paused', 'true')
  await put('duties.allow', JSON.stringify(slugs))
  console.log(`Held, with these duties allowed: ${slugs.join(', ')}`)
} else if (verb === 'release') {
  await db.execute(
    "delete from public.system_config where key in ('duties.paused', 'duties.allow')",
  )
  console.log('The hold is lifted: every enabled duty runs on its schedule.')
}
const { rows } = await db.execute(
  "select key, value::text as v from public.system_config where key in ('duties.paused', 'duties.allow') order by key",
)
console.log(
  (rows as { key: string; v: string }[]).map((r) => `${r.key} = ${r.v}`).join('\n') ||
    'no hold set: every enabled duty runs on its schedule.',
)
