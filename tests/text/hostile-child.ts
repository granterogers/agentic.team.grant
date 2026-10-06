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
const result = await fileText(input.bytes, input.mime, input.name)
const ms = Math.round(performance.now() - started)
console.log(
  JSON.stringify({
    case: name,
    bytesIn,
    ms,
    rssBeforeMb,
    maxRssMb: Math.round(process.resourceUsage().maxRSS / 1024),
    text: result.text === null ? null : `${String(result.text.length)} chars`,
    why: result.text === null ? result.why : undefined,
  }),
)
process.exit(0)
