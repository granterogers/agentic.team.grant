/**
 * A stateful fake of the parts of the Vercel API the retention tools use, with injectable failures. No network, no clock.
 * It is an HttpClient, so the REAL freeze and deletion code runs against it unchanged.
 */
import {
  buildFreeze,
  type FreezeInputs,
  type RowFacts,
} from '../../../scripts/deploy/lib/retention-freeze.ts'
import {
  type HttpClient,
  readBytes,
  readLive,
} from '../../../scripts/deploy/lib/vercel-live-read.ts'

export const DAY = 86_400_000
export const NOW = Date.UTC(2026, 9, 7, 20, 0, 0)

export interface FakeDeployment {
  uid: string
  created: number
  state: string
  target: 'production' | null
  meta: Record<string, string>
  bytes: number
}

export type DeleteMode =
  | 'ok'
  | 'http500'
  | 'timeout'
  | 'weird-body'
  | 'still-there'
  | 'gone-as-state'

export class FakeVercel implements HttpClient {
  readonly teamId = 'team_fake'
  readonly projectId = 'prj_fake'
  deployments = new Map<string, FakeDeployment>()
  productionId = ''
  aliases: { alias: string; deploymentId: string }[] = []
  calls: { method: string; path: string }[] = []
  /** Every call and every log line, in order, so a test can assert "logged BEFORE sent". */
  events: string[] = []
  deleteMode = new Map<string, DeleteMode>()
  /** Ids whose single-deployment read answers 404 although the list still shows them. */
  hideDetail = new Set<string>()
  /** Ids whose single-deployment read says DELETED although the list still shows them. */
  detailSaysDeleted = new Set<string>()
  onDelete: ((id: string) => void) | null = null

  add(d: Partial<FakeDeployment> & { uid: string }): FakeDeployment {
    const full: FakeDeployment = {
      created: NOW - 20 * DAY,
      state: 'READY',
      target: 'production',
      meta: { lambdaRuntimeStats: '{"python":2}' },
      bytes: 23_000_000,
      ...d,
    }
    this.deployments.set(full.uid, full)
    return full
  }

  count(method: string): number {
    return this.calls.filter((c) => c.method === method).length
  }

  async request(
    method: 'GET' | 'DELETE',
    path: string,
  ): Promise<{ status: number; body: unknown }> {
    this.calls.push({ method, path })
    this.events.push(`${method} ${path.split('?')[0]}`)
    const u = new URL(`https://x${path}`)
    const json = (status: number, body: unknown): { status: number; body: unknown } => ({
      status,
      body,
    })
    const live = [...this.deployments.values()].sort((a, b) => b.created - a.created)
    if (method === 'GET') {
      if (u.pathname === '/v2/teams')
        return json(200, { teams: [{ id: this.teamId, slug: 'agentic-team-grant' }] })
      if (u.pathname === '/v9/projects')
        return json(200, {
          projects: [
            {
              id: this.projectId,
              name: 'ai-team-hq',
              targets: { production: { id: this.productionId } },
            },
          ],
        })
      if (u.pathname === '/v6/deployments')
        return json(200, {
          deployments: live.map((d) => ({
            uid: d.uid,
            url: `${d.uid}.vercel.app`,
            created: d.created,
            state: d.state,
            readyState: d.state,
            target: d.target,
            meta: d.meta,
            isRollbackCandidate: true,
          })),
          pagination: { next: null },
        })
      if (u.pathname === '/v4/aliases')
        return json(200, { aliases: this.aliases, pagination: { next: null } })
      const m = u.pathname.match(/^\/v13\/deployments\/([^/]+)(\/builds)?$/)
      if (m) {
        const id = m[1] as string
        const d = this.deployments.get(id)
        if (m[2] === '/builds') {
          if (d === undefined) return json(404, { error: { code: 'not_found' } })
          return json(200, {
            builds: [
              { output: d.bytes > 0 ? [{ type: 'lambda', size: d.bytes }] : [{ type: 'static' }] },
            ],
          })
        }
        if (d === undefined || this.hideDetail.has(id))
          return json(404, { error: { code: 'not_found' } })
        const state = this.detailSaysDeleted.has(id) ? 'DELETED' : d.state
        return json(200, {
          id,
          readyState: state,
          state,
          target: d.target,
          createdAt: d.created,
          meta: d.meta,
        })
      }
    }
    if (method === 'DELETE') {
      const m = u.pathname.match(/^\/v13\/deployments\/([^/]+)$/)
      if (m) {
        const id = m[1] as string
        const mode = this.deleteMode.get(id) ?? 'ok'
        if (mode === 'timeout') throw new Error('The operation was aborted due to timeout')
        if (mode === 'http500') return json(500, { error: { message: 'internal' } })
        if (mode === 'weird-body') return json(200, { ok: true })
        if (mode === 'still-there') return json(200, { uid: id, state: 'DELETED' })
        this.onDelete?.(id)
        this.deployments.delete(id)
        return json(200, { uid: id, state: 'DELETED' })
      }
    }
    throw new Error(`unexpected request in the fake Vercel: ${method} ${path}`)
  }
}

/**
 * A realistic world: a current production deployment, a rollback, a validation preview, one deployment behind an extra alias,
 * a week of recent builds, and a month of older production builds, several per day, most of them ordinary and eligible.
 */
export function world(): FakeVercel {
  const f = new FakeVercel()
  f.add({ uid: 'dpl_PRODCURRENT000001', created: NOW - 1 * 3_600_000 })
  f.add({ uid: 'dpl_ROLLBACKPREV000001', created: NOW - 20 * 3_600_000 })
  f.add({ uid: 'dpl_VALIDATIONPREV0001', created: NOW - 3 * 3_600_000, target: null })
  f.productionId = 'dpl_PRODCURRENT000001'
  f.aliases = [
    { alias: 'ai-team-hq.vercel.app', deploymentId: 'dpl_PRODCURRENT000001' },
    { alias: 'ai-team-hq-agentic-team-grant.vercel.app', deploymentId: 'dpl_PRODCURRENT000001' },
  ]
  // a week of recent production builds, 3 per day
  for (let d = 1; d <= 6; d += 1)
    for (let k = 0; k < 3; k += 1)
      f.add({
        uid: `dpl_RECENT${String(d)}${String(k)}000000000`,
        created: NOW - d * DAY - k * 3_600_000 - 5 * 3_600_000,
      })
  // a month of older builds: days 10..32 ago, 4 per day, the last of each day is its daily keeper
  for (let d = 10; d <= 32; d += 1)
    for (let k = 0; k < 4; k += 1)
      f.add({
        uid: `dpl_OLD${String(d).padStart(2, '0')}${String(k)}00000000`,
        created: NOW - d * DAY + k * 3 * 3_600_000 - 9 * 3_600_000,
      })
  return f
}

/** Read the fake exactly as the freeze script reads Vercel, then build the frozen files. */
export async function freezeOf(
  f: FakeVercel,
  over: Partial<FreezeInputs> & { sizeFails?: ReadonlySet<string> } = {},
): Promise<{
  proposal: ReturnType<typeof buildFreeze>['proposal']
  keep: ReturnType<typeof buildFreeze>['keep']
  proposalText: string
  keepText: string
  rows: RowFacts[]
}> {
  const live = await readLive(f, { teamSlug: 'agentic-team-grant', projectName: 'ai-team-hq' })
  const rows: RowFacts[] = []
  for (const r of live.rows) {
    let bytes = 0
    let bundles = 0
    let known = true
    try {
      if (over.sizeFails?.has(r.id)) throw new Error('size read failed')
      ;({ bundles, bytes } = await readBytes(f, live.teamId, r.id))
    } catch {
      known = false
    }
    rows.push({ ...r, bytes, bundles, bytesKnown: known })
  }
  const { sizeFails: _ignored, ...rest } = over
  const built = buildFreeze({
    now: NOW,
    teamId: live.teamId,
    project: live.project,
    production: { id: live.productionId, aliases: live.aliasPairs },
    rollbackId: 'dpl_ROLLBACKPREV000001',
    validationIds: ['dpl_VALIDATIONPREV0001'],
    rows,
    referencedIds: [],
    extraKeep: [],
    ...rest,
  })
  return { ...built, rows }
}
