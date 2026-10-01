/**
 * An access token for Grant's own Google account.
 *
 * §20's whole shape follows from one decision recorded in ADR-0013 and repeated
 * by Grant when the account was suspended: **the team reads HIS data on HIS
 * account with HIS consent.** There is no service account, no domain-wide
 * delegation, and no second Google identity to be suspended — which is the
 * supported path and the one with no policy exposure.
 *
 * So the durable credential is a refresh token he granted through the consent
 * screen (`supabase/functions/google-oauth`), and it lives in the vault. This
 * exchanges it for the short-lived access token every call needs.
 *
 * ## Why nothing is cached beyond the process
 *
 * An access token lives an hour. A worker run lives minutes. Caching one across
 * runs would mean storing a bearer credential somewhere the vault is not, to
 * save one request per run — and the request is the cheapest thing in the
 * pipeline.
 *
 * ## Why a missing credential is not an error
 *
 * Until Grant creates an OAuth client in a project he owns and presses Connect,
 * there is no token and there was never going to be one. §17 requires an
 * integration to be disableable and §18 requires the rest of the system to
 * carry on; both are served by returning null and saying which of the four
 * setup steps is outstanding, rather than throwing into a worker that has other
 * work to do.
 */

import { credentialSql } from '../credentials/deployment.ts'
import type { SqlExecutor } from '../db/executor.ts'
import type { OfficeId } from '../office/context.ts'

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

export interface GoogleUnavailable {
  readonly ok: false
  /** Which of the four steps on the Settings page is outstanding. */
  readonly reason: string
}

export interface GoogleAccess {
  readonly ok: true
  readonly accessToken: string
  /** What Google actually granted, which can be less than what was asked for. */
  readonly scopes: readonly string[]
  readonly expiresInSeconds: number
}

/**
 * Trade the stored refresh token for an access token.
 *
 * `fetchImpl` is injected so the failure paths can be exercised without a live
 * Google — the interesting cases here are all failures, and a test that can
 * only run when the integration works is a test of nothing.
 */
export async function googleAccess(
  db: SqlExecutor,
  fetchImpl: typeof fetch = fetch,
): Promise<GoogleAccess | GoogleUnavailable> {
  const config = (
    await db.execute(`
      select
        coalesce((select value #>> '{}' from public.system_config
                   where key = 'google.client_id'), '') as client_id,
        coalesce(${credentialSql('google.client_secret')}, '') as client_secret,
        coalesce(${credentialSql('google.refresh_token')}, '') as refresh_token
    `)
  ).rows[0] as { client_id: string; client_secret: string; refresh_token: string }

  if (config.client_id === '') {
    return { ok: false, reason: 'no OAuth client id yet — step 2 of 4 on the Settings page' }
  }
  if (config.client_secret === '') {
    return { ok: false, reason: 'no client secret yet — step 3 of 4 on the Settings page' }
  }
  if (config.refresh_token === '') {
    return { ok: false, reason: 'not connected — press Connect Google, step 4 of 4' }
  }

  const response = await fetchImpl('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.client_id,
      client_secret: config.client_secret,
      refresh_token: config.refresh_token,
      grant_type: 'refresh_token',
    }),
  })
  const body = (await response.json().catch(() => ({}))) as {
    access_token?: string
    expires_in?: number
    scope?: string
    error?: string
    error_description?: string
  }

  if (body.access_token === undefined || body.access_token === '') {
    // `invalid_grant` is the one worth naming: it means the refresh token is
    // dead — revoked, or expired because the OAuth app is still in testing mode
    // where Google expires them after seven days. §20 warns about exactly that
    // and it is indistinguishable from a typo unless the code is repeated.
    const code = String(body.error ?? `http ${String(response.status)}`)
    return {
      ok: false,
      reason:
        code === 'invalid_grant'
          ? 'Google refused the stored refresh token (invalid_grant): it has been revoked, or ' +
            'the OAuth app is in testing mode, where refresh tokens expire after seven days. ' +
            'Press Connect Google again, and publish the app to stop it recurring.'
          : `Google refused the refresh: ${code}${
              body.error_description === undefined ? '' : ` — ${body.error_description}`
            }`,
    }
  }

  return {
    ok: true,
    accessToken: body.access_token,
    // What was GRANTED, not what was asked for. A consent screen lets him
    // uncheck a scope, and a caller that assumed otherwise would fail later
    // with a 403 that named nothing.
    scopes: String(body.scope ?? '')
      .split(/\s+/)
      .filter(Boolean),
    expiresInSeconds: Number(body.expires_in ?? 0),
  }
}

/**
 * Record what happened, so the Connections panel is not guessing.
 *
 * Written under the office the refresh ran for (the caller names it: the claimed job's, or a script's). The table's
 * key is still (service, credential) for the whole deployment, so a row another office already holds is not
 * overwritten: the `do update` only touches a row of the SAME office, and a second office's health is a follow-up to
 * that key (reported, not widened here).
 */
export async function recordGoogleHealth(
  db: SqlExecutor,
  access: GoogleAccess | GoogleUnavailable,
  office: OfficeId,
): Promise<void> {
  await db.execute(`
    insert into public.connection_health
      (service, credential, state, detail, owner, action, checked_at, office_id)
    values ('google_calendar', 'oauth_client',
            ${access.ok ? "'ok'" : "'dead'"},
            ${lit(access.ok ? `connected; scopes: ${access.scopes.join(' ')}` : access.reason).slice(0, 400)},
            app.office_actor(${lit(office)}::uuid),
            'Settings → Google on the web front end', app.now_utc(), ${lit(office)}::uuid)
    on conflict (service, credential) do update
      set state = excluded.state, detail = excluded.detail,
          action = excluded.action, checked_at = app.now_utc()
      where public.connection_health.office_id = excluded.office_id
  `)
}
