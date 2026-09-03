/**
 * Demonstrate that Slack credentials are stored as encrypted-secret references
 * and never as values.
 *
 *   npm run verify:credentials
 *
 * §15 requires per-app credentials in Postgres rather than a flat environment
 * variable, and §6 requires the ledger and stores to hold "secret references
 * only". The claim worth proving is the strong one: not that we remembered to
 * store a reference, but that storing a value is *impossible*.
 */

import type { SqlExecutor } from '../../src/db/executor.ts'
import { ManagementApiExecutor, SqlExecutionError } from '../../src/db/executor.ts'

const token = process.env.SUPABASE_ACCESS_TOKEN
if (token === undefined || token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is not set')
  process.exit(2)
}
const db: SqlExecutor = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  token,
)

const run = Date.now().toString(36)
const checks: { what: string; outcome: string; passed: boolean }[] = []
const one = async (sql: string): Promise<Record<string, unknown>> =>
  (await db.execute(sql)).rows[0] ?? {}

async function succeeds(what: string, sql: string): Promise<void> {
  try {
    await db.execute(sql)
    checks.push({ what, outcome: 'succeeded, as required', passed: true })
  } catch (error) {
    checks.push({
      what,
      outcome: `FAILED: ${(error as Error).message.slice(0, 100)}`,
      passed: false,
    })
  }
}

async function failsWith(
  what: string,
  sql: string,
  sqlstate: string,
  phrase: string,
): Promise<void> {
  try {
    await db.execute(sql)
    checks.push({ what, outcome: 'SUCCEEDED — it must not have', passed: false })
  } catch (error) {
    const message = error instanceof SqlExecutionError ? error.message : String(error)
    const first = (message.split('\n')[0] ?? '').replace(/^Failed to run sql query: ERROR:\s*/, '')
    const ok = message.includes(sqlstate) && message.toLowerCase().includes(phrase.toLowerCase())
    checks.push({
      what,
      outcome: ok
        ? `refused with ${sqlstate}: ${first.slice(0, 100)}`
        : `wrong failure: ${first.slice(0, 100)}`,
      passed: ok,
    })
  }
}

// A fabricated token shape, named so the allow-shape marker can sit directly
// above the literal. The exemption deliberately covers only its own line and
// the next, so a marker several lines up does not reach — and a marker that
// blanketed a region would be a marker that eventually hides something real.
// secret-scan:allow-shape
const FABRICATED_SLACK_TOKEN = 'xoxb-a-real-looking-token'

const secretName = `probe_bot_token_${run}`
const plaintext = `xoxb-fake-${run}-not-a-real-token`

// --- the reference lifecycle ----------------------------------------------
const ref = String(
  (
    await one(
      `select app.store_secret('${secretName}', '${plaintext}', 'verification probe')::text as r`,
    )
  ).r,
)
checks.push({
  what: 'store_secret returns a uuid reference, not a value',
  outcome: `ref = ${ref.slice(0, 8)}…`,
  passed: /^[0-9a-f-]{36}$/.test(ref),
})

const stored = await one(`
  select secret <> '${plaintext}' as is_ciphertext, length(secret) as len
  from vault.secrets where id = '${ref}'
`)
checks.push({
  what: 'the vault stores ciphertext, not the plaintext',
  outcome: `differs=${String(stored.is_ciphertext)} stored_len=${String(stored.len)} vs plaintext_len=${plaintext.length}`,
  passed: stored.is_ciphertext === true,
})

const resolved = await one(
  `select app.resolve_secret('${ref}'::app.vault_secret_ref) = '${plaintext}' as round_trips`,
)
checks.push({
  what: 'resolve_secret returns the original plaintext',
  outcome: `round_trips=${String(resolved.round_trips)}`,
  passed: resolved.round_trips === true,
})

// Rotation must reuse the reference, or every row pointing at it would need a
// write on each of two daily rotations.
const rotated = String(
  (
    await one(
      `select app.store_secret('${secretName}', 'xoxb-rotated-${run}', 'rotated')::text as r`,
    )
  ).r,
)
const afterRotation = await one(
  `select app.resolve_secret('${ref}'::app.vault_secret_ref) = 'xoxb-rotated-${run}' as updated`,
)
checks.push({
  what: 'rotation reuses the same reference and updates the value behind it',
  outcome: `same_ref=${String(rotated === ref)} new_value_visible=${String(afterRotation.updated)}`,
  passed: rotated === ref && afterRotation.updated === true,
})

await failsWith(
  'storing an empty secret is refused',
  `select app.store_secret('probe_empty_${run}', '', 'nothing')`,
  '22023',
  'refusing to store an empty secret',
)

// --- the table cannot hold a value ----------------------------------------
await failsWith(
  'a Slack token cannot be written into a credential column at all',
  // A `//` comment cannot go inside the SQL below — it is a syntax error there,
  // and a bulk marker script put one in, which made this check fail with
  // `42601 syntax error at or near "//"` instead of the 22P02 it asserts. That
  // is exactly why it demands a specific SQLSTATE rather than merely that
  // something failed: a looser assertion would have reported the type
  // enforcement as proven when the statement never reached the type system.
  `insert into public.slack_app_credentials (slack_app_id, team_id, app_name, bot_token_ref)
   values ('A0PROBE${run.slice(0, 3).toUpperCase()}XX', 'T0BUCJ2L5FD', 'probe',
           '${FABRICATED_SLACK_TOKEN}')`,
  '22P02',
  'invalid input syntax for type uuid',
)

await failsWith(
  'a dangling reference is refused rather than stored',
  `insert into public.slack_app_credentials (slack_app_id, team_id, app_name, bot_token_ref)
   values ('A0PROBEDANGLE', 'T0BUCJ2L5FD', 'probe', gen_random_uuid())`,
  '23503',
  'does not exist',
)

await succeeds(
  'a row with a valid reference is accepted',
  `insert into public.slack_app_credentials
     (slack_app_id, team_id, app_name, bot_user_id, scopes, bot_token_ref, installed_at)
   values ('A0BUFRVSSLD', 'T0BUCJ2L5FD', 'AI Team HQ', 'U0BUG0RPZ8B',
           array['chat:write','chat:write.customize'], '${ref}'::app.vault_secret_ref, now())
   on conflict (slack_app_id) do update
     set bot_token_ref = excluded.bot_token_ref, scopes = excluded.scopes`,
)

// --- the kill-switch and lifecycle constraints ----------------------------
await failsWith(
  'disabling an integration without a reason is refused (§8)',
  `update public.slack_app_credentials set enabled = false
   where slack_app_id = 'A0BUFRVSSLD'`,
  '23514',
  'slack_disabled_has_reason',
)
await succeeds(
  'disabling with a reason works, without taking anything else offline',
  `update public.slack_app_credentials
   set enabled = false, disabled_reason = 'verification probe'
   where slack_app_id = 'A0BUFRVSSLD'`,
)
await succeeds(
  're-enabling clears the disabled state',
  `update public.slack_app_credentials
   set enabled = true, disabled_reason = null
   where slack_app_id = 'A0BUFRVSSLD'`,
)
await failsWith(
  'a revoked install cannot also be enabled',
  `update public.slack_app_credentials set revoked_at = now()
   where slack_app_id = 'A0BUFRVSSLD'`,
  '23514',
  'slack_revoked_is_disabled',
)

// --- the application role reaches the vault only through the functions ----
const priv = await one(`
  select
    has_schema_privilege('ai_team_app','vault','usage')                      as schema_usage,
    has_table_privilege('ai_team_app','vault.secrets','select')              as read_raw,
    has_table_privilege('ai_team_app','vault.decrypted_secrets','select')    as read_decrypted,
    has_function_privilege('ai_team_app','app.resolve_secret(app.vault_secret_ref)','execute') as can_resolve
`)
checks.push({
  what: 'the application role has NO direct vault access',
  outcome: `schema_usage=${String(priv.schema_usage)} raw=${String(priv.read_raw)} decrypted=${String(priv.read_decrypted)}`,
  passed: priv.schema_usage === false && priv.read_raw === false && priv.read_decrypted === false,
})
checks.push({
  what: 'but it can resolve a reference it was given (§15: only the connector layer)',
  outcome: `execute on resolve_secret = ${String(priv.can_resolve)}`,
  passed: priv.can_resolve === true,
})

const asApp = await one(`
  set local role ai_team_app;
  select app.resolve_secret('${ref}'::app.vault_secret_ref) is not null as resolved
`)
checks.push({
  what: 'resolving works as the application role itself, via SECURITY DEFINER',
  outcome: `resolved=${String(asApp.resolved)}`,
  passed: asApp.resolved === true,
})

await failsWith(
  'the application role cannot read the vault directly',
  `set local role ai_team_app; select count(*) from vault.decrypted_secrets`,
  '42501',
  'permission denied',
)

const rls = await one(`
  select relrowsecurity as enabled, relforcerowsecurity as forced
  from pg_class where oid = 'public.slack_app_credentials'::regclass
`)
checks.push({
  what: 'RLS enabled and FORCED on slack_app_credentials',
  outcome: `enabled=${String(rls.enabled)} forced=${String(rls.forced)}`,
  passed: rls.enabled === true && rls.forced === true,
})

// --- no secret-shaped string anywhere in the table ------------------------
const leaked = await one(`
  select count(*)::int as n from public.slack_app_credentials
  where app_name ~ '(xox|sk-|sbp_)'
     or coalesce(disabled_reason,'') ~ '(xox|sk-|sbp_)'
     or coalesce(last_rotation_error,'') ~ '(xox|sk-|sbp_)'
     or coalesce(bot_user_id,'') ~ '(xox|sk-|sbp_)'
`)
checks.push({
  what: 'no credential-shaped string in any text column of the table',
  outcome: `${String(leaked.n)} matches`,
  passed: Number(leaked.n) === 0,
})

// --- cleanup ---------------------------------------------------------------
await db.execute(`
  delete from public.slack_app_credentials where slack_app_id like 'A0PROBE%';
  update public.slack_app_credentials set revoked_at = null, enabled = true, disabled_reason = null
    where slack_app_id = 'A0BUFRVSSLD';
`)
await db.execute(`delete from vault.secrets where name like 'probe_%'`)

console.log('| check | outcome | |')
console.log('|---|---|---|')
for (const c of checks) console.log(`| ${c.what} | ${c.outcome} | ${c.passed ? '✅' : '❌'} |`)
const failed = checks.filter((c) => !c.passed)
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`)
if (failed.length > 0) process.exit(1)
