/**
 * The edge functions that share code ship their import graph (P1.1): a function uploaded as one file that imports
 * `src/auth/speaker.ts` deploys cleanly and fails on its first request, which is the failure this pins.
 *
 * And the walker reads EVERY form of import. It once knew only `from '...'`, so the bare side-effect import
 * `import '../safety/arm.ts'` in `src/db/executor.ts` was left out of the worker's upload, and the platform refused
 * the bundle after the deploy script had already reset the function's secrets (6 October 2026).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  BundleError,
  bundleForm,
  closureProblems,
  localImports,
  prepareBundle,
  walk,
} from '../../scripts/deploy/lib/bundle.ts'

const rel = (abs: string): string => abs.replace(`${process.cwd()}/`, '')

// Fixtures live inside the working directory so their bundle paths are ordinary relative ones.
mkdirSync(path.join(process.cwd(), '.out'), { recursive: true })
const root = mkdtempSync(path.join(process.cwd(), '.out', 'bundle-test-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))
const put = (name: string, source: string): string => {
  const file = path.join(root, name)
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, source)
  return file
}
const names = (m: Map<string, string>): string[] =>
  [...m.keys()].map((k) => path.relative(root, k)).sort()

describe('deploy bundles', () => {
  it.each(['voice', 'voice-token'])('%s carries the shared speaker verifier', async (slug) => {
    const found = [...(await walk(`supabase/functions/${slug}/index.ts`)).keys()].map(rel)
    expect(found).toContain(`supabase/functions/${slug}/index.ts`)
    expect(found).toContain('src/auth/speaker.ts')
  })

  it('keeps the repository layout, so no import is rewritten', async () => {
    const { form, files } = await bundleForm(
      'voice-token',
      'supabase/functions/voice-token/index.ts',
    )
    expect(files).toBe(2)
    const names = form.getAll('file').map((f) => (f as File).name)
    expect(names).toContain('src/auth/speaker.ts')
    const meta = JSON.parse(String(form.get('metadata'))) as { entrypoint_path: string }
    expect(meta.entrypoint_path).toBe('supabase/functions/voice-token/index.ts')
  })

  it('the worker still walks its whole graph through the shared helper', async () => {
    const found = (await walk('supabase/functions/worker/index.ts')).size
    expect(found).toBeGreaterThan(100)
  })
})

describe('what counts as an import', () => {
  it('reads every form, once each: from, bare, export-from, dynamic', () => {
    const specs = localImports(`
      import a from './a.ts'
      import { b } from "./b.ts"
      import './side-effect.ts'
      export * from './reexport.ts'
      export { c } from './c.ts'
      const d = await import('./dynamic.ts')
      import './a.ts'
    `)
    expect(specs.sort()).toEqual(
      ['./a.ts', './b.ts', './c.ts', './dynamic.ts', './reexport.ts', './side-effect.ts'].sort(),
    )
  })
  it('ignores package, remote and built-in specifiers, as the bundler always has', () => {
    expect(
      localImports(`
        import postgres from 'npm:postgres@3.4.5'
        import { x } from 'jsr:@std/path'
        import fs from 'node:fs'
        import y from 'https://deno.land/std/mod.ts'
        import 'some-package'
      `),
    ).toEqual([])
  })
  it('ignores an import that is only written in a comment or a string', () => {
    expect(
      localImports(`
        // import './in-a-line-comment.ts'
        /* import './in-a-block-comment.ts'
           import './and-another.ts' */
        const s = "import './in-a-string.ts'"
        const t = \`
import './in-a-template.ts'
\`
      `),
    ).toEqual([])
  })
})

describe('the walker', () => {
  it('follows a normal static import with from', async () => {
    const entry = put('from/entry.ts', "import { a } from './a.ts'\n")
    put('from/a.ts', 'export const a = 1\n')
    expect(names(await walk(entry))).toEqual(['from/a.ts', 'from/entry.ts'])
  })

  it('follows a bare side-effect import', async () => {
    const entry = put('bare/entry.ts', "import './arm.ts'\n")
    put('bare/arm.ts', 'globalThis.armed = true\n')
    expect(names(await walk(entry))).toEqual(['bare/arm.ts', 'bare/entry.ts'])
  })

  it('follows a side-effect import reached only through another file (the executor/arm shape)', async () => {
    const entry = put('nested/entry.ts', "import { run } from './db/executor.ts'\n")
    put('nested/db/executor.ts', "import '../safety/arm.ts'\nexport const run = 1\n")
    put('nested/safety/arm.ts', "import './deeper.ts'\n")
    put('nested/safety/deeper.ts', 'export {}\n')
    expect(names(await walk(entry))).toEqual([
      'nested/db/executor.ts',
      'nested/entry.ts',
      'nested/safety/arm.ts',
      'nested/safety/deeper.ts',
    ])
  })

  it('a file imported more than once, in any form, is bundled once', async () => {
    const entry = put(
      'dup/entry.ts',
      "import { x } from './shared.ts'\nimport './shared.ts'\nimport './other.ts'\n",
    )
    put('dup/other.ts', "import { x } from './shared.ts'\nexport const o = 1\n")
    put('dup/shared.ts', 'export const x = 1\n')
    const found = await walk(entry)
    expect(names(found)).toEqual(['dup/entry.ts', 'dup/other.ts', 'dup/shared.ts'])
    expect(found.size).toBe(3)
  })

  it('an import cycle terminates', async () => {
    const entry = put('cycle/a.ts', "import './b.ts'\n")
    put('cycle/b.ts', "import './a.ts'\n")
    expect(names(await walk(entry))).toEqual(['cycle/a.ts', 'cycle/b.ts'])
  })

  it('an import that resolves to no file fails clearly, naming the importer and the specifier', async () => {
    const entry = put('missing/entry.ts', "import './present.ts'\n")
    put('missing/present.ts', "import '../gone/arm.ts'\n")
    await expect(walk(entry)).rejects.toThrow(BundleError)
    await expect(walk(entry)).rejects.toThrow(
      /missing\/present\.ts imports '\.\.\/gone\/arm\.ts', which does not exist/,
    )
  })

  it('a missing entrypoint is a BundleError too', async () => {
    await expect(walk(path.join(root, 'no-such-entry.ts'))).rejects.toThrow(
      /entrypoint .* does not exist/,
    )
  })

  it('external imports are left to the platform and never read from disk', async () => {
    const entry = put(
      'ext/entry.ts',
      "import postgres from 'npm:postgres@3.4.5'\nimport './local.ts'\n",
    )
    put('ext/local.ts', "import fs from 'node:fs'\n")
    expect(names(await walk(entry))).toEqual(['ext/entry.ts', 'ext/local.ts'])
  })
})

describe('closure of a real bundle', () => {
  it('the worker bundle includes src/safety/arm.ts, reached only by a bare import, and is closed', async () => {
    const { files } = await prepareBundle('worker', 'supabase/functions/worker/index.ts')
    expect(files.has('src/safety/arm.ts')).toBe(true)
    expect(files.has('src/db/executor.ts')).toBe(true)
    expect(closureProblems(files)).toEqual([])
  })

  it.each([
    ['worker', 'supabase/functions/worker/index.ts'],
    ['mcp', 'supabase/functions/mcp/index.ts'],
    ['voice', 'supabase/functions/voice/index.ts'],
    ['voice-token', 'supabase/functions/voice-token/index.ts'],
  ])('%s: every local import of every bundled file is itself bundled', async (slug, entry) => {
    const { files } = await prepareBundle(slug, entry)
    for (const [name, source] of files) {
      for (const spec of localImports(source)) {
        const target = path.posix.normalize(path.posix.join(path.posix.dirname(name), spec))
        expect(files.has(target), `${name} -> ${spec}`).toBe(true)
      }
    }
    expect(files.has(entry)).toBe(true)
  })

  it('closureProblems names what is missing, in the uploaded frame (the hand-listed hq-api shape)', () => {
    const upload = new Map([
      ['index.ts', "import { a } from './a.ts'\nimport './b.ts'\n"],
      ['a.ts', 'export const a = 1\n'],
    ])
    expect(closureProblems(upload)).toEqual([
      "index.ts imports './b.ts', but b.ts is not in the bundle",
    ])
    expect(closureProblems(new Map([['../escape.ts', 'export {}\n']]))).toHaveLength(1)
  })

  it('prepareBundle refuses a graph that cannot be closed, before any form is made', async () => {
    const entry = put('refuse/entry.ts', "import './nope.ts'\n")
    await expect(prepareBundle('x', path.relative(process.cwd(), entry))).rejects.toThrow(
      BundleError,
    )
  })
})
