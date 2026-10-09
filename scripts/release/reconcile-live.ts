/**
 * Reconcile a captured LIVE edge function with the source tree it should come from. LOCAL ONLY: it reads files and runs git, it contacts
 * nothing.
 *
 *   npx tsx scripts/release/reconcile-live.ts <tree-root> <slug> <entry|hq-api> <captured-dir>
 *
 * `<tree-root>` is a checkout of the commit to test (the working tree, or `git worktree add <dir> <commit>`). It REPRODUCES the upload the
 * deploy script would build from that tree (`prepareBundle` for a function, the explicit file list for hq-api), then compares file set and
 * every file's canonical statements (`lib/canonical.ts`) with the captured bundle. It reports files only in the live bundle, files only in
 * the rebuilt upload, and the files whose statements differ, with the shape of each difference (a lowered class field is named as such).
 * Exit 1 when the live bundle holds a file the tree does not, or a file differs in more than a lowered class field.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { compareLowered, compareStoredWithSource } from './lib/canonical.ts'

const [rootArg, slug, entry, capture] = process.argv.slice(2)
if (rootArg === undefined || slug === undefined || entry === undefined || capture === undefined) {
  console.error('usage: reconcile-live.ts <tree-root> <slug> <entry|hq-api> <captured-dir>')
  process.exit(2)
}
const root = resolve(rootArg)
process.chdir(root)
const bundle = (await import(pathToFileURL(join(root, 'scripts/deploy/lib/bundle.ts')).href)) as {
  prepareBundle: (slug: string, entry: string) => Promise<{ files: Map<string, string> }>
}
let upload: Map<string, string>
if (entry === 'hq-api') {
  const m = (await import(
    pathToFileURL(join(root, 'scripts/deploy/lib/hq-api-files.ts')).href
  )) as { HQ_API_FILES: { name: string; from: string }[] }
  upload = new Map(m.HQ_API_FILES.map((f) => [f.name, readFileSync(join(root, f.from), 'utf8')]))
} else if (entry.startsWith('files:')) {
  // a hand-listed flat upload (telegram-webhook, slack-events): files:<uploaded name>=<repository path>,...
  upload = new Map(
    entry
      .slice('files:'.length)
      .split(',')
      .map((pair) => {
        const [name, from] = pair.split('=') as [string, string]
        return [name, readFileSync(join(root, from), 'utf8')] as const
      }),
  )
} else upload = (await bundle.prepareBundle(slug, entry)).files

const walk = (d: string, base = d): string[] =>
  readdirSync(d).flatMap((n) => {
    const p = join(d, n)
    return statSync(p).isDirectory() ? walk(p, base) : [p.slice(base.length + 1)]
  })
const live = new Set(walk(join(capture, 'source')))
const rebuilt = new Set(upload.keys())
// A function uploaded flat (hq-api, signin, telegram-webhook, slack-events) names its entry `index.ts`; the rebuilt path is the repository's.
const liveName = (name: string): string | undefined =>
  live.has(name) ? name : [...live].find((l) => !rebuilt.has(l) && name.endsWith(`/${l}`))
const matched = new Set<string>()
let identical = 0
let statements = 0
let same = 0
const differing: string[] = []
let hard = 0
for (const [name, source] of upload) {
  const ln = liveName(name)
  if (ln === undefined) continue
  matched.add(ln)
  const stored = readFileSync(join(capture, 'source', ln), 'utf8')
  const c = compareStoredWithSource(stored, source)
  statements += c.statements
  same += c.same
  if (c.identical) {
    identical += 1
    continue
  }
  // a class whose fields the platform lowered into the constructor: the only difference of this kind that is known to be behaviour-neutral
  const classOnly = compareLowered(stored, source).identical
  if (!classOnly) hard += 1
  differing.push(
    `${name} (${String(c.differing)} of ${String(c.statements)} statement(s)${classOnly ? ', class-field lowering only' : ''})`,
  )
}
const onlyLive = [...live].filter((l) => !matched.has(l))
const onlyRebuilt = [...rebuilt].filter((r) => liveName(r) === undefined)
console.log(`${slug}: rebuilt upload ${String(rebuilt.size)} file(s); live ${String(live.size)}`)
console.log(`  only in the live bundle: ${JSON.stringify(onlyLive)}`)
console.log(`  only in the rebuilt upload: ${JSON.stringify(onlyRebuilt)}`)
console.log(
  `  files identical: ${String(identical)}; differing: ${String(differing.length)}; statements identical ${String(same)}/${String(statements)}`,
)
for (const d of differing) console.log(`    ${d}`)
process.exit(onlyLive.length > 0 || hard > 0 ? 1 : 0)
