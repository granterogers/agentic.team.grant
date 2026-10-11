// biome-ignore-all format: a one-off observation script kept readable as written
/**
 * What the real Hermes API answers on the calls the M5 bridge makes: capabilities, toolsets, the start-run response, the event
 * payloads of a completed run, a provider failure and a stop. Mock model (the double); nothing here says anything about a real model.
 *
 *   npx tsx scripts/hermes-m0/m5-observe.ts <out-dir> <hermes-host-dir>
 *
 * Prints JSON, with the API key never printed. Used once to write src/engines/hermes/bridge shapes from observation rather than from source reading.
 */
import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { hermes, startHermes } from './hermes-host.ts'
import { sleep, throwaway } from './lib.ts'
import { startLlmDouble } from './llm-double.ts'
import { readEvents, startRun, status, waitTerminal } from './runs.ts'

const [outArg, hostArg] = process.argv.slice(2)
if (outArg === undefined || hostArg === undefined) {
  console.error('usage: m5-observe.ts <out-dir> <hermes-host-dir>')
  process.exit(2)
}
const outDir = resolve(outArg)
mkdirSync(outDir, { recursive: true })
const llm = await startLlmDouble(join(outDir, 'llm-observe.jsonl'))
const key = throwaway('hk')
const host = await startHermes({
  hostDir: resolve(hostArg),
  home: join(outDir, 'homes', 'observe'),
  outDir,
  port: 18_910,
  apiKey: key,
  modelBase: llm.url,
  label: 'observe',
})
const show = (label: string, v: unknown): void => console.log(`\n### ${label}\n${JSON.stringify(v, null, 1).slice(0, 2500)}`)
try {
  show('GET /health', (await hermes(host, 'GET', '/health')).body)
  const caps = await hermes(host, 'GET', '/v1/capabilities')
  show('GET /v1/capabilities', { status: caps.status, body: caps.body })
  const ts = await hermes(host, 'GET', '/v1/toolsets')
  show('GET /v1/toolsets', { status: ts.status, body: ts.body })

  const started = await startRun(host, { input: 'say hello', instructions: 'be brief', conversation_history: [], session_id: 'observe-1' }, { 'idempotency-key': 'engine-run-x-1' })
  show('POST /v1/runs', { status: started.status, body: started.body })
  const ev = await readEvents(host, started.runId ?? '', { timeoutMs: 30_000 })
  show('events of a completed run', { n: ev.events.length, ids: ev.ids, events: ev.events.map((e) => ({ ...e, output: typeof e.output === 'string' ? `${e.output.slice(0, 80)}` : e.output })) })
  show('GET /v1/runs/<id> (terminal)', await waitTerminal(host, started.runId ?? ''))

  const limited = await startRun(host, { input: 'RATELIMIT', instructions: '', conversation_history: [] }, { 'idempotency-key': 'engine-run-x-2' })
  const evFail = await readEvents(host, limited.runId ?? '', { timeoutMs: 60_000 })
  show('events of a provider 429', evFail.events)
  show('status after a provider 429', await waitTerminal(host, limited.runId ?? ''))

  const slow = await startRun(host, { input: 'SLOW 30', instructions: '', conversation_history: [] }, { 'idempotency-key': 'engine-run-x-3' })
  await sleep(1500)
  const stop = await hermes(host, 'POST', `/v1/runs/${slow.runId}/stop`, {})
  show('POST /v1/runs/<id>/stop', { status: stop.status, body: stop.body })
  const evStop = await readEvents(host, slow.runId ?? '', { timeoutMs: 15_000 })
  show('events after stop', evStop.events.map((e) => ({ event: e.event })))
  show('status after stop', await status(host, slow.runId ?? ''))
} finally {
  await host.stop()
  await llm.stop()
}
