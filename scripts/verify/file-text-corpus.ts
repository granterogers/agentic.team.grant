/**
 * The file reader against REAL PDFs, with pdftotext as the ground truth (#419).
 *   npm run verify:file-text-corpus [extra.pdf ...]
 *
 * The unit tests build their PDFs by hand, which proves the reader against what its author imagined a PDF to be. This runs it
 * over PDFs other software produced (the repository's own samples, and whatever real ones are on the machine: pass more as
 * arguments) and compares what it read with what `pdftotext` read. Recall is the share of distinct words of four or more
 * letters that pdftotext found and this found too; a PDF this reader declines (a scan, an unmapped font) is REPORTED as
 * declined, never counted as a pass or a failure, because declining is the honest answer. Local class: no office, no network.
 * Skipped with a sentence if pdftotext is absent.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileText } from '../../src/text/file-text.ts'

const have = spawnSync('pdftotext', ['-v'], { encoding: 'utf8' })
if (have.error !== undefined) {
  console.log(
    'pdftotext is not installed here: the real-PDF corpus is NOT checked (this is a skip, not a pass)',
  )
  process.exit(0)
}
const words = (s: string): Set<string> =>
  new Set(
    (s.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'’-]{3,}/gu) ?? []).map((w) =>
      w.replace(/[’']/g, ''),
    ),
  )

const found: string[] = process.argv.slice(2)
const samples = 'web/studio/samples'
if (existsSync(samples)) {
  for (const f of readdirSync(samples)) if (f.endsWith('.pdf')) found.push(join(samples, f))
}
let failed = 0
let read = 0
for (const path of found) {
  if (!existsSync(path)) continue
  const bytes = new Uint8Array(readFileSync(path))
  const truth = spawnSync('pdftotext', ['-enc', 'UTF-8', path, '-'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  }).stdout
  const got = await fileText(bytes, 'application/pdf', path)
  const t = words(truth)
  if (got.text === null) {
    console.log(`DECLINED ${path} (${String(t.size)} words by pdftotext): ${got.why}`)
    continue
  }
  const g = words(got.text)
  let hit = 0
  for (const w of t) if (g.has(w)) hit += 1
  const recall = t.size === 0 ? 1 : hit / t.size
  const ok = recall >= 0.9
  read += 1
  if (!ok) failed += 1
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${path}: recall ${(recall * 100).toFixed(1)}% (${String(hit)} of ${String(t.size)} words)`,
  )
  if (!ok) {
    const missing = [...t].filter((w) => !g.has(w)).slice(0, 12)
    console.log(`     missing e.g. ${missing.join(', ')}`)
  }
}
console.log(`\n${String(read)} PDF(s) read, ${String(failed)} below 90% recall`)
process.exit(failed === 0 ? 0 : 1)
