import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/*
  Review of Run 5: 0625's first draft backfilled claim_gen with an UPDATE of every job, and jobs_touch_updated_at
  rewrote updated_at on all of them - the morning briefing would have reported the whole history as finished overnight.
  The property is that the migration writes no existing job row.
*/
const sql = readFileSync(
  new URL('../../migrations/0625_a_child_has_an_author_and_an_attempt_a_name.sql', import.meta.url),
  'utf8',
)
const code = sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*--.*$/gm, '')
describe('0625 leaves history alone', () => {
  it('runs no UPDATE against public.jobs outside a function body', () => {
    const outside = code
      .replace(/\$fn\$[\s\S]*?\$fn\$/g, '')
      .replace(/\$function\$[\s\S]*?\$function\$/g, '')
    expect(outside).not.toMatch(/update\s+public\.jobs/i)
  })
  it('numbers the next claim above the attempts already spent', () => {
    expect(code).toMatch(/greatest\(j\.claim_gen,\s*j\.attempt\)\s*\+\s*1/)
  })
})
