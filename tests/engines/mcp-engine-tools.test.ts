import { describe, expect, it } from 'vitest'
import {
  bindProject,
  canonicalJson,
  ENGINE_READ_TOOLS,
  engineDomain,
  engineVisibleTools,
  TOOLS,
  takesProject,
  toolNamed,
  visibleTools,
} from '../../supabase/functions/mcp/tools.ts'

describe('the engine list, against the catalogue', () => {
  it('names only tools that exist, and not one of them can write', () => {
    for (const name of ENGINE_READ_TOOLS) {
      const spec = toolNamed(name)
      expect(spec, `${name} is not a tool`).toBeDefined()
      expect(spec?.write, `${name} can write`).not.toBe(true)
    }
  })
  it('is shown to an engine client as a narrowing of what an ordinary client sees, and never adds a tool', () => {
    const everything = visibleTools(['list_events', 'create_event', 'update_event']).map(([n]) => n)
    const engine = engineVisibleTools(['list_events', 'create_event', 'update_event']).map(
      ([n]) => n,
    )
    expect(engine.length).toBeGreaterThanOrEqual(9)
    for (const n of engine) {
      expect(everything).toContain(n)
      expect(ENGINE_READ_TOOLS).toContain(n)
    }
    for (const writer of Object.entries(TOOLS)
      .filter(([, s]) => s.write === true)
      .map(([n]) => n))
      expect(engine, writer).not.toContain(writer)
  })
  it('offers the calendar read only where the database serves the calendar (an optional tool stays optional)', () => {
    expect(engineVisibleTools([]).map(([n]) => n)).not.toContain('list_events')
    expect(engineVisibleTools(['list_events']).map(([n]) => n)).toContain('list_events')
  })
})

describe("takesProject is derived from each tool's own schema", () => {
  it('is true for exactly the tools that declare a project argument', () => {
    const taking = Object.entries(TOOLS)
      .filter(([, s]) => takesProject(s))
      .map(([n]) => n)
    for (const n of [
      'search_documents',
      'search_project',
      'list_tasks',
      'list_events',
      'inspect_activity',
    ])
      expect(taking, n).toContain(n)
    for (const n of ['list_projects', 'read_document', 'list_staff', 'recent_work', 'check_job'])
      expect(taking, n).not.toContain(n)
  })
})

describe("bindProject forces the run's project in", () => {
  const tasks = TOOLS.list_tasks as NonNullable<(typeof TOOLS)[string]>
  const projects = TOOLS.list_projects as NonNullable<(typeof TOOLS)[string]>
  it('SETS an omitted project (an omitted one reads every project), and overwrites a named one', () => {
    expect(bindProject(tasks, {}, 'one')).toEqual({ project: 'one' })
    expect(bindProject(tasks, { project: 'two', state: 'open' }, 'one')).toEqual({
      project: 'one',
      state: 'open',
    })
    expect(bindProject(tasks, { project: null }, 'one')).toEqual({ project: 'one' })
  })
  it('leaves a tool that takes no project alone, and a run with no project changes nothing', () => {
    expect(bindProject(projects, { project: 'two' }, 'one')).toEqual({ project: 'two' })
    expect(bindProject(tasks, { project: 'two' }, null)).toEqual({ project: 'two' })
  })
  it('does not mutate what the model sent', () => {
    const sent = { project: 'two' }
    bindProject(tasks, sent, 'one')
    expect(sent).toEqual({ project: 'two' })
  })
})

describe('engineDomain: what a served read was about, and whether it was a whole list', () => {
  it('documents are never complete (a search is not a census)', () => {
    for (const t of ['search_documents', 'read_document', 'search_project'])
      expect(engineDomain(t, {}, 3)).toEqual({ domain: 'documents', complete: false })
  })
  it('the projects list is complete; the calendar is not', () => {
    expect(engineDomain('list_projects', {}, 4)).toEqual({ domain: 'projects', complete: true })
    expect(engineDomain('list_events', {}, 2)).toEqual({ domain: 'calendar', complete: false })
  })
  it('a task list is complete only when unfiltered and the page was not full', () => {
    expect(engineDomain('list_tasks', {}, 3)).toEqual({ domain: 'tasks', complete: true })
    expect(engineDomain('list_tasks', {}, 25)).toEqual({ domain: 'tasks', complete: false })
    expect(engineDomain('list_tasks', { limit: 100 }, 25)).toEqual({
      domain: 'tasks',
      complete: true,
    })
    expect(engineDomain('list_tasks', { state: 'open' }, 1)).toEqual({
      domain: 'tasks',
      complete: false,
    })
    expect(engineDomain('list_tasks', { state: '' }, 1)).toEqual({
      domain: 'tasks',
      complete: true,
    })
  })
  it('everything else is no domain', () => {
    for (const t of [
      'list_staff',
      'recent_work',
      'check_job',
      'inspect_activity',
      'create_task',
      'nonsense',
    ])
      expect(engineDomain(t, {}, 1)).toEqual({ domain: null, complete: false })
  })
})

describe('canonicalJson', () => {
  it('is independent of key order, at every depth', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(
      canonicalJson({ a: { c: 3, d: 2 }, b: 1 }),
    )
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}')
  })
  it('keeps array order, and distinguishes different values', () => {
    expect(canonicalJson([2, 1])).not.toBe(canonicalJson([1, 2]))
    expect(canonicalJson({ a: 1 })).not.toBe(canonicalJson({ a: '1' }))
    expect(canonicalJson({ a: null })).toBe('{"a":null}')
    expect(canonicalJson(undefined)).toBe('null')
  })
})
