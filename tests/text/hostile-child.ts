/**
 * Child process for the hostile-document tests: builds ONE case, reads it, and prints one JSON line with what it cost.
 * It runs in its own process under a hard `--max-old-space-size`, so a reader that is not bounded dies here (or is killed
 * by the parent's timeout) instead of taking the test runner with it.
 *   node --import tsx --max-old-space-size=384 tests/text/hostile-child.ts <case>
 */
import { fileText } from '../../src/text/file-text.ts'
import { HOSTILE } from './hostile-inputs.ts'

const name = process.argv[2] ?? ''
const c = HOSTILE[name]
if (c === undefined) {
  console.error(`no such case: ${name}`)
  process.exit(2)
}
const input = c.build()
const bytesIn = input.bytes.length
// maxRSS is the kernel's high-water mark for the whole process, so a spike inside one synchronous call is not missed.
const rssBeforeMb = Math.round(process.resourceUsage().maxRSS / 1024)
const started = performance.now()
const cpuBefore = process.cpuUsage()
// The reader's own wall clock (10 s by default) is a backstop for what the counters did not foresee. When the machine is
// busy, wall time stretches while the work does not, so the parent may widen the backstop (HOSTILE_WALL_MS) and judge the
// case on CPU time instead; the counters, not patience, must still be what ends it.
const wall = Number(process.env.HOSTILE_WALL_MS ?? '')
const result = await fileText(
  input.bytes,
  input.mime,
  input.name,
  Number.isFinite(wall) && wall > 0 ? { ms: wall } : undefined,
)
const ms = Math.round(performance.now() - started)
const cpu = process.cpuUsage(cpuBefore)
const cpuMs = Math.round((cpu.user + cpu.system) / 1000)
console.log(
  JSON.stringify({
    case: name,
    bytesIn,
    ms,
    cpuMs,
    rssBeforeMb,
    maxRssMb: Math.round(process.resourceUsage().maxRSS / 1024),
    text: result.text === null ? null : `${String(result.text.length)} chars`,
    why: result.text === null ? result.why : undefined,
  }),
)
process.exit(0)
