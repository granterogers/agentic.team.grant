/*
  Every relative import an edge function reaches names a file that EXISTS.

  Integration pass, 28 September 2026. `src/jobs/worker.ts` imported
  `../agents/stray-quotes.js` while only `stray-quotes.ts` exists. tsc, vitest
  and esbuild all resolve `.js` to `.ts`, so every test and typecheck was
  green — and `npm run deploy:worker` bundles by reading each specifier
  LITERALLY from disk, so the deploy would have died on ENOENT before
  uploading anything. The handoff's order is migrations first, worker second:
  the office would have been left on the old worker against the new SQL, with
  0599's R48 fix only half-deployed.

  This walks the import graph exactly the way the deploy scripts do (the same
  `from '<relative>'` pattern, the same literal resolution) from every edge
  function's entrypoint, and fails on any file that is not there. Only the
  graph, never the deploy: nothing here touches the network.
*/
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const walk = (file: string, found = new Set<string>(), missing: string[] = []) => {
  const abs = path.resolve(file)
  if (found.has(abs)) return { found, missing }
  if (!existsSync(abs)) {
    missing.push(path.relative(process.cwd(), abs))
    return { found, missing }
  }
  found.add(abs)
  const source = readFileSync(abs, 'utf8')
  for (const m of source.matchAll(/\bfrom\s+'(\.[^']+)'/g)) {
    const spec = m[1]
    if (spec !== undefined) walk(path.resolve(path.dirname(abs), spec), found, missing)
  }
  return { found, missing }
}

/*
  Two functions are NOT bundled by the walk: their deploy scripts upload named
  copies of src/ files beside the entrypoint (scripts/deploy/slack-events.ts,
  scripts/deploy/edge-function.ts), so './events.ts' exists only in the upload.
*/
const COPIED_NOT_WALKED = new Set(['slack-events', 'telegram-webhook'])
const entries = readdirSync('supabase/functions', { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(`supabase/functions/${d.name}/index.ts`))
  .filter((d) => !COPIED_NOT_WALKED.has(d.name))
  .map((d) => `supabase/functions/${d.name}/index.ts`)

const tsUnder = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? tsUnder(`${dir}/${e.name}`)
      : e.name.endsWith('.ts')
        ? [`${dir}/${e.name}`]
        : [],
  )

describe('edge function bundles', () => {
  it('finds the entrypoints, so an empty list cannot pass', () => {
    expect(entries).toContain('supabase/functions/worker/index.ts')
    expect(entries.length).toBeGreaterThanOrEqual(5)
  })
  for (const entry of entries) {
    it(`${entry}: every relative import resolves to a real file`, () => {
      const { found, missing } = walk(entry)
      expect(found.size).toBeGreaterThan(0)
      expect(missing).toEqual([])
    })
  }
  it('no relative import under src/ names a .js file (the class, whoever bundles it)', () => {
    const bad = tsUnder('src').flatMap((f) =>
      [...readFileSync(f, 'utf8').matchAll(/\bfrom\s+'(\.[^']+\.js)'/g)].map(
        (m) => `${f}: ${m[1]}`,
      ),
    )
    expect(bad).toEqual([])
  })
  it('CONTROL: the walker reports a specifier that names no file', () => {
    const { missing } = walk('tests/jobs/fixtures/bundle-missing-import.fixture')
    expect(missing).toEqual(['tests/jobs/fixtures/does-not-exist.js'])
  })
})
