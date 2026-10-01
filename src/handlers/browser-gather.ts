/**
 * Opening a page the office is signed in to, and writing down what it says
 * (#135, #16).
 *
 * The gather tier. It reads and it photographs; it does not click, type,
 * submit or buy. That boundary is enforced in three independent places, which
 * is deliberate rather than belt-and-braces: the adapter has no acting method,
 * `browser_actions.verb` has a CHECK that refuses an acting word, and this
 * handler never composes one. Any single one of them could be widened by
 * accident; all three needs a decision.
 *
 * ## Why every run opens a new browser
 *
 * `docs/agent-runtime-assessment-2026-09-17.md`: persistent STATE is free and
 * persistent COMPUTE is not. The session jar is state and lives in the Vault;
 * the browser is compute and is destroyed at the end of every call. Ten free
 * browser-minutes a day is enough for a gather tier precisely because nothing
 * is held open between them.
 *
 * ## Steps, so sixty seconds is enough
 *
 * #263's checkpoints are what make a 60-second runtime usable at all. Reading
 * is one step and photographing is another, so a run that dies after the read
 * resumes at the photograph rather than paying for the page twice. Stop is
 * read between them.
 *
 * ## What lands where
 *
 * The words become a `documents` row with `origin = 'source'`, `connector =
 * 'browser'` and a URL, so retrieval finds it and #260's provenance rules can
 * say where it came from — a page the office read is a source, not something
 * the office made up, and the distinction is the whole of `provenance.ts`.
 * The photograph goes to the private `files` bucket. The action goes to the
 * append-only ledger the Browser tab reads.
 */

import type { BrowserAdapter } from '../browser/adapter.ts'
import { CloudflareBrowser } from '../browser/cloudflare.ts'
import { FetchedBrowser } from '../browser/fetched.ts'
import type { SqlExecutor } from '../db/executor.ts'
import { filePath, putFile } from '../files/store.ts'
import { runSteps } from '../jobs/checkpoint.ts'
import type { Handler, HandlerOutput, Job } from '../jobs/worker.ts'

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
const nul = (v: string | null | undefined): string => (v == null || v === '' ? 'null' : lit(v))

/** Long enough for a slow page, short enough that a step fits a free runtime. */
const STEP_MS = 45_000

export interface BrowserGatherDeps {
  readonly db: SqlExecutor
  readonly projectRef: string
  readonly serviceKey: string
  /** Supplied by a test. In production it is built from the Vault, below. */
  readonly adapter?: BrowserAdapter
}

interface SessionRow {
  session_id: string
  site: string
  purpose: string
  jar: string | null
  gone: boolean
}

/**
 * The cookie jar, as the adapter wants it.
 *
 * Accepts either a bare array or Playwright's `storageState` envelope, because
 * the notebook's jar is stored in the second shape and a person exporting one
 * by hand will produce whichever their tool gave them. Refusing the shape they
 * have would be an avoidable request for manual configuration (§31).
 */
export function cookiesFrom(raw: string | null): { cookies: unknown[]; problem: string | null } {
  if (raw === null || raw.trim() === '') return { cookies: [], problem: null }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { cookies: [], problem: 'the stored session is not readable as JSON' }
  }
  const list = Array.isArray(parsed) ? parsed : ((parsed as { cookies?: unknown })?.cookies ?? null)
  if (!Array.isArray(list)) {
    return { cookies: [], problem: 'the stored session holds no cookies' }
  }
  return { cookies: list, problem: null }
}

/** `https://host/path` to the bare host, or null when it is not a URL at all. */
export function hostOf(url: string): string | null {
  const m = /^https?:\/\/([a-z0-9.-]+\.[a-z]{2,})(?::\d+)?(?:[/?#]|$)/i.exec(url.trim())
  return m?.[1]?.toLowerCase() ?? null
}

export function browserGatherHandler(deps: BrowserGatherDeps): Handler {
  const { db, projectRef, serviceKey } = deps
  return {
    kind: 'browser.gather',
    handle: async (job: Job): Promise<HandlerOutput> => {
      const base = {
        confidence: 'high' as const,
        contradictions: null,
        evidence: 'verified' as const,
        model: null,
        path: 'deterministic_retrieval' as const,
        sources: [`job:${job.jobId}`],
      }
      const say = (body: string, announce = true): HandlerOutput =>
        ({ ...base, announce, body }) satisfies HandlerOutput

      // raw-sql[2]: keyed by the claimed job; it reads the payload and project of the job the worker holds.
      const pinned =
        ((
          await db.execute(
            `select pinned_config, project_id::text as project
               from public.jobs where job_id = ${lit(job.jobId)}::uuid`,
          )
        ).rows[0] as { pinned_config?: Record<string, unknown>; project?: string } | undefined) ??
        {}
      const url = String(pinned.pinned_config?.url ?? '').trim()
      const projectId = pinned.project ?? null

      if (url === '') return say('I was asked to read a page and not told which one.')
      const host = hostOf(url)
      if (host === null) {
        return say(`“${url.slice(0, 120)}” is not a web address I can open.`)
      }
      if (projectId === null) {
        return say('I can only browse on behalf of a dashboard project, and this job has none.')
      }

      /*
        The budget is checked before anything is opened, not after.

        Ten browser-minutes a day is the free cap and a cap discovered by being
        exceeded is a cap nobody counted against. Refusing early costs a
        sentence; refusing late costs the money the whole assessment was about.
      */
      const budget = jsonOf(
        (
          await db.execute(
            `select app.browser_budget(app.job_office(${lit(job.jobId)}::uuid)) as r`,
          )
        ).rows[0]?.r,
      ) as {
        left_minutes?: number
        exhausted?: boolean
      }
      if (budget.exhausted === true) {
        return say(
          "I have used today's ten free browser-minutes, so I have not opened anything. " +
            'They reset at midnight UTC, and nothing has been charged.',
        )
      }

      const session = (
        await db.execute(`
          select s.session_id::text as session_id, s.site, s.purpose,
                 app.resolve_secret(s.credential_ref) as jar,
                 (s.revoked_at is not null) as gone
            from public.browser_sessions s
           where s.project_id = ${lit(projectId)}::uuid and s.site = ${lit(host)}
             and exists (select 1 from public.projects sp
                          where sp.project_id = s.project_id
                            and sp.office_id = app.job_office(${lit(job.jobId)}::uuid))`)
      ).rows[0] as SessionRow | undefined

      if (session !== undefined && session.gone) {
        return say(
          `The session for ${host} was revoked, so I have not opened anything. ` +
            'Sign in again in the project’s Browser tab and I will carry on.',
        )
      }

      const jar = cookiesFrom(session?.jar ?? null)
      const adapter = deps.adapter ?? (await runtimeFor(db))

      const note = async (
        verb: 'open' | 'read' | 'shot',
        ok: boolean,
        detail: string,
        shotPath: string | null,
        ms: number,
      ): Promise<void> => {
        await db.execute(`
          select app.browser_note(app.job_office(${lit(job.jobId)}::uuid),
                                  ${nul(session?.session_id ?? null)}::uuid,
                                  ${lit(job.jobId)}::uuid, ${lit(verb)}, ${lit(url)},
                                  ${String(ok)}, ${lit(detail)}, ${nul(shotPath)},
                                  ${String(Math.max(0, Math.round(ms)))})`)
      }

      const run = await runSteps(
        db,
        job.jobId,
        'browser.gather@1',
        [
          {
            /*
            External, because opening a page is a request somebody else's
            server saw. A resume must not silently repeat it: a page read is
            usually harmless and "usually" is not a property the effect
            declaration is allowed to assume.
          */
            effect: 'external',
            name: 'read',
            run: async () => {
              const got = await adapter.gather({
                cookies: jar.cookies as never,
                timeoutMs: STEP_MS,
                url,
                verbs: ['read'],
              })
              await note('read', got.ok, got.detail, null, got.ms)
              if (got.signedOut && session !== undefined) {
                await db.execute(
                  `select app.browser_session_expired(app.job_office(${lit(job.jobId)}::uuid),
                                                    ${lit(session.session_id)}::uuid,
                                                    ${lit(got.detail.slice(0, 200))})`,
                )
              }
              return {
                effectRef: `${adapter.name}:${url}`,
                outcome: {
                  detail: got.detail,
                  ms: got.ms,
                  ok: got.ok,
                  signedOut: got.signedOut,
                  text: (got.text ?? '').slice(0, 200_000),
                  title: got.title,
                },
              }
            },
          },
          {
            effect: 'external',
            name: 'shot',
            run: async (done) => {
              if (done.read?.ok !== true) return { outcome: { skipped: 'the read failed' } }
              const got = await adapter.gather({
                cookies: jar.cookies as never,
                timeoutMs: STEP_MS,
                url,
                verbs: ['shot'],
              })
              if (got.shot === null) {
                await note('shot', false, got.detail, null, got.ms)
                return { outcome: { ok: false } }
              }
              const path = filePath(projectId, 'browser', `${job.jobId}-page`, 'png')
              const kept = await putFile(projectRef, serviceKey, path, got.shot, 'image/png')
              await note(
                'shot',
                kept.ok,
                kept.error ?? 'photographed',
                kept.ok ? path : null,
                got.ms,
              )
              return kept.ok
                ? { effectRef: path, outcome: { ok: true, path } }
                : { outcome: { ok: false, path: null } }
            },
          },
          {
            effect: 'local',
            name: 'keep',
            run: async (done) => {
              const text = String(done.read?.text ?? '')
              if (done.read?.ok !== true || text.trim() === '') {
                return { outcome: { kept: false } }
              }
              const title = String(done.read?.title ?? '') || host
              const kept = jsonOf(
                (
                  await db.execute(`
                  select app.record_browser_page(app.job_office(${lit(job.jobId)}::uuid),
                                                 ${lit(projectId)}::uuid, ${lit(url)},
                                                 ${lit(title.slice(0, 300))}, ${lit(text)},
                                                 ${lit(job.jobId)}::uuid) as r`)
                ).rows[0]?.r,
              ) as { document_id?: string; error?: string }
              return {
                outcome: { document: kept.document_id ?? null, kept: kept.error === undefined },
              }
            },
          },
        ],
        job,
      )

      if (run.kind === 'paused') {
        return {
          ...base,
          announce: false,
          body: `I stopped part way through reading ${host}, at "${run.at}": ${run.pause.detail} ${run.pause.resumeWhen}`,
        }
      }
      if (run.kind === 'stopped') {
        return say(
          `You asked me to stop, so I did, at "${run.at}". What I had already read is kept.`,
        )
      }

      const read = run.outcomes.read ?? {}
      if (read.ok !== true) {
        if (read.signedOut === true) {
          return say(
            `${host} asked me to sign in, so there is nothing to report from it. ` +
              'The session has been marked signed-out and I have not tried again.',
          )
        }
        return say(`I could not read ${host}: ${String(read.detail ?? 'no reason given')}.`)
      }

      const shot = run.outcomes.shot ?? {}
      const keep = run.outcomes.keep ?? {}
      const words = String(read.text ?? '')
        .split(/\s+/)
        .filter(Boolean).length

      return say(
        `I read ${String(read.title ?? host)} at ${host} — about ${String(words)} words` +
          `${keep.kept === true ? ', kept as a project document' : ', and there was nothing worth keeping'}` +
          `${shot.ok === true ? ', with a screenshot' : ''}. ` +
          'I only read it. I did not press anything.',
      )
    },
  }
}

function jsonOf(raw: unknown): Record<string, unknown> {
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as Record<string, unknown>
    } catch {
      return {}
    }
  }
  return (raw as Record<string, unknown>) ?? {}
}

/**
 * Which runtime is configured, if any.
 *
 * The unavailable adapter is the default and the office runs on it every day
 * until somebody sets the two Vault entries — the same argument
 * `src/notebook/adapter.ts` makes: a degradation path that only runs during an
 * outage is a degradation path nobody has tested.
 */
async function runtimeFor(db: SqlExecutor): Promise<BrowserAdapter> {
  const row = (
    await db.execute(`
      select (select decrypted_secret from vault.decrypted_secrets
               where name = 'browser.cloudflare_account') as account,
             (select decrypted_secret from vault.decrypted_secrets
               where name = 'browser.cloudflare_token') as token`)
  ).rows[0] as { account?: string | null; token?: string | null } | undefined

  const account = (row?.account ?? '').trim()
  const token = (row?.token ?? '').trim()
  if (account === '' || token === '') {
    /*
      No credential does not mean no capability.

      This used to hand back `UnavailableBrowserAdapter`, so the office could
      not open ANY page — including a plain public one that never needed a
      browser. The Cloudflare account is a real blocker for a site that wants
      a login or draws itself in JavaScript; it is not a blocker for fetching
      HTML and reading it, which is most of the reference material a project
      cites.

      `FetchedBrowser` costs nothing, needs nothing, and is honest about its
      three limits — no screenshot, no JavaScript, no signing in — rather than
      returning an empty read and calling it an answer. It is strictly worse
      than the real runtime at everything except existing, so the moment a
      credential appears the branch above takes over and this becomes the
      degradation path. Which is the point `adapter.ts` already makes: a
      degradation path is only trustworthy because it is the one that runs
      every day until then.

      `UnavailableBrowserAdapter` is no longer reachable from here and the
      import is gone: nothing between "there is no credential" and "there is a
      browser" is now silent. A caller that genuinely needs a real browser
      asks for `shot`, and `FetchedBrowser` refuses that in words.
    */
    return new FetchedBrowser()
  }
  return new CloudflareBrowser({ accountId: account, apiToken: token })
}
