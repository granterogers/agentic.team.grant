/**
 * Capture the edge functions that are deployed RIGHT NOW as restorable content (read-only).
 *
 *   ALLOW_PRODUCTION_CHECKS=1 npx tsx scripts/forensics/capture-functions.ts <out-dir> worker hq-api mcp ...
 *
 * Why: a deployed function has no reproducible source in Git (ADR-0067) and the platform cannot redeploy "version 972".
 * What it CAN give back is the bundle (`GET /functions/{slug}/body`, ESZIP2) whose modules are the sources that were
 * uploaded, AS THE PLATFORM STORES THEM: transpiled to JavaScript (types stripped), which is valid input to a deploy but is
 * not byte-equal to the repository's TypeScript, so "matches Git" is expected to read "nowhere" and says nothing about
 * correctness. This saves, per function, the raw bundle (for evidence), the extracted source tree (what a restore uploads),
 * the deploy settings (entrypoint, verify_jwt), a checksum of each file, and where Git agrees. Nothing is changed.
 *
 * Not captured, by design: function SECRETS (environment values the platform holds; they are not in the bundle and this
 * never asks for them). The sources are scanned for credential-shaped text and the run FAILS if any is found, so a
 * rollback directory cannot quietly become a place where a key is kept. The output belongs in a gitignored folder (`.out/`).
 */
import '../../src/safety/require-production-checks.ts'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { secretFamilies } from '../../src/text/secrets.ts'
import { readEszip } from '../lib/eszip.ts'

const ref = process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg'
const token = process.env.SUPABASE_ACCESS_TOKEN ?? ''
const [outDir, ...slugs] = process.argv.slice(2)
if (token === '' || outDir === undefined || slugs.length === 0) {
  console.error(
    'usage: capture-functions.ts <out-dir> <slug>...   (SUPABASE_ACCESS_TOKEN required)',
  )
  process.exit(2)
}
const api = `https://api.supabase.com/v1/projects/${ref}/functions`
const headers = { authorization: `Bearer ${token}` }
const sha256 = (b: Uint8Array | string): string => createHash('sha256').update(b).digest('hex')

/** Git agreement: does this exact content exist at HEAD, or in any commit of the file's history? */
const gitAgreement = (rel: string, content: Uint8Array): string => {
  const want = sha256(content)
  try {
    const head = execFileSync('git', ['show', `HEAD:${rel}`], {
      maxBuffer: 64e6,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    if (sha256(head) === want) return 'HEAD'
  } catch {
    /* no such file at HEAD */
  }
  try {
    const log = execFileSync('git', ['log', '--format=%h', '--', rel], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    for (const c of log.split('\n').filter(Boolean).slice(0, 300)) {
      try {
        const blob = execFileSync('git', ['show', `${c}:${rel}`], {
          maxBuffer: 64e6,
          stdio: ['ignore', 'pipe', 'ignore'],
        })
        if (sha256(blob) === want) return `history:${c}`
      } catch {
        /* path absent in that commit */
      }
    }
  } catch {
    /* not a git checkout */
  }
  return 'none'
}

const list = (await (await fetch(api, { headers })).json()) as {
  slug: string
  version: number
  status: string
  verify_jwt: boolean
  updated_at: number
}[]
let failed = false
const manifest: Record<string, unknown>[] = []
for (const slug of slugs) {
  const meta = list.find((f) => f.slug === slug)
  if (meta === undefined) {
    console.error(`${slug}: not deployed`)
    failed = true
    continue
  }
  const detail = (await (await fetch(`${api}/${slug}`, { headers })).json()) as {
    entrypoint_path?: string
    import_map?: boolean
  }
  const res = await fetch(`${api}/${slug}/body`, { headers })
  const bytes = new Uint8Array(await res.arrayBuffer())
  if (!res.ok) {
    console.error(`${slug}: body http ${String(res.status)}`)
    failed = true
    continue
  }
  const dir = join(outDir, `${slug}.v${String(meta.version)}`)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${slug}.v${String(meta.version)}.eszip`), bytes)
  const z = readEszip(bytes) // throws on a structure fault: an unreadable bundle is not a capture
  const files: Record<string, unknown>[] = []
  for (const m of z.modules) {
    if (m.kind !== 'module' || m.source === undefined || !m.specifier.startsWith('source/'))
      continue
    const rel = m.specifier.slice('source/'.length)
    // `authorization` and `long-opaque` are prose heuristics (a comment saying "bearer token" or quoting a filename) and fire
    // on ordinary source; they stay in the redactor for log text and are not evidence of a value here. Every other family
    // is a credential SHAPE and stops the capture.
    const families = secretFamilies(Buffer.from(m.source).toString('utf8')).filter(
      (f) => f !== 'authorization' && f !== 'long-opaque',
    )
    if (families.length > 0) {
      console.error(
        `${slug}: ${rel} carries credential-shaped text (${families.join(', ')}) - refusing to keep it`,
      )
      failed = true
      continue
    }
    const target = join(dir, 'source', rel)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, m.source)
    files.push({
      path: rel,
      bytes: m.source.length,
      sha256: sha256(m.source),
      git: gitAgreement(rel, m.source),
    })
  }
  const ep = detail.entrypoint_path ?? ''
  const entry = ep.includes('/source/') ? ep.slice(ep.indexOf('/source/') + '/source/'.length) : ep
  const row = {
    slug,
    version: meta.version,
    status: meta.status,
    deployed_at: new Date(meta.updated_at).toISOString(),
    verify_jwt: meta.verify_jwt,
    entrypoint: entry,
    bundle_sha256: sha256(bytes),
    bundle_bytes: bytes.length,
    npm_snapshot_bytes: z.npmSnapshotBytes,
    npm_redirects: z.modules
      .filter((m) => m.kind === 'redirect')
      .map((m) => `${m.specifier} -> ${m.target ?? ''}`),
    files,
  }
  writeFileSync(join(dir, 'RESTORE.json'), JSON.stringify(row, null, 2))
  manifest.push(row)
  const agree = (k: string) => files.filter((f) => String(f.git).startsWith(k)).length
  console.log(
    `${slug} v${String(meta.version)}: ${String(files.length)} source file(s), bundle ${String(bytes.length)} bytes, ` +
      `entry ${entry}, verify_jwt ${String(meta.verify_jwt)}, git: ${String(agree('HEAD'))} at HEAD / ${String(agree('history'))} in history / ${String(agree('none'))} nowhere`,
  )
}
writeFileSync(join(outDir, 'MANIFEST.json'), JSON.stringify(manifest, null, 2))
if (failed) process.exit(1)
