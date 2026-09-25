import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ADAPTER_SHAPE } from '../../scripts/leak-witness.js'

describe('containment: the guard and an independent witness (R37)', () => {
  it('work started by harness work is harness (0598)', () => {
    const sql = readFileSync(
      'migrations/0598_a_voice_session_the_page_did_not_mint_is_harness.sql',
      'utf8',
    )
    expect(sql).toMatch(
      /or \(j\.parent_job_id is not null and app\.harness_job\(j\.parent_job_id\)\)/,
    )
  })
  it('check:leaks runs the shared witness SQL, not a copy', () => {
    const src = readFileSync('scripts/check-leaks.ts', 'utf8')
    expect(src).toMatch(/await db\.execute\(offShapeSql\)/)
    expect(src).toMatch(/await db\.execute\(harnessDocSql\)/)
    expect(src).not.toMatch(/const ADAPTER_SHAPE = String\.raw/)
  })
  it('the adapter shape admits real keys and refuses the escaped ones', () => {
    const re = new RegExp(ADAPTER_SHAPE)
    for (const k of [
      'telegram:message:8967954396:1386648496:512',
      'slack:message:C0C2DAPDN02:1790000000.1234',
      'voice:turn:s9czo3u0fw2.mufvdj1',
    ])
      expect(re.test(k)).toBe(true)
    for (const k of [
      'voice:turn:scenario-a-x.1',
      'voice:turn:deploy1790157906882.1',
      'telegram:message:escapes-x-real',
    ])
      expect(re.test(k)).toBe(false)
  })
})
