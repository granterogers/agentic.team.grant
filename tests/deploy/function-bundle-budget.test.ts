/**
 * A Python function bundle must not carry the static site. This fails if a function in `vercel.json` loses its `excludeFiles`,
 * if a new `api/*.py` function appears without one, or if the pattern stops covering the studio.
 *
 * The byte figures are modelled from the files that would be uploaded (what the page deployment packs into every function),
 * not measured on Vercel. The measured saving (21.49 to 17.16 MiB per bundle, -20.2%) is a PREVIEW experiment, EXPERIMENTAL
 * and NOT DEPLOYED, in docs/performance/vercel-storage-audit-2026-10-05.md.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  EXCLUDE_GLOB,
  excludes,
  MAX_EXCLUDE_LENGTH,
  RUNTIME_FILES,
} from '../../scripts/deploy/lib/function-exclude.ts'
import { collectPageFiles } from '../../scripts/deploy/lib/page-files.ts'

type FunctionConfig = { excludeFiles?: string; [k: string]: unknown }
const config = JSON.parse(readFileSync('vercel.json', 'utf8')) as {
  functions: Record<string, FunctionConfig>
}

const pythonFunctions = readdirSync('api')
  .filter((f) => f.endsWith('.py'))
  .map((f) => `api/${f}`)
  .sort()

/** Bytes of the uploaded files that a function with this `excludeFiles` would still carry, runtime files aside. */
async function bundledStaticBytes(glob: string | undefined): Promise<number> {
  const runtime = new Set<string>(RUNTIME_FILES)
  let n = 0
  for (const [path, body] of await collectPageFiles('.'))
    if (!runtime.has(path) && (glob === undefined || !excludes(glob, path))) n += body.length
  return n
}

/** What the exclusion must save at least, per function: the studio served twice is several MiB. */
const MIN_SAVED_BYTES = 3 * 2 ** 20
/** What may remain of the static site in a bundle after exclusion. The runtime files are not counted. */
const MAX_REMAINING_STATIC_BYTES = 0

describe('every Python function carries the exclusion', () => {
  it('finds the two functions this budget was written for', () => {
    expect(pythonFunctions).toEqual(['api/notebook-act.py', 'api/notebook.py'])
  })

  it.each(pythonFunctions)(
    '%s has the exact excludeFiles pattern within the length limit',
    (fn) => {
      const glob = config.functions[fn]?.excludeFiles
      expect(glob, `${fn} has no excludeFiles in vercel.json`).toBe(EXCLUDE_GLOB)
      expect((glob ?? '').length).toBeLessThanOrEqual(MAX_EXCLUDE_LENGTH)
    },
  )

  it.each(pythonFunctions)('%s still gets its runtime files after exclusion', (fn) => {
    const glob = config.functions[fn]?.excludeFiles ?? ''
    for (const f of RUNTIME_FILES) expect(excludes(glob, f), f).toBe(false)
  })

  it('every configured function path is a real function (a stale key would silently configure nothing)', () => {
    for (const key of Object.keys(config.functions)) expect(pythonFunctions).toContain(key)
  })
})

describe('the bundle budget (modelled from the upload set)', () => {
  it.each(pythonFunctions)('%s carries no static-site bytes', async (fn) => {
    const remaining = await bundledStaticBytes(config.functions[fn]?.excludeFiles)
    expect(remaining).toBeLessThanOrEqual(MAX_REMAINING_STATIC_BYTES)
  })

  it('the exclusion saves at least 3 MiB per function (so a budget of zero is not satisfied by an empty tree)', async () => {
    const without = await bundledStaticBytes(undefined)
    const withIt = await bundledStaticBytes(EXCLUDE_GLOB)
    expect(without - withIt).toBeGreaterThanOrEqual(MIN_SAVED_BYTES)
  })

  it('can fail: a function config without the exclusion is over budget', async () => {
    expect(await bundledStaticBytes(undefined)).toBeGreaterThan(MAX_REMAINING_STATIC_BYTES)
    expect(await bundledStaticBytes('{*.css}')).toBeGreaterThan(MAX_REMAINING_STATIC_BYTES)
  })
})
