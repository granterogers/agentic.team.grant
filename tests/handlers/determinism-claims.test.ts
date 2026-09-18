/**
 * A handler that spends a model may not claim its answer was deterministic.
 *
 * `enforce_deterministic_claim` refuses `deterministic_retrieval` on any
 * correlation that recorded an inference, and it is right to: the claim says
 * nothing was invented, and no handler can know that about a sentence a model
 * wrote. When a handler claims it anyway the output is thrown away and **the
 * job fails**.
 *
 * On 18 September 2026 `public.jobs` had really failed that way as:
 *
 *     office.slack_rotate      10   latest 07:13 on 18 Sep
 *     briefing.morning          2   latest 04:00 on 18 Sep  <- Grant got no briefing
 *     office.capacity_report    2
 *     office.sync               2
 *
 * Five separate handlers, each written correctly on its own, each with the
 * same hardcoded `path` above a `sayAs` call. So this is asserted as a
 * PROPERTY OF THE SOURCE rather than per handler: every file that calls
 * `sayAs` must also read `howComposed`, and the next handler added cannot be
 * the sixth.
 *
 * It is deliberately a source-shape test. Driving each handler would need a
 * router, a database and a model, and would still only cover the branches the
 * fixtures happened to reach — the whole defect is that these branches are
 * the rare ones.
 *
 * ## The first version of this test was wrong
 *
 * It asserted that no file calling `sayAs` may contain
 * `path: 'deterministic_retrieval'` anywhere, and went red on all five
 * CORRECTED handlers. They each have other returns that are templated, where
 * the exemption is true and worth keeping — losing it everywhere would send
 * routine hourly output through quality review for nothing. The property is
 * per RETURN, not per file. Validate the test before believing the finding.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const DIRS = ['src/handlers', 'src/office', 'src/agents']

const files = DIRS.flatMap((d) =>
  readdirSync(d)
    .filter((f) => f.endsWith('.ts'))
    .map((f) => ({ path: join(d, f), text: readFileSync(join(d, f), 'utf8') })),
)

/**
 * Every `return { … }` object literal in a file, by brace matching.
 *
 * Crude on purpose: it needs to know which `path:` sits in the same object as
 * which `sayAs(`, and nothing less than the braces answers that. A regex over
 * the whole file cannot, which is exactly how the first version of this test
 * went red on five correct handlers.
 */
const returnBlocks = (text: string): string[] => {
  const out: string[] = []
  /*
    Advance by ONE, not to the end of the block just matched.

    The first version jumped `at` to the closing brace, which sounds like an
    optimisation and is a bug: a handler is `return { kind, handle: async () =>
    { … } }`, so the first match swallows the whole file and every
    `HandlerOutput` return inside it is skipped. The extractor found **zero**
    blocks containing `sayAs`, the rule below was vacuously green, and it
    stayed green when a fixed handler was deliberately put back.

    That is the inert-guard shape this repository keeps paying for, and the
    only reason it was caught is the control underneath — which is exactly
    what §10's harness audit is for.
  */
  for (let at = text.indexOf('return {'); at !== -1; at = text.indexOf('return {', at + 1)) {
    let depth = 0
    let i = at + 'return '.length
    for (; i < text.length; i++) {
      const c = text[i]
      if (c === '{') depth++
      else if (c === '}') {
        depth--
        if (depth === 0) break
      }
    }
    const block = text.slice(at, i + 1)
    // Innermost only: an enclosing handler object holds both a `sayAs` call
    // and a perfectly correct templated `path`, and judging it would report
    // every corrected handler as an offender.
    if (!block.slice('return '.length).includes('return {')) out.push(block)
  }
  return out
}

describe('handlers that spend a model', () => {
  it('reads a real set of files, so a green result means something', () => {
    // The found-nothing control. If the walk matched nothing every assertion
    // below would pass vacuously, which is how `npm run levels` once reported
    // zero for a defect it could not see.
    expect(files.length).toBeGreaterThan(20)
    expect(files.some((f) => f.text.includes('sayAs('))).toBe(true)
  })

  it('never claim determinism in a return that calls a model', () => {
    /*
      Stated as "must ask `howComposed`" rather than "must not say
      `deterministic_retrieval`", because most of these returns spread a
      `...base` whose path is set three hundred lines away. The absence of the
      literal proves nothing; the presence of the override proves the claim is
      read from the record. That is the shape `sync.ts` and `notion-sync.ts`
      had, and a literal check would have called both of them clean.
    */
    const offenders = files.flatMap((f) =>
      returnBlocks(f.text)
        .filter((b) => b.includes('sayAs('))
        .filter((b) => !b.includes('howComposed(') || /path:\s*'deterministic_retrieval'/.test(b))
        .map(() => f.path),
    )
    expect(offenders).toEqual([])
  })

  it('and the block reader finds the blocks, or the test above proves nothing', () => {
    // The control for the parser. A brace matcher that returns nothing makes
    // every assertion above pass vacuously — the found-nothing shape, and the
    // reason `npm run space` now names what it measured to.
    const all = files.flatMap((f) => returnBlocks(f.text))
    expect(all.length).toBeGreaterThan(40)
    // The two shapes the rule above has to tell apart must both be present,
    // or it is discriminating between nothing and nothing.
    expect(all.some((b) => b.includes('sayAs('))).toBe(true)
    expect(all.some((b) => b.includes('howComposed('))).toBe(true)
  })

  it('follows the binding too, when the model answer is assigned first', () => {
    /*
      The rule above reads the RETURN, so it cannot see
      `const said = await sayAs(...)` followed by `return { body: said, … }`.
      Sabotaging `slack-rotation.ts` and `propose.ts` — the two written that
      way — left it green, which is the inert half of a guard that looks
      complete.

      So this follows the binding: any identifier assigned from `sayAs` makes
      the return that uses it as its `body` a model-written return.
    */
    const offenders = files.flatMap((f) => {
      const bound = [...f.text.matchAll(/const\s+(\w+)\s*=\s*await sayAs\(/g)].map(
        (m) => m[1] as string,
      )
      if (bound.length === 0) return []
      return (
        returnBlocks(f.text)
          // `body: said` AND the shorthand `body,` — `slack-rotation.ts` uses
          // the second, and requiring the colon left it inert.
          .filter((b) =>
            bound.some((n) =>
              new RegExp(`body:\\s*${n}\\b|\\b${n}\\s*,`).test(b.replace(/^return \{/, '')),
            ),
          )
          .filter((b) => !b.includes('howComposed('))
          .map(() => f.path)
      )
    })
    expect(offenders).toEqual([])
  })

  it('and that binding rule is looking at something', () => {
    const bound = files.flatMap((f) =>
      [...f.text.matchAll(/const\s+(\w+)\s*=\s*await sayAs\(/g)].map((m) => m[1] as string),
    )
    expect(bound.length).toBeGreaterThan(0)
  })

  it('and ask howComposed instead', () => {
    const missing = files
      .filter((f) => f.text.includes('sayAs('))
      .filter((f) => !f.text.includes('howComposed'))
      .map((f) => f.path)
    expect(missing).toEqual([])
  })
})
