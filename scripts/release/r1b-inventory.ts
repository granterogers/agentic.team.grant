/**
 * R1b read-only inventory: which edge functions are deployed, what the platform says of the project, and which Vercel
 * deployment serves Team HQ. Nothing is written, nothing is changed, and no credential, body or person is printed.
 *
 *   ALLOW_PRODUCTION_CHECKS=1 npx tsx scripts/release/r1b-inventory.ts
 *
 * Every request is a GET. The Management API calls are the project record, the health reading and the function list;
 * the Vercel calls are the project list, one deployment and the recent production deployments.
 */
import '../../src/safety/require-production-checks.ts'

const ref = process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg'
const sb = process.env.SUPABASE_ACCESS_TOKEN ?? ''
const vc = process.env.VERCEL_TOKEN ?? ''
if (sb === '' || vc === '') {
  console.error('SUPABASE_ACCESS_TOKEN and VERCEL_TOKEN are required')
  process.exit(2)
}
const sbh = { authorization: `Bearer ${sb}` }
const vch = { authorization: `Bearer ${vc}` }
const get = async (url: string, headers: Record<string, string>): Promise<unknown> => {
  const res = await fetch(url, { headers, method: 'GET' })
  const text = await res.text()
  if (!res.ok) return { http: res.status, note: text.slice(0, 120) }
  return JSON.parse(text) as unknown
}
const iso = (ms: unknown): string => (typeof ms === 'number' ? new Date(ms).toISOString() : 'n/a')

console.log(`target project ref: ${ref}`)
const proj = (await get(`https://api.supabase.com/v1/projects/${ref}`, sbh)) as Record<
  string,
  unknown
>
console.log(
  `project: name=${String(proj.name)} status=${String(proj.status)} region=${String(proj.region)}`,
)
const health = (await get(
  `https://api.supabase.com/v1/projects/${ref}/health?services=auth&services=db&services=rest&services=storage`,
  sbh,
)) as { name: string; healthy?: boolean; status: string }[]
console.log(
  `health: ${Array.isArray(health) ? health.map((h) => `${h.name}=${h.status}`).join(' ') : JSON.stringify(health)}`,
)
const fns = (await get(`https://api.supabase.com/v1/projects/${ref}/functions`, sbh)) as {
  slug: string
  version: number
  status: string
  verify_jwt: boolean
  updated_at: number
  created_at: number
}[]
console.log('functions (slug, version, status, verify_jwt, updated_at):')
for (const f of [...fns].sort((a, b) => a.slug.localeCompare(b.slug)))
  console.log(
    `  ${f.slug.padEnd(20)} v${String(f.version).padEnd(5)} ${f.status.padEnd(7)} jwt=${String(f.verify_jwt).padEnd(5)} ${iso(f.updated_at)}`,
  )

const projects = (
  (await get('https://api.vercel.com/v9/projects?limit=100', vch)) as {
    projects: { id: string; name: string; targets?: { production?: { id?: string } } }[]
  }
).projects
const p = projects.find((x) => x.name === 'ai-team-hq')
if (p === undefined) throw new Error('no ai-team-hq project')
const liveId = p.targets?.production?.id ?? ''
console.log(`vercel project ai-team-hq; production deployment id: ${liveId}`)
const d = (await get(`https://api.vercel.com/v13/deployments/${liveId}`, vch)) as Record<
  string,
  unknown
>
const meta = (d.meta ?? {}) as Record<string, unknown>
const git = (d.gitSource ?? {}) as Record<string, unknown>
console.log(
  `  readyState=${String(d.readyState)} target=${String(d.target)} created=${iso(d.createdAt)} ready=${iso(d.ready)} source=${String(d.source)}`,
)
console.log(
  `  meta keys: ${Object.keys(meta).join(',') || 'none'}; commit sha: ${String(meta.githubCommitSha ?? git.sha ?? 'not recorded')}`,
)
console.log(`  aliases: ${JSON.stringify(d.alias ?? [])}`)
const recent = (
  (await get(
    `https://api.vercel.com/v6/deployments?projectId=${p.id}&target=production&limit=8`,
    vch,
  )) as { deployments?: { uid: string; state?: string; readyState?: string; created: number }[] }
).deployments
console.log('recent production deployments (newest first):')
for (const x of recent ?? [])
  console.log(`  ${x.uid} ${x.readyState ?? x.state ?? '?'} ${iso(x.created)}`)
