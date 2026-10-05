/**
 * Looking something up on the open web, and keeping what is useful (web research).
 *
 * ## What it does, in order
 *
 *   search  ->  read the best few results  ->  photograph the first  ->  follow a few relevant links, ONE hop  ->
 *   download at most one file the question's words appear in  ->  say what was found, with every claim cited.
 *
 * Every page that is worth keeping becomes a `documents` row (`origin = 'source'`, `connector = 'browser'`) through the
 * SAME writer `browser.gather` uses (`app.record_browser_page`), so retrieval finds it, `provenance.ts` treats it as a
 * source and a citation points at the saved row (`browser:<document_id>`). Where it came from is on the ledger row of the
 * read (`browser_actions.found_via`, migration 0930): the query and rank, or the page whose link led to it.
 *
 * ## It cannot act
 *
 * The boundary `browser-gather.ts` states holds here for the same three independent reasons, and this handler adds a
 * fourth that is about the open web rather than a signed-in site:
 *
 *   1. the adapter has no acting method (`gather` takes the verbs `read` and `shot`);
 *   2. `browser_actions.verb` has a CHECK that refuses an acting word, and the only verbs this file composes are
 *      `open`, `read`, `shot` and `download`;
 *   3. this handler never composes an acting verb, and a test reads the source to prove it;
 *   4. a followed link is filtered by `whyNotFollowed` first: an address or a link text that names an act (log out, cart,
 *      unsubscribe, a query asking the site to do something) is not followed, because a GET can act.
 *
 * Anything consequential - send, post, publish, email, contact a human, a form that matters, a purchase, a booking, an
 * upload - is not here and cannot be reached from here. It exists only as a plan step, asked about through
 * `mayAct` / `app.authorize_effect`, which is the one approval architecture. There is no second one in this file.
 *
 * ## Public pages only
 *
 * No cookie jar is presented. A site Grant signed in to is read by `browser.gather` through the session tier, one named
 * address at a time; a SEARCH has no business choosing which signed-in site to open as him.
 *
 * ## Harness jobs never reach the web
 *
 * The question would go to a search engine and the pages to a real server. A harness or fixture job (the same predicate
 * the browsing ledger reader uses, `app.harness_browsing`) is refused before anything is opened.
 */

import type { BrowserAdapter } from '../browser/adapter.ts'
import { CloudflareBrowser } from '../browser/cloudflare.ts'
import { mayAct } from '../agents/approval.ts'
import { downloadFile } from '../browser/download.ts'
import { FetchedBrowser } from '../browser/fetched.ts'
import { normalise, type PageLink, termsOf } from '../browser/links.ts'
import {
  budgetFrom,
  chooseLinks,
  composeFindings,
  extractPassages,
  type FoundPage,
  pageSource,
  pickResults,
} from '../browser/research.ts'
import { defaultSearchProvider, type SearchProvider } from '../browser/search.ts'
import type { SqlExecutor } from '../db/executor.ts'
import { filePath, putFile } from '../files/store.ts'
import { runSteps, type Step } from '../jobs/checkpoint.ts'
import type { Handler, HandlerOutput, Job } from '../jobs/worker.ts'
import { hostOf } from './browser-gather.ts'

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
const nul = (v: string | null | undefined): string => (v == null || v === '' ? 'null' : lit(v))

const STEP_MS = 45_000
/** Read steps, fixed so the checkpoint list is static; the budget decides how many do anything. */
const READ_STEPS = 6
const FOLLOW_STEPS = 3

export interface WebResearchDeps {
  readonly db: SqlExecutor
  readonly projectRef: string
  readonly serviceKey: string
  /** Supplied by a test. In production built from the Vault, as `browser.gather` does. */
  readonly adapter?: BrowserAdapter
  readonly search?: SearchProvider
  /** Storage, injected so a test writes nowhere. */
  readonly store?: typeof putFile
  readonly download?: typeof downloadFile
}

interface Kept {
  readonly ok: boolean
  readonly documentId?: string
  readonly url: string
  readonly title?: string
  readonly passages?: readonly string[]
  readonly links?: readonly PageLink[]
  readonly how?: 'search' | 'link' | 'download'
  readonly detail?: string
}

const today = (): string => new Date().toISOString().slice(0, 10)

export function webResearchHandler(deps: WebResearchDeps): Handler {
  const { db, projectRef, serviceKey } = deps
  const store = deps.store ?? putFile
  const download = deps.download ?? downloadFile
  return {
    kind: 'web.research',
    handle: async (job: Job): Promise<HandlerOutput> => {
      const base = {
        confidence: 'medium' as const,
        contradictions: null,
        evidence: 'inferred' as const,
        model: null,
        path: 'deterministic_retrieval' as const,
        sources: [`job:${job.jobId}`],
      }
      const say = (body: string, announce = true, sources: readonly string[] = base.sources) =>
        ({ ...base, announce, body, sources }) satisfies HandlerOutput

      // raw-sql[2]: keyed by the claimed job; it reads the payload and project of the job the worker holds.
      const row = (
        await db.execute(
          `select pinned_config, project_id::text as project,
                  app.harness_browsing(job_id, project_id) as harness
             from public.jobs where job_id = ${lit(job.jobId)}::uuid`,
        )
      ).rows[0] as
        | { pinned_config?: Record<string, unknown>; project?: string; harness?: boolean }
        | undefined
      const config = row?.pinned_config ?? {}
      const projectId = row?.project ?? null
      const question = String(config.question ?? '')
        .replace(/\s+/g, ' ')
        .trim()

      if (question === '') return say('I was asked to look something up and not told what.')
      // Containment BEFORE anything leaves the building. A harness job's question must never reach a search engine.
      if (row === undefined || row.harness !== false) {
        return say(
          'contained: this work did not come from a production door, so I have not searched or opened anything.',
          false,
        )
      }
      if (projectId === null) {
        return say('I can only research on behalf of a dashboard project, and this job has none.')
      }

      /*
        THE DIAL. Reading the web is not consequential, so nothing here asks anybody; but "Observe" means the office does
        not act, even internally, and saving pages as project documents is acting. The policy is the one architecture
        (app.authorize_effect through mayAct), asked for the tool this job IS (web.read). Anything but a plain yes stops
        before the first search, and an unreadable answer is not a yes.
      */
      const policy = await mayAct(db, {
        audience: 'office',
        jobAskedFor: job.jobId,
        projectId,
        tool: 'web.read',
      })
      if (policy.verdict !== 'proceed') {
        return say(
          'Autonomy for this project does not let me read the web yet, so I have not searched or opened anything and saved nothing. ' +
            'Raise it above Observe in Settings and ask again.',
        )
      }

      const budget = jsonOf(
        (
          await db.execute(
            `select app.browser_budget(app.job_office(${lit(job.jobId)}::uuid)) as r`,
          )
        ).rows[0]?.r,
      ) as { exhausted?: boolean }
      if (budget.exhausted === true) {
        return say(
          "I have used today's free browser-minutes, so I have not searched or opened anything. " +
            'They reset at midnight UTC, and nothing has been charged.',
        )
      }

      const limits = budgetFrom(config)
      const terms = termsOf(question)
      const adapter = deps.adapter ?? (await runtimeFor(db))
      const provider = deps.search ?? defaultSearchProvider()
      const wantShot = config.screenshot !== false

      const note = async (
        verb: 'open' | 'read' | 'shot' | 'download',
        url: string,
        ok: boolean,
        detail: string,
        shotPath: string | null,
        ms: number,
        via: Record<string, unknown> | null,
      ): Promise<void> => {
        await db.execute(`
          select app.browser_note_via(app.job_office(${lit(job.jobId)}::uuid), null::uuid,
                                      ${lit(job.jobId)}::uuid, ${lit(verb)}, ${lit(url)}, ${String(ok)},
                                      ${lit(detail)}, ${nul(shotPath)},
                                      ${String(Math.max(0, Math.round(ms)))},
                                      ${via === null ? 'null' : `${lit(JSON.stringify(via))}::jsonb`})`)
      }

      const spent = async (): Promise<boolean> =>
        (
          jsonOf(
            (
              await db.execute(
                `select app.browser_budget(app.job_office(${lit(job.jobId)}::uuid)) as r`,
              )
            ).rows[0]?.r,
          ) as { exhausted?: boolean }
        ).exhausted === true

      const keptOf = (o: Record<string, unknown> | undefined): Kept | null =>
        o !== undefined && o.ok === true ? (o as unknown as Kept) : null
      const allKept = (done: Readonly<Record<string, Record<string, unknown>>>): Kept[] =>
        Object.entries(done)
          .filter(([k]) => k.startsWith('read-') || k.startsWith('follow-'))
          .map(([, v]) => keptOf(v))
          .filter((k): k is Kept => k !== null)

      /** Read one page, keep it as a project source, and say how it was reached. */
      const readAndKeep = async (
        url: string,
        how: 'search' | 'link',
        via: Record<string, unknown>,
      ): Promise<Kept> => {
        const got = await adapter.gather({ timeoutMs: STEP_MS, url, verbs: ['read'] })
        await note('read', url, got.ok, got.detail, null, got.ms, via)
        const text = (got.text ?? '').slice(0, 200_000)
        if (!got.ok || text.trim() === '') {
          return { detail: got.ok ? 'the page had no words on it' : got.detail, ok: false, url }
        }
        const title = (got.title ?? '') || hostOf(url) || url
        const kept = jsonOf(
          (
            await db.execute(`
              select app.record_browser_page(app.job_office(${lit(job.jobId)}::uuid),
                                             ${lit(projectId)}::uuid, ${lit(url)},
                                             ${lit(title.slice(0, 300))}, ${lit(text)},
                                             ${lit(job.jobId)}::uuid) as r`)
          ).rows[0]?.r,
        ) as { document_id?: string; error?: string }
        if (kept.document_id === undefined) {
          return { detail: kept.error ?? 'it could not be kept', ok: false, url }
        }
        return {
          documentId: kept.document_id,
          how,
          // Links are offered, not followed here; the follow steps decide, under the filter and the budget.
          links: (got.links ?? []).slice(0, 60),
          ok: true,
          passages: extractPassages(text, terms),
          title,
          url,
        }
      }

      const steps: Step[] = [
        {
          effect: 'external',
          name: 'search',
          run: async () => {
            const found = await provider.search(question, 10)
            await note(
              'open',
              provider.urlFor(question),
              found.ok,
              found.ok
                ? `search: ${String(found.results.length)} result(s)`
                : `search: ${found.detail}`,
              null,
              0,
              { how: 'search', query: question.slice(0, 300) },
            )
            return found.ok
              ? {
                  effectRef: `${found.provider}:search`,
                  outcome: {
                    ok: true,
                    results: found.results.map((r) => ({
                      rank: r.rank,
                      snippet: r.snippet.slice(0, 200),
                      title: r.title,
                      url: r.url,
                    })),
                  },
                }
              : { outcome: { detail: found.detail, ok: false } }
          },
        },
      ]

      for (let i = 0; i < READ_STEPS; i++) {
        steps.push({
          effect: 'external',
          name: `read-${String(i)}`,
          run: async (done) => {
            const search = done.search
            if (search?.ok !== true || i >= limits.results) return { outcome: { ok: false } }
            if (allKept(done).length >= limits.pages) return { outcome: { ok: false } }
            if (await spent()) return { outcome: { detail: 'out of browser-minutes', ok: false } }
            const results = (search.results ?? []) as {
              rank: number
              snippet: string
              title: string
              url: string
            }[]
            const picks = pickResults(results, limits.results)
            const pick = picks[i]
            if (pick === undefined) return { outcome: { ok: false } }
            const got = await readAndKeep(pick.url, 'search', {
              how: 'search',
              query: question.slice(0, 300),
              rank: pick.rank,
            })
            return { effectRef: `read:${pick.url}`, outcome: { ...got } }
          },
        })
      }

      steps.push({
        effect: 'external',
        name: 'shot',
        run: async (done) => {
          const first = allKept(done)[0]
          if (!wantShot || first === undefined) return { outcome: { skipped: true } }
          const got = await adapter.gather({ timeoutMs: STEP_MS, url: first.url, verbs: ['shot'] })
          if (got.shot === null) {
            await note('shot', first.url, false, got.detail, null, got.ms, null)
            return { outcome: { ok: false } }
          }
          const path = filePath(projectId, 'browser', `${job.jobId}-research`, 'png')
          const kept = await store(projectRef, serviceKey, path, got.shot, 'image/png')
          await note(
            'shot',
            first.url,
            kept.ok,
            kept.error ?? 'photographed',
            kept.ok ? path : null,
            got.ms,
            null,
          )
          return kept.ok
            ? { effectRef: path, outcome: { ok: true, path } }
            : { outcome: { ok: false } }
        },
      })

      for (let i = 0; i < FOLLOW_STEPS; i++) {
        steps.push({
          effect: 'external',
          name: `follow-${String(i)}`,
          run: async (done) => {
            if (i >= limits.follow) return { outcome: { ok: false } }
            const read = allKept(done)
            if (read.length >= limits.pages) return { outcome: { ok: false } }
            if (await spent()) return { outcome: { detail: 'out of browser-minutes', ok: false } }
            // ONE hop: only pages reached from the search results offer links; a followed page's own links are never taken.
            const origin = read.filter((k) => k.how === 'search')
            const tried = new Set<string>(
              Object.entries(done)
                .filter(([k]) => k.startsWith('read-') || k.startsWith('follow-'))
                .map(([, v]) => (typeof v.url === 'string' ? normalise(v.url) : ''))
                .filter((u) => u !== ''),
            )
            const downloadsMade = Object.values(done).filter(
              (v) => v.how === 'download' && v.ok === true,
            ).length
            const choices = chooseLinks(
              origin.map((k) => ({ links: k.links ?? [], url: k.url })),
              terms,
              6,
              tried,
            ).filter((c) => c.how === 'read' || downloadsMade < limits.downloads)
            const next = choices[0]
            if (next === undefined) return { outcome: { ok: false } }

            const via = { depth: 1, from: next.from, how: 'link' }
            if (next.how === 'download') {
              const got = await download(next.link.url)
              if (!got.ok) {
                await note('download', next.link.url, false, got.detail, null, got.ms, via)
                return { outcome: { detail: got.detail, ok: false, url: next.link.url } }
              }
              const path = filePath(projectId, 'browser', `${job.jobId}-${String(i)}`, got.ext)
              const stored = await store(projectRef, serviceKey, path, got.bytes, got.mime)
              if (!stored.ok) {
                await note(
                  'download',
                  next.link.url,
                  false,
                  stored.error ?? 'could not store it',
                  null,
                  got.ms,
                  via,
                )
                return {
                  outcome: {
                    detail: stored.error ?? 'could not store it',
                    ok: false,
                    url: next.link.url,
                  },
                }
              }
              const title = next.link.text || next.link.url.split('/').pop() || 'Downloaded file'
              const kept = jsonOf(
                (
                  await db.execute(`
                    select app.record_web_file(app.job_office(${lit(job.jobId)}::uuid),
                                               ${lit(projectId)}::uuid, ${lit(next.link.url)},
                                               ${lit(title.slice(0, 300))}, ${lit(path)}, ${lit(got.mime)},
                                               ${String(got.bytes.byteLength)}, ${lit(job.jobId)}::uuid) as r`)
                ).rows[0]?.r,
              ) as { document_id?: string; error?: string }
              await note(
                'download',
                next.link.url,
                kept.document_id !== undefined,
                kept.error ?? `${got.mime}, ${String(got.bytes.byteLength)} bytes`,
                null,
                got.ms,
                via,
              )
              return kept.document_id === undefined
                ? {
                    outcome: {
                      detail: kept.error ?? 'it could not be kept',
                      ok: false,
                      url: next.link.url,
                    },
                  }
                : {
                    effectRef: path,
                    outcome: {
                      documentId: kept.document_id,
                      how: 'download',
                      ok: true,
                      passages: [],
                      title,
                      url: next.link.url,
                    },
                  }
            }
            const got = await readAndKeep(next.link.url, 'link', via)
            // A followed page's links are dropped: the hop budget is one, by construction.
            return { effectRef: `read:${next.link.url}`, outcome: { ...got, links: [] } }
          },
        })
      }

      const run = await runSteps(db, job.jobId, 'web.research@1', steps, job)

      if (run.kind === 'paused') {
        return {
          ...base,
          announce: false,
          body: `I stopped part way through researching that, at "${run.at}": ${run.pause.detail} ${run.pause.resumeWhen}`,
        }
      }
      const outcomes = run.outcomes as Readonly<Record<string, Record<string, unknown>>>
      const kept = allKept(outcomes)
      const found: FoundPage[] = kept.map((k) => ({
        documentId: String(k.documentId),
        how: k.how ?? 'search',
        passages: k.passages ?? [],
        retrievedOn: today(),
        title: String(k.title ?? k.url),
        url: k.url,
      }))

      const notes: string[] = []
      const search = outcomes.search
      if (search?.ok !== true) {
        notes.push(
          `The search itself did not work (${String(search?.detail ?? 'no reason given')}).`,
        )
      } else if (found.length === 0) {
        notes.push('None of the pages it found could be read.')
      }
      if (run.kind === 'stopped') notes.push(`You asked me to stop, at "${run.at}".`)
      const shot = outcomes.shot
      if (wantShot && found.length > 0 && shot?.ok !== true && shot?.skipped !== true) {
        notes.push('No screenshot was possible on this runtime.')
      }

      return say(composeFindings(question, found, notes), true, [
        `job:${job.jobId}`,
        ...found.map(pageSource),
      ])
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

/** The configured runtime, else the one that needs nothing - the same ladder `browser.gather` uses. */
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
  if (account === '' || token === '') return new FetchedBrowser()
  return new CloudflareBrowser({ accountId: account, apiToken: token })
}
