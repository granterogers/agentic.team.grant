/**
 * V8, resolved: attribute spend to THIS run's generations, because the account total cannot.
 *
 *   npx tsx scripts/hermes-m0/v8-attribution.ts <out-dir> <deno-binary> <hermes-host-dir>
 *
 * V5's first run compared the key's account `usage` before and after and it moved by a fraction of a cent. The key is the
 * office's own and the office was running its duties on it, so the total cannot say whose spend it was. This script
 *   1. brackets a short live window with the account total (informational: other traffic on the key can move it), and
 *   2. makes a few live calls, including one real Hermes run, records each generation id, and asks the provider what each
 *      generation actually cost (GET /api/v1/generation?id=...). That per-generation record is the attribution.
 * Environment: LIVE model, MOCK office database.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { candidates, fetchCatalogue } from './catalogue.ts'
import { lookupGenerations, undated } from './generations.ts'
import { startHermes } from './hermes-host.ts'
import { type Check, matrix, scrub, sleep, throwaway } from './lib.ts'
import { startRig } from './mcp-rig.ts'
import { startGuard } from './model-guard.ts'
import { runToEnd } from './runs.ts'

const [outArg, denoArg, hostArg] = process.argv.slice(2)
if (outArg === undefined || denoArg === undefined || hostArg === undefined) {
  console.error('usage: v8-attribution.ts <out-dir> <deno-binary> <hermes-host-dir>')
  process.exit(2)
}
const outDir = resolve(outArg)
mkdirSync(outDir, { recursive: true })
const key = process.env.OPENROUTER_API_KEY ?? ''
if (key === '') {
  console.log('BLOCKED  V8-2  no OPENROUTER_API_KEY in the environment')
  process.exit(3)
}
const checks: Check[] = []
const check = (id: string, name: string, verdict: Check['verdict'], evidence: string): void => {
  checks.push({ id, name, verdict, environment: 'live', evidence })
  console.log(`${verdict}  ${id}  ${name}  ${scrub(evidence)}`)
}

const keyData = async (): Promise<{ usage: number; daily: number }> => {
  const r = await fetch('https://openrouter.ai/api/v1/key', {
    headers: { authorization: `Bearer ${key}` },
  })
  const d = ((await r.json()) as { data: { usage: number; usage_daily: number } }).data
  return { usage: Number(d.usage), daily: Number(d.usage_daily) }
}

// 1. Bracket the live window with the account total.
const u0 = await keyData()

// 2. Per-generation cost.
const catalogue = await fetchCatalogue()
const allowed = new Set(candidates(catalogue).map((c) => c.id))
const model = 'nvidia/nemotron-3-super-120b-a12b:free'
if (!allowed.has(model)) {
  console.log(`BLOCKED  V8-3  ${model} is no longer a zero-priced candidate`)
  process.exit(3)
}
const guard = await startGuard({
  upstreamKey: key,
  allowed,
  maxUpstreamCalls: 30,
  logFile: join(outDir, 'guard-v8.jsonl'),
  catalogue,
})
const rig = await startRig({ root: resolve('.'), deno: denoArg, outDir, port: 18_085 })
try {
  for (let i = 0; i < 3; i += 1) {
    await fetch(`${guard.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        max_tokens: 20,
        messages: [{ role: 'user', content: 'Say one word.' }],
      }),
    })
    await sleep(2500)
  }
  await fetch(`${guard.url}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      max_tokens: 20,
      stream: true,
      messages: [{ role: 'user', content: 'Say one word.' }],
    }),
  }).then((r) => r.text())
  const host = await startHermes({
    hostDir: resolve(hostArg),
    home: '/tmp/hm/v8',
    outDir,
    port: 18_720,
    apiKey: throwaway('apikey'),
    modelBase: guard.url,
    modelName: model,
    contextLength: null,
    mcpUrl: rig.url,
    mcpToken: rig.tokens.ro,
    label: 'v8',
  })
  try {
    await runToEnd(
      host,
      'Use your tools to list the projects in this office, then tell me their names.',
      {},
      150_000,
    )
  } finally {
    await host.stop()
  }
} finally {
  await rig.stop()
}

await sleep(6000) // the generation record can lag the response
const ok = guard.calls.filter((c) => c.verdict === 'forwarded' && c.status === 200)
const ids = ok.map((c) => c.generationId).filter((id): id is string => typeof id === 'string')
const rows = await lookupGenerations(key, ids)
const u1 = await keyData()
check(
  'V8-2',
  "the key's account total did not move across the live window (a stricter test than V8-3: it also holds only if the office was idle on the same key)",
  u1.usage === u0.usage ? 'PASS' : 'FAIL',
  `usage ${String(u0.usage)} -> ${String(u1.usage)} across the live calls (delta ${String(u1.usage - u0.usage)}); the office shares this key, so a non-zero delta is not attributable without V8-3`,
)
check(
  'V8-3',
  "every generation this harness made is, per the provider's own generation record, to an allowlisted model and cost exactly zero",
  rows.length === ok.length &&
    rows.length >= 5 &&
    rows.every(
      (r) =>
        r.totalCost === 0 &&
        allowed.has(undated(r.model)) &&
        (r.upstream === null || r.upstream === 0),
    )
    ? 'PASS'
    : 'FAIL',
  `${String(rows.length)} of ${String(ok.length)} successful calls had a generation id (streamed and non-streamed, direct and through Hermes); total_cost values: ${[...new Set(rows.map((r) => r.totalCost))].join(',')}; models: ${[...new Set(rows.map((r) => r.model))].join(',')}; upstream_inference_cost: ${[...new Set(rows.map((r) => String(r.upstream)))].join(',')}`,
)
await guard.stop()
writeFileSync(join(outDir, 'v8-matrix.md'), `${matrix(checks)}\n`)
writeFileSync(join(outDir, 'v8-generations.json'), `${JSON.stringify(rows, null, 2)}\n`)
const failed = checks.filter((c) => c.verdict !== 'PASS')
console.log(`\nV8: ${String(checks.length - failed.length)}/${String(checks.length)} passed`)
process.exit(failed.length === 0 ? 0 : 1)
