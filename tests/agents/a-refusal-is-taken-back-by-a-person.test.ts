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
      /withdraw_refusal: \{\s*fn: 'hq_withdraw_refusal',\s*(?:office: true,\s*)?required: \['p_blocker_id'\],\s*by: 'p_by'/,
    )
  })
  it('the page presses it and names the action', () => {
    const app = readFileSync('web/studio/app.js', 'utf8')
    expect(app).toMatch(/act\(\s*'withdraw_refusal'/)
  })
  it('the page says reopening does not approve (Reopen sounds like Allow)', () => {
    const app = readFileSync('web/studio/app.js', 'utf8')
    expect(app).toMatch(/(?:Reopening|Letting it ask again) does not approve/)
  })
})

describe('the identity-bearing and authority-setting wrappers belong to the gateway role alone (0611)', () => {
  const sql = readFileSync(
    'migrations/0611_authorization_is_asked_once_and_a_no_is_remembered.sql',
    'utf8',
  )
  const block = /-- REVOKE-BEGIN([\s\S]*?)-- REVOKE-END/.exec(sql)?.[1] ?? ''
  it('one block revokes from anon and authenticated, not only from public, and grants the gateway role', () => {
    expect(block).toMatch(/revoke all on function %s from public, anon, authenticated/)
    expect(block).toMatch(/grant execute on function %s to service_role/)
  })
  it('it covers every public function that names p_by, by property rather than by list', () => {
    expect(block).toMatch(/pg_get_function_arguments\(p\.oid\) ~ '\\mp_by\\M'/)
  })
  it.each([
    'hq_autonomy_set',
    'hq_staff_tool_set',
    'approve_document',
    'discard_document',
    'sender_admitted',
    'hq_withdraw_refusal',
    'hq_task_state',
  ])('and names the setter %s', (fn) => {
    expect(block).toContain(`'${fn}'`)
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
