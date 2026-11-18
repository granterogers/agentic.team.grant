/**
 * The nightly prune (ADR-0077): the verify-once marker and the guards that stand in for a person at the keyboard. The
 * end-to-end proof, with the real handler writing, verifying, marking and pruning against the Storage emulator, is
 * `scripts/isolated/backup-restore-typed.ts`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_POLICY,
  type Plan,
  planRetention,
  type RunInfo,
} from '../../src/backup/retention.ts'
import {
  applyScheduledRetention,
  deletionOrder,
  isMarker,
  listRuns,
  NIGHTLY_MAX_DELETES,
  RetentionRefused,
} from '../../src/backup/runs.ts'
import { autoPruneOn } from '../../src/handlers/backup.ts'

const NOW = new Date('2026-11-18T16:00:00Z')
const uuid = (n: number): string =>
  `run-${n.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`
const daysAgo = (d: number): string => new Date(NOW.getTime() - d * 86_400_000).toISOString()
/** A run as the nightly prune sees it: verified only if it has a manifest AND a marker. */
const run = (n: number, d: number, extra: Partial<RunInfo> = {}): RunInfo => {
  const r = {
    name: uuid(n),
    at: daysAgo(d),
    bytes: 45_000_000,
    complete: true,
    marked: true,
    ...extra,
  }
  return { ...r, verified: r.complete && r.marked === true }
}

afterEach(() => vi.unstubAllGlobals())

/** A bucket where every named folder holds a manifest, a marker and one data object, unless told otherwise. */
const bucket = (
  folders: readonly string[],
  without: { manifest?: string[]; marker?: string[] } = {},
): { deletes: string[][] } => {
  const deletes: string[][] = []
  vi.stubGlobal('fetch', async (url: string, init?: { method?: string; body?: string }) => {
    if (String(url).includes('/object/list/')) {
      const { prefix } = JSON.parse(init?.body ?? '{}') as { prefix: string }
      if (!folders.includes(prefix)) return new Response('[]')
      const names = ['public.a.json.gz']
      if (!without.manifest?.includes(prefix)) names.push('manifest.json.gz')
      if (!without.marker?.includes(prefix)) names.push('verified.json')
      return new Response(JSON.stringify(names.map((name) => ({ name }))))
    }
    const paths = (JSON.parse(init?.body ?? '{}') as { prefixes: string[] }).prefixes
    deletes.push(paths)
    return new Response(JSON.stringify(paths.map((name) => ({ name }))))
  })
  return { deletes }
}

/** Ten nightly runs, one a day, all marked: under the policy the oldest falls out of the daily window. */
const tenNights = (): RunInfo[] => Array.from({ length: 10 }, (_, i) => run(i + 1, i + 1))

describe('the marker', () => {
  it('is recognised by name, and goes FIRST when a run is emptied, with the manifest', () => {
    expect(isMarker('run-x/verified.json')).toBe(true)
    expect(isMarker('run-x/verified.json.gz')).toBe(false)
    const order = deletionOrder([
      'run-x/a.json.gz',
      'run-x/verified.json',
      'run-x/manifest.json.gz',
    ])
    expect(order.slice(0, 2).sort()).toEqual(['run-x/manifest.json.gz', 'run-x/verified.json'])
    expect(order[2]).toBe('run-x/a.json.gz')
  })

  it("is listed as `marked`, and does NOT move the run's date (a backfill days later must not change its day)", async () => {
    vi.stubGlobal('fetch', async (_url: string, init?: { body?: string }) => {
      const { prefix } = JSON.parse(init?.body ?? '{}') as { prefix: string }
      if (prefix === '') return new Response(JSON.stringify([{ name: uuid(1), id: null }]))
      return new Response(
        JSON.stringify([
          { name: 'manifest.json.gz', created_at: '2026-11-01T15:00:00Z', metadata: { size: 1 } },
          { name: 'verified.json', created_at: '2026-11-18T14:00:00Z', metadata: { size: 1 } },
        ]),
      )
    })
    const [r] = await listRuns('ref', 'key')
    expect(r?.marked).toBe(true)
    expect(r?.at).toBe('2026-11-01T15:00:00Z')
    expect(r?.verified).toBe(false) // listing never verifies; the nightly prune derives it from the marker itself
  })
})

describe('the nightly prune: guards in place of a person at the keyboard', () => {
  const planOf = (runs: readonly RunInfo[]): Plan => planRetention(runs, NOW, DEFAULT_POLICY)

  it('is off unless the switch is on, and says so rather than throwing', async () => {
    const { deletes } = bucket([uuid(10)])
    const out = await applyScheduledRetention('ref', 'key', planOf(tenNights()), {
      switchOn: false,
      justWritten: uuid(0),
    })
    expect(out.refused).toMatch(/off/)
    expect(deletes).toEqual([])
  })

  it('with the switch on, deletes what the policy names: manifest and marker first (control for the refusals)', async () => {
    const plan = planOf(tenNights())
    expect(plan.remove.length).toBeGreaterThan(0)
    expect(plan.remove.length).toBeLessThanOrEqual(NIGHTLY_MAX_DELETES)
    const { deletes } = bucket(plan.remove.map((d) => d.name))
    const out = await applyScheduledRetention('ref', 'key', plan, {
      switchOn: true,
      justWritten: uuid(0),
    })
    expect(out.deleted).toEqual(plan.remove.map((d) => d.name))
    expect(deletes[0]?.every((p) => p.endsWith('manifest.json.gz') || isMarker(p))).toBe(true)
  })

  it('counts only MARKED runs as verified: an unmarked backup is never deleted and never counted', () => {
    const runs = [
      ...tenNights().slice(0, 7),
      run(98, 30, { marked: false }),
      run(99, 40, { marked: false }),
    ]
    const plan = planOf(runs)
    expect(plan.remove.map((d) => d.name)).not.toContain(uuid(98))
    expect(plan.unknown.map((d) => d.name)).toEqual(expect.arrayContaining([uuid(98), uuid(99)]))
  })

  it('refuses a plan longer than three WHOLE, and deletes nothing', async () => {
    const many = Array.from({ length: 30 }, (_, i) => run(i + 1, i + 1))
    const plan = planOf(many)
    expect(plan.remove.length).toBeGreaterThan(NIGHTLY_MAX_DELETES)
    const { deletes } = bucket(plan.remove.map((d) => d.name))
    await expect(
      applyScheduledRetention('ref', 'key', plan, { switchOn: true, justWritten: uuid(0) }),
    ).rejects.toThrow(RetentionRefused)
    expect(deletes).toEqual([])
  })

  it("never deletes the run tonight's job wrote, whatever the plan says", async () => {
    const plan = planOf(tenNights())
    const tonight = plan.remove[0]?.name as string
    const { deletes } = bucket([tonight])
    await expect(
      applyScheduledRetention('ref', 'key', plan, { switchOn: true, justWritten: tonight }),
    ).rejects.toThrow(/tonight/)
    expect(deletes).toEqual([])
  })

  it('refuses a plan naming something unverified, unfinished or foreign', async () => {
    const plan = planOf(tenNights())
    const { deletes } = bucket([])
    const unfinished: Plan = {
      ...plan,
      unknown: [{ name: uuid(50), bytes: 1, rule: 'incomplete', reason: 'x' }],
      remove: [{ name: uuid(50), bytes: 1, rule: 'outside-policy', reason: 'x' }],
    }
    await expect(
      applyScheduledRetention('ref', 'key', unfinished, { switchOn: true, justWritten: uuid(0) }),
    ).rejects.toThrow(/unverified or unfinished/)
    const foreign: Plan = {
      ...plan,
      remove: [{ name: 'grants-export.json.gz', bytes: 1, rule: 'outside-policy', reason: 'x' }],
    }
    await expect(
      applyScheduledRetention('ref', 'key', foreign, { switchOn: true, justWritten: uuid(0) }),
    ).rejects.toThrow(/not a run folder/)
    expect(deletes).toEqual([])
  })

  it('skips, never empties, a run that has lost its manifest or its marker since the plan was made', async () => {
    const plan = planOf(tenNights())
    const [a] = plan.remove.map((d) => d.name)
    const { deletes } = bucket([a as string], { marker: [a as string] })
    const out = await applyScheduledRetention('ref', 'key', plan, {
      switchOn: true,
      justWritten: uuid(0),
    })
    expect(out.skipped).toContain(a)
    expect(deletes.flat().some((p) => p.startsWith(`${a as string}/`))).toBe(false)
  })

  it('a refused plan (nothing verified) deletes nothing even with the switch on', async () => {
    const plan = planOf(tenNights().map((r) => ({ ...r, marked: false, verified: false })))
    expect(plan.refused).not.toBeNull()
    const { deletes } = bucket([])
    const out = await applyScheduledRetention('ref', 'key', plan, {
      switchOn: true,
      justWritten: uuid(0),
    })
    expect(out.deleted).toEqual([])
    expect(deletes).toEqual([])
  })
})

describe("the owner's switch", () => {
  const db = (rows: Record<string, unknown>[]) => ({
    execute: async (sql: string) => {
      expect(sql).toContain("key = 'backup.auto_prune'")
      expect(sql).toContain('not self_adjustable')
      return { rows }
    },
  })

  it('is on only when the database says so; absent reads as off', async () => {
    expect(await autoPruneOn(db([{ on: true }]) as never)).toBe(true)
    expect(await autoPruneOn(db([{ on: false }]) as never)).toBe(false)
    expect(await autoPruneOn(db([]) as never)).toBe(false)
  })
})
