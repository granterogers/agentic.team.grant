/**
 * Which document requests are answered from the records (§19A, §19B) and which go to a model.
 *
 * The two fixed documents must be recognised by their own names, and a plain report must not be captured: a plain
 * report is drafted, and sending it down the records path would silently replace the model's writing with a table.
 */
import { describe, expect, it } from 'vitest'
import { deterministicKind } from '../../src/artifacts/deterministic.ts'

describe('which requests are answered from the records', () => {
  it('a correspondence summary is recognised by its name', () => {
    expect(deterministicKind('Create a correspondence summary for this project')).toBe(
      'correspondence',
    )
  })

  it('an accommodation comparison is recognised by its name, in any case', () => {
    expect(deterministicKind('Put together an Accommodation Comparison for the islands')).toBe(
      'accommodation',
    )
  })

  it('a plain report is not captured, so it is still drafted by a model', () => {
    expect(deterministicKind('Write me a short report on the villa enquiry')).toBeNull()
    expect(deterministicKind('Summarise the correspondence with Priya')).toBeNull()
  })

  it('a request that names neither document is not captured', () => {
    expect(deterministicKind('Create a one-pager on the venue options')).toBeNull()
  })
})
