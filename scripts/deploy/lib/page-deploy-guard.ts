/**
 * The one place a Team HQ page deploy asks "would this change anything?". `deploy:hq` and `deploy:hq-page` both call
 * `assessPageDeploy`, so the rule is written once and tested once.
 *
 * Read-only by construction: it takes a client that can only GET (`VercelReader`), so nothing here can create, change or
 * delete anything on Vercel. The client is injected: the tests pass a fake and make no HTTP call.
 *
 * It fails OPEN toward deploying. It never throws; any error while reading the project or the live deployment, a missing
 * piece of evidence, or an unexpected shape returns `skip: false` (and no fingerprint to record, because a fingerprint built
 * from evidence that could not be read would be a claim nothing supports).
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { collectPageFiles, toUploadList } from './page-files.ts'
import {
  decideSkip,
  envDigest,
  FINGERPRINT_META_KEY,
  pageFingerprint,
  pickProjectSettings,
  type SkipDecision,
  unpinnedRequirements,
} from './page-fingerprint.ts'

/** A client that can only read. There is deliberately no method that writes. */
export interface VercelReader {
  get(path: string): Promise<unknown>
}

/** The real reader over `fetch`. `fetchImpl` is injectable so even this is tested without a network. */
export function makeVercelReader(
  token: string,
  fetchImpl: typeof fetch = fetch,
  base = 'https://api.vercel.com',
): VercelReader {
  return {
    async get(path: string): Promise<unknown> {
      const res = await fetchImpl(`${base}${path}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error(`GET ${path.split('?')[0]} -> http ${String(res.status)}`)
      return res.json()
    },
  }
}

export interface GuardOptions {
  root?: string
  projectName: string
  /** The non-file fields of the deployment request, exactly as the script sends them. */
  deployment: { name: string; target: string; projectSettings: unknown }
  /** Environment values the deploy script itself supplies, by variable name. Digested; never stored or printed. */
  supplied?: Readonly<Record<string, string>>
  force?: boolean
}

export interface GuardResult {
  /** Null when the evidence could not be gathered: then nothing is recorded and the answer is always deploy. */
  fingerprint: string | null
  decision: SkipDecision
  liveId: string
  fileCount: number
  /** Requirement lines with no exact pin, reported and never changed. */
  unpinned: string[]
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

/** The `meta` to put on the deployment request: the fingerprint, or nothing when there is none. */
export const deploymentMeta = (r: GuardResult): { meta?: Record<string, string> } =>
  r.fingerprint === null ? {} : { meta: { [FINGERPRINT_META_KEY]: r.fingerprint } }

const clip = (e: unknown): string => String(e instanceof Error ? e.message : e).slice(0, 160)

export async function assessPageDeploy(
  client: VercelReader,
  opts: GuardOptions,
): Promise<GuardResult> {
  const root = opts.root ?? '.'
  const supplied = opts.supplied ?? {}
  const empty: GuardResult = {
    fingerprint: null,
    decision: { skip: false, reason: 'not assessed' },
    liveId: '',
    fileCount: 0,
    unpinned: [],
  }
  let result = empty
  try {
    const files = await collectPageFiles(root)
    const unpinned = unpinnedRequirements(await readFile(join(root, 'requirements.txt'), 'utf8'))
    result = { ...empty, fileCount: files.size, unpinned }

    const projects = await client.get('/v9/projects?limit=100')
    const list = isObj(projects) && Array.isArray(projects.projects) ? projects.projects : null
    if (list === null) throw new Error('the project list had an unexpected shape')
    const project = list.find((p): p is Obj => isObj(p) && p.name === opts.projectName)
    if (project === undefined || typeof project.id !== 'string')
      throw new Error(`no project ${opts.projectName} (the first deploy creates it)`)

    const envReply = await client.get(`/v9/projects/${project.id}/env`)
    if (!isObj(envReply) || !Array.isArray(envReply.envs))
      throw new Error('the environment list had an unexpected shape')
    if (isObj(envReply.pagination) && envReply.pagination.next != null)
      throw new Error('the environment list is truncated')
    const envNames: string[] = []
    const envStamps: Record<string, number | null> = {}
    const shapeParts = new Map<string, string[]>()
    for (const e of envReply.envs) {
      if (!isObj(e) || typeof e.key !== 'string') throw new Error('an environment entry had no key')
      if (!envNames.includes(e.key)) envNames.push(e.key)
      const targets = Array.isArray(e.target)
        ? e.target.map(String).sort().join('+')
        : String(e.target)
      shapeParts.set(e.key, [...(shapeParts.get(e.key) ?? []), `${targets}:${String(e.type)}`])
      if (e.key in supplied) {
        envStamps[e.key] = null // covered by the digest of the value this script supplies
        continue
      }
      if (typeof e.updatedAt !== 'number' || !Number.isFinite(e.updatedAt))
        throw new Error(
          `environment variable ${e.key} has no update time, so a change cannot be seen`,
        )
      envStamps[e.key] = Math.max(envStamps[e.key] ?? 0, e.updatedAt)
    }

    const envDigests = Object.fromEntries(
      Object.entries(supplied).map(([k, v]) => [k, envDigest(v)]),
    )
    const fingerprint = pageFingerprint({
      files: toUploadList(files),
      deployment: opts.deployment,
      project: {
        settings: pickProjectSettings(project),
        envNames,
        envStamps,
        envShapes: Object.fromEntries(
          [...shapeParts].map(([k, parts]) => [k, [...parts].sort().join('|')]),
        ),
      },
      envDigests,
    })
    result = { ...result, fingerprint }

    const targets = isObj(project.targets) ? project.targets : {}
    const production = isObj(targets.production) ? targets.production : {}
    const liveId = typeof production.id === 'string' ? production.id : ''
    result = { ...result, liveId }
    if (liveId === '') {
      return {
        ...result,
        decision: decideSkip(null, fingerprint, opts.force === true),
      }
    }
    const live = await client.get(`/v13/deployments/${liveId}`)
    if (!isObj(live)) throw new Error('the live deployment had an unexpected shape')
    const state = typeof live.readyState === 'string' ? live.readyState : String(live.state)
    const meta: Record<string, string> = {}
    if (isObj(live.meta))
      for (const [k, v] of Object.entries(live.meta)) if (typeof v === 'string') meta[k] = v
    // `targets.production.id` is Vercel's own statement of what production serves. A deployment that says it is another
    // target contradicts it, which is uncertainty, so it is never compared with.
    const isProduction = typeof live.target !== 'string' || live.target === 'production'
    const decision = decideSkip(
      { state: isProduction ? state : 'NOT_PRODUCTION', meta },
      fingerprint,
      opts.force === true,
    )
    return { ...result, decision }
  } catch (error) {
    // Anything unknown deploys. A fingerprint is kept only if it was fully built before the failure, so it can still be
    // recorded on the deployment that follows; with no live deployment read, the decision is deploy.
    return {
      ...result,
      decision: { skip: false, reason: `could not assess, so deploying: ${clip(error)}` },
    }
  }
}
