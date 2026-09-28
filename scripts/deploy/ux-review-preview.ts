/**
 * An ISOLATED review copy of the page, for the Team HQ UX branch.
 *
 *   npm run deploy:ux-review
 *
 * What it does, and - as important - what it does not:
 *
 *  - uploads `web/studio` (static files only) to its OWN Vercel project,
 *    `team-hq-ux-review`, so it has its own URL and nothing it does can move
 *    an alias, a domain or a setting of `ai-team-hq` or the Basecamp site;
 *  - ships a rewrites-only `vercel.json`: the real one declares the Python
 *    notebook function, which a page review does not need;
 *  - writes NO secret, NO environment variable, NO SSO setting, NO sign-in or
 *    voice allow-list, and deploys NO edge function. The page it serves is
 *    signed out, so it shows the example projects - the same thing the public
 *    Basecamp site shows a visitor - and it cannot sign in, because the shared
 *    allow-lists are deliberately left alone.
 *
 * Files go up by digest (`/v2/files`) because inline deployment bodies are
 * refused over 10 MB (#370 item 8), and every file is read as BYTES, because
 * reading a .wav or a .zip as text corrupts it (#370 item 9).
 */
import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'

const token = process.env.VERCEL_TOKEN ?? ''
if (token === '') {
  console.error('VERCEL_TOKEN is required')
  process.exit(2)
}
const PROJECT = 'team-hq-ux-review'
const auth = { Authorization: `Bearer ${token}` }

const files: { file: string; sha: string; size: number; body: Buffer }[] = []
const walk = async (dir: string): Promise<void> => {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name !== 'raw') await walk(full)
      continue
    }
    const body = await readFile(full)
    const rel = relative('web/studio', full).split('\\').join('/')
    files.push({
      file: rel,
      sha: createHash('sha1').update(body).digest('hex'),
      size: body.length,
      body,
    })
  }
}
await walk('web/studio')
const config = Buffer.from(
  JSON.stringify(
    {
      rewrites: [
        { source: '/:path((?!api/|studio/|samples/|fonts/)[^.]*)', destination: '/index.html' },
      ],
    },
    null,
    2,
  ),
)
files.push({
  file: 'vercel.json',
  sha: createHash('sha1').update(config).digest('hex'),
  size: config.length,
  body: config,
})

let sent = 0
for (const f of files) {
  const up = await fetch('https://api.vercel.com/v2/files', {
    method: 'POST',
    headers: {
      ...auth,
      'Content-Type': 'application/octet-stream',
      'x-vercel-digest': f.sha,
      'Content-Length': String(f.size),
    },
    body: f.body,
  })
  if (!up.ok && up.status !== 409) {
    console.error(`upload failed for ${f.file}: http ${String(up.status)}`)
    process.exit(1)
  }
  sent += 1
}
console.log(`uploaded ${String(sent)} files by digest`)

const made = await fetch('https://api.vercel.com/v13/deployments', {
  method: 'POST',
  headers: { ...auth, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: PROJECT,
    /*
      Production OF THIS PROJECT, which is its own and is not the canonical
      site: a project's production domain is readable without a Vercel login,
      where a preview is behind one - and the review copy has to be something
      Grant can open, and something this sandbox's browser can render.
    */
    target: 'production',
    files: files.map((f) => ({ file: f.file, sha: f.sha, size: f.size })),
    projectSettings: { framework: null },
  }),
})
const got = (await made.json()) as {
  id?: string
  url?: string
  alias?: string[]
  error?: { message?: string }
}
if (!made.ok) {
  console.error(`deploy failed: ${JSON.stringify(got.error ?? got).slice(0, 240)}`)
  process.exit(1)
}
let state = 'QUEUED'
const started = Date.now()
while (state !== 'READY' && state !== 'ERROR' && Date.now() - started < 240_000) {
  await new Promise((r) => setTimeout(r, 4000))
  const poll = await fetch(`https://api.vercel.com/v13/deployments/${String(got.id)}`, {
    headers: auth,
  })
  const p = (await poll.json()) as { readyState?: string; alias?: string[] }
  state = String(p.readyState ?? 'UNKNOWN')
  if (Array.isArray(p.alias) && p.alias.length > 0) got.alias = p.alias
}
console.log(`deployment ${String(got.id)}: ${state}`)
console.log(`  this deploy: https://${String(got.url)}`)
for (const a of got.alias ?? []) console.log(`  alias:       https://${a}`)
process.exit(state === 'READY' ? 0 : 1)
