/**
 * 1021 asks an assistant's research to be started with the words the instruction handler recognises. The SQL string and
 * the recogniser are two halves; this reads the first out of the migration and feeds it to the second, so changing either
 * alone turns it red (a name appearing in a file is not evidence that anything calls it).
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { researchRequest } from '../../src/agents/actions.ts'

const sql = readFileSync('migrations/1021_the_audit_of_the_candidate_closes_seven_gaps.sql', 'utf8')

describe('mcp_start_research', () => {
  const literal = /v_text := '([^']+)' \|\| btrim\(p_topic\)/.exec(sql)?.[1] ?? ''
  it('opens with words researchRequest turns into a web lookup', () => {
    expect(literal).not.toBe('')
    expect(researchRequest(`${literal}churn benchmarks for SaaS`)).not.toBeNull()
  })
  it('control: the sentence it used before does not', () => {
    expect(
      researchRequest(
        'Research this for the project and report what you find, with sources: churn benchmarks',
      ),
    ).toBeNull()
  })
})

describe('the duties that must ship switched off', () => {
  it('1021 switches calendar-event-sync off and asserts drive-index and it stay off', () => {
    expect(sql).toMatch(
      /update public\.responsibilities set enabled = false\s+where slug = 'calendar-event-sync'/,
    )
    expect(sql).toMatch(/slug in \('drive-index', 'calendar-event-sync'\) and enabled/)
  })
})
