/**
 * Create ONE Vercel PREVIEW deployment of the Team HQ page, to test a candidate before production sees it.
 *
 *   npx tsx scripts/deploy/hq-page-preview.ts                                       # what it would do; creates nothing
 *   npx tsx scripts/deploy/hq-page-preview.ts --go --secret-file=<path outside the repo>
 *   npx tsx scripts/deploy/hq-page-preview.ts --compare=<dpl_id>                    # would this tree change that preview? never creates
 *
 * It builds the SAME file set as hq-page-delta.ts (scripts/deploy/lib/page-files.ts) and the same fingerprint, and differs in
 * exactly these ways, each asserted by tests/deploy/hq-page-preview.test.ts:
 *   - the request has NO `target`: Vercel makes a preview, which is never production and gets no production alias. Nothing here
 *     calls an alias, rollback, promote or delete endpoint.
 *   - the deployment carries its own throwaway NOTEBOOK_READER_SECRET (random per run, in the deployment's own `env`, never a
 *     project setting). It is written to --secret-file (mode 0600, refused inside the repository) so a test can authenticate, and it
 *     is never printed, logged or stored anywhere else. The real secret is not used.
 *   - `--compare=<id>` points the skip decision at that preview instead of at the production deployment, so "would an identical
 *     second deployment be skipped?" can be asked of the preview. Without --go nothing is ever created, so the comparison run
 *     cannot make a second preview even when the answer is "deploy".
 *
 * Like the production script it refuses when the generated web/studio/config.js is missing (run `npm run config:site`), and it
 * fails open: any doubt means "deploy", never "skip".
 */
import '../../src/safety/require-production-writes.ts'
import { randomBytes } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import {
  assessPageDeploy,
  deploymentMeta,
  makeVercelReader,
  type VercelReader,
} from './lib/page-deploy-guard.ts'
import { collectPageFiles, toUploadList } from './lib/page-files.ts'

const token = process.env.VERCEL_TOKEN ?? ''
if (token === '') {
  console.error('VERCEL_TOKEN is required')
  process.exit(2)
}
const arg = (name: string): string | undefined =>
  process.argv.find((a) => a.startsWith(`${name}=`))?.slice(name.length + 1)
const go = process.argv.includes('--go')
const compareWith = arg('--compare')
const secretFile = arg('--secret-file')
if (compareWith !== undefined && !/^dpl_[A-Za-z0-9]+$/.test(compareWith)) {
  console.error('--compare takes a deployment id (dpl_...)')
  process.exit(2)
}
if (go && compareWith !== undefined) {
  console.error('--go and --compare are exclusive: a comparison never creates anything')
  process.exit(2)
}
if (go) {
  if (secretFile === undefined || secretFile === '') {
    console.error(
      '--go needs --secret-file=<a path outside the repository> (for the throwaway secret)',
    )
    process.exit(2)
  }
  const rel = relative(resolve('.'), resolve(secretFile))
  if (!rel.startsWith('..') && !rel.startsWith('/')) {
    console.error('refusing: --secret-file is inside the repository')
    process.exit(2)
  }
}

const auth = { Authorization: `Bearer ${token}` }
const files = await collectPageFiles('.')
if (!files.has('config.js') || !files.has('studio/config.js')) {
  console.error(
    'web/studio/config.js is missing: run `npm run config:site` first. Nothing was compared or deployed.',
  )
  process.exit(2)
}
const list = toUploadList(files)
/** The non-file fields of the request. `target` is deliberately ABSENT from the request; the fingerprint names it 'preview'. */
const DEPLOYMENT = {
  name: 'ai-team-hq',
  target: 'preview',
  projectSettings: { framework: null },
} as const
console.log(
  `${String(list.length)} files, ${(list.reduce((n, f) => n + f.size, 0) / 1e6).toFixed(1)} MB (config.js included)`,
)

const real = makeVercelReader(token)
// --compare: answer "which deployment is live?" with the preview named, so the SAME assessment code decides skip or deploy.
const reader: VercelReader =
  compareWith === undefined
    ? real
    : {
        async get(path: string): Promise<unknown> {
          const reply = await real.get(path)
          if (path.startsWith('/v9/projects?') && typeof reply === 'object' && reply !== null) {
            const projects = (reply as { projects?: unknown[] }).projects
            if (Array.isArray(projects))
              for (const p of projects)
                if (
                  typeof p === 'object' &&
                  p !== null &&
                  (p as { name?: string }).name === DEPLOYMENT.name
                )
                  (p as { targets?: unknown }).targets = { production: { id: compareWith } }
          }
          return reply
        },
      }

const projects = (await real.get('/v9/projects?limit=100')) as {
  projects: { id: string; name: string; targets?: { production?: { id?: string } } }[]
}
const project = projects.projects.find((p) => p.name === DEPLOYMENT.name)
if (project === undefined) throw new Error('no ai-team-hq project')
const productionId = project.targets?.production?.id ?? ''
console.log(`production deployment (never touched by this script): ${productionId}`)

const assessment = await assessPageDeploy(reader, {
  projectName: DEPLOYMENT.name,
  deployment: DEPLOYMENT,
  supplied: {},
  force: compareWith === undefined,
})
console.log(
  `fingerprint: ${assessment.fingerprint === null ? 'not computed' : assessment.fingerprint.slice(0, 16)}; ` +
    `${assessment.decision.skip ? 'SKIP' : 'deploy'} (${assessment.decision.reason})`,
)
if (compareWith !== undefined) {
  console.log(
    assessment.decision.skip
      ? `SKIP: nothing to deploy; ${compareWith} was built from exactly these inputs. No deployment was created.`
      : `would deploy: ${assessment.decision.reason}. This was a comparison, so nothing was created.`,
  )
  process.exit(0)
}
if (!go) {
  console.log(
    'dry run: nothing created. A real run creates one PREVIEW (no target; production is not touched).',
  )
  process.exit(0)
}

// ---- the one write: a preview ---------------------------------------------------------------------------------------------
const secret = randomBytes(24).toString('hex')
writeFileSync(secretFile as string, secret, { mode: 0o600 })
const body = {
  name: DEPLOYMENT.name,
  files: list,
  projectSettings: DEPLOYMENT.projectSettings,
  env: { NOTEBOOK_READER_SECRET: secret },
  meta: {
    gitCommitSha: process.env.DEPLOY_SOURCE_SHA ?? 'unknown',
    deployedBy: 'deploy:hq-page-preview',
    ...(deploymentMeta(assessment).meta ?? {}),
  },
}
const create = async (): Promise<Response> =>
  fetch('https://api.vercel.com/v13/deployments?skipAutoDetectionConfirmation=1', {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
let response = await create()
for (let round = 0; round < 3 && response.status === 400; round += 1) {
  const err = (await response.clone().json()) as { error?: { code?: string; missing?: string[] } }
  if (err.error?.code !== 'missing_files') break
  const missing = new Set(err.error.missing ?? [])
  const bodies = new Map(list.map((f) => [f.sha, files.get(f.file) as Buffer]))
  console.log(`uploading ${String(missing.size)} file(s) Vercel does not hold`)
  for (const s of missing) {
    const content = bodies.get(s)
    if (content === undefined) continue
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const up = await fetch('https://api.vercel.com/v2/files', {
        method: 'POST',
        headers: {
          ...auth,
          'Content-Type': 'application/octet-stream',
          'x-vercel-digest': s,
          'Content-Length': String(content.length),
        },
        body: content,
      })
      if (up.ok) break
      if (attempt === 4) throw new Error(`upload of ${s} failed: http ${String(up.status)}`)
      await new Promise((r) => setTimeout(r, 1500 * attempt))
    }
  }
  response = await create()
}
const dep = (await response.json()) as {
  id?: string
  url?: string
  target?: string | null
  error?: { message?: string }
}
if (!response.ok) {
  console.error(
    `create failed: http ${String(response.status)} ${JSON.stringify(dep.error ?? {}).slice(0, 300)}`,
  )
  process.exit(1)
}
console.log(`PREVIEW_ID=${String(dep.id)}`)
console.log(`PREVIEW_URL=https://${String(dep.url)}`)
console.log(`target on creation: ${JSON.stringify(dep.target ?? null)} (null is a preview)`)
if (dep.target === 'production') {
  console.error('STOP: Vercel says this deployment is PRODUCTION. Not touching it; report it.')
  process.exit(1)
}
let state = 'BUILDING'
const started = Date.now()
while (
  state !== 'READY' &&
  state !== 'ERROR' &&
  state !== 'CANCELED' &&
  Date.now() - started < 420_000
) {
  await new Promise((r) => setTimeout(r, 6000))
  const d = (await (
    await fetch(`https://api.vercel.com/v13/deployments/${String(dep.id)}`, { headers: auth })
  ).json()) as { readyState?: string }
  state = String(d.readyState ?? 'UNKNOWN')
}
console.log(`state: ${state}`)
process.exit(state === 'READY' ? 0 : 1)
