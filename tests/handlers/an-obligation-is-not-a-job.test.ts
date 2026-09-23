/**
 * #312 — an obligation is not a job, and a refusal is not a throw.
 *
 * ## Canonical ground truth
 *
 *     real parent/child pairs               56
 *     child finished AFTER the parent       53   (95%)
 *     branch_groups that are real traffic    0
 *     real children outside any group     1055
 *     real turns convening 2+ specialists    0
 *
 * The parent finishing before its children is what ALWAYS happens, and the
 * aggregation that would have owned the late result was gated at two
 * specialists — one above the only shape that occurs.
 *
 * Both halves held the same threshold, so lowering either alone did nothing:
 * `instruction.ts` at `>= 2`, and `app.fan_in_over` refusing `v_count < 2`.
 * CLAUDE.md's 0282/0293 entry for the third time.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const handler = readFileSync('src/handlers/instruction.ts', 'utf8')
const synth = readFileSync('src/handlers/synthesise.ts', 'utf8')
const withoutComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
const H = withoutComments(handler)
const S = withoutComments(synth)

describe('one convened specialist is owned', () => {
  it('the caller registers a fan-in over one branch', () => {
    expect(H).toMatch(/if \(branchesStarted\.length >= 1\) \{/)
  })

  it('and the refusal the function RETURNS is read, not only the one it throws', () => {
    /*
      `app.fan_in_over` returns `{error: …}` rather than raising. With only a
      `.catch`, months of refusals were silent — which is the swallowed-write
      defect CLAUDE.md records `consultations` sitting empty for weeks behind.
    */
    /*
      BOUNDED TO THE FAN-IN BLOCK. A first version sliced 2600 characters
      after the call and ran straight past it into the record-consultation
      handler, which happens to contain `answer?.error` and `app.cannot` of
      its own — so a synthetic failure that gutted the fan-in's check left
      this GREEN. #268's superstring trap in slice form, and the fourth
      vacuous control in this family.
    */
    const from = H.indexOf('branchesStarted.length >= 1')
    const to = H.indexOf("who.slug !== 'chief-of-staff'", from)
    expect(from).toBeGreaterThan(-1)
    expect(to).toBeGreaterThan(from)
    const call = H.slice(from, to)
    expect(call).toContain('app.fan_in_over')
    expect(call).toContain('answer?.error')
    expect(call).toContain('app.cannot')
  })
})

describe('a lone branch is relayed, never synthesised', () => {
  it('there is a one-branch path before the model is reached', () => {
    const one = S.indexOf('outputs.length === 1')
    const model = S.indexOf('router.complete')
    expect(one).toBeGreaterThan(-1)
    expect(model).toBeGreaterThan(-1)
    expect(one).toBeLessThan(model)
  })

  it('and it asks provenance rather than claiming it', () => {
    /*
      `enforce_deterministic_claim` refuses `deterministic_retrieval` on any
      correlation that spent a model call — and the branch spent several on
      THIS one, because a child inherits its parent's correlation. Claiming it
      would have failed the job at the insert, which is the shape that cost
      `office.notion_sync` twelve failures in a day.
    */
    const block = /if \(outputs\.length === 1\) \{[\s\S]{0,900}/.exec(S)?.[0] ?? ''
    expect(block).toContain('howComposed(')
    expect(block).not.toMatch(/path: 'deterministic_retrieval'/)
  })

  it('and it carries the specialist name, so nothing is laundered', () => {
    /*
      #128: a colleague's prose is the office's own prose. Relaying it without
      saying whose it is would put an unattributed finding in Grant's hands.
    */
    const block = /if \(outputs\.length === 1\) \{[\s\S]{0,900}/.exec(S)?.[0] ?? ''
    expect(block).toContain('only.name')
    expect(block).toContain('only.body')
  })
})
