/**
 * The activity taxonomy (migration 1060) says what the read model (1061) and the writers can produce, in both directions.
 *
 * A taxonomy row that nothing produces is a claim with nothing behind it (CLAUDE.md, the registry-row defect), and an event type
 * the read model produces that the taxonomy does not know would be shown with a made-up category and visibility. Both are read from the
 * migrations themselves, so adding a type to one side and not the other fails here.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = (prefix: string): string => {
  const f = readdirSync('migrations').find((n) => n.startsWith(prefix))
  if (f === undefined) throw new Error(`no migration ${prefix}`)
  return readFileSync(`migrations/${f}`, 'utf8')
}
const m1060 = migration('1060_')
const m1061 = migration('1061_')

type Row = {
  type: string
  category: string
  source: string
  visibility: string
  severity: string
  external: boolean
}
const taxonomy: Row[] = (() => {
  const block = m1060.slice(
    m1060.indexOf('insert into public.activity_event_types'),
    m1060.indexOf(
      'on conflict (event_type) do nothing;',
      m1060.indexOf('insert into public.activity_event_types'),
    ),
  )
  return [
    ...block.matchAll(
      /\('([a-z0-9_.]+)',\s*'([a-z]+)',\s*'(projected|native)',\s*'([a-z]+)',\s*'([a-z]+)',\s*(true|false),/g,
    ),
  ].map((m) => ({
    type: m[1] as string,
    category: m[2] as string,
    source: m[3] as string,
    visibility: m[4] as string,
    severity: m[5] as string,
    external: m[6] === 'true',
  }))
})()
const byType = new Map(taxonomy.map((r) => [r.type, r]))

describe('the taxonomy as written', () => {
  it('parses, with no duplicate and nothing malformed (a control: the parse found the rows)', () => {
    expect(taxonomy.length).toBeGreaterThan(40)
    expect(new Set(taxonomy.map((r) => r.type)).size).toBe(taxonomy.length)
    const rowsInSql = (
      m1060.match(/^\s+\('[a-z0-9_.]+',\s*'[a-z]+',\s*'(?:projected|native)'/gm) ?? []
    ).length
    expect(taxonomy.length).toBe(rowsInSql)
  })

  it('every type matches the pattern public.events enforces, so the two ledgers share one vocabulary shape', () => {
    for (const r of taxonomy)
      expect(r.type).toMatch(/^[a-z0-9]+(_[a-z0-9]+)*(\.[a-z0-9]+(_[a-z0-9]+)*)+$/)
  })

  it('only a native type may be external, and an external type is never operator-only (it has to reach the person who reviews it)', () => {
    for (const r of taxonomy.filter((x) => x.external)) {
      expect(r.source).toBe('native')
      expect(r.type.startsWith('external.')).toBe(true)
      expect(r.visibility).not.toBe('operator')
    }
    expect(taxonomy.filter((x) => x.type.startsWith('external.')).every((x) => x.external)).toBe(
      true,
    )
  })

  it('no external type is critical by default (the door refuses critical severity from outside)', () => {
    for (const r of taxonomy.filter((x) => x.external)) expect(r.severity).not.toBe('critical')
  })
})

describe('both directions', () => {
  // Every type literal the read model emits: the second argument of a case arm or a literal 'xxx.yyy' in type position.
  const emitted = new Set(
    [
      ...m1061.matchAll(
        /'((?:request|job|retry|action|approval|output|delivery|inference)\.[a-z_]+)'/g,
      ),
    ].map((m) => m[1] as string),
  )

  it('every type the read model can emit is in the taxonomy', () => {
    const unknown = [...emitted].filter((t) => !byType.has(t))
    expect(unknown).toEqual([])
  })

  it('every projected type is produced by the read model (a taxonomy row nothing produces is a claim)', () => {
    const projected = taxonomy.filter((r) => r.source === 'projected').map((r) => r.type)
    const silent = projected.filter((t) => !emitted.has(t))
    expect(silent).toEqual([])
  })

  it('the native types that nothing in this repository writes yet are exactly the ones named here, so adding a writer or a row is a decision', () => {
    const native = taxonomy.filter((r) => r.source === 'native' && !r.external).map((r) => r.type)
    const written = native.filter((t) =>
      readFileSync('src/activity/record.ts', 'utf8').includes(`'${t}'`),
    )
    const unwritten = native.filter((t) => !written.includes(t)).sort()
    // Taxonomy rows ahead of their writers. They are proposals in docs/activity-ledger/PROGRESS.md; when a writer lands, move the type out of this list.
    expect(unwritten).toEqual(
      [
        'activity.corrected',
        'budget.threshold_reached',
        'integration.rate_limited',
        'tool.call_completed',
        'tool.call_failed',
        'tool.call_requested',
      ].sort(),
    )
    expect(written).toEqual(['system.recovered'])
  })

  it('the taxonomy and the read model agree on which types an ordinary person sees', () => {
    // The transitions branch pre-filters for the ordinary view; it must name exactly the user-visible job types.
    const userJob = taxonomy
      .filter((r) => r.category === 'job' && r.source === 'projected' && r.visibility === 'user')
      .map((r) => r.type)
      .sort()
    expect(userJob).toEqual(['job.cancelled', 'job.completed', 'job.delegated', 'job.failed'])
    const pre = m1061.match(
      /\(\$10 >= 1 or t0\.to_state in \(([^)]*)\) or \(t0\.from_state is null and j0\.parent_job_id is not null\)\)/,
    )
    expect(pre, 'the stage-0 transitions pre-filter').not.toBeNull()
    expect(
      (pre?.[1] ?? '')
        .split(',')
        .map((s) => s.trim().replace(/'/g, ''))
        .sort(),
    ).toEqual(['cancelled', 'complete', 'failed'])
  })
})

describe('the writers cannot write a type the taxonomy forbids', () => {
  it('record_activity refuses a type that is not native', () => {
    expect(m1060).toMatch(
      /if not found or v_type\.source <> 'native' then\s+raise exception 'activity type % is not a native type'/,
    )
  })
  it('the external door selects only external_writable types', () => {
    expect(m1060).toMatch(/where event_type = p_event_type and external_writable;/)
  })
})
