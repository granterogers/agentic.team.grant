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
  clampInt,
  isoDate,
  isoInstant,
  rpcArgs,
  scopeRefusal,
  TOOLS,
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
        'add_to_project',
        'ask_notebook',
        'ask_team',
        'create_event',
        'create_task',
        'generate_artifact',
        'notebook_generate',
        'push_to_notebook',
        'start_research',
        'update_event',
        'update_task',
      ].sort(),
    )
    for (const n of [
      'search_project',
      'list_tasks',
      'list_events',
      'inspect_activity',
      'check_job',
      'list_projects',
    ]) {
      expect(TOOLS[n]?.write, n).not.toBe(true)
    }
  })

  it('has no way to delete, and none takes an office or a secret from the model', () => {
    for (const [name, spec] of Object.entries(TOOLS)) {
      expect(name).not.toMatch(/delete|remove|cancel|revoke|destroy/)
      const props = Object.keys((spec.schema as { properties?: object }).properties ?? {})
      for (const p of props)
        expect(p, `${name}.${p}`).not.toMatch(/office|token|secret|password|key|client/i)
    }
  })

  it('maps arguments by named field only: a model-supplied office never reaches the RPC', () => {
    for (const [name, spec] of Object.entries(TOOLS)) {
      const hostile = {
        p_office: OTHER,
        office: OTHER,
        office_id: OTHER,
        p_client_id: 'attacker',
        project: 'p',
        query: 'q',
        title: 't',
        task_id: OTHER,
        event_id: OTHER,
        question: 'q',
        topic: 't',
        brief: 'b',
        content: 'c',
        document_id: OTHER,
        starts_at: '2026-10-05T10:00:00Z',
        job_id: OTHER,
        kind: 'audio',
      }
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

  it('calendar tools pass the real calendar its arguments, by name, and never an office or authority', () => {
    const create = toolNamed('create_event')
    const args = create?.args(
      {
        project: 'plot',
        title: 'Site visit',
        starts_at: '2026-10-05T10:00:00+01:00',
        ends_at: 'garbage',
        all_day: true,
        location: 'Plot 4',
        p_authority: 'person',
        p_channel: 'teamhq',
      },
      'c1',
    )
    expect(args).toEqual({
      p_client_id: 'c1',
      p_project: 'plot',
      p_title: 'Site visit',
      p_starts_at: '2026-10-05T09:00:00.000Z',
      p_ends_at: null,
      p_all_day: true,
      p_location: 'Plot 4',
      p_notes: null,
    })
    // the channel and the authority are decided by the database from the client, never offered to the model
    for (const n of ['create_event', 'update_event', 'list_events']) {
      const props = Object.keys(((toolNamed(n)?.schema ?? {}) as { properties: object }).properties)
      expect(props, n).not.toContain('channel')
      expect(props, n).not.toContain('authority')
      const out = toolNamed(n)?.args(
        { p_authority: 'person', authority: 'person', channel: 'teamhq' },
        'c',
      )
      expect(Object.keys(out ?? {}), n).not.toContain('p_authority')
      expect(Object.keys(out ?? {}), n).not.toContain('p_channel')
    }
  })

  it('update_event is a patch: an omitted field is null, all_day only when a real boolean', () => {
    const upd = toolNamed('update_event')
    const id = '33333333-3333-3333-3333-333333333333'
    expect(upd?.args({ event_id: id, title: 'New' }, 'c1')).toEqual({
      p_client_id: 'c1',
      p_event_id: id,
      p_title: 'New',
      p_starts_at: null,
      p_ends_at: null,
      p_all_day: null,
      p_location: null,
      p_notes: null,
    })
    expect(upd?.args({ event_id: id, all_day: 'yes' }, 'c1')).toMatchObject({ p_all_day: null })
    expect(upd?.args({ event_id: id, all_day: false }, 'c1')).toMatchObject({ p_all_day: false })
    // the control: the schema requires the id, and says it is a uuid from list_events
    expect(((upd?.schema ?? {}) as { required?: string[] }).required).toEqual(['event_id'])
  })

  it('list_events and the calendar writes are one-to-one with the functions 0924 defines', () => {
    expect(toolNamed('list_events')?.fn).toBe('mcp_event_list')
    expect(toolNamed('create_event')?.fn).toBe('mcp_event_create')
    expect(toolNamed('update_event')?.fn).toBe('mcp_event_update')
    // no calendar tool deletes: the calendar hard-deletes what never reached Google
    expect(
      Object.keys(TOOLS)
        .filter((n) => /event/.test(n))
        .sort(),
    ).toEqual(['create_event', 'list_events', 'update_event'])
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
    expect(args).toMatchObject({
      p_client_id: 'c1',
      p_project: 'plot',
      p_title: 'Call',
      p_detail: null,
      p_due_on: null,
    })
  })

  it('search_project defaults to ten and caps at fifty', () => {
    const spec = toolNamed('search_project')
    expect(spec?.args({ query: 'x' }, 'c')).toMatchObject({
      p_limit: 10,
      p_project: null,
      p_kinds: null,
    })
    expect(spec?.args({ query: 'x', limit: 5000 }, 'c')).toMatchObject({ p_limit: 50 })
  })
})

describe('a date that was sent and cannot be read is refused, not dropped', () => {
  it('names the field', async () => {
    const { badValue } = await import('../../supabase/functions/mcp/tools.ts')
    expect(badValue({ starts_at: 'next tuesday' })).toMatch(/^starts_at is not a date/)
    expect(badValue({ due_on: '2026-02-31' })).toMatch(/^due_on/)
    expect(badValue({ ends_at: '2026-10-05T10:00:00Z', due_on: '2026-10-05' })).toBeNull()
    // control: nothing sent, nothing to refuse
    expect(badValue({})).toBeNull()
    expect(badValue({ starts_at: null, due_on: '' })).toBeNull()
  })
})

describe('the edge consults the check before it calls the database', () => {
  it('badValue(callInput) is called and its answer returned before spec.fn is invoked', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync('supabase/functions/mcp/index.ts', 'utf8')
    // callInput is the arguments as they will be sent (the run's project already forced in for an engine client), so the
    // check reads exactly what the database would receive.
    const at = src.indexOf('const unreadable = badValue(callInput)')
    expect(at).toBeGreaterThan(0)
    expect(src.slice(at, at + 160)).toMatch(/if \(unreadable !== null\) return rpcError\(/)
    expect(at).toBeLessThan(src.indexOf('await rpc(spec.fn, rpcArgs('))
  })
})
