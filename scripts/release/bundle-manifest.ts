/**
 * Which services does a release have to deploy? Computed from the code, never from a list somebody wrote.
 *
 *   npm run release:services                      # the manifest of this checkout (service -> file -> digest), as JSON
 *   npm run release:services -- --against 9310116 # what changed since that commit, per service
 *
 * It lives beside the deploy scripts, not in them: every file in `scripts/deploy/` is asserted to write to production and to
 * carry the gate, and this one only reads. It uses the SAME import walker the deploy scripts upload with
 * (`scripts/deploy/lib/bundle.ts`) and the SAME hand-kept lists the flat
 * uploads use (`lib/hq-api-files.ts` and the file lists named in each `deploy:*` script), so "this service's bundle is
 * byte-identical to the deployed commit's" means "redeploying it would upload nothing new". It reads files and runs `git`
 * on a throwaway worktree; it contacts no network and no database, so it carries no production gate.
 *
 * What it cannot say: whether production is RUNNING the commit named. A service the deployment record lists as "not
 * redeployed" may hold older code than that commit, and only a capture of the live bundle (`npm run capture:functions`, a
 * production read) can settle it.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { bundlePath, walk } from '../deploy/lib/bundle.ts'
import { HQ_API_FILES } from '../deploy/lib/hq-api-files.ts'

export type Manifest = Record<string, Record<string, string>>

/** Services uploaded as an import graph from one entrypoint (`deploy:worker`, `deploy:voice`, `deploy:signin`, `deploy:mcp`). */
export const GRAPH_SERVICES: Readonly<Record<string, string>> = {
  worker: 'supabase/functions/worker/index.ts',
  voice: 'supabase/functions/voice/index.ts',
  'voice-token': 'supabase/functions/voice-token/index.ts',
  signin: 'supabase/functions/signin/index.ts',
  mcp: 'supabase/functions/mcp/index.ts',
}

/** Services uploaded as a hand-listed flat set, exactly as their deploy scripts list them. */
export const LISTED_SERVICES: Readonly<Record<string, readonly string[]>> = {
  'hq-api': HQ_API_FILES.map((f) => f.from),
  'telegram-webhook': ['supabase/functions/telegram-webhook/index.ts', 'src/channels/telegram.ts'],
  'slack-events': [
    'supabase/functions/slack-events/index.ts',
    'src/slack/events.ts',
    'src/slack/interactions.ts',
    'src/slack/signature.ts',
  ],
  'slack-oauth': ['supabase/functions/slack-oauth/index.ts', 'src/slack/oauth.ts'],
  'google-oauth': ['supabase/functions/google-oauth/index.ts'],
}

/** The Team HQ page is every tracked file `deploy:hq-page` sends (config.js is generated and untracked, so it is not here). */
const PAGE_ROOTS = ['web/studio', 'api', 'scripts/notebook', 'requirements.txt', 'vercel.json']

const digest = (s: string | Buffer): string =>
  createHash('sha256').update(s).digest('hex').slice(0, 12)

/** The manifest of the checkout in the current directory. */
export const manifestHere = async (): Promise<Manifest> => {
  const out: Manifest = {}
  for (const [slug, entry] of Object.entries(GRAPH_SERVICES)) {
    out[slug] = {}
    for (const [abs, source] of await walk(entry)) out[slug][bundlePath(abs)] = digest(source)
  }
  for (const [slug, files] of Object.entries(LISTED_SERVICES)) {
    out[slug] = {}
    // A file the list names today may not exist at an older baseline (hq-api gained background.ts's source after 9310116):
    // absent there means ADDED here, so it is simply left out of that side's manifest.
    for (const f of files) if (existsSync(f)) out[slug][f] = digest(readFileSync(f))
  }
  out.page = {}
  const tracked = execFileSync('git', ['ls-files', ...PAGE_ROOTS], { encoding: 'utf8' })
    .split('\n')
    .filter((f) => f !== '')
  for (const f of tracked) out.page[f] = digest(readFileSync(f))
  return out
}

export type ServiceDiff = {
  service: string
  files: number
  changed: string[]
  added: string[]
  removed: string[]
  deploy: boolean
}

/** Pure: what differs, per service, between a deployed manifest and a candidate one. */
export const diffManifests = (deployed: Manifest, candidate: Manifest): ServiceDiff[] =>
  Object.keys(candidate).map((service) => {
    const a = deployed[service] ?? {}
    const b = candidate[service] ?? {}
    const names = new Set([...Object.keys(a), ...Object.keys(b)])
    const changed: string[] = []
    const added: string[] = []
    const removed: string[] = []
    for (const f of [...names].sort()) {
      if (!(f in a)) added.push(f)
      else if (!(f in b)) removed.push(f)
      else if (a[f] !== b[f]) changed.push(f)
    }
    return {
      service,
      files: Object.keys(b).length,
      changed,
      added,
      removed,
      deploy: changed.length + added.length + removed.length > 0,
    }
  })

/** The manifest of another commit, read from a throwaway worktree that is always removed. */
const manifestAt = async (ref: string): Promise<Manifest> => {
  const here = process.cwd()
  const dir = mkdtempSync(path.join(tmpdir(), 'release-services-'))
  execFileSync('git', ['worktree', 'add', '--detach', dir, ref], { stdio: 'ignore' })
  try {
    process.chdir(dir)
    return await manifestHere()
  } finally {
    process.chdir(here)
    execFileSync('git', ['worktree', 'remove', '--force', dir], { stdio: 'ignore' })
    rmSync(dir, { recursive: true, force: true })
  }
}

if (process.argv[1]?.endsWith('bundle-manifest.ts')) {
  const against = process.argv.includes('--against')
    ? (process.argv[process.argv.indexOf('--against') + 1] ?? '')
    : ''
  const candidate = await manifestHere()
  if (against === '') {
    console.log(JSON.stringify(candidate, null, 2))
  } else {
    const deployed = await manifestAt(against)
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
    console.log(`candidate ${head} against ${against}`)
    for (const d of diffManifests(deployed, candidate)) {
      const detail =
        d.changed.length + d.added.length + d.removed.length <= 8
          ? [
              ...d.changed.map((f) => `~ ${f}`),
              ...d.added.map((f) => `+ ${f}`),
              ...d.removed.map((f) => `- ${f}`),
            ].join('; ')
          : `${String(d.changed.length)} changed, ${String(d.added.length)} added, ${String(d.removed.length)} removed`
      console.log(
        `${d.deploy ? 'DEPLOY   ' : 'unchanged'} ${d.service.padEnd(17)} ${String(d.files).padStart(3)} files  ${detail}`,
      )
    }
  }
}
