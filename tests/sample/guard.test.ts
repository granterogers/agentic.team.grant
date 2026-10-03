import { describe, expect, it } from 'vitest'
import { guardOffice, SAMPLE_OWNER_KEY } from '../../scripts/sample/guard.ts'

const GRANT = '2a2cd4d4-0000-4000-8000-000000000001'
const SAMPLE = '205669cc-0000-4000-8000-000000000002'
const good = { isOperator: false, kind: 'person', ownerKey: SAMPLE_OWNER_KEY, state: 'active' }

describe('the Sample Person guard refuses by structure', () => {
  it('accepts the Sample office', () => {
    expect(() => guardOffice(SAMPLE, good)).not.toThrow()
  })

  it("refuses the operator's office even if it carried the Sample's owner key", () => {
    expect(() => guardOffice(GRANT, { ...good, isOperator: true })).toThrow(/operator's office/)
  })

  it('refuses Grant as a person office with his own key', () => {
    expect(() => guardOffice(GRANT, { ...good, ownerKey: 'grant' })).toThrow(
      /not the Sample Person/,
    )
  })

  it.each(['system', 'test'])('refuses a %s office', (kind) => {
    expect(() => guardOffice(SAMPLE, { ...good, kind })).toThrow(/not a person's/)
  })

  it('refuses a disabled office', () => {
    expect(() => guardOffice(SAMPLE, { ...good, state: 'disabled' })).toThrow(/disabled/)
  })

  it('names the reason it refused (a refusal for the wrong reason looks like the rule working)', () => {
    expect(() => guardOffice(GRANT, { ...good, isOperator: true })).not.toThrow(/owner/)
  })
})
