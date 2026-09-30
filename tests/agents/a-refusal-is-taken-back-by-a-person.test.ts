import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/*
  ADR-0053: the only way to take a remembered No back is a person's press at the
  gateway. The runtime properties are driven in scripts/isolated/refusal-reversal.ts;
  these pin the wiring a refactor could quietly undo.
*/
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const full = join(dir, f)
    return statSync(full).isDirectory() ? walk(full) : full.endsWith('.ts') ? [full] : []
  })

describe('taking a No back is a person-only door', () => {
  it('no agent, handler or job path names the function', () => {
    const named = walk('src').filter((f) => /withdraw_refusal/.test(readFileSync(f, 'utf8')))
    expect(named).toEqual([])
  })
  it('the gateway exposes it with the verified principal injected, never the page-supplied one', () => {
    const gw = readFileSync('supabase/functions/hq-api/index.ts', 'utf8')
    expect(gw).toMatch(
      /withdraw_refusal: \{\s*fn: 'hq_withdraw_refusal',\s*required: \['p_blocker_id'\],\s*by: 'p_by'/,
    )
  })
  it('the page presses it and names the action', () => {
    const app = readFileSync('web/studio/app.js', 'utf8')
    expect(app).toMatch(/act\(\s*'withdraw_refusal'/)
  })
  it('the page says reopening does not approve (Reopen sounds like Allow)', () => {
    const app = readFileSync('web/studio/app.js', 'utf8')
    expect(app).toMatch(/Reopening does not approve it/)
  })
})
