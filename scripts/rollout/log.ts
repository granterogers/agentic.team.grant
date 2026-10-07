/**
 * The rollout's two append-only logs under .out/rollout/ (outside git), and the gate check the other tools call.
 *
 *   gate-log.jsonl   one line per canary reading (scripts/rollout/gate.ts read)
 *   writes.jsonl     one line per production write (scripts/rollout/step.ts, the two deploy tools)
 *
 * Reading them touches no network.
 */
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { isFirstWrite, type Reading, twoGo, type WriteEvent } from './gate-lib.ts'

const DIR = '.out/rollout'
export const GATE_LOG = `${DIR}/gate-log.jsonl`
export const WRITE_LOG = `${DIR}/writes.jsonl`

export const readLines = <T>(file: string): T[] => {
  try {
    return readFileSync(file, 'utf8')
      .split('\n')
      .filter((l) => l.trim() !== '')
      .map((l) => JSON.parse(l) as T)
  } catch {
    return []
  }
}

export const appendLine = (file: string, value: unknown): void => {
  mkdirSync(DIR, { recursive: true })
  appendFileSync(file, `${JSON.stringify(value)}\n`)
}

/** Record a production write (after it was made, successful or not). */
export const logWrite = (what: string, ok: boolean, detail?: string): void =>
  appendLine(WRITE_LOG, {
    at: new Date().toISOString(),
    what,
    ok,
    ...(detail === undefined ? {} : { detail }),
  } satisfies WriteEvent)

/**
 * Refuse unless the two-GO condition holds. Used before the baseline reads, and before the first production write; once a write
 * has been made, a later step is gated by the fresh canary its own tool takes first, so `firstWriteOnly` lets that through.
 */
export const requireTwoGo = (what: string, firstWriteOnly = false): void => {
  const writes = readLines<WriteEvent>(WRITE_LOG)
  if (firstWriteOnly && !isFirstWrite(writes)) return
  const verdict = twoGo(readLines<Reading>(GATE_LOG), writes, new Date())
  if (verdict.ok) return
  console.error(
    `REFUSED: ${what} needs two consecutive GO canaries about ten minutes apart (scripts/rollout/gate.ts read, twice, with nothing changed between), and the condition does not hold:\n  ${verdict.reasons.join('\n  ')}\nNothing was sent.`,
  )
  process.exit(1)
}
