/**
 * READ-ONLY: read the live Vercel inventory and write the two FROZEN, hashed retention files.
 *
 *   ALLOW_PRODUCTION_CHECKS=1 npx tsx scripts/vercel/vercel-retention-freeze.ts \
 *       --rollback=dpl_<previous known-good production> --validation=dpl_<validation preview>[,dpl_...] \
 *       [--keep=dpl_a,dpl_b] [--out-dir=<directory outside the repository>]
 *
 * Writes proposal.json (what may be deleted, with every safety check each candidate passed), keep.json (what is kept and why),
 * stages.json (the proposed order) and SHA256SUMS. It sends only GET requests: its client refuses any other method. It never
 * deletes, aliases, deploys or touches Supabase. The files are NOT to be committed: a tracked file that names a deployment
 * protects it (that is a rule of the proposal itself), so committing the candidate list would protect every candidate.
 *
 * The deletion tool (vercel-retention-delete.ts) accepts ONLY the exact proposal whose sha256 a person approved, and refuses if
 * the live inventory has changed since this ran.
 */
import '../../src/safety/require-production-checks.ts'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  buildFreeze,
  collectReferencedIds,
  planStages,
  type RowFacts,
  verifyProposal,
} from '../deploy/lib/retention-freeze.ts'
import { canonicalText, sha256 } from '../deploy/lib/retention-hash.ts'
import { type HttpClient, readBytes, readLive } from '../deploy/lib/vercel-live-read.ts'

const token = process.env.VERCEL_TOKEN ?? ''
if (token === '') {
  console.error('VERCEL_TOKEN is required')
  process.exit(2)
}
const arg = (name: string): string | undefined =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)
const list = (s: string | undefined): string[] => (s ?? '').split(',').filter((x) => x !== '')
const rollbackId = arg('rollback') ?? ''
const validationIds = list(arg('validation'))
if (!/^dpl_[A-Za-z0-9]+$/.test(rollbackId) || validationIds.length === 0) {
  console.error(
    '--rollback=dpl_... and --validation=dpl_... are required: they are protected by name',
  )
  process.exit(2)
}
const outDir =
  arg('out-dir') ?? join('.out', 'vercel-retention', new Date().toISOString().replace(/[:.]/g, '-'))

/** A client that can only read. There is no other method to call. */
const client: HttpClient = {
  async request(method, path) {
    if (method !== 'GET') throw new Error(`this script only reads; refused ${method}`)
    for (let attempt = 1; ; attempt += 1) {
      try {
        const res = await fetch(`https://api.vercel.com${path}`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(30_000),
        })
        const text = await res.text()
        let body: unknown = null
        try {
          body = JSON.parse(text)
        } catch {
          /* a non-JSON body is reported by its status */
        }
        return { status: res.status, body }
      } catch (e) {
        // A cut-off transfer is not an answer; a read is safe to repeat.
        if (attempt >= 4) throw e
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt))
      }
    }
  },
}

const now = Date.now()
const live = await readLive(client, { teamSlug: 'agentic-team-grant', projectName: 'ai-team-hq' })
console.log(
  `live inventory: ${String(live.rows.length)} deployments; production ${live.productionId}`,
)

const rows: RowFacts[] = []
for (let i = 0; i < live.rows.length; i += 4) {
  const batch = live.rows.slice(i, i + 4)
  const sizes = await Promise.all(
    batch.map((r) =>
      readBytes(client, live.teamId, r.id).then(
        (s) => ({ ok: true as const, ...s }),
        () => ({ ok: false as const, bundles: 0, bytes: 0 }),
      ),
    ),
  )
  batch.forEach((r, k) => {
    const s = sizes[k] as (typeof sizes)[number]
    rows.push({
      id: r.id,
      created: r.created,
      target: r.target,
      state: r.state,
      aliases: r.aliases,
      metaKeys: r.metaKeys,
      metaSha: r.metaSha,
      bytes: s.bytes,
      bundles: s.bundles,
      bytesKnown: s.ok,
    })
  })
}

// Every id named in a tracked repository file, docs/performance and code included, except the one list that is itself an inventory.
let grep = ''
try {
  grep = execFileSync('git', ['grep', '-o', '-E', 'dpl_[A-Za-z0-9]{20,}', '--', '.'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })
} catch {
  /* exit 1 = nothing found */
}
const refs = collectReferencedIds(grep)

const { proposal, keep, proposalText, keepText } = buildFreeze({
  now,
  teamId: live.teamId,
  project: live.project,
  production: { id: live.productionId, aliases: live.aliasPairs },
  rollbackId,
  validationIds,
  rows,
  referencedIds: refs.ids,
  extraKeep: list(arg('keep')),
})
// The deletion tool re-verifies all of this; check it here too, so a bad freeze is never written.
verifyProposal(proposalText, keepText, sha256(proposalText))
const stages = planStages(proposal, keep)
const stagesText = canonicalText(stages)

mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, 'proposal.json'), proposalText)
writeFileSync(join(outDir, 'keep.json'), keepText)
writeFileSync(join(outDir, 'stages.json'), stagesText)
const sums = `${sha256(proposalText)}  proposal.json\n${sha256(keepText)}  keep.json\n${sha256(stagesText)}  stages.json\n`
writeFileSync(join(outDir, 'SHA256SUMS'), sums)

const gib = (n: number): string => (n / 2 ** 30).toFixed(3)
const t = proposal.totals
console.log(`generated ${proposal.generatedAt}; frozen files in ${outDir}`)
console.log(`inventory ${String(t.inventory.deployments)} / ${gib(t.inventory.bytes)} GiB`)
console.log(`KEEP      ${String(t.keep.deployments)} / ${gib(t.keep.bytes)} GiB`)
console.log(`DELETE    ${String(t.delete.deployments)} candidates / ${gib(t.delete.bytes)} GiB`)
console.log(
  `tracked files naming deployments: ${String(refs.ids.length)} ids (inventory list excluded: ${String(refs.byFile.size)} other files)`,
)
console.log(
  `stage 1: ${String(stages.stage1.length)} deployments; later batches: ${stages.later.map((b) => String(b.length)).join(', ')}`,
)
console.log(sums.trim())
console.log('read-only: nothing was deleted, promoted, aliased or deployed')
