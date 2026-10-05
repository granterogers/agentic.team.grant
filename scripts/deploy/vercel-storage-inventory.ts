/**
 * READ-ONLY inventory of a Vercel project's deployments and the deletion candidates under the retention rule.
 *
 *   ALLOW_PRODUCTION_CHECKS=1 npx tsx scripts/deploy/vercel-storage-inventory.ts
 *   ALLOW_PRODUCTION_CHECKS=1 npx tsx scripts/deploy/vercel-storage-inventory.ts --out=.out/vercel-inventory.csv
 *   ... --keep=dpl_abc,dpl_def   (ids a reviewer wants kept regardless)  --now=2026-10-05T15:00:00Z  (reproduce a past list)
 *
 * It only issues GET requests. It never deletes, promotes, aliases or deploys, and it has no flag that does. It prints the
 * totals and, with --out, writes the full list for review. The rule and the safety assertion live in
 * `scripts/deploy/lib/vercel-retention.ts`, which has the tests.
 *
 * Function bundle sizes are not in the deployment object; they are `output[].size` on the deployment's builds, which is why
 * this makes one extra request per deployment (four at a time, retried on a transport cut-off).
 */
import '../../src/safety/require-production-checks.ts'
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import {
  assertSafe,
  classify,
  DEFAULT_RULE,
  type DeploymentRow,
  type Rule,
  toCsv,
  totals,
} from './lib/vercel-retention.ts'

const token = process.env.VERCEL_TOKEN ?? ''
if (token === '') {
  console.error('VERCEL_TOKEN is required')
  process.exit(2)
}
const arg = (name: string): string | undefined =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)
const projectName = arg('project') ?? 'ai-team-hq'
const teamSlug = arg('team') ?? 'agentic-team-grant'
const now = arg('now') === undefined ? Date.now() : Date.parse(String(arg('now')))
if (Number.isNaN(now)) {
  console.error('--now must be an ISO timestamp')
  process.exit(2)
}

const get = async <T>(path: string): Promise<T> => {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const res = await fetch(`https://api.vercel.com${path}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        const said = ((await res.text()).match(/"message":"([^"]{0,160})/) ?? [])[1] ?? ''
        throw new Error(`GET ${path.split('?')[0]} -> http ${String(res.status)} ${said}`)
      }
      return (await res.json()) as T
    } catch (error) {
      // A cut-off transfer is not an answer; an HTTP refusal is, and is thrown above on the same path.
      if (attempt >= 5 || String(error).includes('-> http')) throw error
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt))
    }
  }
}

const teams = await get<{ teams: { id: string; slug: string }[] }>('/v2/teams')
const team = teams.teams.find((t) => t.slug === teamSlug)
if (team === undefined) throw new Error(`no team ${teamSlug}`)
const q = `teamId=${team.id}`

const projects = await get<{
  projects: { id: string; name: string; targets?: { production?: { id?: string } } }[]
}>(`/v9/projects?${q}&limit=100`)
const project = projects.projects.find((p) => p.name === projectName)
if (project === undefined) throw new Error(`no project ${projectName}`)
const liveId = project.targets?.production?.id ?? ''

type Listed = {
  uid: string
  url: string
  created: number
  target?: string | null
  state?: string
  meta?: Record<string, string>
}
const listed: Listed[] = []
for (let until: string | undefined; ; ) {
  const page = await get<{ deployments: Listed[]; pagination?: { next?: number | null } }>(
    `/v6/deployments?${q}&projectId=${project.id}&limit=100${until === undefined ? '' : `&until=${until}`}`,
  )
  listed.push(...page.deployments)
  // The last page says `next: null`, which is a number-shaped absence and not a cursor.
  const next = page.pagination?.next
  if (typeof next !== 'number' || page.deployments.length === 0) break
  until = String(next)
}

const aliases = new Map<string, string[]>()
for (let until: string | undefined; ; ) {
  const page = await get<{
    aliases: { alias: string; deploymentId: string; projectId?: string }[]
    pagination?: { next?: number | null }
  }>(`/v4/aliases?${q}&limit=100${until === undefined ? '' : `&until=${until}`}`)
  for (const a of page.aliases)
    aliases.set(a.deploymentId, [...(aliases.get(a.deploymentId) ?? []), a.alias])
  const next = page.pagination?.next
  if (typeof next !== 'number' || page.aliases.length === 0) break
  until = String(next)
}

const refs = new Map<string, Set<string>>()
try {
  const out = execFileSync(
    'git',
    [
      'grep',
      '-n',
      '-o',
      '-E',
      'dpl_[A-Za-z0-9]{20,}',
      '--',
      'docs',
      'CLAUDE.md',
      'README.md',
      // this audit names deployments as evidence; it is not a release record that depends on them
      ':!docs/performance',
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
  )
  for (const line of out.split('\n')) {
    const [file, , id] = line.split(':')
    if (file !== undefined && id !== undefined) refs.set(id, (refs.get(id) ?? new Set()).add(file))
  }
} catch {
  // git grep exits 1 when there is nothing to find; the column is then simply empty
}

const sizes = async (id: string): Promise<{ bundles: number; bytes: number }> => {
  const b = await get<{ builds: { output?: { type?: string; size?: number }[] }[] }>(
    `/v13/deployments/${id}/builds?${q}`,
  )
  const lambdas = b.builds.flatMap((x) => (x.output ?? []).filter((o) => o.type === 'lambda'))
  return { bundles: lambdas.length, bytes: lambdas.reduce((n, o) => n + (o.size ?? 0), 0) }
}
const rows: DeploymentRow[] = []
for (let i = 0; i < listed.length; i += 4) {
  const batch = listed.slice(i, i + 4)
  const done = await Promise.all(batch.map((d) => sizes(d.uid)))
  batch.forEach((d, k) => {
    rows.push({
      id: d.uid,
      url: `https://${d.url}`,
      created: d.created,
      target: d.target === 'production' ? 'production' : 'preview',
      state: d.state ?? 'UNKNOWN',
      bundles: done[k]?.bundles ?? 0,
      bytes: done[k]?.bytes ?? 0,
      aliases: aliases.get(d.uid) ?? [],
      docRefs: [...(refs.get(d.uid) ?? [])].sort(),
      experiment: d.meta?.experiment ?? null,
    })
  })
}

const keepNames = (arg('keep') ?? '').split(',').filter((s) => s !== '')
const rule: Rule = {
  liveId,
  now,
  ...DEFAULT_RULE,
  extraKeep: new Set(keepNames),
}
const decisions = classify(rows, rule)
assertSafe(decisions, rule)
const t = totals(decisions)
const gib = (n: number): string => (n / 2 ** 30).toFixed(3)
console.log(
  `project ${projectName} (${project.id}); live ${liveId}; generated ${new Date(now).toISOString()}`,
)
console.log(
  `rule: live + newest ${String(rule.keepNewestProduction)} ready production + ${String(rule.windowDays)}-day window` +
    `${keepNames.length > 0 ? ` + ${String(keepNames.length)} named` : ''}`,
)
console.log(
  `inventory: ${String(t.total.deployments)} deployments, ${gib(t.total.bytes)} GiB of function bundles`,
)
console.log(`KEEP:   ${String(t.keep.deployments)} deployments, ${gib(t.keep.bytes)} GiB`)
console.log(
  `DELETE: ${String(t.delete.deployments)} candidates, ${gib(t.delete.bytes)} GiB (${(t.deleteShareOfBytes * 100).toFixed(0)}% of bytes)`,
)
console.log(`candidates that a tracked document names: ${String(t.deleteWithDocRefs.length)}`)
const out = arg('out')
if (out !== undefined) {
  writeFileSync(out, toCsv(decisions))
  console.log(`wrote ${out}`)
}
console.log('read-only: nothing was deleted, promoted, aliased or deployed')
