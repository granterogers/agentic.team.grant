/**
 * The excludeFiles pattern must keep the static site out of the function bundles, never match a runtime file, fit Vercel's
 * length limit, and agree with what Vercel measurably did with it.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  EXCLUDE_GLOB,
  excludes,
  MAX_EXCLUDE_LENGTH,
  RUNTIME_FILES,
  uncovered,
} from '../../scripts/deploy/lib/function-exclude.ts'
import { collectPageFiles } from '../../scripts/deploy/lib/page-files.ts'

const probe = JSON.parse(
  readFileSync('tests/deploy/fixtures/vercel-exclude-probe.json', 'utf8'),
) as { dirs: string[]; bundleBefore: string[]; bundleAfter: string[] }

describe('excludeFiles pattern', () => {
  it('fits the 256-character limit Vercel enforces', () => {
    expect(EXCLUDE_GLOB.length).toBeLessThanOrEqual(MAX_EXCLUDE_LENGTH)
  })

  it.each(RUNTIME_FILES)('never excludes the runtime file %s', (file) => {
    expect(excludes(EXCLUDE_GLOB, file)).toBe(false)
  })

  it('never excludes the function sources or the dependency directories the builder adds', () => {
    for (const p of [
      'api/zz.py',
      'scripts/notebook/act.py',
      '_vendor/httpx/__init__.py',
      'pyproject.toml',
      'uv.lock',
    ])
      expect(excludes(EXCLUDE_GLOB, p)).toBe(false)
  })

  it('excludes the studio, its root copies and each root-level asset directory', () => {
    for (const p of [
      'studio/app.js',
      'studio/bc/x.js',
      'app.js',
      'studio.css',
      'index.html',
      'bc/compose.js',
      'fonts/f.woff2',
      'vendor/v.js',
    ])
      expect(excludes(EXCLUDE_GLOB, p)).toBe(true)
  })

  it('covers every file the page deployment uploads, except the runtime files', async () => {
    const uploaded = (await collectPageFiles('.')).keys()
    // If this fails a studio file type or directory was added that the pattern does not name. The bundle is then larger,
    // not broken; extend EXCLUDE_GLOB (and keep it under 256 characters) and measure again.
    expect(uncovered(EXCLUDE_GLOB, uploaded)).toEqual([])
  })

  it('agrees with what Vercel measurably removed from the bundle', () => {
    const dirs = new Set(probe.dirs)
    const removedByVercel = probe.bundleBefore.filter((n) => !probe.bundleAfter.includes(n)).sort()
    const predicted = probe.bundleBefore
      .filter((n) => excludes(EXCLUDE_GLOB, dirs.has(n) ? `${n}/x` : n))
      .sort()
    expect(predicted).toEqual(removedByVercel)
    expect(removedByVercel.length).toBeGreaterThan(40)
  })

  it('the proposed vercel.json carries exactly this pattern on both functions and changes nothing else', () => {
    const read = (p: string) => JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>
    const current = read('vercel.json') as {
      functions: Record<string, Record<string, unknown>>
      rewrites: unknown
    }
    const proposed = read('docs/performance/vercel-experiment/vercel.proposed.json') as {
      functions: Record<string, Record<string, unknown>>
      rewrites: unknown
    }
    expect(Object.keys(proposed.functions).sort()).toEqual([
      'api/notebook-act.py',
      'api/notebook.py',
    ])
    for (const fn of Object.values(proposed.functions)) expect(fn.excludeFiles).toBe(EXCLUDE_GLOB)
    // the existing settings survive; the writer gains only the exclusion (its 300 s default is unchanged, as measured)
    const { excludeFiles: _e, ...reader } = proposed.functions['api/notebook.py'] as Record<
      string,
      unknown
    >
    expect(reader).toEqual(current.functions['api/notebook.py'])
    expect(Object.keys(proposed.functions['api/notebook-act.py'] as object)).toEqual([
      'excludeFiles',
    ])
    expect(proposed.rewrites).toEqual(current.rewrites)
  })

  it('the checks can fail: a pattern that also removes scripts is refused, and an unnamed extension is reported', () => {
    const wider = `${EXCLUDE_GLOB.slice(0, -1)},scripts/**}`
    expect(excludes(wider, 'scripts/notebook/act.py')).toBe(true)
    expect(uncovered(EXCLUDE_GLOB, ['logo.svg', 'api/notebook.py'])).toEqual(['logo.svg'])
    expect(() => excludes('{**/*.js}', 'a.js')).toThrow(/unsupported/)
  })
})
