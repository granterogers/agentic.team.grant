/*
 * Deploy the experimental site to its own Vercel project.
 *
 *   npm run deploy:preview
 *
 * WHY NOT THE CLI. `vercel deploy` works, and on this link it also fails about
 * four times in five with a bare "fetch failed" — it uploads everything in one
 * go, and one dropped connection loses the whole attempt. This uploads each
 * file separately and retries each one, so a flaky network costs a retry
 * rather than a deploy.
 *
 * WHY NOT THE REPOSITORY. Deploying the repo makes Vercel find `api/*.py`,
 * fail to resolve a Python entrypoint, and end the build before it reaches the
 * page. `.out/site` is the studio plus one generated `vercel.json`.
 *
 * It targets `agentic-team-hq-basecamp`, which is NOT `ai-team-hq`. The
 * production site is not reachable from here by design.
 */
import '../../src/safety/require-production-writes.ts'
import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'

const token = process.env.VERCEL_TOKEN
if (token === undefined || token === '') {
  console.error('VERCEL_TOKEN is required')
  process.exit(2)
}

const ROOT = '.out/site'
/*
  WHICH PROJECT, AND WHETHER THIS IS THE ONE PEOPLE OPEN.

  A merge-readiness pass needs a deployment nobody is looking at: the same
  bytes, a URL of its own, and the stable Basecamp alias left exactly where it
  is. `VERCEL_PREVIEW=1` omits `target`, which is what makes Vercel give the
  deployment its own hostname and move no alias -- so the thing being proved is
  the candidate and the thing Grant has open is untouched.
*/
const NAME = process.env.VERCEL_PROJECT ?? 'agentic-team-hq-basecamp'
const PREVIEW = process.env.VERCEL_PREVIEW === '1'
const TEAM = 'agentic-team-grant'
const AUTH = { Authorization: `Bearer ${token}` }

const walk = async (dir: string): Promise<string[]> => {
  const out: string[] = []
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, e.name)
    if (e.isDirectory()) out.push(...(await walk(full)))
    else out.push(full)
  }
  return out
}

/** One request, retried — a dropped connection is the common case here. */
const tryHard = async <T>(what: string, run: () => Promise<T>, times = 4): Promise<T> => {
  let last: unknown
  for (let i = 1; i <= times; i += 1) {
    try {
      return await run()
    } catch (e) {
      last = e
      await new Promise((ok) => setTimeout(ok, i * 2000))
    }
  }
  throw new Error(`${what} failed after ${String(times)} attempts: ${String(last)}`)
}

const paths = await walk(ROOT)
if (paths.length === 0) {
  console.error(`${ROOT} is empty — run the build first`)
  process.exit(2)
}

const files: { file: string; sha: string; size: number }[] = []
for (const p of paths) {
  const body = await readFile(p)
  const sha = createHash('sha1').update(body).digest('hex')
  const name = relative(ROOT, p).split('\\').join('/')
  await tryHard(`upload ${name}`, async () => {
    const r = await fetch(`https://api.vercel.com/v2/files?slug=${TEAM}`, {
      method: 'POST',
      headers: {
        ...AUTH,
        'Content-Type': 'application/octet-stream',
        'x-vercel-digest': sha,
        'Content-Length': String(body.byteLength),
      },
      body,
    })
    if (!r.ok && r.status !== 409) throw new Error(`${String(r.status)} ${await r.text()}`)
    return true
  })
  files.push({ file: name, sha, size: body.byteLength })
}
console.log(`uploaded ${String(files.length)} file(s)`)

const made = await tryHard('create the deployment', async () => {
  const r = await fetch(`https://api.vercel.com/v13/deployments?slug=${TEAM}`, {
    method: 'POST',
    headers: { ...AUTH, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: NAME,
      ...(PREVIEW ? {} : { target: 'production' as const }),
      // No framework and no build step: these are the files, served as they are.
      projectSettings: { framework: null },
      files,
    }),
  })
  const body = (await r.json()) as { url?: string; error?: { message?: string }; alias?: string[] }
  if (!r.ok) throw new Error(`${String(r.status)} ${body.error?.message ?? JSON.stringify(body)}`)
  return body
})

console.log(`deployed: https://${String(made.url)}`)
for (const a of made.alias ?? []) console.log(`alias:    https://${a}`)
