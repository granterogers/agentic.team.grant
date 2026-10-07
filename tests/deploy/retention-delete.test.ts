import { describe, expect, it } from 'vitest'
import {
  type DeleteOptions,
  type DeleteResult,
  type LogEntry,
  MAX_PER_RUN,
  Refused,
  runDeletion,
} from '../../scripts/deploy/lib/retention-delete.ts'
import { CHECK_NAMES } from '../../scripts/deploy/lib/retention-freeze.ts'
import { canonicalText, sha256 } from '../../scripts/deploy/lib/retention-hash.ts'
import { DAY, type FakeVercel, freezeOf, NOW, world } from './lib/fake-vercel.ts'

/*
  The deletion procedure, run against a fake Vercel. Every refusal is asserted by its CODE (a refusal for the wrong reason looks
  exactly like the rule working) and by the fake's call count (nothing was sent), and every protection is a named PROTECTION in
  the source so that a sabotage of exactly that line must turn a test here red.
*/

interface Setup {
  f: FakeVercel
  proposalText: string
  keepText: string
  sha: string
  /** Candidate ids, oldest first, as the proposal lists them. */
  ids: string[]
  log: LogEntry[]
}

const setup = async (mutateBeforeFreeze?: (f: FakeVercel) => void): Promise<Setup> => {
  const f = world()
  // a non-production deployment behind a live alias: it must be unreachable by the aliased check, not merely by the keep set
  f.add({ uid: 'dpl_ALIASEDOLDBUILD001', created: NOW - 25 * DAY })
  f.aliases.push({ alias: 'custom.example.test', deploymentId: 'dpl_ALIASEDOLDBUILD001' })
  mutateBeforeFreeze?.(f)
  const r = await freezeOf(f)
  const ids = r.proposal.candidates.map((c) => c.id)
  return {
    f,
    proposalText: r.proposalText,
    keepText: r.keepText,
    sha: sha256(r.proposalText),
    ids,
    log: [],
  }
}

const run = (
  s: Setup,
  over: Partial<DeleteOptions> & { ids: readonly string[] },
): Promise<DeleteResult> =>
  runDeletion({
    client: s.f,
    proposalText: s.proposalText,
    keepText: s.keepText,
    expectedSha256: s.sha,
    go: true,
    now: NOW + 60_000,
    log: (e) => {
      s.log.push(e)
      s.f.events.push(`LOG ${e.phase} ${e.id}`)
    },
    referencedNow: () => 0,
    runId: 'test-run',
    ...over,
  })

const refused = async (p: Promise<unknown>, code: string): Promise<void> => {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  )
  expect(e).toBeInstanceOf(Refused)
  expect((e as Refused).code).toBe(code)
}

describe('refused before anything is deleted', () => {
  it('control: the same setup deletes a candidate (so the refusals below are the rule, not a broken setup)', async () => {
    const s = await setup()
    const r = await run(s, { ids: [s.ids[0] as string] })
    expect(r.deleted).toEqual([s.ids[0]])
  })

  it('the current production deployment', async () => {
    const s = await setup()
    await refused(run(s, { ids: ['dpl_PRODCURRENT000001'] }), 'current-production')
    expect(s.f.count('DELETE')).toBe(0)
  })

  it('a deployment behind a live alias that is not production', async () => {
    const s = await setup()
    await refused(run(s, { ids: ['dpl_ALIASEDOLDBUILD001'] }), 'aliased')
    expect(s.f.count('DELETE')).toBe(0)
  })

  it('the rollback deployment', async () => {
    const s = await setup()
    await refused(run(s, { ids: ['dpl_ROLLBACKPREV000001'] }), 'rollback-target')
    expect(s.f.count('DELETE')).toBe(0)
  })

  it('the validation preview and anything else in the keep set', async () => {
    const s = await setup()
    await refused(run(s, { ids: ['dpl_VALIDATIONPREV0001'] }), 'protected')
    await refused(run(s, { ids: ['dpl_RECENT10000000000'] }), 'protected')
    expect(s.f.count('DELETE')).toBe(0)
  })

  it('an id that is not in the proposal', async () => {
    const s = await setup()
    await refused(run(s, { ids: ['dpl_NOTINTHEPROPOSAL01'] }), 'not-in-proposal')
    expect(s.f.count('DELETE')).toBe(0)
  })

  it('a proposal that was modified after it was approved', async () => {
    const s = await setup()
    await refused(
      run(s, { ids: [s.ids[0] as string], proposalText: `${s.proposalText} ` }),
      'hash-mismatch',
    )
    expect(s.f.count('DELETE')).toBe(0)
  })

  it('a keep file that is not the one the proposal names', async () => {
    const s = await setup()
    await refused(
      run(s, { ids: [s.ids[0] as string], keepText: `${s.keepText} ` }),
      'keep-hash-mismatch',
    )
    expect(s.f.count('DELETE')).toBe(0)
  })

  it('a protected deployment added to the proposal by hand, even re-hashed', async () => {
    const s = await setup()
    const p = JSON.parse(s.proposalText)
    const k = JSON.parse(s.keepText).keeps.find(
      (x: { id: string }) => x.id === 'dpl_ROLLBACKPREV000001',
    )
    p.candidates.push({
      id: k.id,
      created: k.created,
      createdUtc: k.createdUtc,
      state: 'READY',
      target: 'production',
      bytes: k.bytes,
      bundles: k.bundles,
      eligibleBecause: 'forged',
      checks: [...CHECK_NAMES],
    })
    const text = canonicalText(p)
    await refused(
      run(s, { ids: ['dpl_ROLLBACKPREV000001'], proposalText: text, expectedSha256: sha256(text) }),
      'proposal-invalid',
    )
    expect(s.f.count('DELETE')).toBe(0)
  })

  it('a stale proposal; the limit can be shortened by the caller but never lengthened', async () => {
    const s = await setup()
    const id = s.ids[0] as string
    await refused(run(s, { ids: [id], now: NOW + 61 * 60_000 }), 'stale-proposal')
    await refused(
      run(s, { ids: [id], now: NOW + 11 * 60_000, maxAgeMs: 10 * 60_000 }),
      'stale-proposal',
    )
    await refused(
      run(s, { ids: [id], now: NOW + 61 * 60_000, maxAgeMs: 999 * 60 * 60_000 }),
      'stale-proposal',
    )
    expect(s.f.count('DELETE')).toBe(0)
  })

  it('wildcards, malformed and duplicate ids, an empty request and more than the per-run maximum', async () => {
    const s = await setup()
    await refused(run(s, { ids: ['dpl_OLD*'] }), 'bad-id')
    await refused(run(s, { ids: ['dpl_OLD2000000000?'] }), 'bad-id')
    await refused(run(s, { ids: ['older-than-30-days'] }), 'bad-id')
    await refused(run(s, { ids: [] }), 'bad-id')
    const id = s.ids[0] as string
    await refused(run(s, { ids: [id, id] }), 'duplicate-id')
    await refused(run(s, { ids: s.ids.slice(0, MAX_PER_RUN + 1) }), 'too-many')
    expect(s.ids.length).toBeGreaterThan(MAX_PER_RUN)
    expect(s.f.count('DELETE')).toBe(0)
  })
})

describe('stopped before the delete, because the world is not the one that was frozen', () => {
  const stopped = async (s: Setup, id: string, code: string): Promise<void> => {
    const r = await run(s, { ids: [id] })
    expect(r.stopped?.code).toBe(code)
    expect(r.deleted).toEqual([])
    expect(s.f.count('DELETE')).toBe(0)
  }

  it('production now points somewhere else', async () => {
    const s = await setup()
    s.f.productionId = 'dpl_RECENT10000000000'
    await stopped(s, s.ids[0] as string, 'production-changed')
  })

  it('production became the candidate itself', async () => {
    const s = await setup()
    const id = s.ids[0] as string
    s.f.productionId = id
    await stopped(s, id, 'current-production')
  })

  it('an alias was added elsewhere', async () => {
    const s = await setup()
    s.f.aliases.push({ alias: 'another.example.test', deploymentId: 'dpl_RECENT10000000000' })
    await stopped(s, s.ids[0] as string, 'aliases-changed')
  })

  it('an alias now points at the candidate', async () => {
    const s = await setup()
    const id = s.ids[0] as string
    s.f.aliases.push({ alias: 'another.example.test', deploymentId: id })
    await stopped(s, id, 'aliased')
  })

  it('a deployment appeared, or any deployment changed state, since the freeze', async () => {
    const a = await setup()
    a.f.add({ uid: 'dpl_BRANDNEWBUILD00001', created: NOW - 60_000 })
    await stopped(a, a.ids[0] as string, 'inventory-changed')
    const b = await setup()
    const other = b.f.deployments.get('dpl_RECENT10000000000')
    if (other !== undefined) other.state = 'ERROR'
    await stopped(b, b.ids[0] as string, 'inventory-changed')
  })

  it('the candidate no longer exists, or is already deleted', async () => {
    const a = await setup()
    const id = a.ids[0] as string
    a.f.hideDetail.add(id)
    await stopped(a, id, 'missing')
    const b = await setup()
    const id2 = b.ids[0] as string
    b.f.detailSaysDeleted.add(id2)
    await stopped(b, id2, 'already-deleted')
  })

  it('its bundle size is not what was frozen', async () => {
    const s = await setup()
    const id = s.ids[0] as string
    const d = s.f.deployments.get(id)
    if (d !== undefined) d.bytes += 1
    await stopped(s, id, 'bytes-changed')
  })

  it('a tracked file now names it', async () => {
    const s = await setup()
    const id = s.ids[0] as string
    const r = await run(s, { ids: [id], referencedNow: () => 1 })
    expect(r.stopped?.code).toBe('referenced')
    expect(s.f.count('DELETE')).toBe(0)
  })
})

describe('a dry run sends nothing', () => {
  it('runs every check, reports what would be deleted and issues no DELETE', async () => {
    const s = await setup()
    const ids = s.ids.slice(0, 3)
    const r = await run(s, { ids, go: false })
    expect(r.dryRun).toBe(true)
    expect(r.wouldDelete).toEqual(ids)
    expect(r.deleted).toEqual([])
    expect(s.f.count('DELETE')).toBe(0)
    expect(s.f.deployments.size).toBeGreaterThan(ids.length)
    for (const id of ids) expect(s.f.deployments.has(id)).toBe(true)
  })
})

describe('deleting', () => {
  it('deletes exactly the one allowed deployment, logging the attempt BEFORE the request and the result after', async () => {
    const s = await setup()
    const id = s.ids[0] as string
    const before = s.f.deployments.size
    const r = await run(s, { ids: [id] })
    expect(r.deleted).toEqual([id])
    expect(r.stopped).toBeNull()
    expect(s.f.count('DELETE')).toBe(1)
    expect(s.f.deployments.size).toBe(before - 1)
    expect(s.f.deployments.has(id)).toBe(false)
    const attempt = s.f.events.indexOf(`LOG attempt ${id}`)
    const del = s.f.events.findIndex((e) => e.startsWith('DELETE /v13/deployments/'))
    const done = s.f.events.indexOf(`LOG completed ${id}`)
    expect(attempt).toBeGreaterThan(-1)
    expect(del).toBeGreaterThan(attempt)
    expect(done).toBeGreaterThan(del)
    expect(s.log.find((e) => e.phase === 'completed')?.result).toBe('deleted')
    expect(s.log.find((e) => e.phase === 'completed')?.httpStatus).toBe(200)
    expect(r.reclaimedBytes).toBeGreaterThan(0)
  })

  it('deletes several one at a time, each re-reading the world, and nothing outside the request', async () => {
    const s = await setup()
    const ids = s.ids.slice(0, 3)
    const before = s.f.deployments.size
    const r = await run(s, { ids })
    expect(r.deleted).toEqual(ids)
    expect(s.f.count('DELETE')).toBe(3)
    expect(s.f.deployments.size).toBe(before - 3)
    // no DELETE is issued before the previous one completed
    const order = s.f.events.filter((e) => e.startsWith('DELETE') || e.startsWith('LOG completed'))
    expect(order.map((e) => e.split(' ')[0])).toEqual([
      'DELETE',
      'LOG',
      'DELETE',
      'LOG',
      'DELETE',
      'LOG',
    ])
  })

  it('stops at the first failure and attempts nothing after it', async () => {
    const s = await setup()
    const [a, b, c] = s.ids as [string, string, string]
    s.f.deleteMode.set(b, 'http500')
    const r = await run(s, { ids: [a, b, c] })
    expect(r.deleted).toEqual([a])
    expect(r.stopped?.id).toBe(b)
    expect(r.stopped?.code).toBe('unexpected-response')
    expect(s.f.count('DELETE')).toBe(2)
    expect(s.f.deployments.has(c)).toBe(true)
    expect(s.log.some((e) => e.id === c)).toBe(false)
    expect(s.log.find((e) => e.id === b && e.phase === 'completed')?.httpStatus).toBe(500)
  })

  it('a timeout is ambiguous: logged, not retried, and the run stops', async () => {
    const s = await setup()
    const [a, b] = s.ids as [string, string]
    s.f.deleteMode.set(a, 'timeout')
    const r = await run(s, { ids: [a, b] })
    expect(r.stopped?.code).toBe('ambiguous')
    expect(s.f.count('DELETE')).toBe(1)
    expect(s.log.find((e) => e.id === a && e.phase === 'completed')?.result).toBe('ambiguous')
    expect(s.f.deployments.has(b)).toBe(true)
  })

  it('an answer that says DELETED while the deployment is still readable is ambiguous, not a success', async () => {
    const s = await setup()
    const [a, b] = s.ids as [string, string]
    s.f.deleteMode.set(a, 'still-there')
    const r = await run(s, { ids: [a, b] })
    expect(r.deleted).toEqual([])
    expect(r.stopped?.code).toBe('ambiguous')
    expect(s.f.count('DELETE')).toBe(1)
  })

  it('an unexpected body is a failure even with a 200', async () => {
    const s = await setup()
    const [a, b] = s.ids as [string, string]
    s.f.deleteMode.set(a, 'weird-body')
    const r = await run(s, { ids: [a, b] })
    expect(r.stopped?.code).toBe('unexpected-response')
    expect(r.deleted).toEqual([])
    expect(s.f.count('DELETE')).toBe(1)
  })

  it('if the attempt cannot be logged, nothing is sent', async () => {
    const s = await setup()
    const r = await run(s, {
      ids: [s.ids[0] as string],
      log: () => {
        throw new Error('disk full')
      },
    })
    expect(r.stopped?.code).toBe('log-failed')
    expect(s.f.count('DELETE')).toBe(0)
  })
})
