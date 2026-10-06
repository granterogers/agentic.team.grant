/**
 * Roll the Team HQ page back to a previous production deployment (Vercel "instant rollback"; no rebuild, no files uploaded).
 *
 *   ALLOW_PRODUCTION_CHECKS=1 npx tsx scripts/rollout/page-rollback.ts <deploymentId>          dry run: reads, changes nothing
 *   ALLOW_PRODUCTION_WRITES=1 npx tsx scripts/rollout/page-rollback.ts <deploymentId> --go     points production traffic at it
 *
 * The deployment id is the "live deployment (the rollback point)" that scripts/deploy/hq-page-delta.ts prints BEFORE it deploys.
 * Endpoint (Vercel REST API, checked against the current documentation on 6 October 2026):
 *   POST /v1/projects/{projectId}/rollback/{deploymentId}
 * It touches only which deployment production points at. It deploys nothing, deletes nothing and changes no setting.
 * A rollback is the remedy when something is worse, so it is not gated on the database canary.
 */
import '../../src/safety/require-production-checks.ts'

const id = process.argv[2] ?? ''
const go = process.argv.includes('--go')
const token = process.env.VERCEL_TOKEN ?? ''
if (!/^dpl_[A-Za-z0-9]+$/.test(id)) {
  console.error('usage: page-rollback.ts <deploymentId, dpl_...> [--go]')
  process.exit(2)
}
if (token === '') {
  console.error('VERCEL_TOKEN is required')
  process.exit(2)
}
const auth = { Authorization: `Bearer ${token}` }
const projects = (
  (await (
    await fetch('https://api.vercel.com/v9/projects?limit=100', { headers: auth })
  ).json()) as {
    projects: { id: string; name: string; targets?: { production?: { id?: string } } }[]
  }
).projects
const project = projects.find((p) => p.name === 'ai-team-hq')
if (project === undefined) {
  console.error('no ai-team-hq project: refusing')
  process.exit(1)
}
const now = project.targets?.production?.id ?? ''
console.log(`production currently points at ${now}; rolling back TO ${id}`)
const dep = await fetch(`https://api.vercel.com/v13/deployments/${id}`, { headers: auth })
const info = (await dep.json()) as { readyState?: string; target?: string | null; error?: unknown }
console.log(
  `  target deployment: http ${String(dep.status)}, state ${String(info.readyState)}, target ${String(info.target)}`,
)
if (!dep.ok || info.readyState !== 'READY' || info.target !== 'production') {
  console.error('refusing: the deployment is not a READY production deployment')
  process.exit(1)
}
if (now === id) {
  console.log('already live: nothing to do')
  process.exit(0)
}
if (!go) {
  console.log('dry run: nothing changed. Pass --go (with ALLOW_PRODUCTION_WRITES=1) to roll back.')
  process.exit(0)
}
await import('../../src/safety/require-production-writes.ts')
const { logWrite } = await import('./log.ts')
logWrite('rollback-attempt page', false)
const r = await fetch(
  `https://api.vercel.com/v1/projects/${project.id}/rollback/${id}?description=${encodeURIComponent('stabilisation rollback')}`,
  { method: 'POST', headers: auth },
)
console.log(`rollback request: http ${String(r.status)}`)
if (r.status !== 201) {
  console.error((await r.text()).slice(0, 300))
  process.exit(1)
}
await new Promise((res) => setTimeout(res, 4000))
const after = (
  (await (
    await fetch('https://api.vercel.com/v9/projects?limit=100', { headers: auth })
  ).json()) as {
    projects: { name: string; targets?: { production?: { id?: string } } }[]
  }
).projects.find((p) => p.name === 'ai-team-hq')
const live = after?.targets?.production?.id ?? ''
console.log(
  `production now points at ${live}: ${live === id ? 'MATCHES the rollback target' : 'DOES NOT MATCH yet (read again once, do not retry the write)'}`,
)
process.exit(live === id ? 0 : 1)
