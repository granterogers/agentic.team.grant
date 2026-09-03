/**
 * Deploy the static voice POC page to Vercel.
 *
 *   npm run deploy:page
 *
 * Why Vercel for this and Supabase for everything else: **Supabase forces
 * `content-type: text/plain` on every response it serves**, from Edge Functions
 * and from Storage alike, with `x-content-type-options: nosniff`. Measured
 * across five ways of setting the header and both hosting paths — Storage even
 * *records* `text/html` and still serves `text/plain`. It is a deliberate
 * platform-wide XSS mitigation, not a bug, and it means Supabase cannot serve a
 * web page at all. See ADR-0011.
 *
 * So the JSON mint endpoint stays where it is and works fine; only the page
 * moves. Grant saw this as "the link just opens a text file", which is exactly
 * what a browser does with `text/plain` under `nosniff`.
 */
import { readFile } from 'node:fs/promises'

const token = process.env.VERCEL_TOKEN
if (token === undefined || token === '') {
  console.error('VERCEL_TOKEN is required')
  process.exit(2)
}

const html = await readFile('web/voice/index.html', 'utf8')

const deployment = await fetch('https://api.vercel.com/v13/deployments', {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'ai-team-hq-voice',
    target: 'production',
    // No framework, no build step. One file, served as-is — which is all a
    // POC page needs and the least that can go wrong.
    projectSettings: { framework: null },
    files: [{ file: 'index.html', data: html }],
  }),
})

const result = (await deployment.json()) as {
  url?: string
  readyState?: string
  alias?: string[]
  error?: { message?: string }
}

if (!deployment.ok) {
  console.error(
    `deploy failed: ${deployment.status} ${result.error?.message ?? JSON.stringify(result)}`,
  )
  process.exit(1)
}

const url = `https://${String(result.url)}`
console.log(`deployed: ${url}`)
console.log(`state: ${String(result.readyState)}`)
if (result.alias !== undefined && result.alias.length > 0) {
  for (const a of result.alias) console.log(`alias: https://${a}`)
}

// Poll until it is actually serving. "Deployed" and "serving" are not the same
// thing, and handing Grant a URL that 404s for thirty seconds is the same class
// of mistake as the text/plain one: a link that does not work.
for (let attempt = 1; attempt <= 20; attempt++) {
  const check = await fetch(url)
  const contentType = check.headers.get('content-type') ?? ''
  if (check.ok && contentType.includes('text/html')) {
    console.log(`\nserving: http ${check.status}, content-type: ${contentType}`)
    const body = await check.text()
    console.log(
      `${String(body.length)} bytes; mentions the mint endpoint: ${body.includes('voice-token')}`,
    )
    process.exit(0)
  }
  await new Promise((resolve) => setTimeout(resolve, 3000))
  if (attempt === 20) {
    console.error(`\nstill not serving HTML after 60s (last: ${check.status} ${contentType})`)
    process.exit(1)
  }
}
