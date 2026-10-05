/**
 * The multi-user acceptance streams (scripts/p4, p5, p6) are under the same production-intent rule as scripts/verify.
 *
 * They drive the real office through the real gateway and create disposable people, and until 5 October 2026 they sat outside
 * the suite guard, so they never needed `HQ_PRODUCTION_INTENT=1` (docs/ops/supabase-forensics-2026-10-05.md section 12.3).
 *
 * A script is covered when its import closure holds the SQL executor (which asks `assertMayTouchProduction` on its first
 * statement) or `src/safety/require-suite-intent.ts` (which asks it at import, for a script with no executor). The detector is
 * proved able to FAIL on an in-memory tree.
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isProductionHeavy } from '../../src/db/suite-guard.ts'
import { closure, type Fs, reachesProduction, realFs } from './coverage-lib.ts'

const INTENT_MODULES = ['src/db/executor.ts', 'src/safety/require-suite-intent.ts']
const STREAM = /^scripts\/p[456]\/[^/]+\.ts$/

const hasIntentGuard = (fs: Fs, entry: string): boolean =>
  [...closure(fs, entry)].some((f) => INTENT_MODULES.includes(f))

/** Every p4/p5/p6 entry that can reach production and has no intent guard in its closure. */
const unguarded = (fs: Fs): string[] =>
  fs
    .list('scripts')
    .filter((f) => STREAM.test(f))
    .filter((f) => reachesProduction(fs, f) && !hasIntentGuard(fs, f))

const mem = (files: Record<string, string>): Fs => ({
  read: (p) => files[p] ?? null,
  list: (dir) => Object.keys(files).filter((f) => f.startsWith(`${dir}/`)),
})

describe('every p4/p5/p6 script that can reach production meets the suite-intent guard', () => {
  const fs = realFs(process.cwd())

  it('there are scripts to cover (the detector is not vacuous)', () => {
    const reaching = fs.list('scripts').filter((f) => STREAM.test(f) && reachesProduction(fs, f))
    expect(reaching.length).toBeGreaterThan(15)
  })

  it('none is left without it', () => {
    expect(unguarded(fs)).toEqual([])
  })

  it('the executor really does ask the suite guard before sending a statement', () => {
    const src = fs.read('src/db/executor.ts') ?? ''
    const execute = src.slice(src.indexOf('async execute(sql'))
    expect(execute.indexOf('assertMayTouchProduction()')).toBeGreaterThan(-1)
    expect(execute.indexOf('assertMayTouchProduction()')).toBeLessThan(execute.indexOf('fetch('))
  })

  it('the import-time guard calls the same function, on a command only', () => {
    const src = fs.read('src/safety/require-suite-intent.ts') ?? ''
    expect(src).toMatch(/if \(isScriptEntry\(\)\) assertMayTouchProduction\(\)/)
  })
})

describe('controls: the detector can fail', () => {
  const guard = "import '../../src/safety/require-suite-intent.ts'\n"
  const arm = "import '../../src/safety/arm.ts'\n"
  const tree = (script: string): Fs =>
    mem({
      'scripts/p4/x.ts': script,
      'src/safety/arm.ts': '',
      'src/safety/require-suite-intent.ts': "import './arm.ts'\n",
      'src/db/executor.ts': '',
    })

  it('flags a p4 script that names production and has no guard', () => {
    expect(
      unguarded(tree(`${arm}await fetch('https://x.supabase.co/functions/v1/hq-api')\n`)),
    ).toEqual(['scripts/p4/x.ts'])
  })
  it('flags a p6 script reaching the deployed site with only the production-checks gate', () => {
    const fs = mem({
      'scripts/p6/y.ts':
        "import '../../src/safety/arm.ts'\nawait page.goto('https://ai-team-hq.vercel.app/')\n",
      'src/safety/arm.ts': '',
    })
    expect(unguarded(fs)).toEqual(['scripts/p6/y.ts'])
  })
  it('passes the same script once it imports the guard, or the executor', () => {
    const body = "await fetch('https://x.supabase.co/functions/v1/hq-api')\n"
    expect(unguarded(tree(`${guard}${body}`))).toEqual([])
    expect(
      unguarded(
        mem({
          'scripts/p4/x.ts': `import { ManagementApiExecutor } from '../../src/db/executor.ts'\n${body}`,
          'src/db/executor.ts': '',
        }),
      ),
    ).toEqual([])
  })
  it('does not flag a script that touches no production at all', () => {
    expect(unguarded(tree("console.log('local only')\n"))).toEqual([])
  })
})

describe('the suite guard now classes the p-streams like suites', () => {
  const manifest = {
    sample: ['verify:account-ui'],
    smoke: ['verify:signout'],
    local: [],
    scripts: { 'scripts/p5/settings-qa.ts': 'local' },
  }
  const npm = {
    'verify:account-ui': 'tsx scripts/p6/account-ui.ts',
    'verify:signout': 'tsx scripts/p5/signout.ts',
  }
  it('an unclassified p4, p5 or p6 script is production-heavy (refused without intent)', () => {
    for (const f of ['p4/browser', 'p4/provision-second-person', 'p5/sample-probe', 'p6/new-thing'])
      expect(isProductionHeavy(`/r/scripts/${f}.ts`, npm, manifest), f).toBe(true)
  })
  it('a named sample, smoke or local one is let through, as a verify suite is', () => {
    expect(isProductionHeavy('/r/scripts/p6/account-ui.ts', npm, manifest)).toBe(false)
    expect(isProductionHeavy('/r/scripts/p5/signout.ts', npm, manifest)).toBe(false)
    expect(isProductionHeavy('/r/scripts/p5/settings-qa.ts', npm, manifest)).toBe(false)
  })
  it('scripts outside the suite directories are still never refused here', () => {
    expect(isProductionHeavy('/r/scripts/p7/x.ts', npm, manifest)).toBe(false)
    expect(isProductionHeavy('/r/scripts/deploy/hq.ts', npm, manifest)).toBe(false)
  })
})

describe('driven as a real process: a p4 command is refused before any statement is sent', () => {
  const exec = join(process.cwd(), 'src/db/executor.ts')
  const probe = (stream: string): { root: string; file: string } => {
    const root = mkdtempSync(join(tmpdir(), 'pstream-'))
    const dir = join(root, 'scripts', stream)
    mkdirSync(dir, { recursive: true })
    const file = join(dir, 'probe.ts')
    writeFileSync(
      file,
      `import { ManagementApiExecutor } from ${JSON.stringify(exec)}\n` +
        "const db = new ManagementApiExecutor('baujwlzcziasnfhhkchg', 'sbp_not_a_real_token')\n" +
        'void (async () => {\n' +
        "  await db.execute('select 1')\n" +
        '})().catch((e) => {\n' +
        '  console.error(String(e?.message ?? e))\n' +
        '  process.exitCode = 1\n' +
        '})\n',
    )
    return { root, file }
  }
  const env = (intent: string) => ({
    ...process.env,
    HQ_PRODUCTION_INTENT: intent,
    ALLOW_PRODUCTION_CHECKS: '1',
    ALLOW_PRODUCTION_WRITES: '',
    SUPABASE_ACCESS_TOKEN: 'sbp_not_a_real_token',
    HTTPS_PROXY: 'http://127.0.0.1:9', // if the guard failed, the request still could not leave this machine
    HTTP_PROXY: 'http://127.0.0.1:9',
  })

  const drive = (stream: string, intent: string): string => {
    const { root, file } = probe(stream)
    try {
      const out = spawnSync('npx', ['tsx', file], {
        env: env(intent),
        encoding: 'utf8',
        timeout: 90000,
      })
      return `${out.stdout}${out.stderr}`
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }

  it('without intent a p4, p5 and p6 command is refused as a production-heavy suite', () => {
    for (const stream of ['p4', 'p5', 'p6'])
      expect(drive(stream, ''), stream).toContain('REFUSED: this is a production-heavy suite')
  }, 300000)

  it('with intent it still needs the second flag, because such a suite writes', () => {
    expect(drive('p4', '1')).toContain('WRITE')
  }, 120000)

  it('control: the same file outside the suite directories is not refused by this guard', () => {
    expect(drive('notasuite', '')).not.toContain('production-heavy suite')
  }, 120000)
})
