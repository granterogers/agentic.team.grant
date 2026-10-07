import { describe, expect, it } from 'vitest'
import {
  BENIGN_META_KEYS,
  CHECK_NAMES,
  collectReferencedIds,
  FreezeRefused,
  INVENTORY_LISTS_NOT_REFERENCES,
  planStages,
  verifyProposal,
} from '../../scripts/deploy/lib/retention-freeze.ts'
import { canonicalText, sha256 } from '../../scripts/deploy/lib/retention-hash.ts'
import { DAY, freezeOf, NOW, world } from './lib/fake-vercel.ts'

/*
  The frozen proposal is the only authority the deletion tool accepts, so what it contains has to be right in BOTH directions:
  nothing protected may be a candidate, and a candidate has to have passed every check. Every protection below is shown by a
  control (the same deployment IS a candidate without it) and then by switching exactly one thing on.
*/
const ELIGIBLE = 'dpl_OLD20000000000'

const candidates = async (
  over: Parameters<typeof freezeOf>[1] = {},
  mutate?: (f: ReturnType<typeof world>) => void,
) => {
  const f = world()
  mutate?.(f)
  const r = await freezeOf(f, over)
  return { f, ...r, ids: new Set(r.proposal.candidates.map((c) => c.id)) }
}

describe('what is protected, one switch at a time', () => {
  it('control: an ordinary old superseded production build IS a candidate, and carries every check', async () => {
    const { ids, proposal } = await candidates()
    expect(ids.has(ELIGIBLE)).toBe(true)
    const c = proposal.candidates.find((x) => x.id === ELIGIBLE)
    expect(c?.checks).toEqual([...CHECK_NAMES])
    expect(c?.eligibleBecause).toMatch(/passed all 14 safety checks/)
  })

  it('current production, the rollback deployment, the validation preview and the aliased deployment are kept, with reasons', async () => {
    const { keep } = await candidates({}, (f) => {
      f.add({ uid: 'dpl_ALIASEDOLDBUILD001', created: NOW - 25 * DAY })
      f.aliases.push({ alias: 'custom.example.test', deploymentId: 'dpl_ALIASEDOLDBUILD001' })
    })
    const why = (id: string): string =>
      (keep.keeps.find((k) => k.id === id)?.reasons ?? []).join(' | ')
    expect(why('dpl_PRODCURRENT000001')).toMatch(/current production/)
    expect(why('dpl_ROLLBACKPREV000001')).toMatch(/rollback/)
    expect(why('dpl_VALIDATIONPREV0001')).toMatch(/validation preview/)
    expect(why('dpl_ALIASEDOLDBUILD001')).toMatch(/alias/)
  })

  it.each([
    ['a tracked file names it', { referencedIds: [ELIGIBLE] }, /tracked repository file/],
    ['a reviewer named it', { extraKeep: [ELIGIBLE] }, /kept by name on review/],
  ])('%s', async (_n, over, reason) => {
    const { ids, keep } = await candidates(over)
    expect(ids.has(ELIGIBLE)).toBe(false)
    expect((keep.keeps.find((k) => k.id === ELIGIBLE)?.reasons ?? []).join(' ')).toMatch(reason)
  })

  it('its size could not be read: kept, never judged', async () => {
    const { ids, keep } = await candidates({ sizeFails: new Set([ELIGIBLE]) })
    expect(ids.has(ELIGIBLE)).toBe(false)
    expect((keep.keeps.find((k) => k.id === ELIGIBLE)?.reasons ?? []).join(' ')).toMatch(
      /size could not be read/,
    )
  })

  it.each(['ERROR', 'BUILDING', 'QUEUED', 'CANCELED', 'SOMETHING_NEW'])(
    'state %s is kept as possible incident evidence',
    async (state) => {
      const { ids } = await candidates({}, (f) => {
        const d = f.deployments.get(ELIGIBLE)
        if (d !== undefined) d.state = state
      })
      expect(ids.has(ELIGIBLE)).toBe(false)
    },
  )

  it('metadata somebody recorded (an unfamiliar key) keeps it: unknown is KEEP', async () => {
    for (const key of [
      'commit',
      'candidate',
      'experiment',
      'audit',
      'release',
      'incident',
      'something-new',
    ]) {
      const { ids, keep } = await candidates({}, (f) => {
        const d = f.deployments.get(ELIGIBLE)
        if (d !== undefined) d.meta = { ...d.meta, [key]: 'x' }
      })
      expect(ids.has(ELIGIBLE), key).toBe(false)
      expect((keep.keeps.find((k) => k.id === ELIGIBLE)?.reasons ?? []).join(' ')).toMatch(
        /metadata/,
      )
    }
    expect([...BENIGN_META_KEYS]).toEqual(['lambdaRuntimeStats'])
  })

  it('a preview is never a candidate, however old', async () => {
    const { ids } = await candidates({}, (f) => {
      const d = f.deployments.get(ELIGIBLE)
      if (d !== undefined) d.target = null
    })
    expect(ids.has(ELIGIBLE)).toBe(false)
  })

  it('anything created in the last 7 days is kept', async () => {
    const { ids, proposal } = await candidates({}, (f) => {
      f.add({ uid: 'dpl_SIXDAYSOLD0000001', created: NOW - 6 * DAY - 2 * 3_600_000 })
    })
    expect(ids.has('dpl_SIXDAYSOLD0000001')).toBe(false)
    expect(proposal.candidates.every((c) => c.created < NOW - 7 * DAY)).toBe(true)
  })

  it('the newest 15 ready production deployments and the last build of every UTC day are kept', async () => {
    const { proposal, keep } = await candidates()
    const readyProd = [...keep.keeps, ...proposal.candidates]
      .filter((x) => x.target === 'production' && x.state === 'READY')
      .sort((a, b) => b.created - a.created)
    const kept = new Set(keep.keeps.map((k) => k.id))
    for (const x of readyProd.slice(0, 15)) expect(kept.has(x.id)).toBe(true)
    const lastOfDay = new Map<string, string>()
    for (const x of readyProd) {
      const day = x.createdUtc.slice(0, 10)
      if (!lastOfDay.has(day)) lastOfDay.set(day, x.id)
    }
    expect(lastOfDay.size).toBeGreaterThan(20)
    for (const id of lastOfDay.values()) expect(kept.has(id)).toBe(true)
  })

  it('keep and candidates partition the inventory and the totals add up', async () => {
    const { proposal, keep } = await candidates()
    const all = new Set([...proposal.candidates.map((c) => c.id), ...keep.keeps.map((k) => k.id)])
    expect(all.size).toBe(proposal.inventory.length)
    expect(proposal.candidates.length + keep.keeps.length).toBe(proposal.inventory.length)
    expect(proposal.totals.keep.bytes + proposal.totals.delete.bytes).toBe(
      proposal.totals.inventory.bytes,
    )
    expect(keep.totals).toEqual(proposal.totals)
  })

  it('refuses a freeze whose premises are false (production not READY, rollback is production, validation is not a preview)', async () => {
    const f = world()
    const bad = f.deployments.get('dpl_PRODCURRENT000001')
    if (bad !== undefined) bad.state = 'BUILDING'
    await expect(freezeOf(f)).rejects.toThrow(FreezeRefused)
    await expect(freezeOf(world(), { rollbackId: 'dpl_PRODCURRENT000001' })).rejects.toThrow(
      /rollback deployment is the current/,
    )
    await expect(freezeOf(world(), { validationIds: ['dpl_RECENT10000000000'] })).rejects.toThrow(
      /not a READY preview/,
    )
  })
})

describe('the proposal can be trusted or it is refused', () => {
  const frozen = async () => {
    const r = await candidates()
    return { ...r, sha: sha256(r.proposalText) }
  }

  it('control: the untouched proposal verifies', async () => {
    const r = await frozen()
    expect(
      verifyProposal(r.proposalText, r.keepText, r.sha).proposal.candidates.length,
    ).toBeGreaterThan(30)
  })

  it('is byte-for-byte reproducible and does not depend on key order', async () => {
    const a = await frozen()
    const b = await frozen()
    expect(a.sha).toBe(b.sha)
    expect(canonicalText({ b: 1, a: { d: 1, c: 2 } })).toBe(
      canonicalText({ a: { c: 2, d: 1 }, b: 1 }),
    )
  })

  it('refuses text that does not hash to the approved value', async () => {
    const r = await frozen()
    expect(() => verifyProposal(`${r.proposalText} `, r.keepText, r.sha)).toThrow(/does not hash/)
  })

  it('refuses a candidate added by hand even when the edited file is re-hashed (the rules re-derive the set)', async () => {
    const r = await frozen()
    const p = JSON.parse(r.proposalText)
    const keepEntry = JSON.parse(r.keepText).keeps.find(
      (k: { id: string }) => k.id === 'dpl_ROLLBACKPREV000001',
    )
    p.candidates.push({
      id: keepEntry.id,
      created: keepEntry.created,
      createdUtc: keepEntry.createdUtc,
      state: 'READY',
      target: 'production',
      bytes: keepEntry.bytes,
      bundles: keepEntry.bundles,
      eligibleBecause: 'forged',
      checks: [...CHECK_NAMES],
    })
    const text = canonicalText(p)
    expect(() => verifyProposal(text, r.keepText, sha256(text))).toThrow(FreezeRefused)
  })

  it('refuses a candidate removed by hand, a changed keep file, a changed inventory digest and a changed schema', async () => {
    const r = await frozen()
    const dropped = JSON.parse(r.proposalText)
    dropped.candidates.pop()
    const droppedText = canonicalText(dropped)
    expect(() => verifyProposal(droppedText, r.keepText, sha256(droppedText))).toThrow()
    expect(() => verifyProposal(r.proposalText, `${r.keepText} `, r.sha)).toThrow(/keep file/)
    const digest = JSON.parse(r.proposalText)
    digest.inventoryDigest = '0'.repeat(64)
    const digestText = canonicalText(digest)
    expect(() => verifyProposal(digestText, r.keepText, sha256(digestText))).toThrow(/digest/)
    const schema = JSON.parse(r.proposalText)
    schema.schema = 'vercel-retention/0'
    const schemaText = canonicalText(schema)
    expect(() => verifyProposal(schemaText, r.keepText, sha256(schemaText))).toThrow(/schema/)
  })
})

describe('what counts as a reference in a tracked file', () => {
  const grep = [
    'docs/HANDOFF.md:dpl_REFERENCEDINDOCS0001',
    'docs/performance/vercel-storage-audit-2026-10-05.md:dpl_NAMEDINPERFDOCUMENT0001',
    'tests/deploy/x.test.ts:dpl_NAMEDINATESTFILE000001',
    `${INVENTORY_LISTS_NOT_REFERENCES[0]}:dpl_ONLYINTHEINVENTORY01`,
    `${INVENTORY_LISTS_NOT_REFERENCES[0]}:dpl_REFERENCEDINDOCS0001`,
    'docs/note.md:dpl_short',
  ].join('\n')

  it('counts docs/performance, code and tests, and excludes only the one file that is itself an inventory', () => {
    const { ids } = collectReferencedIds(grep)
    expect(ids).toEqual([
      'dpl_NAMEDINATESTFILE000001',
      'dpl_NAMEDINPERFDOCUMENT0001',
      'dpl_REFERENCEDINDOCS0001',
    ])
    expect(ids).not.toContain('dpl_ONLYINTHEINVENTORY01')
    expect(INVENTORY_LISTS_NOT_REFERENCES).toHaveLength(1)
  })

  it('control: without the exclusion the inventory list would protect its ids', () => {
    expect(collectReferencedIds(grep, []).ids).toContain('dpl_ONLYINTHEINVENTORY01')
  })
})

describe('stage 1 and the later batches', () => {
  it('picks the 5 oldest ordinary candidates, never a zero-byte or odd-sized one, and names the neighbouring protected builds', async () => {
    const { proposal, keep } = await candidates({}, (f) => {
      // the oldest eligible build is a static-only (zero-byte) one, and the next is far outside the ordinary size
      f.add({ uid: 'dpl_OLDESTSTATICONLY001', created: NOW - 40 * DAY, bytes: 0 })
      f.add({ uid: 'dpl_OLDHUGEBUILD000001', created: NOW - 39 * DAY, bytes: 90_000_000 })
    })
    const s = planStages(proposal, keep)
    expect(s.stage1).toHaveLength(5)
    const ids = s.stage1.map((p) => p.id)
    expect(ids).not.toContain('dpl_OLDESTSTATICONLY001')
    expect(ids).not.toContain('dpl_OLDHUGEBUILD000001')
    for (const p of s.stage1) {
      expect(p.bytes).toBeGreaterThan(0)
      expect(p.beforeProtected === null && p.afterProtected === null).toBe(false)
    }
    const created = s.stage1.map((p) => Date.parse(p.createdUtc))
    expect(created).toEqual([...created].sort((a, b) => a - b))
  })

  it('splits the rest into 10, then 20, then 25s, and loses and repeats nothing', async () => {
    const { proposal, keep } = await candidates()
    const s = planStages(proposal, keep)
    expect(s.later[0]).toHaveLength(10)
    expect(s.later[1]).toHaveLength(20)
    for (const b of s.later.slice(2, -1)) expect(b).toHaveLength(25)
    const all = [...s.stage1.map((p) => p.id), ...s.later.flat()]
    expect(new Set(all).size).toBe(all.length)
    expect(all.sort()).toEqual(proposal.candidates.map((c) => c.id).sort())
  })
})
