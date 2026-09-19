/**
 * Ask the record AFTER spending the model, never before.
 *
 * `howComposed` counts the inferences recorded against a job's correlation and
 * answers `deterministic_retrieval` or `inference`. It asks the right
 * question. Two handlers asked it one step too early:
 *
 *     return {
 *       path: await howComposed(db, job.jobId),   // counts zero
 *       body: announce ? await sayAs(...) : plain, // spends one
 *     }
 *
 * An object literal evaluates in SOURCE ORDER, so `path` was decided before
 * the property that made it untrue. `enforce_deterministic_claim` then refused
 * the insert and the job FAILED — `office.notion_sync` every two hours from at
 * least 17:54 to 23:55 on 18 September, twelve of the office's sixteen daily
 * failures, with Notion mirroring silently not running.
 *
 * Nothing caught it. The fix was in the repository, the worker was deployed,
 * and the defect was the evaluation order of two lines that read correctly one
 * after the other.
 *
 * This is a SOURCE check rather than a behavioural one, deliberately: the
 * behaviour needs a real correlation, a real inference row and a real insert,
 * and the thing that went wrong is visible in the text. It is the same shape
 * as `quality-messages.test.ts`, which reads the source to assert a property
 * about what is written there.
 */
import { globSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/** Every handler, so a new one cannot quietly join the two that were wrong. */
const HANDLERS = globSync('src/handlers/*.ts')

/**
 * Does this file put a model call AFTER `path: await howComposed(...)` inside
 * the same object literal?
 *
 * Scanned from the `path:` line to the closing `satisfies HandlerOutput`,
 * which is how every one of these returns is written. A model call is
 * `sayAs(` or `router.complete(` — the two ways this repository spends one.
 */
const asksTooEarly = (src: string): readonly string[] => {
  const bad: string[] = []
  const lines = src.split('\n')
  for (const [i, line] of lines.entries()) {
    if (!/path:\s*await\s+howComposed\(/.test(line)) continue
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j] ?? ''
      if (/satisfies HandlerOutput/.test(l)) break
      if (/\b(?:sayAs|router\.complete)\(/.test(l)) {
        bad.push(`${String(i + 1)} -> ${String(j + 1)}: ${l.trim().slice(0, 60)}`)
        break
      }
    }
  }
  return bad
}

describe('a handler asks how it composed its answer after composing it', () => {
  it.each(HANDLERS)('%s', (file) => {
    expect(asksTooEarly(readFileSync(file, 'utf8'))).toEqual([])
  })

  it('CONTROL: the detector finds the shape it was written for', () => {
    /*
      The exact defect, as it stood in `notion-sync.ts` and `sync.ts`. Without
      this, a detector that matched nothing would pass every file above and
      look like a clean codebase — the found-nothing shape, on a check whose
      whole job is to find one thing.
    */
    const broken = [
      '      return {',
      '        ...base,',
      '        path: await howComposed(db, job.jobId),',
      '        body: announce',
      "          ? await sayAs(db, router, 'operations-director', { words: 45 })",
      '          : plain,',
      '      } satisfies HandlerOutput',
    ].join('\n')
    expect(asksTooEarly(broken)).toHaveLength(1)
  })

  it('CONTROL: and does NOT fire on the corrected order', () => {
    // Spending first and asking second is the fix, and must read as clean.
    const fixed = [
      "      const said = announce ? await sayAs(db, router, 'ops', {}) : plain",
      '      const composed = await howComposed(db, job.jobId)',
      '      return {',
      '        ...base,',
      '        path: composed,',
      '        body: said,',
      '      } satisfies HandlerOutput',
    ].join('\n')
    expect(asksTooEarly(fixed)).toEqual([])
  })

  it('CONTROL: a model call BEFORE the ask in the same literal is fine', () => {
    // Order within the literal is what matters, not presence. A body computed
    // above `path` has already spent whatever it was going to spend.
    const ok = [
      '      return {',
      "        body: await sayAs(db, router, 'ops', {}),",
      '        path: await howComposed(db, job.jobId),',
      '      } satisfies HandlerOutput',
    ].join('\n')
    expect(asksTooEarly(ok)).toEqual([])
  })
})
