/**
 * OPT-IN live check of the web-research tier against the PUBLIC internet. Not in any default gate, never run by `npm test`.
 *
 *   unset SUPABASE_ACCESS_TOKEN SUPABASE_PROJECT_REF SUPABASE_SERVICE_ROLE_KEY SUPABASE_DB_URL
 *   npx tsx scripts/verify/web-live.ts
 *
 * Needs no secret and touches no database. It sends one public search (the QUESTION leaves the machine, which is the cost of
 * searching) and fetches two public pages and one public PDF through the project's own abstractions: `DuckDuckGoHtmlSearch`,
 * `FetchedBrowser`, `chooseLinks`, `downloadFile`. A search engine may answer a datacentre address with a challenge; that is
 * reported as exactly that and is NOT a failure of this script (the honest-failure branch is what is being observed).
 * TLS verification stays on. Behind the agent proxy Node needs NODE_USE_ENV_PROXY=1 and NODE_EXTRA_CA_CERTS.
 */

import { downloadFile } from '../../src/browser/download.ts'
import { FetchedBrowser } from '../../src/browser/fetched.ts'
import { termsOf } from '../../src/browser/links.ts'
import { chooseLinks } from '../../src/browser/research.ts'
import { DuckDuckGoHtmlSearch } from '../../src/browser/search.ts'

let failed = 0
const check = (name: string, ok: boolean, detail = ''): void => {
  if (!ok) failed += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail === '' ? '' : ` - ${detail}`}`)
}

// 1. search: either real results or an honest unavailable, never an empty success.
const found = await new DuckDuckGoHtmlSearch().search('wikipedia', 5)
if (found.ok) {
  check(
    'search returned public https results',
    found.results.length > 0 &&
      found.results.every((r) => r.url.startsWith('https://') && !/duckduckgo\.com/.test(r.url)),
    `${String(found.results.length)} results, first ${found.results[0]?.url ?? '-'}`,
  )
} else {
  check(
    'search was refused HONESTLY (challenge or slow-down), not read as no results',
    /slow down|challenge|http|timed out|failed/.test(found.detail),
    found.detail,
  )
}

// 2. page read + link bounds, through the real reader.
const browser = new FetchedBrowser()
const page = await browser.gather({
  url: 'https://www.iana.org/help/example-domains',
  verbs: ['read'],
})
check(
  'a real page was read',
  page.ok && (page.text ?? '').length > 200,
  `${page.title ?? '-'} (${String((page.text ?? '').length)} chars)`,
)
const links = page.links ?? []
check('the page yielded links', links.length > 0, `${String(links.length)} links`)
const picked = chooseLinks(
  [{ links, url: 'https://www.iana.org/help/example-domains' }],
  termsOf('reserved example domains documentation'),
  2,
  new Set(),
)
check(
  'link following is bounded (<= 2) and public',
  picked.length <= 2 && picked.every((p) => p.link.url.startsWith('https://')),
  picked.map((p) => p.link.url).join(' '),
)

// 3. refusals: private address and a page (HTML) offered as a download.
const priv = await browser.gather({
  url: 'http://169.254.169.254/latest/meta-data',
  verbs: ['read'],
})
check(
  'a private address is refused before any request',
  !priv.ok && /refused/.test(priv.detail),
  priv.detail,
)
const html = await downloadFile('https://www.iana.org/help/example-domains')
check(
  'an HTML page is not kept as a download',
  !html.ok && /not a type/.test(html.detail),
  html.ok ? 'kept!' : html.detail,
)

// 4. a small public PDF is the one kind kept.
const pdf = await downloadFile(
  'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf',
)
check(
  'a small public PDF was downloaded with the right bytes',
  pdf.ok && pdf.mime === 'application/pdf' && pdf.bytes.byteLength > 100,
  pdf.ok ? `${String(pdf.bytes.byteLength)} bytes` : pdf.detail,
)

console.log(failed === 0 ? '\nlive checks done' : `\n${String(failed)} live check(s) failed`)
process.exitCode = failed === 0 ? 0 : 1
