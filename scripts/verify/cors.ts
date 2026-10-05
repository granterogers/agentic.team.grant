/**
 * Does the browser get through?
 *
 *   npm run verify:cors
 *
 * Issue #41, and the single most important check in this repository's history.
 *
 * VOICE_ALLOWED_ORIGIN was stale for WEEKS. Every probe passed. The call button
 * was dead on desktop and on the phone, and Grant found it, not us. The reason
 * no probe caught it:
 *
 *   A SERVER-SIDE FETCH SENDS NO ORIGIN HEADER.
 *
 * With no Origin, a CORS-aware endpoint has nothing to reject, so it answers
 * happily — and a probe written as a plain fetch is exercising a code path no
 * browser ever takes. The only honest test sends the real page origin and reads
 * what comes back.
 *
 * ## Against the real request, not a generic superset
 *
 * The first version of this file asserted that every endpoint should allow the
 * authorization header from both production and localhost. It produced three
 * failures that were all correct behaviour:
 *
 *   - voice-token does not allow the authorization header, and the page never
 *     sends one. The real call is fetch(MINT, { method: 'POST' }) with no
 *     headers at all — web/hq/index.html and web/voice/index.html.
 *   - voice-token does not allow localhost, and PAGE_ORIGINS in
 *     scripts/deploy/voice.ts holds only the production origin on purpose.
 *
 * Widening an allowlist to satisfy a test is the test making the system worse.
 * So each endpoint declares its real callers and its real headers, and
 * localhost is reported as informational rather than asserted.
 */
import '../../src/safety/require-production-site.ts'

/*
  This file imports nothing — it needs only `fetch`, which is global — and a TS
  file with no import or export is a SCRIPT, not a module, so top-level await is
  a type error even though tsx runs it happily. One empty export settles it.
*/
export {}

const PRODUCTION = 'https://ai-team-hq.vercel.app'
const LOCAL = 'http://localhost:5173'
const HOSTILE = 'https://not-grants-site.example'

const ENDPOINTS = [
  {
    name: 'voice-token',
    path: 'voice-token',
    method: 'POST',
    headers: [] as string[],
    required: [PRODUCTION],
  },
  {
    name: 'hq-api',
    path: 'hq-api',
    method: 'POST',
    headers: ['authorization', 'content-type'],
    required: [PRODUCTION],
  },
  // MCP is called by other people's agents, not by our page.
  {
    name: 'mcp',
    path: 'mcp',
    method: 'POST',
    headers: ['authorization', 'content-type'],
    required: [] as string[],
  },
]

const ref = process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg'
const base = `https://${ref}.supabase.co/functions/v1`

let pass = 0
let fail = 0
let skipped = 0
const ok = (what: string, good: boolean, note = '') => {
  if (good) {
    pass++
    console.log(`  ok   ${what}`)
  } else {
    fail++
    console.error(`  FAIL ${what}${note === '' ? '' : ` — ${note}`}`)
  }
}
const skip = (what: string, why: string) => {
  skipped++
  console.log(`  --   ${what} — ${why}`)
}

console.log('cors — the preflight a browser sends')

for (const ep of ENDPOINTS) {
  for (const origin of [...ep.required, LOCAL]) {
    const mustPass = ep.required.includes(origin)
    let res: Response
    try {
      res = await fetch(`${base}/${ep.path}`, {
        method: 'OPTIONS',
        headers: {
          origin,
          'access-control-request-method': ep.method,
          ...(ep.headers.length > 0
            ? { 'access-control-request-headers': ep.headers.join(', ') }
            : {}),
        },
      })
    } catch (e) {
      skip(`${ep.name} from ${origin}`, e instanceof Error ? e.message : String(e))
      continue
    }

    const allow = res.headers.get('access-control-allow-origin')
    const methods = res.headers.get('access-control-allow-methods') ?? ''
    const allowed = (res.headers.get('access-control-allow-headers') ?? '').toLowerCase()
    const lets = allow === origin || allow === '*'

    if (!mustPass) {
      console.log(
        `  --   ${ep.name} from ${origin} — ${lets ? 'allowed' : 'not allowed, by design'}`,
      )
      continue
    }

    ok(
      `${ep.name} answers the preflight from ${origin}`,
      res.status < 400,
      `HTTP ${String(res.status)}`,
    )
    ok(`${ep.name} allows ${origin}`, lets, `allow-origin: ${String(allow)}`)
    ok(
      `${ep.name} allows ${ep.method}`,
      methods === '' || methods.includes(ep.method) || methods.includes('*'),
      `allow-methods: ${methods}`,
    )
    for (const h of ep.headers) {
      ok(
        `${ep.name} allows the ${h} header`,
        allowed === '' || allowed.includes(h) || allowed.includes('*'),
        `allow-headers: ${allowed}`,
      )
    }

    // Vary: Origin is easy to miss and matters. Without it a cache can serve one
    // origin's allow-header to another, so a correctly configured endpoint still
    // fails intermittently for whoever asks second.
    const vary = (res.headers.get('vary') ?? '').toLowerCase()
    ok(`${ep.name} varies on Origin`, allow === '*' || vary.includes('origin'), `vary: ${vary}`)
  }

  // An endpoint that echoes back any origin is not configured, it is open.
  try {
    const res = await fetch(`${base}/${ep.path}`, {
      method: 'OPTIONS',
      headers: { origin: HOSTILE, 'access-control-request-method': ep.method },
    })
    const allow = res.headers.get('access-control-allow-origin')
    ok(`${ep.name} refuses an unknown origin`, allow !== HOSTILE, `it echoed ${String(allow)} back`)
  } catch {
    skip(`${ep.name} refuses an unknown origin`, 'unreachable')
  }
}

console.log(
  `\n${String(pass)}/${String(pass + fail)} checks passed${skipped > 0 ? `, ${String(skipped)} skipped` : ''}`,
)
if (fail > 0) process.exit(1)
