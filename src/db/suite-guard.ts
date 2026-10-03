/**
 * The production-heavy suite guard, enforced where SQL actually leaves the process.
 *
 * `scripts/suite.ts` states a suite's class and refuses a production-heavy one without `--production`, but a person (or an
 * agent) can run `npx tsx scripts/verify/x.ts` or `npm run verify:x` directly and never meet it. So the executor asks the
 * same question on its first statement: is the script that started this process a production-heavy suite, and was
 * production intent stated? It is stated by `--production` through `scripts/suite.ts`, or by `npm run gate` /
 * `npm run e2e`, which set HQ_PRODUCTION_INTENT for the suites they spawn.
 *
 * Nothing here runs inside the worker or an edge function: it acts only when the entry script is under `scripts/verify/`
 * or `scripts/poc/` of a Node process, and it reaches `node:fs` through `process.getBuiltinModule` so the Deno bundle has
 * no import to resolve.
 */

type Manifest = {
  sample: string[]
  smoke: string[]
  local: string[]
  scripts: Record<string, string>
}

/** Where a suite lives. Anything else (operator commands, deploys, the worker) is not a suite and is never refused here. */
const SUITE_DIR = /(?:^|\/)scripts\/(verify|poc)\/[^/]+\.ts$/

let decided: string | null | undefined

/** Pure: given the entry script, its npm names and the manifest, is it production-heavy? */
export const isProductionHeavy = (
  entry: string,
  npmScripts: Record<string, string>,
  manifest: Manifest,
): boolean => {
  const rel = entry.replace(/^.*?(scripts\/(?:verify|poc)\/[^/]+\.ts)$/, '$1')
  if (!SUITE_DIR.test(rel)) return false
  const named = new Set([...manifest.sample, ...manifest.smoke, ...manifest.local])
  for (const [name, command] of Object.entries(npmScripts))
    if (named.has(name) && command.includes(rel)) return false
  const explicit = manifest.scripts[rel]
  if (explicit !== undefined) return explicit === 'production-heavy'
  return true
}

/** Throws a sentence unless this process may touch production. Memoised: the answer cannot change mid-run. */
export const assertMayTouchProduction = (): void => {
  if (decided === null) return
  if (typeof decided === 'string') throw new Error(decided)
  decided = null
  const proc = (globalThis as { process?: NodeJS.Process }).process
  const entry = proc?.argv?.[1]
  if (proc === undefined || entry === undefined || proc.env?.HQ_PRODUCTION_INTENT === '1') return
  if (!SUITE_DIR.test(entry)) return
  const fs = proc.getBuiltinModule?.('node:fs')
  if (fs === undefined) return
  let heavy = true
  try {
    const root = entry.replace(/\/scripts\/(?:verify|poc)\/[^/]+\.ts$/, '')
    const read = (p: string): unknown => JSON.parse(fs.readFileSync(`${root}/${p}`, 'utf8'))
    heavy = isProductionHeavy(
      entry,
      (read('package.json') as { scripts: Record<string, string> }).scripts,
      read('docs/testing/suite-classes.json') as Manifest,
    )
  } catch {
    // An unreadable manifest is not permission: a suite that cannot be classified is treated as heavy.
  }
  if (!heavy) return
  decided =
    'REFUSED: this is a production-heavy suite, which writes into or presses on the real office. ' +
    'Run it as `npm run suite -- <name> --production` (see docs/testing/SUITE-CLASSES.md), or use a sample-class suite.'
  throw new Error(decided)
}
