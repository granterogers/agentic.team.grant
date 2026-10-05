/**
 * Every verification suite has an environment class, and the classes cannot quietly lie.
 *
 *   npm run check:suite-classes
 *
 * 1. every name the manifest lists is a real suite (a rename must not leave a stale exemption);
 * 2. no suite is classed `local` or `sample` while its source touches the production database or a real session, except
 *    the Sample Person's own, which is the point of that class;
 * 3. CONTROL: the classifier must call a suite whose source plainly uses the Management API production-heavy, or a
 *    classifier that has stopped seeing anything would report "everything local" and read as clean.
 */
import '../src/safety/arm.ts'
import { readFileSync } from 'node:fs'
import { classify, suites } from './suite.ts'

const manifest = JSON.parse(readFileSync('docs/testing/suite-classes.json', 'utf8')) as {
  sample: string[]
  smoke: string[]
  local: string[]
}
const all = suites()
const names = new Set(all.map((s) => s.name))
const problems: string[] = []

for (const n of [...manifest.sample, ...manifest.smoke, ...manifest.local])
  if (!names.has(n)) problems.push(`the manifest names ${n}, which is not a suite`)

for (const s of all) {
  if (s.cls !== 'local') continue
  const m = /tsx\s+(\S+\.ts)/.exec(s.command)
  if (m === null) continue
  const text = readFileSync(m[1] ?? '', 'utf8')
  if (/ManagementApiExecutor|supabase\.co/.test(text))
    problems.push(`${s.name} is classed local but its source reaches the database`)
}

const control = classify('verify:control', 'tsx scripts/verify/upload.ts')
if (control !== 'production-heavy')
  problems.push(`CONTROL failed: verify:upload classed ${control}, expected production-heavy`)

const counts: Record<string, number> = {}
for (const s of all) counts[s.cls] = (counts[s.cls] ?? 0) + 1
console.log(`suite classes: ${JSON.stringify(counts)}`)
if (problems.length > 0) {
  for (const p of problems) console.log(`  ! ${p}`)
  process.exit(1)
}
console.log('check:suite-classes clean')
