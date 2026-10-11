/**
 * V5 / V8: an actually-free model through a REAL Hermes, with a cost guard, and the behaviour when free capacity runs out.
 *
 *   npx tsx scripts/hermes-m0/v5-free-model.ts <out-dir> <deno-binary> <hermes-host-dir> <usage-baseline.json>
 *
 * Environment: LIVE for the model (the provider is real; the calls are zero-priced and guarded), MOCK for the office database.
 * The provider credential is read from OPENROUTER_API_KEY, held only by the guard process, and never printed or passed to
 * Hermes. If it is absent the live checks are reported BLOCKED, never faked.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { candidates, fetchCatalogue } from './catalogue.ts'
import { lookupGenerations, undated } from './generations.ts'
import { type HermesHost, startHermes } from './hermes-host.ts'
import { type Check, matrix, scrub, sleep, throwaway } from './lib.ts'
import { startRig } from './mcp-rig.ts'
import { type Guard, startGuard } from './model-guard.ts'
import { runToEnd } from './runs.ts'

const [outArg, denoArg, hostArg, baselineArg] = process.argv.slice(2)
if (
  outArg === undefined ||
  denoArg === undefined ||
  hostArg === undefined ||
  baselineArg === undefined
) {
  console.error(
    'usage: v5-free-model.ts <out-dir> <deno-binary> <hermes-host-dir> <usage-baseline.json>',
  )
  process.exit(2)
}
const outDir = resolve(outArg)
const hostDir = resolve(hostArg)
mkdirSync(outDir, { recursive: true })
const checks: Check[] = []
const check = (
  id: string,
  name: string,
  verdict: Check['verdict'],
  environment: Check['environment'],
  evidence: string,
): void => {
  checks.push({ id, name, verdict, environment, evidence })
  console.log(`${verdict}  ${id}  ${name}  ${scrub(evidence)}`)
}

const upstreamKey = process.env.OPENROUTER_API_KEY ?? ''
if (upstreamKey === '') {
  check(
    'V5',
    'a real free model through Hermes',
    'BLOCKED',
    'live',
    'no OPENROUTER_API_KEY in the environment; nothing was attempted',
  )
  writeFileSync(join(outDir, 'v5-matrix.md'), `${matrix(checks)}\n`)
  process.exit(3)
}

const usageNow = async (): Promise<{
  usage: number
  usageDaily: number
  free: { used: number; limit: number } | null
}> => {
  const r = await fetch('https://openrouter.ai/api/v1/key', {
    headers: { authorization: `Bearer ${upstreamKey}` },
  })
  const d = ((await r.json()) as { data: Record<string, unknown> }).data
  return {
    usage: Number(d.usage),
    usageDaily: Number(d.usage_daily),
    free: (d.free_model_daily_requests ?? null) as { used: number; limit: number } | null,
  }
}
const baseline = JSON.parse(readFileSync(resolve(baselineArg), 'utf8')) as {
  usage: number
  free_model_daily_requests: { used: number }
}

const catalogue = await fetchCatalogue()
const pool = candidates(catalogue)
console.log(
  `catalogue: ${String(catalogue.length)} models; zero-priced, >=64K context, tools: ${String(pool.length)}`,
)
const allowed = new Set(pool.map((c) => c.id))
const guard: Guard = await startGuard({
  upstreamKey,
  allowed,
  maxUpstreamCalls: 120,
  logFile: join(outDir, 'guard.jsonl'),
  catalogue,
})

// --- A. availability and tool-calling reliability, raw, through the guard -------------------------------------------------
const PICKS = [
  'nvidia/nemotron-3-super-120b-a12b:free',
  'google/gemma-4-31b-it:free',
  'poolside/laguna-s-2.1:free',
  'thinkingmachines/inkling:free',
].filter((id) => allowed.has(id))

interface Probe {
  readonly model: string
  readonly status: number
  readonly toolCallOk: boolean
  readonly ms: number
  readonly detail: string
}
const probeTool = async (model: string): Promise<Probe> => {
  const started = Date.now()
  const response = await fetch(`${guard.url}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      max_tokens: 900,
      messages: [
        {
          role: 'user',
          content: 'Call the function get_projects with {"office":"A"}. Do not reply in text.',
        },
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'get_projects',
            description: 'List the projects of an office.',
            parameters: {
              type: 'object',
              properties: { office: { type: 'string' } },
              required: ['office'],
            },
          },
        },
      ],
    }),
  })
  const text = await response.text()
  let ok = false
  let detail = ''
  try {
    const parsed = JSON.parse(text) as {
      choices?: {
        message?: { tool_calls?: { function?: { name?: string; arguments?: string } }[] }
      }[]
      error?: { message?: string }
    }
    const call = parsed.choices?.[0]?.message?.tool_calls?.[0]?.function
    if (call?.name === 'get_projects') {
      JSON.parse(call.arguments ?? '')
      ok = true
    }
    detail = parsed.error?.message ?? (ok ? 'valid tool call' : 'no tool call')
  } catch {
    detail = 'unparseable response'
  }
  return {
    model,
    status: response.status,
    toolCallOk: ok,
    ms: Date.now() - started,
    detail: scrub(detail).slice(0, 120),
  }
}

const probes: Probe[] = []
for (const model of PICKS) {
  for (let i = 0; i < 2; i += 1) {
    probes.push(await probeTool(model))
    await sleep(1500)
  }
}
const byModel = new Map<string, Probe[]>()
for (const p of probes) byModel.set(p.model, [...(byModel.get(p.model) ?? []), p])
for (const [model, rows] of byModel) {
  console.log(
    `  probe ${model}: ${rows.map((r) => `${String(r.status)}/${r.toolCallOk ? 'tool' : 'no-tool'}/${String(r.ms)}ms`).join(' ')}`,
  )
}
const reliable = [...byModel.entries()]
  .filter(([, rows]) => rows.every((r) => r.status === 200 && r.toolCallOk))
  .map(([m]) => m)
check(
  'V5-1',
  'at least one zero-priced model with >=64K context answers and makes a valid tool call (2 of 2)',
  reliable.length > 0 ? 'PASS' : 'FAIL',
  'live',
  `catalogue pool ${String(pool.length)}; probed ${PICKS.join(', ')}; reliable: ${reliable.join(', ') || 'none'}; per-model: ${[...byModel.entries()].map(([m, r]) => `${m}=${r.map((x) => `${String(x.status)}${x.toolCallOk ? 'T' : 'n'}`).join('')}`).join(' ')}`,
)

// --- C. a real Hermes, a real office MCP function (fake DB), a real free model --------------------------------------------
const rig = await startRig({ root: resolve('.'), deno: denoArg, outDir, port: 18_084 })
let port = 18_700
const asked = 'Use your tools to list the projects in this office, then tell me their names.'
interface E2E {
  readonly model: string
  readonly ok: boolean
  readonly ms: number
  readonly guardCalls: number
  readonly note: string
}
const e2e: E2E[] = []
const hermesRun = async (
  model: string,
  label: string,
  input: string,
  contextLength?: number | null,
): Promise<{ host: HermesHost; result: Awaited<ReturnType<typeof runToEnd>> }> => {
  const host = await startHermes({
    hostDir,
    home: `/tmp/hm/v5-${label}`,
    outDir,
    port: port++,
    apiKey: throwaway('apikey'),
    modelBase: guard.url,
    modelName: model,
    modelKey: 'dummy-model-key',
    mcpUrl: rig.url,
    mcpToken: rig.tokens.ro,
    ...(contextLength === undefined ? {} : { contextLength }),
    label: `v5-${label}`,
  })
  const result = await runToEnd(host, input, {}, 150_000)
  return { host, result }
}

try {
  for (const model of reliable.slice(0, 2)) {
    for (let i = 0; i < 2; i += 1) {
      const before = guard.calls.length
      const t0 = Date.now()
      rig.pg.reset()
      const { host, result } = await hermesRun(
        model,
        `${model.replace(/[^a-z0-9]/gi, '').slice(0, 12)}${String(i)}`,
        asked,
        null,
      )
      try {
        const called = result.events.some(
          (e) => e.event === 'tool.started' && e.tool === 'mcp__office__list_projects',
        )
        const named = /harvest lane/i.test(result.output) && /budget 2027/i.test(result.output)
        e2e.push({
          model,
          ok: result.final.status === 'completed' && called && named,
          ms: Date.now() - t0,
          guardCalls: guard.calls.length - before,
          note: `status ${String(result.final.status)}; tool called ${String(called)}; names in answer ${String(named)}; office rows reached ${String(rig.pg.callsTo('mcp_projects').length)}`,
        })
      } finally {
        await host.stop()
      }
    }
  }
  for (const r of e2e)
    console.log(
      `  e2e ${r.model}: ${r.ok ? 'ok' : 'NOT ok'} ${String(r.ms)}ms guard calls ${String(r.guardCalls)} | ${r.note}`,
    )
  const winners = new Set(e2e.filter((r) => r.ok).map((r) => r.model))
  check(
    'V5-2',
    'a real Hermes with a real free model, through the Runs API, calls an office MCP tool and answers from its result (2 attempts per model)',
    winners.size > 0 ? 'PASS' : 'FAIL',
    'live',
    e2e
      .map(
        (r) =>
          `${r.model} ${r.ok ? 'ok' : 'FAIL'} ${String(Math.round(r.ms / 1000))}s ${String(r.guardCalls)} model calls`,
      )
      .join('; ') || 'no reliable model to try',
  )

  // --- D. a paid model is refused, and nothing is spent ----------------------------------------------------------------
  const upstreamBefore = guard.upstreamCalls()
  const blockedBefore = guard.calls.filter((c) => c.verdict === 'blocked_model').length
  const paid = await hermesRun('openai/gpt-4o', 'paid', 'say hello', 131_072)
  try {
    const blocked = guard.calls.filter((c) => c.verdict === 'blocked_model').length - blockedBefore
    check(
      'V5-3',
      'asking Hermes to use a paid model is refused by the guard: the run does not succeed through a paid model, and no upstream call is made',
      blocked > 0 &&
        guard.upstreamCalls() === upstreamBefore &&
        paid.result.final.status !== 'completed'
        ? 'PASS'
        : 'FAIL',
      'live',
      `guard refusals ${String(blocked)}; upstream calls before/after ${String(upstreamBefore)}/${String(guard.upstreamCalls())}; run status ${String(paid.result.final.status)}`,
    )
  } finally {
    await paid.host.stop()
  }

  // --- E. a real rate-limit response, and Hermes's reaction --------------------------------------------------------------
  const burstModel = PICKS[0]
  if (burstModel !== undefined) {
    let first429: { n: number; message: string } | null = null
    const statuses: number[] = []
    for (let n = 1; n <= 24; n += 1) {
      const r = await fetch(`${guard.url}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: burstModel,
          max_tokens: 1,
          messages: [{ role: 'user', content: 'hi' }],
        }),
      })
      statuses.push(r.status)
      const t = await r.text()
      if (r.status === 429 && first429 === null) first429 = { n, message: scrub(t).slice(0, 200) }
      if (first429 !== null) break
    }
    check(
      'V5-4',
      'the provider limits free requests per minute: a burst receives a 429 whose shape is recorded',
      first429 !== null ? 'PASS' : 'FAIL',
      'live',
      first429 === null
        ? `no 429 in ${String(statuses.length)} requests (statuses ${[...new Set(statuses)].join(',')})`
        : `429 at request ${String(first429.n)}: ${first429.message}`,
    )
  }
} finally {
  await rig.stop()
}

// --- F. the money --------------------------------------------------------------------------------------------------------
const okCalls = guard.calls.filter((c) => c.verdict === 'forwarded' && c.status === 200)
const costs = okCalls.map((c) => c.cost)
const nonZero = costs.filter((c) => c !== null && c !== 0)
const models = [
  ...new Set(guard.calls.filter((c) => c.verdict === 'forwarded').map((c) => c.model)),
]
await sleep(6000)
const generations = await lookupGenerations(
  upstreamKey,
  okCalls.map((c) => c.generationId).filter((id): id is string => typeof id === 'string'),
)
const after = await usageNow()
const delta = after.usage - baseline.usage
check(
  'V8-1',
  "every successful call this run made is, per the provider's own per-generation record, to an allowlisted zero-priced model at exactly zero cost; no response reported a non-zero cost",
  models.every((m) => allowed.has(m)) &&
    nonZero.length === 0 &&
    generations.length === okCalls.length &&
    generations.every((g) => g.totalCost === 0 && allowed.has(undated(g.model)))
    ? 'PASS'
    : 'FAIL',
  'live',
  `${String(generations.length)} of ${String(okCalls.length)} successful calls found in the generation record, total_cost values ${[...new Set(generations.map((g) => g.totalCost))].join(',')}; responses reporting non-zero cost: ${String(nonZero.length)}; models requested ${models.join(', ')}`,
)
check(
  'V8-1b',
  "the key's account total did not move across the whole V5 run (informational: the office shares this key, so a non-zero delta is not attributable; V8-1 is the attribution)",
  Math.abs(delta) < 1e-9 ? 'PASS' : 'FAIL',
  'live',
  `usage before ${String(baseline.usage)} after ${String(after.usage)} (delta ${String(delta)}); free-model requests today ${String(after.free?.used)} of ${String(after.free?.limit)} (was ${String(baseline.free_model_daily_requests.used)})`,
)

await guard.stop()
writeFileSync(join(outDir, 'v5-matrix.md'), `${matrix(checks)}\n`)
writeFileSync(
  join(outDir, 'v5-details.json'),
  `${JSON.stringify({ pool: pool.map((c) => ({ id: c.id, context: c.context, nameSaysFree: c.nameSaysFree })), probes, e2e, guardCalls: guard.calls.length }, null, 2)}\n`,
)
const failed = checks.filter((c) => c.verdict !== 'PASS')
console.log(`\nV5: ${String(checks.length - failed.length)}/${String(checks.length)} passed`)
process.exit(failed.length === 0 ? 0 : 1)
