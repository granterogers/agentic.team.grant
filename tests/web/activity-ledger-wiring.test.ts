/**
 * The Team HQ Activity page consumes the unified ledger without a visual change (docs/activity-ledger/ARCHITECTURE.md).
 *
 * `needLately` keeps the existing list and replaces its rows ONLY when the ledger answers enabled with at least one row. Off, absent,
 * empty or failing, the list the page already had stands, so switching the ledger on can never empty the page. The assertions are on
 * the wired expressions (CLAUDE.md: a name appearing in a file is not evidence that anything calls it) and each detector is shown a
 * synthetic defect it must catch.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync('web/studio/app.js', 'utf8')

const needLately = (src: string): string => {
  const a = src.indexOf('async function needLately()')
  if (a < 0) return ''
  const b = src.indexOf('\nasync function refresh()', a)
  return src.slice(a, b < 0 ? a + 2000 : b)
}

/** The properties, as predicates over the function's text, so a mutated copy can be put through the same ones. */
const properties = {
  readsTheLedgerSection: (t: string) => /await settles\(read\('activity_ledger'\)\)/.test(t),
  replacesOnlyWhenEnabledAndNonEmpty: (t: string) =>
    /if \(ledger\?\.enabled === true && Array\.isArray\(ledger\.office\) && ledger\.office\.length > 0\) \{\s*latest\.lately = \{ \.\.\.latest\.lately, office: ledger\.office \}/.test(t),
  keepsTheRestOfThePage: (t: string) => /latest\.lately = \{ \.\.\.latest\.lately, office: ledger\.office \}/.test(t),
  ledgerFailureIsContained: (t: string) => /try \{\s*const ledger = await settles\(read\('activity_ledger'\)\)[\s\S]*?\} catch \{\s*\/\/ the existing list stands\s*\}/.test(t),
  existingReadStillFirst: (t: string) => t.indexOf("read('lately')") > -1 && t.indexOf("read('lately')") < t.indexOf("read('activity_ledger')"),
}

describe('needLately', () => {
  const body = needLately(source)

  it('found the function (a control: the detectors below would pass on an empty string otherwise)', () => {
    expect(body.length).toBeGreaterThan(300)
    expect(body).toContain("read('lately')")
  })

  for (const [name, holds] of Object.entries(properties)) {
    it(`holds: ${name}`, () => {
      expect(holds(body), name).toBe(true)
    })
  }

  describe('each detector can fail', () => {
    const mutants: Record<keyof typeof properties, [string, string]> = {
      readsTheLedgerSection: ["read('activity_ledger')", "read('lately')"],
      replacesOnlyWhenEnabledAndNonEmpty: ['ledger?.enabled === true && ', ''],
      keepsTheRestOfThePage: ['{ ...latest.lately, office: ledger.office }', '{ office: ledger.office }'],
      ledgerFailureIsContained: ['// the existing list stands', 'throw new Error("ledger")'],
      existingReadStillFirst: ["read('lately')", "read('activity_ledger')"],
    }
    for (const [name, [from, to]] of Object.entries(mutants)) {
      it(`${name} goes red when the code is changed to defeat it`, () => {
        const mutated = body.replace(from, to)
        expect(mutated, 'the mutation landed').not.toBe(body)
        expect(properties[name as keyof typeof properties](mutated), name).toBe(false)
      })
    }
  })
})
