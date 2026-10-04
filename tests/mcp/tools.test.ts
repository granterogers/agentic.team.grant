/**
 * The MCP tool catalogue (supabase/functions/mcp/tools.ts), as data.
 *
 * What is asserted is the property each rule exists for - not that a name is present:
 *   - the OFFICE reaches an RPC from the credential only, whatever the model sent;
 *   - a write tool refuses a read-only client, and every tool that changes something is DECLARED a write;
 *   - an optional tool (the calendar) is advertised only where the database serves it;
 *   - `constructor` is not a tool;
 *   - no tool can delete, and no tool takes a secret or an office.
 */
import { describe, expect, it } from 'vitest'
import {
  TOOLS,
  clampInt,
  isoDate,
  isoInstant,
  rpcArgs,
  scopeRefusal,
  toolNamed,
  visibleTools,
} from '../../supabase/functions/mcp/tools.ts'

const OFFICE = '11111111-1111-1111-1111-111111111111'
const OTHER = '22222222-2222-2222-2222-222222222222'

describe('the catalogue', () => {
  it('declares every tool that changes anything as a write, and nothing else', () => {
    const writes = Object.entries(TOOLS)
      .filter(([, s]) => s.write === true)
      .map(([n]) => n)
      .sort()
    expect(writes).toEqual(
      [
        'add_to_project', 'ask_notebook', 'ask_team', 'create_event', 'create_task', 'generate_artifact',
        'notebook_generate', 'push_to_notebook', 'start_research', 'update_event', 'update_task',
      ].sort(),
    )
    for (const n of ['search_project', 'list_tasks', 'list_events', 'inspect_activity', 'check_job', 'list_projects']) {
      expect(TOOLS[n]?.write, n).not.toBe(true)
    }
  })

  it('has no way to delete, and none takes an office or a secret from the model', () => {
    for (const [name, spec] of Object.entries(TOOLS)) {
      expect(name).not.toMatch(/delete|remove|cancel|revoke|destroy/)
      const props = Object.keys((spec.schema as { properties?: object }).properties ?? {})
      for (const p of props) expect(p, `${name}.${p}`).not.toMatch(/office|token|secret|password|key|client/i)
    }
  })

  it('maps arguments by named field only: a model-supplied office never reaches the RPC', () => {
    for (const [name, spec] of Object.entries(TOOLS)) {
      const hostile = { p_office: OTHER, office: OTHER, office_id: OTHER, p_client_id: 'attacker', project: 'p', query: 'q', title: 't', task_id: OTHER, event_id: OTHER, question: 'q', topic: 't', brief: 'b', content: 'c', document_id: OTHER, starts_at: '2026-10-05T10:00:00Z', job_id: OTHER, kind: 'audio' }
      const args = rpcArgs(spec, OFFICE, 'real-client', hostile)
      expect(args.p_office, name).toBe(OFFICE)
      if ('p_client_id' in args) expect(args.p_client_id, name).toBe('real-client')
    }
  })

  it('refuses a write for a read-only client and allows it with the scope; reads need neither', () => {
    const write = toolNamed('create_task')
    const read = toolNamed('search_project')
    expect(write && scopeRefusal(write, ['read'])).toMatch(/write scope/)
    expect(write && scopeRefusal(write, ['read', 'write'])).toBeNull()
    expect(read && scopeRefusal(read, ['read'])).toBeNull()
    // the control: the detector can fail the other way, so a client with NO scopes is also refused a write
    expect(write && scopeRefusal(write, [])).not.toBeNull()
  })

  it('advertises calendar tools only where the database serves them', () => {
    const names = (opt: string[]) => visibleTools(opt).map(([n]) => n)
    for (const c of ['list_events', 'create_event', 'update_event']) {
      expect(names([])).not.toContain(c)
      expect(names([c])).toContain(c)
    }
    expect(names([])).toContain('search_project')
    expect(names(['create_event'])).not.toContain('update_event')
  })

  it('does not treat a prototype property as a tool', () => {
    for (const bad of ['constructor', '__proto__', 'toString', 'hasOwnProperty', '']) {
      expect(toolNamed(bad), bad).toBeUndefined()
    }
    expect(toolNamed('ask_team')).toBeDefined()
  })
})

describe('what a model sends is bounded and shaped before it reaches the database', () => {
  it('clamps limits', () => {
    expect(clampInt(undefined, 10, 1, 50)).toBe(10)
    expect(clampInt(9999, 10, 1, 50)).toBe(50)
    expect(clampInt(-4, 10, 1, 50)).toBe(1)
    expect(clampInt('abc', 10, 1, 50)).toBe(10)
    expect(clampInt(7.9, 10, 1, 50)).toBe(7)
  })

  it('accepts a real date and refuses one that only rolls over (2026-02-31)', () => {
    expect(isoDate('2026-10-05')).toBe('2026-10-05')
    expect(isoDate('2026-02-31')).toBeNull()
    expect(isoDate('tomorrow')).toBeNull()
    expect(isoDate(20261005)).toBeNull()
  })

  it('normalises an instant, and a bad one is null rather than a thrown error', () => {
    expect(isoInstant('2026-10-05T10:00:00+01:00')).toBe('2026-10-05T09:00:00.000Z')
    expect(isoInstant('not a date')).toBeNull()
    expect(isoInstant('')).toBeNull()
  })

  it('create_task passes the client and a validated date, and null for a missing optional', () => {
    const spec = toolNamed('create_task')
    const args = spec?.args({ project: 'plot', title: 'Call', due_on: '2026-13-40' }, 'c1')
    expect(args).toMatchObject({ p_client_id: 'c1', p_project: 'plot', p_title: 'Call', p_detail: null, p_due_on: null })
  })

  it('search_project defaults to ten and caps at fifty', () => {
    const spec = toolNamed('search_project')
    expect(spec?.args({ query: 'x' }, 'c')).toMatchObject({ p_limit: 10, p_project: null, p_kinds: null })
    expect(spec?.args({ query: 'x', limit: 5000 }, 'c')).toMatchObject({ p_limit: 50 })
  })
})
