/**
 * Deploy the Team HQ PAGE alone, uploading only what changed.
 *
 *   npx tsx scripts/deploy/hq-page-delta.ts          # compare with production, change nothing
 *   npx tsx scripts/deploy/hq-page-delta.ts --go     # deploy
 *
 * `deploy:hq` sends every file inline in one request body and now exceeds Vercel's 10 MB limit
 * (the studio is served twice, at `/` and `/studio/`), so its page step fails after its function
 * step succeeds. This builds the SAME file set with the same rules, sends digests instead of
 * bodies, and uploads only the files Vercel says it does not hold - the method the #382 cutover
 * used by hand. It never touches a function, a secret, an env var or a project setting.
 *
 * It refuses to deploy when its file NAMES differ from the live deployment's, because a
 * different set is a different page. The previous deployment is printed as the rollback point.
 *
 * It also fingerprints every input (lib/page-fingerprint.ts) and compares it with the one recorded on the live production
 * deployment (`meta.pageFingerprint`). It skips ONLY when that deployment is READY and recorded exactly this fingerprint;
 * no recorded fingerprint, any error reading Vercel, a changed input or `--force` all deploy. The first deploy after this
 * was added therefore deploys, and records the fingerprint. Run `npm run config:site` first (its output is an input).
 */
import '../../src/safety/require-production-writes.ts'
import { assessPageDeploy, deploymentMeta, makeVercelReader } from './lib/page-deploy-guard.ts'
import { collectPageFiles, toUploadList } from './lib/page-files.ts'

const token = process.env.VERCEL_TOKEN ?? ''
if (token === '') {
  console.error('VERCEL_TOKEN is required')
  process.exit(2)
}
const go = process.argv.includes('--go')
// --force: deploy even when every input matches the live deployment (a platform incident, a suspect deployment).
const force = process.argv.includes('--force')
const auth = { Authorization: `Bearer ${token}` }

// The upload set is defined once, in lib/page-files.ts, and the fingerprint below is computed over exactly these bytes.
// Run `npm run config:site` first: the generated web/studio/config.js is part of what is uploaded and so of the fingerprint.
const files = await collectPageFiles('.')
// The generated config.js tells the page which office to ask. It is gitignored, so a fresh checkout does not have it, and a page
// deployed without it points at no office (backend.js answers an empty address). Refuse before anything is compared or sent.
if (!files.has('config.js') || !files.has('studio/config.js')) {
  console.error(
    'web/studio/config.js is missing: run `npm run config:site` first. Nothing was compared or deployed.',
  )
  process.exit(2)
}
const list = toUploadList(files)
/** The non-file fields of the deployment request. The request and the fingerprint both read these, so they cannot differ. */
const DEPLOYMENT = {
  name: 'ai-team-hq',
  target: 'production',
  projectSettings: { framework: null },
} as const
console.log(
  `${String(list.length)} files, ${(list.reduce((n, f) => n + f.size, 0) / 1e6).toFixed(1)} MB`,
)

const project = (
  (await (
    await fetch('https://api.vercel.com/v9/projects?limit=100', { headers: auth })
  ).json()) as {
    projects: { id: string; name: string; targets?: { production?: { id?: string } } }[]
  }
).projects.find((p) => p.name === 'ai-team-hq')
if (project === undefined) throw new Error('no ai-team-hq project')
const liveId = project.targets?.production?.id ?? ''
console.log(`live deployment (the rollback point): ${liveId}`)

type Node = { name: string; type: string; children?: Node[] }
const flat = (nodes: Node[], prefix = ''): string[] =>
  nodes.flatMap((n) =>
    n.type === 'directory' ? flat(n.children ?? [], `${prefix}${n.name}/`) : [`${prefix}${n.name}`],
  )
const liveTree = (await (
  await fetch(`https://api.vercel.com/v6/deployments/${liveId}/files`, { headers: auth })
).json()) as Node[]
// The listing roots every uploaded file under a top-level src/ directory.
const live = new Set(flat(liveTree).map((f) => f.replace(/^src\//, '')))
const mine = new Set(list.map((f) => f.file))
const onlyMine = [...mine].filter((f) => !live.has(f))
const onlyLive = [...live].filter((f) => !mine.has(f))
console.log(
  `names only here: ${JSON.stringify(onlyMine)}  names only live: ${JSON.stringify(onlyLive.slice(0, 8))}${onlyLive.length > 8 ? ` (+${String(onlyLive.length - 8)})` : ''}`,
)
if (onlyMine.length > 0 || onlyLive.length > 0) {
  // Vercel lists the serverless functions' sources and build outputs differently; only refuse on
  // something the page itself would gain or lose.
  const pageLoss = onlyLive.filter((f) => !f.startsWith('.') && !f.startsWith('out/'))
  // A file the change is MEANT to add is named on the command line, exactly: --allow-new=a.js,b.js. Anything else
  // gained or lost still refuses, so an accidental file set is not deployed.
  const allowed = new Set(
    (process.argv.find((a) => a.startsWith('--allow-new='))?.slice('--allow-new='.length) ?? '')
      .split(',')
      .filter((f) => f !== ''),
  )
  const unexpected = onlyMine.filter((f) => !allowed.has(f))
  if (unexpected.length > 0 || pageLoss.length > 0) {
    console.error('the file set differs from the live page; not deploying')
    process.exit(1)
  }
}

// Would this deployment change anything? Read-only GETs; fails open (any doubt means deploy).
const assessment = await assessPageDeploy(makeVercelReader(token), {
  projectName: 'ai-team-hq',
  deployment: DEPLOYMENT,
  supplied: {}, // this script supplies no environment value
  force,
})
console.log(
  `fingerprint: ${assessment.fingerprint === null ? 'not computed' : assessment.fingerprint.slice(0, 16)}; ` +
    `${assessment.decision.skip ? 'SKIP' : 'deploy'} (${assessment.decision.reason})`,
)
if (assessment.unpinned.length > 0)
  console.log(
    `requirements.txt has unpinned dependencies (a new release is not an input here): ${assessment.unpinned.join(', ')}`,
  )
if (!go) {
  console.log('dry run: nothing deployed')
  console.log(
    `rollback point if this is deployed: ${liveId} (scripts/rollout/page-rollback.ts ${liveId} --go)`,
  )
  process.exit(0)
}
if (assessment.decision.skip) {
  console.log(
    'nothing to deploy: the live production deployment was built from exactly these inputs',
  )
  console.log('pass --force to deploy anyway')
  process.exit(0)
}
// A deploy is a production WRITE: it is recorded in the write log the rollout gate reads, before anything is uploaded.
{
  const { logWrite } = await import('../rollout/log.ts')
  logWrite('deploy-attempt page', false)
}

const create = async () =>
  fetch('https://api.vercel.com/v13/deployments', {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: DEPLOYMENT.name,
      target: DEPLOYMENT.target,
      files: list,
      projectSettings: DEPLOYMENT.projectSettings,
      // The page fingerprint (what makes an unchanged redeploy skippable) and, from the provenance check in
      // require-production-writes.ts, the commit this page was built from. Neither is an input to the fingerprint.
      ...deploymentMeta(assessment),
      // When the commit is known, the same `meta` carries it AND the fingerprint (this later spread replaces the one above).
      ...(process.env.DEPLOY_SOURCE_SHA === undefined
        ? {}
        : {
            meta: {
              gitCommitSha: process.env.DEPLOY_SOURCE_SHA,
              deployedBy: 'deploy:hq-page',
              ...(deploymentMeta(assessment).meta ?? {}),
            },
          }),
    }),
  })
let response = await create()
for (let round = 0; round < 3 && response.status === 400; round += 1) {
  const err = (await response.clone().json()) as { error?: { code?: string; missing?: string[] } }
  if (err.error?.code !== 'missing_files') break
  const missing = new Set(err.error.missing ?? [])
  const bodies = new Map(list.map((f) => [f.sha, files.get(f.file) as Buffer]))
  console.log(`uploading ${String(missing.size)} file(s) Vercel does not hold`)
  for (const s of missing) {
    const body = bodies.get(s)
    if (body === undefined) continue
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const up = await fetch('https://api.vercel.com/v2/files', {
        method: 'POST',
        headers: {
          ...auth,
          'Content-Type': 'application/octet-stream',
          'x-vercel-digest': s,
          'Content-Length': String(body.length),
        },
        body,
      })
      if (up.ok) break
      if (attempt === 4) throw new Error(`upload of ${s} failed: http ${String(up.status)}`)
      await new Promise((r) => setTimeout(r, 1500 * attempt))
    }
  }
  response = await create()
}
const dep = (await response.json()) as { id?: string; url?: string; error?: { message?: string } }
if (!response.ok) {
  console.error(`deploy failed: ${JSON.stringify(dep.error ?? dep).slice(0, 300)}`)
  process.exit(1)
}
console.log(`deployment ${String(dep.id)} created`)
let state = 'BUILDING'
const started = Date.now()
while (state !== 'READY' && state !== 'ERROR' && Date.now() - started < 300_000) {
  await new Promise((r) => setTimeout(r, 5000))
  state = String(
    (
      (await (
        await fetch(`https://api.vercel.com/v13/deployments/${String(dep.id)}`, { headers: auth })
      ).json()) as { readyState?: string }
    ).readyState ?? 'UNKNOWN',
  )
}
console.log(`build: ${state}`)
if (state !== 'READY') process.exit(1)
const served = await (await fetch(`https://${String(dep.url)}/app.js`)).text()
console.log(`serves the new page: ${String(served.includes('settings-ui.js'))}`)
console.log(`rollback: promote ${liveId}`)
