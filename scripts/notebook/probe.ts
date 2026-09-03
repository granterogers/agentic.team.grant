/**
 * Run the Python probe against the vaulted credential and record the result.
 *
 *   npm run notebook:probe
 *
 * The credential is passed to the child process through the environment, not
 * as an argument: arguments appear in `ps` output for every user on the box,
 * and this one is a Google session.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { ManagementApiExecutor } from '../../src/db/executor.ts'
import type { CapabilityState } from '../../src/notebook/adapter.ts'
import { recordProbe } from '../../src/notebook/sync-queue.ts'

const run = promisify(execFile)

const token = process.env.SUPABASE_ACCESS_TOKEN
if (token === undefined || token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}

const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  token,
)

const vaulted = await db.execute(
  `select decrypted_secret as v from vault.decrypted_secrets where name = 'notebook.storage_state'`,
)
const storageState = vaulted.rows[0]?.v === undefined ? '' : String(vaulted.rows[0].v)
if (storageState === '') {
  console.error(
    'no notebook.storage_state in the vault - run `npm run notebook:import` first.\n' +
      'See docs/poc/gate-2-notebook/01-what-grant-does.md',
  )
  process.exit(1)
}

interface ProbeOutput {
  state: string
  capabilities?: string[]
  adapter_version?: string | null
  detected_tier?: number | null
  notebook_limit?: number | null
  source_limit?: number | null
  notebook_count?: number
  account?: string | null
  detail?: string
  latency_ms?: number | null
}

let output: ProbeOutput
try {
  const { stdout } = await run('python3', ['scripts/notebook/probe.py'], {
    // Through the environment, not argv: argv is world-readable in `ps`.
    env: { ...process.env, NOTEBOOK_STORAGE_STATE: storageState },
    maxBuffer: 8 * 1024 * 1024,
    timeout: 120_000,
  })
  // The probe contracts to print exactly one JSON object and nothing else, so
  // the last non-empty line is it even if a library logs to stdout anyway.
  const lines = stdout
    .trim()
    .split('\n')
    .filter((l) => l.trim() !== '')
  output = JSON.parse(String(lines[lines.length - 1])) as ProbeOutput
} catch (error) {
  // The probe itself failing is different from Notebook being unavailable, and
  // conflating them would report a broken environment as a broken dependency.
  const message = (error as Error).message
  console.error(`the probe could not run: ${message.slice(0, 300)}`)
  await recordProbe(db, {
    state: 'unavailable',
    capabilities: [],
    adapter: 'notebooklm-py',
    adapterVersion: null,
    detectedTier: null,
    notebookLimit: null,
    sourceLimit: null,
    detail: `the probe process failed: ${message.slice(0, 200)}`,
    latencyMs: null,
  })
  process.exit(1)
}

const VALID: readonly CapabilityState[] = [
  'available',
  'available_unofficial',
  'degraded',
  'unavailable',
  'auth_required',
]
if (!VALID.includes(output.state as CapabilityState)) {
  console.error(`the probe reported an unknown state: ${output.state}`)
  process.exit(1)
}

await recordProbe(db, {
  state: output.state as CapabilityState,
  capabilities: output.capabilities ?? [],
  adapter: 'notebooklm-py',
  adapterVersion: output.adapter_version ?? null,
  detectedTier: output.detected_tier ?? null,
  notebookLimit: output.notebook_limit ?? null,
  sourceLimit: output.source_limit ?? null,
  detail: (output.detail ?? '').slice(0, 500),
  latencyMs: output.latency_ms ?? null,
})

console.log(`state:        ${output.state}`)
console.log(`capabilities: ${(output.capabilities ?? []).join(', ') || 'none'}`)
console.log(`account:      ${output.account ?? 'unknown'}`)
console.log(`notebooks:    ${String(output.notebook_count ?? 0)}`)
console.log(
  `limits:       tier=${String(output.detected_tier)} notebooks=${String(output.notebook_limit)} sources=${String(output.source_limit)}`,
)
console.log(`latency:      ${String(output.latency_ms)}ms`)
console.log(`detail:       ${output.detail ?? ''}`)

if (output.state === 'available_unofficial') {
  console.log('\n✅ the credential works. Gate 2 can now run: `npm run poc:gate-2`')
  console.log('   Enable the adapter with:')
  console.log(
    "   update public.system_config set value = 'true'::jsonb where key = 'notebook.enabled';",
  )
} else {
  console.log(`\n⛔ not usable yet (${output.state}). Nothing has been enabled.`)
  process.exit(1)
}
