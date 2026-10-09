/**
 * R1b read-only: compare the Team HQ page that Vercel serves with a source tree, file by file, by SHA-1.
 *
 *   ALLOW_PRODUCTION_CHECKS=1 npx tsx scripts/release/r1b-page-compare.ts <repo-root> [<repo-root> ...]
 *
 * It builds the same file set `scripts/deploy/hq-page-delta.ts` would upload (same names, same rules), then asks Vercel for
 * the live deployment's file listing (a GET) and compares digests. It sends nothing, deploys nothing and prints only file
 * names and counts. A repo root is a directory holding `web/studio`, `api`, `scripts/notebook`, `requirements.txt`, `vercel.json`
 * (the working tree, or a `git archive` of a commit extracted somewhere else).
 */
import '../../src/safety/require-production-checks.ts'
import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'

const token = process.env.VERCEL_TOKEN ?? ''
const roots = process.argv.slice(2)
if (token === '' || roots.length === 0) {
  console.error('usage: r1b-page-compare.ts <repo-root>...   (VERCEL_TOKEN required)')
  process.exit(2)
}
const auth = { Authorization: `Bearer ${token}` }
const SKIP_DIRS = new Set(['raw'])
const sha1 = (b: Buffer): string => createHash('sha1').update(b).digest('hex')

const build = async (repo: string): Promise<Map<string, string>> => {
  const out = new Map<string, string>()
  const studio = join(repo, 'web/studio')
  const add = async (name: string, path: string): Promise<void> => {
    out.set(name, sha1(await readFile(path)))
  }
  await add('index.html', join(studio, 'index.html'))
  for (const f of [
    'api/notebook.py',
    'api/notebook-act.py',
    'scripts/notebook/act.py',
    'requirements.txt',
    'vercel.json',
  ])
    await add(f, join(repo, f))
  const walk = async (dir: string): Promise<void> => {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, e.name)
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) await walk(full)
        continue
      }
      const rel = relative(studio, full).split('\\').join('/')
      await add(`studio/${rel}`, full)
      if (rel !== 'index.html') await add(rel, full)
    }
  }
  await walk(studio)
  return out
}

const projects = (
  (await (
    await fetch('https://api.vercel.com/v9/projects?limit=100', { headers: auth })
  ).json()) as {
    projects: { name: string; targets?: { production?: { id?: string } } }[]
  }
).projects
const liveId = projects.find((p) => p.name === 'ai-team-hq')?.targets?.production?.id ?? ''
console.log(`live production deployment: ${liveId}`)
type Node = { name: string; type: string; uid?: string; children?: Node[] }
const tree = (await (
  await fetch(`https://api.vercel.com/v6/deployments/${liveId}/files`, { headers: auth })
).json()) as Node[]
const live = new Map<string, string | undefined>()
const flat = (nodes: Node[], prefix = ''): void => {
  for (const n of nodes) {
    if (n.type === 'directory') flat(n.children ?? [], `${prefix}${n.name}/`)
    else live.set(`${prefix}${n.name}`.replace(/^src\//, ''), n.uid)
  }
}
flat(tree)
const withUid = [...live.values()].filter((u) => u !== undefined).length
console.log(`live files listed: ${String(live.size)} (${String(withUid)} with a digest)`)

for (const repo of roots) {
  const mine = await build(repo)
  const same: string[] = []
  const differ: string[] = []
  const onlyMine: string[] = []
  for (const [name, digest] of mine) {
    if (!live.has(name)) onlyMine.push(name)
    else if (live.get(name) === digest) same.push(name)
    else differ.push(name)
  }
  const onlyLive = [...live.keys()].filter((n) => !mine.has(n) && !n.startsWith('.'))
  console.log(
    `${repo}: ${String(mine.size)} files; identical ${String(same.length)}; differ ${String(differ.length)}; only here ${String(onlyMine.length)}; only live ${String(onlyLive.length)}`,
  )
  console.log(`  differ: ${JSON.stringify(differ.slice(0, 40))}`)
  console.log(`  only here: ${JSON.stringify(onlyMine.slice(0, 20))}`)
  console.log(`  only live: ${JSON.stringify(onlyLive.slice(0, 20))}`)
}
