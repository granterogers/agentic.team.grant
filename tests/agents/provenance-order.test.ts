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
 * Scanned from the `path:` line to the END OF THE OBJECT LITERAL, found by
 * brace balance. A model call is `sayAs(` or `router.complete(` — the two ways
 * this repository spends one.
 *
 * The first version stopped at `satisfies HandlerOutput`, which is how MOST of
 * these returns are written and not all of them. A correct return without that
 * suffix let the scan run on into the rest of the function, and #282 added one:
 * `synthesise.ts`'s `dependency_wait` branch was reported against a
 * `router.complete` twenty-nine lines below it, in a different statement. A
 * detector that points at the wrong place is worse than a bare count, which
 * this repository has already paid for twice — `check:templates` naming a
 * backtick for every parse error, and an audit printing "12 of 6".
 *
 * Brace balance cannot be fooled that way: the literal ends where it ends.
 */
const asksTooEarly = (src: string): readonly string[] => {
  const bad: string[] = []
  const lines = src.split('\n')
  for (const [i, line] of lines.entries()) {
    if (!/path:\s*await\s+howComposed\(/.test(line)) continue
    /*
      Depth 1 at the `path:` line, because it sits one level inside the object
      literal that opened above it. The literal is closed by the line that
      brings the balance back to zero.
    */
    let depth = 1
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j] ?? ''
      if (/\b(?:sayAs|router\.complete)\(/.test(l)) {
        bad.push(`${String(i + 1)} -> ${String(j + 1)}: ${l.trim().slice(0, 60)}`)
        break
      }
      for (const ch of l) {
        if (ch === '{') depth += 1
        else if (ch === '}') depth -= 1
      }
      if (depth <= 0) break
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

/**
 * AND THE OTHER HALF: a handler that can spend a model may not hardcode the
 * claim at all.
 *
 * The order check above catches asking too early. It cannot catch never
 * asking, which is the commoner shape and the one that took a day to find:
 * `extract-tasks.ts` built one `base` object with
 * `path: 'deterministic_retrieval'` and spread it into all five of its
 * returns, two of which sit below `router.complete`. Every delegation that
 * reached it FAILED — the output insert refused, the job dead, Grant given
 * nothing for work he had asked for — and `verify:extract` passed 11/11
 * throughout, because it asserts the TASK ROWS, which really were created.
 *
 * `provenance.ts` records the identical defect in `slack-rotation.ts`, where
 * the only branch that spends a model is the one that reports a failure: the
 * check silenced exactly the message it exists to protect. Three files now.
 *
 * So the property is structural and cheap: **a handler that can reach a model
 * must import `howComposed`.** It does not prove every branch asks — nothing
 * short of running them can — but a file that spends inferences and has never
 * heard of the question is the state all three defects were in.
 */
describe('a handler that spends a model asks how it was composed', () => {
  it('every model-spending handler imports howComposed', () => {
    const missing: string[] = []
    for (const file of HANDLERS) {
      const source = readFileSync(file, 'utf8')
      const spends = /\.complete\(/.test(source)
      const claims = /path:\s*'deterministic_retrieval'/.test(source)
      if (!spends || !claims) continue
      if (!/howComposed/.test(source)) missing.push(file)
    }
    expect(missing, `these claim determinism and can spend a model: ${missing.join(', ')}`).toEqual(
      [],
    )
  })

  it('CONTROL: the rule is not vacuous — some handler is in scope', () => {
    /*
      A found-nothing check is indistinguishable from a check that cannot find
      anything, and CLAUDE.md records three instances of exactly that. If no
      handler both spends a model and carries the literal, the assertion above
      passes over an empty set and says nothing.
    */
    const inScope = HANDLERS.filter((f) => {
      const s = readFileSync(f, 'utf8')
      return /\.complete\(/.test(s) && /path:\s*'deterministic_retrieval'/.test(s)
    })
    expect(inScope.length).toBeGreaterThan(0)
  })
})
