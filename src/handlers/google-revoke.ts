/**
 * Killing a Google grant at Google, not merely here (#109).
 *
 * #90 asked to *"revoke, do not just forget"*. Migration 0350 delivered the
 * forget half honestly — our copy deleted, everything that reads it switched
 * off, and Google's own consent page handed back so the studio could point at
 * it — and claimed nothing more, because Postgres makes no HTTP calls.
 *
 * This is the other half. A deleted vault row and a live refresh token at
 * Google are not the same state: the credential keeps working and we have
 * simply stopped watching it. For a token that has been on a machine we no
 * longer control, that difference is the entire reason to press Disconnect.
 *
 * ## Why the token still exists when this runs
 *
 * #109 asked for the local copy to be deleted BEFORE the revoke is enqueued,
 * "so a failed revoke never leaves a credential we are still using". The
 * safety property is right; the sequence cannot deliver it, because Google's
 * revoke endpoint takes the token as its argument and there would be nothing
 * left to post.
 *
 * So 0354 PARKS it instead — the same secret under a name nothing else reads.
 * `app.deployment_credential` gates every read by class and by who is asking, and `googleAccess`
 * asks for `google.refresh_token`, which is gone by the time this handler is
 * dequeued. The office cannot use the credential; this handler can destroy it.
 *
 * ## What Google's endpoint actually says
 *
 * `POST https://oauth2.googleapis.com/revoke?token=…` returns **200** when the
 * grant is killed and **400 invalid_token** when the token was already dead —
 * revoked elsewhere, or expired because the OAuth app is still in testing
 * mode, which §20 warns about.
 *
 * Both mean *the grant is not live*, so both are reported as revoked. Treating
 * `invalid_token` as a failure would tell Grant to go and revoke something
 * that does not exist, which is the same class of untruth as claiming a revoke
 * that never happened — just in the direction that wastes his time rather than
 * his security.
 *
 * Anything else — a network failure, a 500, a body we cannot read — is
 * reported as NOT revoked, with Google's own words, and the page tells him to
 * do it himself.
 *
 * ## The parked copy always goes
 *
 * `app.google_revoke_finish` deletes it on both paths and this handler calls
 * it on both paths. A parked token outliving its job would be precisely the
 * thing this exists to prevent, wearing a different name.
 */

import { credentialSql } from '../credentials/deployment.ts'
import type { SqlExecutor } from '../db/executor.ts'
import type { Handler, HandlerOutput, Job } from '../jobs/worker.ts'
import { redactSecrets } from '../text/secrets.ts'

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

export const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke'

/**
 * A sentence about a failure, with the credential taken out of it.
 *
 * The first draft of this file had a comment claiming the token is never
 * reported and nothing enforcing it — which is the trap CLAUDE.md records
 * about comments that assert a property. A unit test found the leak in one
 * run: `fetch` puts the request in its error message, so
 * `could not reach Google: connect failed for 1//…` carried the whole refresh
 * token into `connection_health.detail`, a column the studio renders.
 *
 * Two passes, and the order matters. The token is removed BY VALUE first,
 * which is exact — we are holding the string, so there is no pattern to get
 * wrong. `redactSecrets` then covers anything else credential-shaped that a
 * provider's error text might carry, which is the case we cannot enumerate.
 */
const safely = (text: string, token: string): string => {
  /*
    Long enough to BE a credential.

    Without the floor, a one-character token turns `split`/`join` into a
    find-and-replace on a single letter: a test passing 't' got back
    "Google refused: h[redacted][redacted]p 400 invalid_reques[redacted]".
    Nothing was leaked and the sentence was destroyed, which on a real failure
    would leave Grant a redaction smear where the reason should be.

    A Google refresh token is around a hundred characters. Twelve is well under
    anything real and well over any substring that could occur by accident.
  */
  const withoutToken =
    token.trim().length < 12 ? text : text.split(token).join('[redacted:google-refresh-token]')
  return redactSecrets(withoutToken).slice(0, 160)
}

export interface RevokeOutcome {
  readonly revoked: boolean
  /** For a person, and short enough to sit in `connection_health.detail`. */
  readonly detail: string
}

/**
 * Ask Google to kill the grant.
 *
 * Separated from the handler so it can be tested without a database: the
 * decision about what an `invalid_token` MEANS is the part worth pinning, and
 * it is a pure function of the response.
 */
export async function revokeAtGoogle(
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<RevokeOutcome> {
  if (token.trim() === '') {
    return { revoked: false, detail: 'there was no parked token to revoke' }
  }

  let response: Response
  try {
    response = await fetchImpl(GOOGLE_REVOKE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }),
    })
  } catch (error) {
    return {
      revoked: false,
      detail: safely(`could not reach Google: ${(error as Error).message}`, token),
    }
  }

  if (response.ok) return { revoked: true, detail: 'Google confirmed the grant is revoked' }

  const said = (await response.json().catch(() => ({}))) as {
    error?: string
    error_description?: string
  }

  // Already dead is still dead. See the header: calling this a failure would
  // send Grant to revoke something that does not exist.
  if (response.status === 400 && said.error === 'invalid_token') {
    return {
      revoked: true,
      detail: 'the grant was already gone at Google (invalid_token)',
    }
  }

  return {
    revoked: false,
    detail: safely(
      `Google refused: http ${String(response.status)}${
        said.error === undefined ? '' : ` ${said.error}`
      }`,
      token,
    ),
  }
}

export function googleRevokeHandler(db: SqlExecutor, fetchImpl: typeof fetch = fetch): Handler {
  return {
    kind: 'google.revoke',
    handle: async (job: Job): Promise<HandlerOutput> => {
      const parked = (
        await db.execute(
          `select coalesce(${credentialSql('google.revoking_refresh_token')}, '') as token`,
        )
      ).rows[0] as { token: string }

      const outcome = await revokeAtGoogle(parked.token, fetchImpl)

      // Both paths. The parked copy is deleted here whatever happened.
      await db.execute(
        `select app.google_revoke_finish(${outcome.revoked ? 'true' : 'false'},
           ${lit(outcome.detail)})`,
      )

      /*
        Worth interrupting him for when it FAILED, and not when it worked.

        A successful revoke is the thing he asked for by pressing Disconnect,
        and §12 gives Telegram one interrupting voice. A failed one leaves a
        live grant at Google that only he can kill, which is exactly what an
        interruption is for.
      */
      if (outcome.revoked) {
        // raw-sql[2]: keyed by the claimed job; it sets one column of the job the worker holds.
        await db.execute(
          `update public.jobs set announce = false where job_id = ${lit(job.jobId)}::uuid`,
        )
      }

      return {
        body: outcome.revoked
          ? `Signed out of Google and revoked the grant at Google — ${outcome.detail}. ` +
            'Nothing here can reach the account until you connect it again.'
          : `Signed out of Google here, but the grant is still live at Google: ${outcome.detail}. ` +
            'Revoke it yourself at https://myaccount.google.com/permissions — until you do, ' +
            'the refresh token that was on this machine still works.',
        confidence: 'high',
        // Google was asked and Google answered. The citation is the endpoint,
        // which is where somebody would go to check.
        evidence: 'verified',
        sources: [`url:${GOOGLE_REVOKE_URL}`],
        contradictions: null,
        path: 'deterministic_retrieval',
        model: null,
        severity: outcome.revoked ? 'routine' : 'important',
      }
    },
  }
}
