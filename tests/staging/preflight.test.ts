import { describe, expect, it } from 'vitest'
import {
  BUILTIN_DENYLIST,
  type Env,
  evaluate,
  mergeDenylists,
  shownValue,
  workerMayBeDeployed,
} from '../../src/staging/preflight.ts'

const REF = 'abcdefghijklmnopqrst'
const good: Env = {
  TARGET_ENVIRONMENT: 'staging',
  SUPABASE_PROJECT_REF: REF,
  STAGING_EXPECT_REF: REF,
  STAGING_GATEWAY_URL: `https://${REF}.supabase.co/functions/v1/hq-api`,
  STAGING_WORKER_URL: `https://${REF}.supabase.co/functions/v1/worker`,
  STAGING_STORAGE_URL: `https://${REF}.supabase.co/storage/v1/`,
  STAGING_SITE_URL: 'https://team-hq-staging-git-feature.vercel.app',
  VERCEL_ENV: 'preview',
  STAGING_GOOGLE_CLIENT_ID: 'staging-client-123.apps.googleusercontent.com',
  STAGING_TELEGRAM_BOT: 'team_hq_staging_bot',
  STAGING_SLACK_TEAM: 'unused',
  STAGING_VIKUNJA_URL: 'https://vikunja.staging.example.org',
  // secret-scan:allow-shape (a synthetic specimen, not a credential)
  SUPABASE_DB_URL: `postgresql://postgres:pw@db.${REF}.supabase.co:5432/postgres`,
}
const deny = mergeDenylists(BUILTIN_DENYLIST, {
  identifiers: [
    'prod-client-999.apps.googleusercontent.com',
    'team_hq_prod_bot',
    'vikunja.example.com',
  ],
})
const run = (env: Env, found = true) => evaluate(env, deny, { denylistFileFound: found })
const failing = (env: Env, found = true) =>
  run(env, found)
    .checks.filter((c) => !c.ok)
    .map((c) => c.id)

describe('the staging preflight', () => {
  it('passes a fully staging environment', () => {
    expect(run(good).ok).toBe(true)
    expect(failing(good)).toEqual([])
  })

  it('CONTROL: it can fail (an empty environment fails many checks, not none)', () => {
    expect(failing({}).length).toBeGreaterThan(8)
  })

  it('refuses the production project ref in every place it can appear', () => {
    const prod = BUILTIN_DENYLIST.refs[0] as string
    expect(failing({ ...good, SUPABASE_PROJECT_REF: prod, STAGING_EXPECT_REF: prod })).toContain(
      'supabase.ref.not-production',
    )
    expect(
      failing({ ...good, STAGING_GATEWAY_URL: `https://${prod}.supabase.co/functions/v1/hq-api` }),
    ).toContain('STAGING_GATEWAY_URL')
    expect(
      failing({ ...good, STAGING_WORKER_URL: `https://${prod}.supabase.co/functions/v1/worker` }),
    ).toContain('STAGING_WORKER_URL')
    expect(
      failing({ ...good, STAGING_STORAGE_URL: `https://${prod}.supabase.co/storage/v1/` }),
    ).toContain('STAGING_STORAGE_URL')
    expect(
      failing({
        ...good,
        // secret-scan:allow-shape (a synthetic specimen, not a credential)
        SUPABASE_DB_URL: `postgresql://postgres:pw@db.${prod}.supabase.co:5432/postgres`,
      }),
    ).toContain('database.host')
  })

  it('refuses a ref that is unset (scripts default to production) or typed two ways that disagree', () => {
    expect(failing({ ...good, SUPABASE_PROJECT_REF: undefined })).toContain('supabase.ref.explicit')
    expect(failing({ ...good, STAGING_EXPECT_REF: 'zzzzzzzzzzzzzzzzzzzz' })).toContain(
      'supabase.ref.typed-twice',
    )
    expect(failing({ ...good, STAGING_EXPECT_REF: undefined })).toContain(
      'supabase.ref.typed-twice',
    )
  })

  it('refuses a gateway or worker that points at a different project from the ref', () => {
    expect(
      failing({
        ...good,
        STAGING_GATEWAY_URL: 'https://zzzzzzzzzzzzzzzzzzzz.supabase.co/functions/v1/hq-api',
      }),
    ).toContain('STAGING_GATEWAY_URL')
    expect(
      failing({ ...good, STAGING_WORKER_URL: `https://${REF}.supabase.co/functions/v1/hq-api` }),
    ).toContain('STAGING_WORKER_URL')
  })

  it('refuses the production site and a Vercel environment that is not preview', () => {
    expect(failing({ ...good, STAGING_SITE_URL: 'https://ai-team-hq.vercel.app' })).toContain(
      'site.url',
    )
    expect(failing({ ...good, STAGING_SITE_URL: 'http://staging.example.org' })).toContain(
      'site.url',
    )
    expect(failing({ ...good, VERCEL_ENV: 'production' })).toContain('site.vercel-env')
    expect(failing({ ...good, VERCEL_ENV: undefined })).toContain('site.vercel-env')
  })

  it('refuses a production Google client, Telegram bot, or Vikunja server, and an integration nobody named', () => {
    expect(
      failing({ ...good, STAGING_GOOGLE_CLIENT_ID: 'prod-client-999.apps.googleusercontent.com' }),
    ).toContain('STAGING_GOOGLE_CLIENT_ID')
    expect(failing({ ...good, STAGING_TELEGRAM_BOT: 'team_hq_prod_bot' })).toContain(
      'STAGING_TELEGRAM_BOT',
    )
    expect(failing({ ...good, STAGING_VIKUNJA_URL: 'https://vikunja.example.com/api' })).toContain(
      'STAGING_VIKUNJA_URL',
    )
    expect(failing({ ...good, STAGING_SLACK_TEAM: undefined })).toContain('STAGING_SLACK_TEAM')
  })

  it('accepts "unused" for an integration staging does not have', () => {
    expect(
      failing({
        ...good,
        STAGING_GOOGLE_CLIENT_ID: 'unused',
        STAGING_TELEGRAM_BOT: 'unused',
        STAGING_VIKUNJA_URL: 'unused',
      }),
    ).toEqual([])
  })

  it('finds a production identifier hiding in a variable nobody listed, and names the variable only', () => {
    const r = run({ ...good, SOMETHING_ELSE: 'see https://ai-team-hq.vercel.app/x' })
    const c = r.checks.find((x) => x.id === 'environment.no-production-identifier')
    expect(c?.ok).toBe(false)
    expect(c?.detail).toContain('SOMETHING_ELSE')
    expect(c?.detail).not.toContain('ai-team-hq')
  })

  it('refuses a stray Supabase address for another project', () => {
    expect(
      failing({ ...good, NEXT_PUBLIC_SUPABASE_URL: 'https://zzzzzzzzzzzzzzzzzzzz.supabase.co' }),
    ).toContain('environment.one-project')
    expect(
      failing({ ...good, HQ_API_URL: `https://${REF}.supabase.co/functions/v1/hq-api` }),
    ).toEqual([])
  })

  it('needs the local denylist, or an explicit acknowledgement that only the built-in identifiers are known', () => {
    expect(failing(good, false)).toContain('denylist.present')
    expect(failing({ ...good, STAGING_DENYLIST_ACKNOWLEDGED: 'builtin-only' }, false)).toEqual([])
    expect(failing({ ...good, STAGING_DENYLIST_ACKNOWLEDGED: 'yes' }, false)).toContain(
      'denylist.present',
    )
  })

  it('requires TARGET_ENVIRONMENT to be exactly staging', () => {
    expect(failing({ ...good, TARGET_ENVIRONMENT: 'production' })).toContain('environment.label')
    expect(failing({ ...good, TARGET_ENVIRONMENT: 'Staging' })).toContain('environment.label')
    expect(failing({ ...good, TARGET_ENVIRONMENT: 'stage' })).toContain('environment.label')
  })

  it('never carries a secret into the report', () => {
    const r = JSON.stringify(
      run({
        ...good,
        SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_SHOULDNOTAPPEAR',
        SUPABASE_ACCESS_TOKEN: 'sbp_SHOULDNOTAPPEAR',
      }),
    )
    expect(r).not.toContain('SHOULDNOTAPPEAR')
    expect(shownValue('SUPABASE_SERVICE_ROLE_KEY', 'x')).toBe('(set, not shown)')
    // secret-scan:allow-shape (a synthetic specimen, not a credential)
    expect(shownValue('SUPABASE_DB_URL', 'postgres://u:p@h')).toBe('(set, not shown)')
    expect(shownValue('STAGING_SITE_URL', 'https://s.example')).toBe('https://s.example')
  })

  it('a worker may be deployed only when timed duties are held', () => {
    expect(workerMayBeDeployed({ paused: true, allow: [] }).ok).toBe(true)
    expect(workerMayBeDeployed({ paused: true, allow: ['drive-index'] }).ok).toBe(true)
    expect(workerMayBeDeployed({ paused: false, allow: [] }).ok).toBe(false)
    // a hold the database does not honour is no hold at all
    expect(workerMayBeDeployed({ paused: true, allow: [], honoured: false }).ok).toBe(false)
  })
})
