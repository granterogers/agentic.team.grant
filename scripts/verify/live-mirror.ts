/*
 * MIRROR THE DEPLOYED SITE, AND PROVE IT IS THE DEPLOYED SITE.
 *
 * Grant, 23 September: "First determine whether the current environment can now
 * browser-test the actual deployed URL. Retry from scratch... If it still
 * genuinely cannot render the deployed URL: capture fresh evidence; continue
 * equivalent browser testing against the exact deployed source locally; compare
 * deployed/source assets; clearly preserve the distinction."
 *
 * WHAT THE ENVIRONMENT CAN AND CANNOT DO, established from scratch this run
 * rather than assumed from the last one:
 *
 *   - `curl` reaches the deployed host and verifies its certificate: the chain
 *     is the genuine Vercel one (CN=*.vercel.app, issued by Google Trust
 *     Services WR1 under GTS Root R1), so the network and the proxy are fine;
 *   - Playwright's Chromium in this container cannot verify ANY public
 *     certificate. https://example.com fails with ERR_CERT_AUTHORITY_INVALID
 *     too, with the proxy and without it. That is a missing root store in the
 *     browser build, not a property of this site — and it is why the previous
 *     run's three attempts at "trust the proxy CA" could never have worked:
 *     they were fixing the wrong thing.
 *
 * So this fetches EVERY file the deployment holds, over HTTPS, with the
 * verification that does work, checks each one against the bytes that were
 * uploaded, and writes them to `.out/live`. The acceptance pass then browses
 * THOSE bytes over plain HTTP.
 *
 * That is not the same as rendering the URL, and the report says so. It is
 * strictly stronger than testing the working tree: every byte the browser
 * executes came back from the deployed host this minute.
 */
import '../../src/safety/require-production-site.ts'
import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'

const HOST = process.env.LIVE_HOST ?? 'agentic-team-hq-basecamp-agentic-team-grant.vercel.app'
const FROM = '.out/site'
const TO = '.out/live'

const walk = async (dir: string): Promise<string[]> => {
  const out: string[] = []
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, e.name)
    if (e.isDirectory()) out.push(...(await walk(full)))
    else out.push(full)
  }
  return out
}

const sha = (b: Buffer | Uint8Array): string => createHash('sha256').update(b).digest('hex')

/*
  WHAT A PREVIEW DEPLOYMENT ADDS, AND NOTHING ELSE.

  Vercel injects its own feedback widget into a PREVIEW deployment's HTML and
  not into a production one, so a preview's index.html is 163 bytes longer than
  the bytes that were uploaded and the mirror reports it as different every
  time. Left alone that turns a real check into one somebody learns to ignore.

  So exactly that one tag is removed before comparing, and the report SAYS it
  removed it. Anything else -- a byte of the page, a script of ours, a stale
  file -- still fails, which is the whole reason the check exists.
*/
const VERCEL_FEEDBACK =
  /<script async data-explicit-opt-in="true"[^>]*vercel\.live\/_next-live\/feedback[^>]*><\/script>\s*/g
let strippedFeedback = 0
const asUploaded = (b: Buffer): Buffer => {
  const text = b.toString('utf8')
  VERCEL_FEEDBACK.lastIndex = 0
  if (!VERCEL_FEEDBACK.test(text)) return b
  VERCEL_FEEDBACK.lastIndex = 0
  strippedFeedback += 1
  return Buffer.from(text.replace(VERCEL_FEEDBACK, ''), 'utf8')
}

const built = (await walk(FROM)).map((f) => relative(FROM, f)).sort()
console.log(`${String(built.length)} file(s) in the deployment`)

/*
  WAIT FOR THE HOST TO BE SERVING WHAT WAS UPLOADED.

  A deployment that has not finished serves a placeholder of its own -- every
  file came back as the same 19,700 bytes on one run -- and the report then
  names nine files as DIFFERENT, which reads as nine files that failed to
  upload. The condition is real and it is temporary, so it is waited for and
  said out loud rather than retried invisibly.
*/
{
  const want = await readFile(join(FROM, 'index.html'))
  const until = Date.now() + 90_000
  let waited = 0
  for (;;) {
    const r = await fetch(`https://${HOST}/index.html`)
    if (r.ok) {
      const got = asUploaded(Buffer.from(await r.arrayBuffer()))
      if (sha(got) === sha(want)) break
    }
    if (Date.now() >= until) {
      console.log('  (the host is still not serving the uploaded index.html after 90s)')
      break
    }
    waited += 1
    await new Promise((ok) => setTimeout(ok, 3000))
  }
  if (waited > 0) {
    console.log(`  (waited ${String(waited * 3)}s for the deployment to start serving)`)
  }
  strippedFeedback = 0
}

let same = 0
const differ: string[] = []
const missing: string[] = []

for (const path of built) {
  /* vercel.json is configuration, not a served file. */
  if (path === 'vercel.json') continue
  const local = await readFile(join(FROM, path))
  const r = await fetch(`https://${HOST}/${path}`, { redirect: 'manual' })
  if (!r.ok) {
    missing.push(`${path} (${String(r.status)})`)
    continue
  }
  const live = asUploaded(Buffer.from(await r.arrayBuffer()))
  if (sha(live) === sha(local)) same += 1
  else differ.push(`${path} (${String(local.length)} built, ${String(live.length)} live)`)
  await mkdir(dirname(join(TO, path)), { recursive: true })
  await writeFile(join(TO, path), live)
}

console.log(`identical: ${String(same)}`)
if (strippedFeedback > 0) {
  console.log(
    `  (${String(strippedFeedback)} file(s) had Vercel's preview feedback widget removed ` +
      'before comparing — a preview carries it and a production deployment does not)',
  )
}
if (differ.length > 0) console.log(`DIFFERENT: ${differ.join(', ')}`)
if (missing.length > 0) console.log(`NOT SERVED: ${missing.join(', ')}`)

/* The redirect a person meets at the bare domain. */
const root = await fetch(`https://${HOST}/`, { redirect: 'manual' })
const to = root.headers.get('location') ?? ''
console.log(`bare domain: ${String(root.status)} -> ${to}`)

/* And that an unknown path is rewritten to the page rather than 404ing. */
const deep = await fetch(`https://${HOST}/basecamp/p/legacy-coaching-course/tasks`)
const deepBody = asUploaded(Buffer.from(await deep.arrayBuffer()))
const index = await readFile(join(FROM, 'index.html'))
console.log(
  `deep link: ${String(deep.status)}, ${sha(deepBody) === sha(index) ? 'serves the page' : 'serves something else'}`,
)

const ok =
  differ.length === 0 &&
  missing.length === 0 &&
  root.status === 307 &&
  to.includes('/basecamp/p/') &&
  sha(deepBody) === sha(index)
console.log(
  ok
    ? '\nthe mirror in .out/live IS the deployed site'
    : '\nthe mirror does not match the deployment',
)
process.exit(ok ? 0 : 1)
