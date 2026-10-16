/**
 * An ISOLATED static copy of the visual review gallery, for reading on a phone.
 *
 *   GALLERY_DIR=.out/site npm run deploy:gallery
 *
 * It uploads one folder of static files (index.html, manifest.json, thumbs/, screenshots/) to its OWN Vercel project, so it has its own URL
 * and cannot move an alias, a domain or a setting of `ai-team-hq` or of `team-hq-ux-review`. It ships a headers-only `vercel.json` and a
 * `robots.txt` that ask search engines to stay away. It writes no secret and no environment variable, deploys no function, and the page it
 * serves makes no request outside its own origin (the gallery is plain HTML with relative image links).
 *
 * The screenshots are synthetic demonstration data only; the project's address is the only access control (no Vercel login, no paid
 * protection), so treat the link as private review material.
 */
import '../../src/safety/require-production-writes.ts'
import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'

const token = process.env.VERCEL_TOKEN ?? ''
if (token === '') {
  console.error('VERCEL_TOKEN is required')
  process.exit(2)
}
const DIR = process.env.GALLERY_DIR ?? ''
if (DIR === '') {
  console.error('GALLERY_DIR is required (the assembled static gallery folder)')
  process.exit(2)
}
const PROJECT = process.env.GALLERY_PROJECT ?? 'hq-visual-review-k7x2m9'
const auth = { Authorization: `Bearer ${token}` }

const files: { file: string; sha: string; size: number; body: Buffer }[] = []
const add = (file: string, body: Buffer): void => {
  files.push({ file, sha: createHash('sha1').update(body).digest('hex'), size: body.length, body })
}
const walk = async (dir: string): Promise<void> => {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, e.name)
    if (e.isDirectory()) await walk(full)
    else add(relative(DIR, full).split('\\').join('/'), await readFile(full))
  }
}
await walk(DIR)
add('robots.txt', Buffer.from('User-agent: *\nDisallow: /\n'))
add(
  'vercel.json',
  Buffer.from(
    JSON.stringify(
      {
        headers: [
          {
            source: '/(.*)',
            headers: [
              { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
              { key: 'Referrer-Policy', value: 'no-referrer' },
              { key: 'X-Content-Type-Options', value: 'nosniff' },
            ],
          },
          {
            source: '/(thumbs|screenshots)/(.*)',
            headers: [{ key: 'Cache-Control', value: 'public, max-age=86400' }],
          },
        ],
      },
      null,
      2,
    ),
  ),
)

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
    body: typeof f.body === 'string' ? f.body : new Uint8Array(f.body ?? new Uint8Array()),
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
    // Production OF THIS PROJECT, which is its own: a project's production domain is readable without a Vercel login.
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
