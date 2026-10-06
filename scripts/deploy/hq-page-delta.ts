/**
 * Deploy the Team HQ PAGE alone, uploading only what changed.
 *
 *   npx tsx scripts/deploy/hq-page-delta.ts          # compare with production, change nothing
 *   npx tsx scripts/deploy/hq-page-delta.ts --go     # deploy
 *
 * `deploy:hq` sends every file inline in one request body and now exceeds Vercel's 10 MB limit
 * (the studio is served twice, at `/` and `/studio/`), so its page step fails after its function
 * step succeeds. This builds the SAME file set with the same rules, sends digests instead of
 * bodies, and uploads only the files Vercel says it does not hold - the method the #382 cutover
 * used by hand. It never touches a function, a secret, an env var or a project setting.
 *
 * It refuses to deploy when its file NAMES differ from the live deployment's, because a
 * different set is a different page. The previous deployment is printed as the rollback point.
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
const go = process.argv.includes('--go')
// The studio folder to send. The default is the working tree; a staged tree (live bytes plus one change) is named here.
const ROOT =
  process.argv.find((a) => a.startsWith('--root='))?.slice('--root='.length) ?? 'web/studio'
const auth = { Authorization: `Bearer ${token}` }
const BINARY = new Set(['.woff2', '.pdf', '.png', '.jpg', '.jpeg', '.ico', '.webp'])
const SKIP_DIRS = new Set(['raw'])

const files = new Map<string, Buffer>()
const add = async (name: string, path: string) => files.set(name, await readFile(path))
await add('index.html', join(ROOT, 'index.html'))
await add('api/notebook.py', 'api/notebook.py')
await add('api/notebook-act.py', 'api/notebook-act.py')
await add('scripts/notebook/act.py', 'scripts/notebook/act.py')
await add('requirements.txt', 'requirements.txt')
await add('vercel.json', 'vercel.json')
const walk = async (dir: string): Promise<void> => {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) await walk(full)
      continue
    }
    const ext = entry.name.slice(entry.name.lastIndexOf('.')).toLowerCase()
    void BINARY.has(ext) // bytes are read raw either way; the set documents which are not text
    const rel = relative(ROOT, full).split('\\').join('/')
    await add(`studio/${rel}`, full)
    if (rel !== 'index.html') await add(rel, full)
  }
}
await walk(ROOT)
const sha = (b: Buffer) => createHash('sha1').update(b).digest('hex')
const list = [...files].map(([file, body]) => ({ file, sha: sha(body), size: body.length }))
console.log(
  `${String(list.length)} files, ${(list.reduce((n, f) => n + f.size, 0) / 1e6).toFixed(1)} MB`,
)

const project = (
  (await (
    await fetch('https://api.vercel.com/v9/projects?limit=100', { headers: auth })
  ).json()) as {
    projects: { id: string; name: string; targets?: { production?: { id?: string } } }[]
  }
).projects.find((p) => p.name === 'ai-team-hq')
if (project === undefined) throw new Error('no ai-team-hq project')
const liveId = project.targets?.production?.id ?? ''
console.log(`live deployment (the rollback point): ${liveId}`)

type Node = { name: string; type: string; children?: Node[] }
const flat = (nodes: Node[], prefix = ''): string[] =>
  nodes.flatMap((n) =>
    n.type === 'directory' ? flat(n.children ?? [], `${prefix}${n.name}/`) : [`${prefix}${n.name}`],
  )
const liveTree = (await (
  await fetch(`https://api.vercel.com/v6/deployments/${liveId}/files`, { headers: auth })
).json()) as Node[]
// The listing roots every uploaded file under a top-level src/ directory.
const live = new Set(flat(liveTree).map((f) => f.replace(/^src\//, '')))
const mine = new Set(list.map((f) => f.file))
const onlyMine = [...mine].filter((f) => !live.has(f))
const onlyLive = [...live].filter((f) => !mine.has(f))
console.log(
  `names only here: ${JSON.stringify(onlyMine)}  names only live: ${JSON.stringify(onlyLive.slice(0, 8))}${onlyLive.length > 8 ? ` (+${String(onlyLive.length - 8)})` : ''}`,
)
if (onlyMine.length > 0 || onlyLive.length > 0) {
  // Vercel lists the serverless functions' sources and build outputs differently; only refuse on
  // something the page itself would gain or lose.
  const pageLoss = onlyLive.filter((f) => !f.startsWith('.') && !f.startsWith('out/'))
  // A file the change is MEANT to add is named on the command line, exactly: --allow-new=a.js,b.js. Anything else
  // gained or lost still refuses, so an accidental file set is not deployed.
  const allowed = new Set(
    (process.argv.find((a) => a.startsWith('--allow-new='))?.slice('--allow-new='.length) ?? '')
      .split(',')
      .filter((f) => f !== ''),
  )
  const unexpected = onlyMine.filter((f) => !allowed.has(f))
  if (unexpected.length > 0 || pageLoss.length > 0) {
    console.error('the file set differs from the live page; not deploying')
    process.exit(1)
  }
}
if (!go) {
  console.log('dry run: nothing deployed')
  process.exit(0)
}

const create = async () =>
  fetch('https://api.vercel.com/v13/deployments', {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'ai-team-hq',
      target: 'production',
      files: list,
      projectSettings: { framework: null },
    }),
  })
let response = await create()
for (let round = 0; round < 3 && response.status === 400; round += 1) {
  const err = (await response.clone().json()) as { error?: { code?: string; missing?: string[] } }
  if (err.error?.code !== 'missing_files') break
  const missing = new Set(err.error.missing ?? [])
  const bodies = new Map(list.map((f) => [f.sha, files.get(f.file) as Buffer]))
  console.log(`uploading ${String(missing.size)} file(s) Vercel does not hold`)
  for (const s of missing) {
    const body = bodies.get(s)
    if (body === undefined) continue
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const up = await fetch('https://api.vercel.com/v2/files', {
        method: 'POST',
        headers: {
          ...auth,
          'Content-Type': 'application/octet-stream',
          'x-vercel-digest': s,
          'Content-Length': String(body.length),
        },
        body,
      })
      if (up.ok) break
      if (attempt === 4) throw new Error(`upload of ${s} failed: http ${String(up.status)}`)
      await new Promise((r) => setTimeout(r, 1500 * attempt))
    }
  }
  response = await create()
}
const dep = (await response.json()) as { id?: string; url?: string; error?: { message?: string } }
if (!response.ok) {
  console.error(`deploy failed: ${JSON.stringify(dep.error ?? dep).slice(0, 300)}`)
  process.exit(1)
}
console.log(`deployment ${String(dep.id)} created`)
let state = 'BUILDING'
const started = Date.now()
while (state !== 'READY' && state !== 'ERROR' && Date.now() - started < 300_000) {
  await new Promise((r) => setTimeout(r, 5000))
  state = String(
    (
      (await (
        await fetch(`https://api.vercel.com/v13/deployments/${String(dep.id)}`, { headers: auth })
      ).json()) as { readyState?: string }
    ).readyState ?? 'UNKNOWN',
  )
}
console.log(`build: ${state}`)
if (state !== 'READY') process.exit(1)
const served = await (await fetch(`https://${String(dep.url)}/app.js`)).text()
console.log(`serves the new page: ${String(served.includes('settings-ui.js'))}`)
console.log(`rollback: promote ${liveId}`)
