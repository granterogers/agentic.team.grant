/**
 * Reading a Vercel project's live deployment inventory through an injected client. No network of its own, no filesystem.
 *
 * The client is a single `request(method, path)` function. The freeze script gives it a client that can only GET; only the
 * deletion tool's client can send a DELETE, and that one call lives in retention-delete.ts. Everything here only reads.
 *
 * What is read, and why each field is there:
 *   - the project's production deployment id and every alias, so "behind an alias" is a fact read now, not remembered;
 *   - every deployment's state, target, creation time and metadata, so a change since a proposal was frozen is detectable;
 *   - function-bundle bytes per deployment (one extra read each), the figure the storage question is about.
 */
import { canonicalText, sha256 } from './retention-hash.ts'

export interface HttpClient {
  /** Resolves with the status and parsed body (null when there is none). Rejects on a network error or a timeout. */
  request(method: 'GET' | 'DELETE', path: string): Promise<{ status: number; body: unknown }>
}

export class UnexpectedResponse extends Error {
  constructor(
    readonly path: string,
    readonly status: number,
  ) {
    super(`GET ${path.split('?')[0]} -> http ${String(status)}`)
  }
}

export interface LiveRow {
  id: string
  created: number
  target: 'production' | 'preview'
  state: string
  /** Aliases that point at this deployment, sorted. */
  aliases: string[]
  /** Metadata KEYS, sorted. The values are in `metaSha`. */
  metaKeys: string[]
  /** sha256 of the whole metadata object, so any change to it is detectable without carrying the values. */
  metaSha: string
  /** What Vercel reports for instant rollback. Informational: it is NOT part of the inventory digest. */
  rollbackCandidate: boolean
}

export interface LiveState {
  teamId: string
  project: { id: string; name: string }
  productionId: string
  /** Every alias of this project's deployments, sorted by alias. */
  aliasPairs: { alias: string; deploymentId: string }[]
  rows: LiveRow[]
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string => (typeof v === 'string' ? v : '')

const okGet = async (client: HttpClient, path: string): Promise<unknown> => {
  const r = await client.request('GET', path)
  if (r.status !== 200) throw new UnexpectedResponse(path, r.status)
  return r.body
}

/** The digest of the inventory at list level. Bytes are not in it (they cost a read per deployment). */
export const inventoryDigest = (rows: readonly LiveRow[]): string =>
  sha256(
    canonicalText(
      [...rows]
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        .map((r) => ({
          id: r.id,
          created: r.created,
          target: r.target,
          state: r.state,
          aliases: [...r.aliases].sort(),
          metaKeys: [...r.metaKeys].sort(),
          metaSha: r.metaSha,
        })),
    ),
  )

export const metaDigest = (meta: unknown): string => sha256(canonicalText(isObj(meta) ? meta : {}))

/** Pages through a list endpoint whose last page says `next: null` (a number-shaped absence, not a cursor). */
async function pages(client: HttpClient, base: string, key: string): Promise<Obj[]> {
  const out: Obj[] = []
  for (let until: string | undefined; ; ) {
    const body = await okGet(client, `${base}${until === undefined ? '' : `&until=${until}`}`)
    if (!isObj(body) || !Array.isArray(body[key]))
      throw new Error(`${base.split('?')[0]}: unexpected shape`)
    const list = body[key] as unknown[]
    out.push(...list.filter(isObj))
    const next = isObj(body.pagination) ? body.pagination.next : null
    if (typeof next !== 'number' || list.length === 0) break
    until = String(next)
  }
  return out
}

/** The whole live state of one project. Used by the freeze (once) and by the deletion tool (before every deletion). */
export async function readLive(
  client: HttpClient,
  who: { teamSlug: string; projectName: string } | { teamId: string; projectName: string },
): Promise<LiveState> {
  let teamId: string
  if ('teamId' in who) teamId = who.teamId
  else {
    const teams = await okGet(client, '/v2/teams')
    const list = isObj(teams) && Array.isArray(teams.teams) ? (teams.teams as unknown[]) : []
    const team = list.filter(isObj).find((t) => t.slug === who.teamSlug)
    if (team === undefined || str(team.id) === '') throw new Error(`no team ${who.teamSlug}`)
    teamId = str(team.id)
  }
  const q = `teamId=${teamId}`
  const projects = await okGet(client, `/v9/projects?${q}&limit=100`)
  const plist =
    isObj(projects) && Array.isArray(projects.projects) ? (projects.projects as unknown[]) : []
  const project = plist.filter(isObj).find((p) => p.name === who.projectName)
  if (project === undefined || str(project.id) === '')
    throw new Error(`no project ${who.projectName}`)
  const targets = isObj(project.targets) ? project.targets : {}
  const production = isObj(targets.production) ? targets.production : {}
  const productionId = str(production.id)

  const listed = await pages(
    client,
    `/v6/deployments?${q}&projectId=${str(project.id)}&limit=100`,
    'deployments',
  )
  const aliasList = await pages(client, `/v4/aliases?${q}&limit=100`, 'aliases')
  const known = new Set(listed.map((d) => str(d.uid)))
  const aliasPairs = aliasList
    .map((a) => ({ alias: str(a.alias), deploymentId: str(a.deploymentId) }))
    .filter((a) => a.alias !== '' && known.has(a.deploymentId))
    .sort((a, b) => (a.alias < b.alias ? -1 : a.alias > b.alias ? 1 : 0))
  const aliasesOf = new Map<string, string[]>()
  for (const a of aliasPairs)
    aliasesOf.set(a.deploymentId, [...(aliasesOf.get(a.deploymentId) ?? []), a.alias])

  const rows: LiveRow[] = listed.map((d) => ({
    id: str(d.uid),
    created: typeof d.created === 'number' ? d.created : 0,
    target: d.target === 'production' ? 'production' : 'preview',
    state: str(d.state) !== '' ? str(d.state) : 'UNKNOWN',
    aliases: [...(aliasesOf.get(str(d.uid)) ?? [])].sort(),
    metaKeys: isObj(d.meta) ? Object.keys(d.meta).sort() : [],
    metaSha: metaDigest(d.meta),
    rollbackCandidate: d.isRollbackCandidate === true,
  }))
  return {
    teamId,
    project: { id: str(project.id), name: who.projectName },
    productionId,
    aliasPairs,
    rows,
  }
}

/** One deployment, raw: the caller decides what a 404 or a different state means. */
export const readDeployment = (
  client: HttpClient,
  teamId: string,
  id: string,
): Promise<{ status: number; body: unknown }> =>
  client.request('GET', `/v13/deployments/${id}?teamId=${teamId}`)

/** Python function bundles and their total bytes, from the deployment's build output. Throws if it cannot be read. */
export async function readBytes(
  client: HttpClient,
  teamId: string,
  id: string,
): Promise<{ bundles: number; bytes: number }> {
  const body = await okGet(client, `/v13/deployments/${id}/builds?teamId=${teamId}`)
  if (!isObj(body) || !Array.isArray(body.builds))
    throw new Error(`builds of ${id}: unexpected shape`)
  let bundles = 0
  let bytes = 0
  for (const b of (body.builds as unknown[]).filter(isObj)) {
    for (const o of Array.isArray(b.output) ? (b.output as unknown[]).filter(isObj) : []) {
      if (o.type === 'lambda') {
        bundles += 1
        bytes += typeof o.size === 'number' ? o.size : 0
      }
    }
  }
  return { bundles, bytes }
}
