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

describe('the identity-bearing wrappers belong to the gateway role alone (0611)', () => {
  const sql = readFileSync(
    'migrations/0611_authorization_is_asked_once_and_a_no_is_remembered.sql',
    'utf8',
  )
  it.each([
    'public.hq_answer_blocker(uuid, text, text)',
    'public.hq_approve_tool(uuid, jsonb, text)',
    'public.hq_decline_tool(uuid, text, text)',
    'public.hq_grant_standing(text, text, uuid, timestamptz, text)',
    'public.hq_revoke_standing(uuid, text, text)',
    'public.hq_withdraw_refusal(uuid, text)',
    'public.hq_task_state(text, text, text, text)',
    'public.sender_admitted(text, text, text)',
  ])('%s is revoked from anon and authenticated, not only from public', (fn) => {
    const escaped = fn.replace(/[().,]/g, (c) => `\\${c}`)
    expect(sql).toMatch(
      new RegExp(`revoke all on function ${escaped} from public, anon, authenticated`),
    )
  })
})

describe('the boundary has no quiet fallback (0611)', () => {
  it('mayAct asks app.authorize_effect and never falls back to app.may_act', () => {
    const src = readFileSync('src/agents/approval.ts', 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^[ \t]*\/\/.*$/gm, '')
    expect(src).toMatch(/app\.authorize_effect\(/)
    expect(src).not.toMatch(/app\.may_act\(/)
    expect(src).not.toMatch(/42883/)
  })
  it('and it names its arguments', () => {
    const src = readFileSync('src/agents/approval.ts', 'utf8')
    for (const named of ['p_asked_job =>', 'p_job =>', 'p_fingerprint =>', 'p_staff =>']) {
      expect(src).toContain(named)
    }
  })
})
