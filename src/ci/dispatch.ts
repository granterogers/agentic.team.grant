/**
 * Running a workflow on demand, under the ceiling (#17).
 *
 * ## Why `repository_dispatch` and not `workflow_dispatch`
 *
 * Probed rather than assumed. `github.dispatch_token` answers 200 on the
 * repository endpoint and **403 on every `/actions/` endpoint** — it carries
 * contents and nothing else, which is exactly what 0126 made it for. Calling
 * the `workflow_dispatch` API needs `actions:write`, so it is not available;
 * `repository_dispatch` needs `contents:write`, so it is.
 *
 * Asking Grant to widen a PAT would be an avoidable request for manual
 * configuration, which §31 calls a design failure, and it buys nothing: a
 * workflow reached by `repository_dispatch` runs the same jobs.
 *
 * ## This file does not decide whether it may run
 *
 * `app.ci_reserve` does, and it is the only door. The reservation is taken
 * BEFORE the request goes out and released only by a report or an expiry, so
 * two dispatches in the same second cannot both be told there is room. A
 * dispatcher that asked "is there budget" and then posted would be the
 * check-then-act race the ceiling exists to prevent.
 *
 * ## The token is resolved by NAME here, deliberately
 *
 * `GitHubClient.fromVault` tries three secrets in preference order and its own
 * comment says: *"If a write method is ever added here, this fallback has to
 * go first."* This is that write method, so it does not use the fallback. It
 * asks for the one credential that is scoped to this repository and made for
 * this, and if that is missing it says so rather than reaching for a
 * read-scoped token that would fail confusingly at the API instead.
 */

import type { SqlExecutor } from '../db/executor.ts'
import { redactSecrets } from '../text/secrets.ts'

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
const nul = (v: string | null): string => (v === null ? 'null' : lit(v))

/** The one credential this may use. Never the read tokens. */
export const DISPATCH_SECRET = 'github.dispatch_token'

export const REPO = 'granterogers/agentic.team.grant'

export interface DispatchRequest {
  readonly workflow: string
  readonly reason: string
  readonly requestedBy?: string
  readonly jobId?: string | null
  readonly repo?: string
  readonly fetchImpl?: typeof fetch
}

export interface DispatchResult {
  readonly ok: boolean
  /** The ledger row, when one was taken. Null when the ceiling refused. */
  readonly ciRunId: string | null
  readonly reservedMinutes: number | null
  /** Non-secret, always. A reason a person can act on. */
  readonly detail: string
  /** The ceiling said no, as opposed to GitHub saying no. */
  readonly refusedByCeiling: boolean
}

interface Verdict {
  may?: boolean
  ci_run_id?: string
  reserved?: number
  why?: string
}

/**
 * Ask the ceiling, then tell GitHub.
 *
 * A reservation taken for a dispatch GitHub then refuses is released
 * immediately rather than left to expire — the run never existed, so counting
 * it would make the ceiling tighter every time the network failed.
 */
export async function dispatchWorkflow(
  db: SqlExecutor,
  request: DispatchRequest,
): Promise<DispatchResult> {
  const fetchImpl = request.fetchImpl ?? fetch
  const repo = request.repo ?? REPO
  const eventType = `run-${request.workflow}`

  const taken = (
    await db.execute(`
      select app.ci_reserve(${lit(request.workflow)}, ${lit(eventType)},
                            ${lit(request.reason)},
                            ${lit(request.requestedBy ?? 'grant')},
                            ${nul(request.jobId ?? null)}::uuid) as r`)
  ).rows[0]?.r
  const verdict = (typeof taken === 'string' ? JSON.parse(taken) : taken) as Verdict

  if (verdict.may !== true || typeof verdict.ci_run_id !== 'string') {
    return {
      ciRunId: null,
      detail: verdict.why ?? 'the ceiling refused and did not say why',
      ok: false,
      refusedByCeiling: true,
      reservedMinutes: null,
    }
  }
  const ciRunId = verdict.ci_run_id

  const token = (
    (
      await db.execute(
        `select decrypted_secret as t from vault.decrypted_secrets
          where name = 'github.dispatch_token'`, // infra: CI dispatch, the deployment's own
      )
    ).rows[0] as { t?: string } | undefined
  )?.t
  if (token === undefined || token.trim() === '') {
    await release(db, ciRunId, `there is no ${DISPATCH_SECRET} in the vault`)
    return {
      ciRunId,
      detail:
        `The office holds no ${DISPATCH_SECRET}, so it cannot ask GitHub to run ` +
        'anything. Nothing was charged.',
      ok: false,
      refusedByCeiling: false,
      reservedMinutes: verdict.reserved ?? null,
    }
  }

  let status = 0
  let body = ''
  try {
    const response = await fetchImpl(`https://api.github.com/repos/${repo}/dispatches`, {
      body: JSON.stringify({
        client_payload: { ci_run_id: ciRunId, reason: request.reason.slice(0, 300) },
        event_type: eventType,
      }),
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token.trim()}`,
        'content-type': 'application/json',
        'user-agent': 'ai-team-hq',
      },
      method: 'POST',
    })
    status = response.status
    if (status >= 400) body = (await response.text().catch(() => '')).slice(0, 200)
  } catch (error) {
    const why = redactSecrets(error instanceof Error ? error.message : String(error))
    await release(db, ciRunId, `the request to GitHub failed: ${why}`)
    return {
      ciRunId,
      detail: `I could not reach GitHub: ${why}. Nothing was charged.`,
      ok: false,
      refusedByCeiling: false,
      reservedMinutes: verdict.reserved ?? null,
    }
  }

  /*
    204 is the whole of success here. `repository_dispatch` returns no body and
    no run id — GitHub decides which workflows match the event type, and the
    office finds out what happened when the run reports.
  */
  if (status !== 204) {
    await release(db, ciRunId, `GitHub answered ${String(status)}: ${redactSecrets(body)}`)
    return {
      ciRunId,
      detail:
        `GitHub refused to start it (${String(status)})` +
        `${body === '' ? '' : `: ${redactSecrets(body)}`}. Nothing was charged.`,
      ok: false,
      refusedByCeiling: false,
      reservedMinutes: verdict.reserved ?? null,
    }
  }

  return {
    ciRunId,
    detail:
      `Asked GitHub to run ${request.workflow}. It has ` +
      `${String(verdict.reserved ?? 0)} minute(s) reserved against this month's ceiling ` +
      'until it reports what it actually cost.',
    ok: true,
    refusedByCeiling: false,
    reservedMinutes: verdict.reserved ?? null,
  }
}

/**
 * Give the minutes back for a run that never started.
 *
 * Settled as `refused_by_github` rather than deleted: a dispatch that was
 * attempted and rejected is something Grant should be able to see, and an
 * append-only reading of the ledger is what makes the month's figure
 * reconstructible.
 */
async function release(db: SqlExecutor, ciRunId: string, why: string): Promise<void> {
  await db.execute(`
    update public.ci_runs
       set settled_at = app.now_utc(), outcome = 'refused_by_github',
           actual_minutes = 0, detail = ${lit(why.slice(0, 400))}
     where ci_run_id = ${lit(ciRunId)}::uuid`)
}
