/**
 * Run a verification suite with its environment class stated.
 *
 *   npx tsx scripts/suite.ts <name>                 # e.g. wired, ui, settings-live
 *   npx tsx scripts/suite.ts <name> --production    # explicit intent, for production-heavy suites
 *   npx tsx scripts/suite.ts --list                 # every suite and its class
 *   npx tsx scripts/suite.ts --classify             # the counts
 *
 * Classes (docs/testing/SUITE-CLASSES.md): local (no database), sample (the Sample Person's own office, through the real
 * gateway), smoke (a few reads of production, cheap), production-heavy (writes fixtures into, or presses on, the real
 * office). A production-heavy suite will not start without --production, and neither a smoke nor a heavy suite starts
 * while Supabase reports itself unhealthy: a degraded platform is not something to add load to.
 */

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

export type SuiteClass = 'local' | 'sample' | 'smoke' | 'production-heavy'

type Manifest = {
  sample: string[]
  smoke: string[]
  local: string[]
  scripts: Record<string, SuiteClass>
}
const manifest = JSON.parse(readFileSync('docs/testing/suite-classes.json', 'utf8')) as Manifest

/** The script file an npm script runs, when it is a plain `tsx <file>`. */
const fileOf = (command: string): string | null =>
  /^(?:[A-Z_]+=\S+\s+)*tsx\s+(\S+\.ts)/.exec(command)?.[1] ?? null

const TOUCHES_PRODUCTION =
  /ManagementApiExecutor|SUPABASE_ACCESS_TOKEN|supabase\.co|harnessSession|grantSession|secondSession|hq\.api_token/

/** Classify one npm script. Explicit entries win; otherwise what the source touches decides. */
export const classify = (npmName: string, command: string): SuiteClass => {
  if (manifest.sample.includes(npmName)) return 'sample'
  if (manifest.smoke.includes(npmName)) return 'smoke'
  if (manifest.local.includes(npmName)) return 'local'
  const file = fileOf(command)
  if (file === null)
    return /^(?:npm run \S+(?: && )?)+$/.test(command) ? 'production-heavy' : 'production-heavy'
  const explicit = manifest.scripts[file]
  if (explicit !== undefined) return explicit
  let text = ''
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return 'production-heavy'
  }
  return TOUCHES_PRODUCTION.test(text) ? 'production-heavy' : 'local'
}

export const suites = (): { name: string; command: string; cls: SuiteClass }[] => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
    scripts: Record<string, string>
  }
  return Object.entries(pkg.scripts)
    .filter(([n]) => n.startsWith('verify:'))
    .map(([name, command]) => ({ name, command, cls: classify(name, command) }))
}

const healthy = async (): Promise<boolean | null> => {
  const token = process.env.SUPABASE_ACCESS_TOKEN
  if (token === undefined || token === '') return null
  const ref = process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg'
  try {
    const r = await fetch(
      `https://api.supabase.com/v1/projects/${ref}/health?services=db,auth,rest`,
      {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15000),
      },
    )
    const b = (await r.json()) as { healthy?: boolean }[]
    return Array.isArray(b) && b.every((s) => s.healthy === true)
  } catch {
    return false
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2)
  const all = suites()
  if (args.includes('--list') || args.includes('--classify')) {
    const counts: Record<string, number> = {}
    for (const s of all) counts[s.cls] = (counts[s.cls] ?? 0) + 1
    if (args.includes('--list')) for (const s of all) console.log(`${s.cls.padEnd(17)} ${s.name}`)
    console.log(JSON.stringify(counts))
    process.exit(0)
  }
  const name = args.find((a) => !a.startsWith('--'))
  if (name === undefined) {
    console.error('usage: suite.ts <name> [--production] | --list | --classify')
    process.exit(2)
  }
  const suite = all.find((s) => s.name === name || s.name === `verify:${name}`)
  if (suite === undefined) {
    console.error(`no suite called ${name}`)
    process.exit(2)
  }
  console.log(`${suite.name}: ${suite.cls}`)
  if (suite.cls === 'production-heavy' && !args.includes('--production')) {
    console.error(
      'REFUSED: this suite writes into or presses on the real office. Say so with --production, ' +
        'or run it against the Sample Person (docs/testing/SUITE-CLASSES.md).',
    )
    process.exit(3)
  }
  if (suite.cls === 'smoke' || suite.cls === 'production-heavy') {
    const ok = await healthy()
    if (ok === false) {
      console.error(
        'REFUSED: Supabase does not report itself healthy. Not adding load to a degraded platform.',
      )
      process.exit(4)
    }
  }
  const r = spawnSync('npm', ['run', suite.name], {
    stdio: 'inherit',
    env: { ...process.env, HQ_PRODUCTION_INTENT: '1' },
  })
  process.exit(r.status ?? 1)
}
