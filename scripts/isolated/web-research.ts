/**
 * Web research (0930) - the real handler driven end to end on a LOCAL replica, with every network behaviour injected.
 *
 *   npx tsx scripts/isolated/web-research.ts <replica-db>      (default: cand_web)
 *
 * Search, every page, the screenshot, the download and the storage write are functions in this file: NOTHING here makes an
 * outbound call. It runs inside one transaction that is rolled back, and refuses to start anywhere that is not a marked
 * replica on a Unix socket (`isolated()`). Real parts under test: the handler, the checkpoint steps, the ledger writers,
 * the provenance reader, `FetchedBrowser`'s link extraction and its address guard.
 *
 * NOT proved here (needs a live run, flagged in docs/ux-be-web-notes.md): the DuckDuckGo markup against the real service,
 * the Cloudflare runtime's screenshot and link extraction, and Supabase Storage accepting the bytes.
 */
import type { BrowserAdapter, GatherRequest, GatherResult } from '../../src/browser/adapter.ts'
import { FetchedBrowser } from '../../src/browser/fetched.ts'
import type { SearchProvider } from '../../src/browser/search.ts'
import { webResearchHandler } from '../../src/handlers/web-research.ts'
import type { Job } from '../../src/jobs/worker.ts'
import { isolated } from './guard.ts'

const db = await isolated(process.argv[2] ?? 'cand_web')
const one = async (sql: string): Promise<Record<string, unknown>> =>
  (await db.execute(sql)).rows[0] as Record<string, unknown>
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
let failed = 0
const check = (name: string, ok: boolean, detail = ''): void => {
  if (!ok) failed += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail === '' ? '' : ` - ${detail}`}`)
}
const J = (x: unknown): Record<string, unknown> =>
  (typeof x === 'string' ? JSON.parse(x) : x) as Record<string, unknown>

// ---- the fake web --------------------------------------------------------------------------------------------------
const LONG = (s: string): string => `${s} `.repeat(40)
const SITE: Record<string, string> = {
  'https://a.example/widgets': `<html><head><title>Widget pricing guide</title></head><body>
    <p>Widget pricing for small shops starts at forty pounds a month and is billed annually, which most small shops prefer.</p>
    <p>${LONG('Our company history is long and not relevant to anything.')}</p>
    <a href="/widgets/small-shop-pricing">Small shop widget pricing</a>
    <a href="/files/widget-pricing.pdf">Widget pricing sheet</a>
    <a href="/cart/add/widget-pricing-small-shops">Add widget pricing for small shops to cart</a>
    <a href="/logout">Log out</a>
    <a href="/unsubscribe/widget-pricing-small-shops?id=4">Unsubscribe from widget pricing for small shops</a>
    <a href="http://10.0.0.7/widget-pricing">Internal widget pricing</a>
    <a href="/careers">Careers</a></body></html>`,
  'https://a.example/widgets/small-shop-pricing': `<html><head><title>Small shop plan</title></head><body>
    <p>The small shop plan is the cheapest widget pricing option and includes email support for every small shop.</p>
    <a href="/widgets/deep-pricing-page">Deeper widget pricing page</a><p>${LONG('Filler about shops.')}</p></body></html>`,
  'https://b.example/review': `<html><head><title>Widget review</title></head><body>
    <p>An independent review of widget pricing finds the small shops tier fair against competitors in the market.</p>
    <p>${LONG('More review words.')}</p></body></html>`,
}
const PDF = new TextEncoder().encode('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n')
const fetched: string[] = []
const fakeFetch = (async (u: string, init?: RequestInit) => {
  fetched.push(`${init?.method ?? 'GET'} ${u}`)
  const html = SITE[u.replace(/#.*/, '')]
  return html === undefined
    ? new Response('not found', { status: 404 })
    : new Response(html, { headers: { 'content-type': 'text/html' } })
}) as unknown as typeof fetch

const readCalls: string[] = []
const shotCalls: string[] = []
const real = new FetchedBrowser({ fetchImpl: fakeFetch })
const adapter: BrowserAdapter = {
  name: 'fetched+fake-shot',
  async gather(req: GatherRequest): Promise<GatherResult> {
    if (req.verbs.includes('shot')) {
      shotCalls.push(req.url)
      return {
        detail: 'photographed',
        ms: 5,
        ok: true,
        shot: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2]),
        signedOut: false,
        stopped: false,
        text: null,
        title: null,
      }
    }
    readCalls.push(req.url)
    return real.gather(req)
  },
}
const searchedFor: string[] = []
const search: SearchProvider = {
  name: 'fixture-search',
  urlFor: (q) => `https://search.fixture.invalid/?q=${encodeURIComponent(q)}`,
  async search(q) {
    searchedFor.push(q)
    return {
      ok: true,
      provider: 'fixture-search',
      results: [
        { rank: 1, snippet: '', title: 'Widget pricing guide', url: 'https://a.example/widgets' },
        {
          rank: 2,
          snippet: '',
          title: 'Metadata',
          url: 'http://169.254.169.254/latest/meta-data/',
        },
        { rank: 3, snippet: '', title: 'A file', url: 'https://a.example/files/other.pdf' },
        { rank: 4, snippet: '', title: 'Widget review', url: 'https://b.example/review' },
        { rank: 5, snippet: '', title: 'Dead link', url: 'https://c.example/gone' },
      ],
    }
  },
}
const stored: { path: string; mime: string; bytes: number }[] = []
const store = (async (
  _ref: string,
  _key: string,
  path: string,
  bytes: Uint8Array,
  mime: string,
) => {
  stored.push({ bytes: bytes.byteLength, mime, path })
  return { bytes: bytes.byteLength, error: null, ok: true, path }
}) as never
const downloaded: string[] = []
const download = (async (url: string) => {
  downloaded.push(url)
  return { bytes: PDF, ext: 'pdf', finalUrl: url, mime: 'application/pdf', ms: 7, ok: true }
}) as never

await db.execute('begin')
try {
  const A = String(
    (
      await one(
        `select office_id::text o from public.offices where kind = 'person' order by created_at limit 1`,
      )
    ).o,
  )
  const PA = String(
    (
      await one(
        `insert into public.projects (slug, name, office_id) values ('zz-wr-a', 'WR A', ${lit(A)}::uuid) returning project_id::text id`,
      )
    ).id,
  )
  const makeJob = async (by: string, config: Record<string, unknown>): Promise<Job> => {
    const id = String(
      (
        await one(
          `insert into public.jobs (kind, requested_by, project_id, office_id, idempotency_key, correlation_id, pinned_config, recipient_agent)
           values ('web.research', ${lit(by)}, ${lit(PA)}::uuid, ${lit(A)}::uuid, 'wr-' || gen_random_uuid(), gen_random_uuid(),
                   ${lit(JSON.stringify(config))}::jsonb, 'chief-of-staff') returning job_id::text id`,
        )
      ).id,
    )
    return {
      attempt: 1,
      correlationId: id,
      idempotencyKey: id,
      jobId: id,
      kind: 'web.research',
      projectId: PA,
    }
  }
  const handler = webResearchHandler({
    adapter,
    db,
    download,
    projectRef: 'local',
    search,
    serviceKey: 'local',
    store,
  })
  const reset = (): void => {
    for (const a of [fetched, readCalls, shotCalls, searchedFor, downloaded]) a.length = 0
    stored.length = 0
  }

  // ===== 1. the happy path ===========================================================================================
  const job = await makeJob('telegram:424242', {
    by: 'chief-of-staff',
    question: 'what does widget pricing cost for small shops',
  })
  const out = await handler.handle(job, db)
  console.log(`\n--- body ---\n${out.body}\n--- sources ---\n${(out.sources ?? []).join('\n')}\n`)
  check(
    'it searched once, for the question',
    searchedFor.length === 1 && searchedFor[0]?.includes('widget pricing') === true,
  )
  check(
    'it read the two public pages the search offered',
    readCalls.includes('https://a.example/widgets') &&
      readCalls.includes('https://b.example/review'),
  )
  check(
    'it never opened the metadata address, the search-result file, or anything private',
    !fetched.some(
      (f) => f.includes('169.254') || f.includes('10.0.0.7') || f.includes('other.pdf'),
    ),
  )
  check(
    'it followed the ONE relevant link',
    readCalls.includes('https://a.example/widgets/small-shop-pricing'),
  )
  check(
    'it did not follow cart, logout, unsubscribe, careers or the private link',
    !readCalls.some((u) => /cart|logout|unsubscribe|careers|10\.0\.0\.7/.test(u)),
  )
  check(
    "depth is one: the followed page's own link was never taken",
    !readCalls.includes('https://a.example/widgets/deep-pricing-page'),
  )
  check(
    'every request was a bodiless GET',
    fetched.every((f) => f.startsWith('GET ')),
  )
  check(
    'it photographed the first page and stored the PNG',
    shotCalls.length === 1 && stored.some((s) => s.mime === 'image/png'),
  )
  check(
    'it downloaded the one relevant file and stored it as a pdf',
    downloaded.length === 1 && stored.some((s) => s.mime === 'application/pdf'),
    downloaded.join(),
  )
  check(
    'the body cites saved rows and says it only read',
    /\[browser:[0-9a-f-]{36}\]/.test(out.body) && /did not press, submit or send/.test(out.body),
  )
  check(
    'the output is a deterministic retrieval, medium confidence, not "verified"',
    out.path === 'deterministic_retrieval' &&
      out.confidence === 'medium' &&
      out.evidence === 'inferred',
  )
  check(
    'its sources carry browser:<id> for every kept page',
    (out.sources ?? []).filter((s) => s.startsWith('browser:')).length >= 3,
  )

  const docs = (
    await db.execute(
      `select document_id::text id, external_ref url, origin, connector, produced_by_job::text pj, content is not null has_text, storage_path from public.documents where project_id = ${lit(PA)}::uuid order by created_at`,
    )
  ).rows as Record<string, unknown>[]
  check(
    'pages are saved as sources by this job',
    docs.length >= 3 &&
      docs.every((d) => d.origin === 'source' && d.connector === 'browser' && d.pj === job.jobId),
  )
  check(
    'a file is saved without text, with its storage path',
    docs.some(
      (d) => String(d.url).endsWith('.pdf') && d.has_text === false && d.storage_path !== null,
    ),
  )

  const ledger = (
    await db.execute(
      `select verb, url, ok, found_via from public.browser_actions where job_id = ${lit(job.jobId)}::uuid`,
    )
  ).rows as { verb: string; url: string; ok: boolean; found_via: unknown }[]
  check(
    'the ledger holds only reading verbs',
    ledger.length > 0 && ledger.every((l) => ['open', 'read', 'shot', 'download'].includes(l.verb)),
    [...new Set(ledger.map((l) => l.verb))].join(),
  )
  const viaSearch = ledger.find((l) => l.verb === 'read' && l.url === 'https://a.example/widgets')
  const viaLink = ledger.find(
    (l) => l.verb === 'read' && l.url === 'https://a.example/widgets/small-shop-pricing',
  )
  check(
    'how each page was reached is on the ledger',
    J(viaSearch?.found_via).how === 'search' &&
      J(viaSearch?.found_via).rank === 1 &&
      J(viaLink?.found_via).how === 'link' &&
      J(viaLink?.found_via).from === 'https://a.example/widgets' &&
      J(viaLink?.found_via).depth === 1,
  )
  check(
    'the search itself is recorded as an open of the search address',
    ledger.some(
      (l) =>
        l.verb === 'open' &&
        l.url.startsWith('https://search.fixture.invalid/') &&
        J(l.found_via).how === 'search',
    ),
  )

  // ===== 2. the provenance reader, over what the run produced =================================================
  const rd = J((await one(`select app.hq_project_sources_web(${lit(A)}::uuid, 'zz-wr-a') r`)).r)
  const pages = rd.pages as Record<string, unknown>[]
  check('the reader lists them', Number(rd.count) === docs.length)
  const first = pages.find((p) => p.url === 'https://a.example/widgets')
  check(
    'agent, job, research question and day are all there',
    J(first?.agent).slug === 'chief-of-staff' &&
      first?.job_id === job.jobId &&
      J(first?.research_task).job_id === job.jobId &&
      String(J(first?.research_task).label).includes('widget pricing') &&
      first?.retrieved_at !== null,
  )
  check('screenshot availability is reported', J(first?.screenshot).available === true)
  const fl = pages.find((p) => String(p.url).endsWith('.pdf'))
  check('the file shows as a file, not indexed', fl?.kind === 'file' && fl?.indexed === false)

  // ===== 3. resume does not repeat the outside world ===================================================================
  reset()
  const again = await handler.handle(job, db)
  check(
    'running the same job again fetches, searches, stores and downloads nothing more',
    fetched.length === 0 &&
      readCalls.length === 0 &&
      searchedFor.length === 0 &&
      stored.length === 0 &&
      downloaded.length === 0,
    `fetched ${String(fetched.length)}`,
  )
  check('and says the same thing', again.body.includes('browser:'))

  // ===== 4. a page budget is a ceiling =================================================================================
  reset()
  const small = await makeJob('telegram:424242', {
    max_pages: 1,
    question: 'widget pricing small shops',
    screenshot: false,
  })
  await handler.handle(small, db)
  const n = Number(
    (
      await one(
        `select count(*) c from public.documents where produced_by_job = ${lit(small.jobId)}::uuid`,
      )
    ).c,
  )
  check(
    'max_pages 1 keeps one page and takes no screenshot',
    n === 1 && shotCalls.length === 0,
    `kept ${String(n)}`,
  )

  // ===== 5. a failed search says so and keeps nothing ===================================================================
  reset()
  const dead = webResearchHandler({
    adapter,
    db,
    download,
    projectRef: 'local',
    serviceKey: 'local',
    store,
    search: {
      name: 'dead',
      urlFor: () => 'https://search.fixture.invalid/',
      search: async () => ({
        detail: 'the search engine put up a challenge instead of results',
        ok: false,
        provider: 'dead',
      }),
    },
  })
  const failedJob = await makeJob('telegram:424242', { question: 'anything at all here' })
  const failedOut = await dead.handle(failedJob, db)
  check(
    'it says the search did not work and kept nothing',
    /search itself did not work/.test(failedOut.body) &&
      /kept nothing/.test(failedOut.body) &&
      readCalls.length === 0,
  )
  check(
    'and cites nothing it did not read',
    !(failedOut.sources ?? []).some((s) => s.startsWith('browser:')),
  )

  // ===== 6. harness work never reaches the web =========================================================================
  reset()
  const harness = await makeJob(`verify:wr-${Date.now().toString(36)}`, {
    question: 'harness question words',
  })
  const hOut = await handler.handle(harness, db)
  const hLedger = Number(
    (
      await one(
        `select count(*) c from public.browser_actions where job_id = ${lit(harness.jobId)}::uuid`,
      )
    ).c,
  )
  check(
    'a harness job is contained: no search, no page, no ledger row, no document',
    /contained/.test(hOut.body) &&
      searchedFor.length === 0 &&
      fetched.length === 0 &&
      hLedger === 0,
  )
  const fx = await makeJob('telegram:424242', { question: 'fixture project question' })
  await db.execute(
    `update public.projects set slug = 'fixture-zz-wr', name = 'fixture wr' where project_id = ${lit(PA)}::uuid`,
  )
  const fxOut = await handler.handle(fx, db)
  check(
    'and so is a real-looking job in a FIXTURE project',
    /contained/.test(fxOut.body) && searchedFor.length === 0,
  )
  await db.execute(
    `update public.projects set slug = 'zz-wr-a', name = 'WR A' where project_id = ${lit(PA)}::uuid`,
  )

  // ===== 7. the free budget is a ceiling =================================================================================
  reset()
  await db.execute(
    `insert into public.system_config (key, value, description) values ('browser.daily_minutes', '0'::jsonb, 'proof') on conflict (key) do update set value = '0'::jsonb`,
  )
  const broke = await handler.handle(
    await makeJob('telegram:424242', { question: 'out of minutes question' }),
    db,
  )
  check(
    'with no browser-minutes left it opens nothing and says why',
    /browser-minutes/.test(broke.body) && searchedFor.length === 0,
  )
} finally {
  await db.execute('rollback')
  await db.end()
}
console.log(
  failed === 0
    ? '\nweb-research: all checks passed (rolled back)'
    : `\nweb-research: ${String(failed)} CHECK(S) FAILED (rolled back)`,
)
process.exitCode = failed === 0 ? 0 : 1
