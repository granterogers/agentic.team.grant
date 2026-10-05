/**
 * The excludeFiles pattern must keep the static site out of the function bundles, never match a runtime file, fit Vercel's
 * length limit, and agree with what Vercel measurably did with it.
 */
import { execFileSync } from 'node:child_process'
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

  it('the real vercel.json is exactly the configuration the preview experiment measured', () => {
    // docs/performance/vercel-experiment/vercel.proposed.json is the file variant B deployed (EXPERIMENTAL evidence). The
    // repository's vercel.json must be that configuration, so the measured behaviour is the behaviour that ships.
    const read = (p: string) => JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>
    expect(read('vercel.json')).toEqual(
      read('docs/performance/vercel-experiment/vercel.proposed.json'),
    )
  })

  describe('against the files that exist in this tree', () => {
    const tracked = execFileSync('git', ['ls-files'], { encoding: 'utf8', maxBuffer: 64 << 20 })
      .split('\n')
      .filter((p) => p !== '')

    it('enumerates a real repository (the checks below are not vacuous)', () => {
      expect(tracked.length).toBeGreaterThan(1000)
      expect(tracked).toContain('api/notebook.py')
      expect(tracked.filter((p) => p.startsWith('web/studio/')).length).toBeGreaterThan(50)
    })

    it('never matches a Python file, requirements.txt or vercel.json, wherever it sits in the repository', () => {
      const runtimeLike = tracked.filter(
        (p) =>
          p.endsWith('.py') ||
          /(^|\/)(requirements[^/]*\.txt|vercel\.json|pyproject\.toml)$/.test(p),
      )
      expect(runtimeLike).toContain('scripts/notebook/act.py')
      expect(runtimeLike).toContain('requirements.txt')
      expect(runtimeLike.filter((p) => excludes(EXCLUDE_GLOB, p))).toEqual([])
    })

    it('never matches anything under api/ or scripts/notebook/', () => {
      const needed = tracked.filter(
        (p) => p.startsWith('api/') || p.startsWith('scripts/notebook/'),
      )
      expect(needed.length).toBeGreaterThan(3)
      expect(needed.filter((p) => excludes(EXCLUDE_GLOB, p))).toEqual([])
    })

    it('only ever matches deployment paths that come from web/studio (the static site)', async () => {
      const uploaded = [...(await collectPageFiles('.')).keys()]
      const fromStudio = new Set<string>()
      for (const p of tracked.filter((t) => t.startsWith('web/studio/'))) {
        const rel = p.slice('web/studio/'.length)
        fromStudio.add(rel)
        fromStudio.add(`studio/${rel}`)
      }
      // config.js is generated and gitignored, so it is not tracked; it is a studio file all the same
      fromStudio.add('config.js')
      fromStudio.add('studio/config.js')
      const excluded = uploaded.filter((p) => excludes(EXCLUDE_GLOB, p))
      expect(excluded.length).toBeGreaterThan(100)
      expect(excluded.filter((p) => !fromStudio.has(p))).toEqual([])
    })

    it('the Python function sources name no static asset, so none can be needed at run time', () => {
      for (const p of ['api/notebook.py', 'api/notebook-act.py', 'scripts/notebook/act.py']) {
        const src = readFileSync(p, 'utf8')
        expect(src, p).not.toMatch(
          /studio|\.html|\.css|\.js\b|fonts\/|samples\/|textures|vendor\/|\bbc\/|logos/,
        )
      }
    })

    it('can fail: a runtime-looking file under an excluded directory is caught', () => {
      expect(excludes(EXCLUDE_GLOB, 'vendor/helper.py')).toBe(true)
      expect(excludes(EXCLUDE_GLOB, 'studio/requirements.txt')).toBe(true)
    })
  })

  it('the checks can fail: a pattern that also removes scripts is refused, and an unnamed extension is reported', () => {
    const wider = `${EXCLUDE_GLOB.slice(0, -1)},scripts/**}`
    expect(excludes(wider, 'scripts/notebook/act.py')).toBe(true)
    expect(uncovered(EXCLUDE_GLOB, ['logo.svg', 'api/notebook.py'])).toEqual(['logo.svg'])
    expect(() => excludes('{**/*.js}', 'a.js')).toThrow(/unsupported/)
  })
})
