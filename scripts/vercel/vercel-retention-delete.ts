/**
 * Delete SPECIFIC Vercel deployments named in a FROZEN, hashed retention proposal. THE ONLY DESTRUCTIVE TOOL IN THE RETENTION
 * WORK. It is not to be run without a person approving the exact proposal hash and the exact ids.
 *
 *   ALLOW_PRODUCTION_CHECKS=1 ALLOW_PRODUCTION_WRITES=1 npx tsx scripts/vercel/vercel-retention-delete.ts \
 *       --proposal=<dir>/proposal.json --sha256=<the approved hash> --ids=dpl_a,dpl_b            # dry run: every check, no DELETE
 *   ... same, plus --go                                                                         # deletes, one at a time
 *
 * Dry run is the default; --go is required to send a single DELETE. At most 25 ids per run, each an exact id that the hashed
 * proposal lists as a candidate. All the logic is in scripts/deploy/lib/retention-delete.ts (tested against a fake Vercel,
 * with sabotage); this file only wires the real HTTP client, the log file and `git grep`.
 *
 * It never touches Supabase, aliases, project settings or deployments' contents, and never deploys. A failure of any kind
 * ends the run: nothing after it is attempted and nothing is retried.
 */
import '../../src/safety/require-production-writes.ts'
import { execFileSync } from 'node:child_process'
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, writeSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  type LogEntry,
  MAX_AGE_MS,
  MAX_PER_RUN,
  Refused,
  runDeletion,
} from '../deploy/lib/retention-delete.ts'
import { INVENTORY_LISTS_NOT_REFERENCES } from '../deploy/lib/retention-freeze.ts'
import type { HttpClient } from '../deploy/lib/vercel-live-read.ts'

const token = process.env.VERCEL_TOKEN ?? ''
if (token === '') {
  console.error('VERCEL_TOKEN is required')
  process.exit(2)
}
const arg = (name: string): string | undefined =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)
const proposalPath = arg('proposal') ?? ''
const sha = (arg('sha256') ?? '').toLowerCase()
const ids = (arg('ids') ?? '').split(',').filter((s) => s !== '')
const go = process.argv.includes('--go')
if (proposalPath === '' || !/^[0-9a-f]{64}$/.test(sha) || ids.length === 0) {
  console.error('usage: --proposal=<proposal.json> --sha256=<64 hex> --ids=dpl_...,dpl_... [--go]')
  process.exit(2)
}
const maxAgeMin = arg('max-age-minutes')
const maxAgeMs = maxAgeMin === undefined ? MAX_AGE_MS : Number(maxAgeMin) * 60_000
if (!Number.isFinite(maxAgeMs) || maxAgeMs <= 0) {
  console.error('--max-age-minutes must be a positive number (and can only shorten the limit)')
  process.exit(2)
}
const keepPath = arg('keep-file') ?? join(dirname(proposalPath), 'keep.json')
const proposalText = readFileSync(proposalPath, 'utf8')
const keepText = readFileSync(keepPath, 'utf8')

const client: HttpClient = {
  async request(method, path) {
    // One attempt, always. A DELETE that does not answer is AMBIGUOUS and the run stops; this client never repeats anything.
    const res = await fetch(`https://api.vercel.com${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30_000),
    })
    const text = await res.text()
    let body: unknown = null
    try {
      body = JSON.parse(text)
    } catch {
      /* reported by status */
    }
    return { status: res.status, body }
  },
}

const logDir = join(dirname(proposalPath), '..')
mkdirSync(logDir, { recursive: true })
const logPath = join(logDir, 'delete-log.jsonl')
/** Append and flush to disk before returning: an attempt that was not recorded must not be sent. */
const log = (e: LogEntry): void => {
  const fd = openSync(logPath, 'a')
  try {
    writeSync(fd, `${JSON.stringify(e)}\n`)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}
const referencedNow = (id: string): number => {
  try {
    const out = execFileSync(
      'git',
      ['grep', '-l', '-F', id, '--', '.', ...INVENTORY_LISTS_NOT_REFERENCES.map((f) => `:!${f}`)],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    )
    return out.split('\n').filter((l) => l !== '').length
  } catch {
    return 0 // git grep exits 1 when nothing names it
  }
}

console.log(
  `${go ? 'DELETING' : 'DRY RUN (no --go): checking'} ${String(ids.length)} deployment(s) of at most ${String(MAX_PER_RUN)}; log ${logPath}`,
)
try {
  const r = await runDeletion({
    client,
    proposalText,
    keepText,
    expectedSha256: sha,
    ids,
    go,
    now: Date.now(),
    maxAgeMs,
    log,
    referencedNow,
    runId: `run-${new Date().toISOString().replace(/[:.]/g, '-')}`,
  })
  console.log(
    `deleted: ${String(r.deleted.length)}  would delete: ${String(r.wouldDelete.length)}  reclaimed: ${(r.reclaimedBytes / 2 ** 20).toFixed(1)} MiB`,
  )
  if (r.stopped !== null) {
    console.error(`STOPPED at ${r.stopped.id}: ${r.stopped.code}: ${r.stopped.detail}`)
    process.exit(1)
  }
  console.log(go ? 'done; nothing else was attempted' : 'dry run complete: nothing was sent')
} catch (e) {
  if (e instanceof Refused) {
    console.error(`REFUSED (${e.code}): ${e.message}\nNothing was deleted.`)
    process.exit(1)
  }
  throw e
}
