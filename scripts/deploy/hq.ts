/**
 * Deploy Team HQ: the read endpoint to Supabase, the page to Vercel.
 *
 *   npm run deploy:hq
 *
 * Two hosts for one feature, and not by choice: **Supabase forces
 * `content-type: text/plain` on everything it serves**, with `nosniff`, so it
 * cannot serve a web page at all (ADR-0011, measured five ways). JSON is fine,
 * which is why the split falls where it does — API on Supabase, HTML on Vercel.
 *
 * The access token is generated once and stored in the vault. On every deploy
 * after that the existing one is reused, because rotating a token nobody asked
 * to rotate would silently lock Grant's phone out of the dashboard.
 */
import '../../src/safety/require-production-writes.ts'
import { randomBytes } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { ManagementApiExecutor } from '../../src/db/executor.ts'

const supabaseToken = process.env.SUPABASE_ACCESS_TOKEN
const vercelToken = process.env.VERCEL_TOKEN
if (supabaseToken === undefined || supabaseToken === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}

const ref = process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg'
const api = `https://api.supabase.com/v1/projects/${ref}`
const db = new ManagementApiExecutor(ref, supabaseToken)
const rotate = process.argv.includes('--rotate-token')

// --- the token -------------------------------------------------------------
const existing = (
  await db.execute(
    `select decrypted_secret as v from vault.decrypted_secrets where name = 'hq.api_token'`,
  )
).rows[0]

let token = existing?.v === undefined ? '' : String(existing.v)
if (token === '' || rotate) {
  // 32 bytes, base64url. Long enough that guessing is not a strategy, short
  // enough to paste on a phone once.
  token = randomBytes(32).toString('base64url')
  await db.execute(`
    select app.store_secret('hq.api_token', '${token.replace(/'/g, "''")}',
      'Bearer token for the Team HQ read endpoint. A capability, not a password: it grants exactly four read-only sections.')
  `)
  console.log(rotate ? 'token ROTATED (old devices must re-enter it)' : 'token generated')
} else {
  console.log('token: reusing the one in the vault')
}

// --- the endpoint ----------------------------------------------------------
const setSecrets = await fetch(`${api}/secrets`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${supabaseToken}`, 'Content-Type': 'application/json' },
  body: JSON.stringify([{ name: 'HQ_API_TOKEN', value: token }]),
})
console.log(`function secret set: http ${String(setSecrets.status)}`)

const entrypoint = await readFile('supabase/functions/hq-api/index.ts', 'utf8')
const form = new FormData()
form.append(
  'metadata',
  JSON.stringify({ name: 'hq-api', entrypoint_path: 'index.ts', verify_jwt: false }),
)
form.append('file', new File([entrypoint], 'index.ts', { type: 'application/typescript' }))
// The file reader the upload action imports as ./file-text.ts (#419): one source, uploaded beside the entrypoint.
form.append(
  'file',
  new File([await readFile('src/text/file-text.ts', 'utf8')], 'file-text.ts', {
    type: 'application/typescript',
  }),
)

// And the Slack install helpers it imports as ./oauth.ts (ADR-0065).
form.append(
  'file',
  new File([await readFile('src/slack/oauth.ts', 'utf8')], 'oauth.ts', {
    type: 'application/typescript',
  }),
)

const deployed = await fetch(`${api}/functions/deploy?slug=hq-api`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${supabaseToken}` },
  body: form,
})
const result = (await deployed.json()) as { version?: number; status?: string }
if (!deployed.ok) {
  console.error(`endpoint deploy failed: http ${String(deployed.status)} ${JSON.stringify(result)}`)
  process.exit(1)
}
const endpoint = `https://${ref}.supabase.co/functions/v1/hq-api`
console.log(`endpoint v${String(result.version)} ${String(result.status)} — ${endpoint}`)

// --- verify the endpoint, by its answers rather than its status ------------
// A Vercel deploy in this project once returned 200 with 339,010 bytes of auth
// wall; the rule since then is that a status code is not a verification.
/*
  Given time to wake up before being believed (#189).

  A Supabase edge function is cold the instant it is deployed, and the first
  request to it can time out or come back without a body — so a good deploy
  failed its own probe and printed "the endpoint did not behave as required"
  about an endpoint that was fine two seconds later. A deploy that fails
  intermittently is worse than one that is slow: it teaches whoever is running
  it to re-run without reading, which is how a real failure gets through.

  Three attempts, a second apart, and the LAST answer is the one reported — so
  a genuine misbehaviour still fails, and only the cold start is forgiven. The
  unauthenticated probe is retried with it because a 401 that has not woken up
  yet is not a 401.
*/
const wait = async (ms: number) => {
  await new Promise((r) => setTimeout(r, ms))
}
let unauthorized = await fetch(`${endpoint}?section=overview`)
let authorized = await fetch(`${endpoint}?section=overview`, {
  headers: { Authorization: `Bearer ${token}` },
})
let body = (await authorized.json().catch(() => ({}))) as { data?: { counts?: unknown } }
for (
  let go = 0;
  go < 2 && (unauthorized.status !== 401 || body.data?.counts === undefined);
  go += 1
) {
  console.log('  (cold — waiting a second and asking again)')
  await wait(1200)
  unauthorized = await fetch(`${endpoint}?section=overview`)
  authorized = await fetch(`${endpoint}?section=overview`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  body = (await authorized.json().catch(() => ({}))) as { data?: { counts?: unknown } }
}
console.log(`  unauthenticated: http ${String(unauthorized.status)} (must be 401)`)
console.log(
  `  authenticated:   http ${String(authorized.status)} counts=${body.data?.counts !== undefined ? 'present' : 'MISSING'}`,
)
if (unauthorized.status !== 401 || body.data?.counts === undefined) {
  console.error('the endpoint did not behave as required')
  process.exit(1)
}

// --- the page --------------------------------------------------------------
if (vercelToken === undefined || vercelToken === '') {
  console.log('\nVERCEL_TOKEN not set; endpoint deployed, page skipped')
  process.exit(0)
}

// Vercel turns SSO protection ON for a new project by default, and it applies
// to the deployment URL. The symptom is a 302 to `vercel.com/sso-api` and a
// 15-byte "Redirecting..." body — a page that looks deployed and cannot be
// opened. Turned off here rather than by hand, because a manual step that is
// only needed on the first deploy is a manual step nobody remembers on the
// second project.
//
// Safe to disable: the HTML holds no data. It is a login gate, and the API
// behind it requires the bearer token whoever loads the page must already have.
const projects = (await (
  await fetch('https://api.vercel.com/v9/projects?limit=100', {
    headers: { Authorization: `Bearer ${vercelToken}` },
  })
).json()) as { projects?: { id: string; name: string; ssoProtection: unknown }[] }
const project = projects.projects?.find((p) => p.name === 'ai-team-hq')
if (project !== undefined && project.ssoProtection !== null) {
  const off = await fetch(`https://api.vercel.com/v9/projects/${project.id}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${vercelToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ssoProtection: null }),
  })
  console.log(`sso protection disabled: http ${String(off.status)}`)
}

// --- the notebook reader ----------------------------------------------------
//
// It ships in THIS deployment, not its own, because a Vercel deployment is an
// atomic file list: deploying `api/` alone would delete the page.
//
// Why it exists at all: every notebook read used to shell out to Python, which
// no longer has a runtime — Actions are off and the only worker is a Deno Edge
// Function (0137). The read path needs no browser, only `httpx`, so it fits
// here as a serverless function on the project already serving the page.
const readerSecretRow = (
  await db.execute(
    `select decrypted_secret as v from vault.decrypted_secrets where name = 'notebook.reader_secret'`,
  )
).rows[0]
let readerSecret = readerSecretRow?.v === undefined ? '' : String(readerSecretRow.v)
if (readerSecret === '') {
  readerSecret = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, '')
  await db.execute(
    `select vault.create_secret(${`'${readerSecret.replace(/'/g, "''")}'`},
       'notebook.reader_secret',
       'Shared secret a worker presents to the Vercel notebook reader.')`,
  )
  console.log('reader secret: generated and stored in the vault')
} else {
  console.log('reader secret: already in the vault')
}

// Vercel keeps the SECRET and nothing else. The cookie jar stays in the vault
// and travels in the request body for the life of one call — §15 wants one home
// for a credential, and an environment variable at a third party is a second.
const envBody = JSON.stringify({
  key: 'NOTEBOOK_READER_SECRET',
  value: readerSecret,
  type: 'encrypted',
  target: ['production'],
})
if (project === undefined) {
  // First ever deploy: the project is created BY the deployment below, so
  // there is nothing to attach an environment variable to yet. Said out loud
  // rather than skipped silently, because the function answers 503 until a
  // second run and that would otherwise look like a broken reader.
  console.log(
    'reader secret on vercel: skipped — the project does not exist yet, re-run after this',
  )
} else {
  const envSet = await fetch(`https://api.vercel.com/v10/projects/${project.id}/env?upsert=true`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${vercelToken}`, 'Content-Type': 'application/json' },
    body: envBody,
  })
  console.log(`reader secret on vercel: http ${String(envSet.status)}`)
  if (!envSet.ok) {
    console.error(
      `${(await envSet.text()).slice(0, 200)}\n` +
        'the function answers 503 without it — refusing to deploy half of this',
    )
    process.exit(1)
  }
}

/*
  The studio is the page now (ADR-0019, #68).

  `web/hq/index.html` is deleted. It kept the root URL until every one of its
  fifteen write actions existed in the studio, which is the condition ADR-0019
  set — retiring it sooner would have removed capability in the name of a
  redesign, the failure 0119 named in a different context: *"a permission
  system's first job is to not change behaviour on the day it is installed."*

  Grant's bookmark is the root, so the studio serves there. `/studio/` keeps
  working, because a URL that has been handed out is a URL somebody has open.
*/
const html = await readFile('web/studio/index.html', 'utf8')

/*
  The studio prototype, at /studio/.

  Grant, looking at the deployed dashboard: *"excuse me but where all the nice
  graphics that we spent so long trying to perfect?"* — and the honest answer
  was that they had never been deployed. `web/studio` is the designed frontend,
  it has had days of visual iteration, and it existed only on disk and as PNGs
  in `.out/`. Every critique of it was made from a screenshot, which is exactly
  the thing §14A says not to do.

  It ships alongside rather than instead of. They are different things: the HQ
  page is live and wired to the office, the studio is the M0 prototype and its
  data is invented. Two URLs says that more clearly than one page trying to be
  both.

  Fonts and PDFs go up base64: Vercel's file API takes a string, and a woff2
  read as utf8 is a corrupted woff2 that fails silently as a fallback face —
  which is the exact failure the sandbox already has, and shipping it to
  production would make the one thing we cannot check locally also wrong live.
*/
/*
  Read as bytes rather than as text. A file missing from this set is uploaded
  as UTF-8 and arrives corrupted — which is a 404's quieter cousin, because the
  request succeeds and the browser simply cannot decode what it gets.

  `.webp` was missing, and #206's six materials were the first WebP this
  project has ever served.
*/
const BINARY = new Set(['.woff2', '.pdf', '.png', '.jpg', '.jpeg', '.ico', '.webp'])
/*
  Not everything under `web/studio` belongs on the internet.

  `textures/raw/` is 14 MB of source photographs that exist only to be
  re-tuned — gitignored, and it would otherwise be uploaded twice (once at the
  root and once under `studio/`) on every deploy, for nothing.
*/
const SKIP_DIRS = new Set(['raw'])
const studioFiles: { file: string; data: string; encoding?: 'base64' }[] = []
const walk = async (dir: string): Promise<void> => {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) await walk(full)
      continue
    }
    const ext = entry.name.slice(entry.name.lastIndexOf('.')).toLowerCase()
    const rel = relative('web/studio', full).split('\\').join('/')
    const at = `studio/${rel}`
    studioFiles.push(
      BINARY.has(ext)
        ? { file: at, data: (await readFile(full)).toString('base64'), encoding: 'base64' }
        : { file: at, data: await readFile(full, 'utf8') },
    )
    /*
      And at the root, because the page is served there now.

      Two copies of each asset rather than a rewrite rule: this is a static
      deployment with no routing layer, `index.html` asks for `./app.js`, and a
      relative path from `/` and from `/studio/` are different files as far as
      the host is concerned. Thirty-one small files twice is cheaper than a
      config that only one person understands.
    */
    if (rel !== 'index.html') {
      studioFiles.push(
        BINARY.has(ext)
          ? { file: rel, data: (await readFile(full)).toString('base64'), encoding: 'base64' }
          : { file: rel, data: await readFile(full, 'utf8') },
      )
    }
  }
}
await walk('web/studio')
console.log(`  studio: ${String(studioFiles.length)} files`)
const reader = await readFile('api/notebook.py', 'utf8')
// The write side, and the script it spawns. `act.py` ships as a plain file
// rather than being reimplemented in the function: fourteen actions with a
// docstring per mistake already made, and two copies would drift on the first
// library update.
const writer = await readFile('api/notebook-act.py', 'utf8')
const actScript = await readFile('scripts/notebook/act.py', 'utf8')
const requirements = await readFile('requirements.txt', 'utf8')
const vercelConfig = await readFile('vercel.json', 'utf8')
const deployment = await fetch('https://api.vercel.com/v13/deployments', {
  method: 'POST',
  headers: { Authorization: `Bearer ${vercelToken}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'ai-team-hq',
    target: 'production',
    files: [
      { file: 'index.html', data: html },
      { file: 'api/notebook.py', data: reader },
      { file: 'api/notebook-act.py', data: writer },
      { file: 'scripts/notebook/act.py', data: actScript },
      { file: 'requirements.txt', data: requirements },
      { file: 'vercel.json', data: vercelConfig },
      ...studioFiles,
    ],
    projectSettings: { framework: null },
  }),
})
const page = (await deployment.json()) as {
  id?: string
  url?: string
  error?: { message?: string }
}
if (!deployment.ok) {
  console.error(`page deploy failed: ${JSON.stringify(page.error ?? page).slice(0, 200)}`)
  process.exit(1)
}
// Wait for it to be READY before asking what it serves.
//
// This deployment has a build step now — the Python functions in `api/` — so
// the URL answers before the build finishes, with a 19KB "deploying" page that
// is a perfectly good 200. Two deploys in a row reported "NOT THE PAGE" and
// exited 1 while the deployment was in fact fine, which is a check that cries
// wolf: run it twice and you learn to ignore it.
const deploymentId = String(page.id ?? '')
if (deploymentId !== '') {
  const started = Date.now()
  let state = 'BUILDING'
  while (state !== 'READY' && state !== 'ERROR' && Date.now() - started < 240_000) {
    await new Promise((r) => setTimeout(r, 5_000))
    const poll = await fetch(`https://api.vercel.com/v13/deployments/${deploymentId}`, {
      headers: { Authorization: `Bearer ${vercelToken}` },
    })
    state = String(((await poll.json()) as { readyState?: string }).readyState ?? 'UNKNOWN')
  }
  console.log(`  build:  ${state} after ${String(Math.round((Date.now() - started) / 1000))}s`)
  if (state === 'ERROR') {
    console.error('the deployment failed to build')
    process.exit(1)
  }
}

// The page, checked by what it serves rather than by its status. A 302 to an
// auth wall is a 200 as far as `deployment.ok` is concerned.
const served = await fetch(`https://${String(page.url)}`, { redirect: 'follow' })
const servedBody = await served.text()
const looksRight =
  served.status === 200 &&
  (served.headers.get('content-type') ?? '').includes('text/html') &&
  servedBody.includes('Team HQ')
console.log(`\npage: https://ai-team-hq.vercel.app  (this deploy: https://${String(page.url)})`)
console.log(
  `  served: http ${String(served.status)} ${String(served.headers.get('content-type'))} ${String(servedBody.length)} bytes — ${looksRight ? 'ok' : 'NOT THE PAGE'}`,
)
if (!looksRight) {
  console.error('the page URL did not serve the page')
  process.exit(1)
}

/*
  And a DEEP LINK, which is the half no test on this machine can cover (#157).

  `verify:routes` runs against a server that performs the same rewrite by hand,
  so it proves the studio reads and writes its address correctly and proves
  nothing whatever about `vercel.json`. A rewrite that stops matching is
  invisible in every local check and turns every link Grant has saved into a
  404 — which is the one failure mode of this feature that matters, because the
  whole point of it is links that outlive the session.

  A project slug is not needed: an unknown one is a legitimate route and lands
  on the portfolio, so the assertion is that the HOST served the application
  rather than looked for a file.
*/
const deep = await fetch(`https://${String(page.url)}/p/any-project/tasks`)
const deepBody = await deep.text()
const deepOk = deep.status === 200 && deepBody.includes('Team HQ')
console.log(
  `  deep link: http ${String(deep.status)} — ${deepOk ? 'the rewrite is live' : 'THE REWRITE IS NOT WORKING'}`,
)
if (!deepOk) {
  console.error('a saved link to a project would 404 — check the rewrite in vercel.json')
  process.exit(1)
}
// --- and prove the reader reads --------------------------------------------
//
// By behaviour, not by status. A Python function that failed to install its
// dependency still serves a 200 for the liveness route and fails only on the
// one call that matters.
const readerBase = `https://${String(page.url)}/api/notebook`
const readerLive = await fetch(readerBase)
const readerLiveBody = (await readerLive.json().catch(() => ({}))) as {
  ok?: boolean
  configured?: boolean
}
console.log(
  `  reader: http ${String(readerLive.status)} configured=${String(readerLiveBody.configured)}`,
)

const jar = String(
  (
    await db.execute(
      `select decrypted_secret as v from vault.decrypted_secrets
        where name = 'notebook.storage_state'`,
    )
  ).rows[0]?.v ?? '',
)
if (jar === '') {
  console.log('  reader: no cookie jar in the vault, so the read was not attempted')
} else {
  const read = await fetch(readerBase, {
    method: 'POST',
    headers: { Authorization: `Bearer ${readerSecret}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ op: 'notebooks', storage_state: jar }),
  })
  const list = (await read.json().catch(() => ({}))) as { error?: string } | { id: string }[]
  const count = Array.isArray(list) ? list.length : -1
  console.log(
    `  reader: http ${String(read.status)} ` +
      (count >= 0
        ? `${String(count)} notebook(s)`
        : `error=${String((list as { error?: string }).error).slice(0, 120)}`),
  )
  if (count < 0) {
    console.error('the notebook reader is deployed but cannot read — see the message above')
    process.exit(1)
  }
}

// The writer, proved with an action that changes nothing.
//
// `notebooks` goes through the same auth, the same spawn and the same JSON
// relay as `add_text` does — so it proves the transport without putting a
// deployment probe's leavings in Grant's notebook. A write is exercised when
// he asks for one, not by a deploy script.
const writerBase = `https://${String(page.url)}/api/notebook-act`
const writerLive = await fetch(writerBase)
const writerLiveBody = (await writerLive.json().catch(() => ({}))) as { configured?: boolean }
console.log(
  `  writer: http ${String(writerLive.status)} configured=${String(writerLiveBody.configured)}`,
)
if (jar !== '') {
  const acted = await fetch(writerBase, {
    method: 'POST',
    headers: { Authorization: `Bearer ${readerSecret}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'notebooks', args: { notebook_id: 'any' }, storage_state: jar }),
  })
  const actedBody = (await acted.json().catch(() => ({}))) as {
    ok?: boolean
    error?: string
    notebooks?: unknown[]
  }
  console.log(
    `  writer: http ${String(acted.status)} ok=${String(actedBody.ok)} ` +
      (actedBody.ok === true
        ? `${String(actedBody.notebooks?.length ?? 0)} notebook(s) through the write path`
        : `error=${String(actedBody.error).slice(0, 140)}`),
  )
  if (actedBody.ok !== true) {
    console.error('the notebook writer is deployed but cannot act — see the message above')
    process.exit(1)
  }
}

// The token is deliberately NOT printed.
//
// This script printed it once, into a session transcript, which is the same
// mistake that put Google session cookies in one earlier in the week. A
// transcript is a durable, copied, searchable place; a token that reaches one
// has to be rotated.
//
// `npm run hq:token` sends it to Grant on Telegram instead — his own device,
// through the delivery path this system already owns.
console.log('\ntoken: in the vault as `hq.api_token`, deliberately not printed here.')
console.log('       `npm run hq:token` sends it to Grant on Telegram.')
