// biome-ignore-all format: dense scenario tests kept readable as written
// biome-ignore-all lint/suspicious/noExplicitAny: the gateway's recorded JSON bodies are untyped
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Bridge, canonicalBody, DEFAULT_TIMING, idleDelay, type Timing } from '../../scripts/hermes-bridge/bridge.ts'
import { parseBridgeConfig } from '../../scripts/hermes-bridge/config.ts'
import { GatewayClient } from '../../scripts/hermes-bridge/gateway-client.ts'
import { HermesClient } from '../../scripts/hermes-bridge/hermes-client.ts'
import { SseParser } from '../../scripts/hermes-bridge/sse.ts'
import type { ClaimedRun } from '../../src/engines/hermes/types.ts'
import { FakeGateway, FakeHermes, hermesId, type ScriptedEvent, sleep } from './bridge-fakes.ts'

const RUN = '33333333-3333-4333-8333-333333333333'
const BRIDGE_TOKEN = `ebt_${'a'.repeat(64)}`
const FAST: Partial<Timing> = {
  heartbeatMs: 40,
  noProgressMs: 400,
  tickMs: 10,
  stopWaitMs: 600,
  deadlineGraceMs: 0,
  leaseGiveUpMs: 2_000,
  finishRetryMs: 20,
  finishGiveUpMs: 500,
  reconnectDelayMs: 10,
}

const completed = (output: string, afterMs = 5): ScriptedEvent => ({
  afterMs,
  data: { event: 'run.completed', output, usage: { input_tokens: 12, output_tokens: 7 }, runtime: { model: 'vendor/model:free' } },
})
const tool = (name: string, afterMs = 5): ScriptedEvent => ({ afterMs, data: { event: 'tool.started', tool: name, preview: '' } })

const claimed = (over: Partial<ClaimedRun> = {}): ClaimedRun => ({
  run_id: RUN,
  claim_gen: 1,
  job_id: '44444444-4444-4444-8444-444444444444',
  deadline_at: new Date(Date.now() + 60_000).toISOString(),
  request: { input: 'What is due?', instructions: 'Be brief.', conversation_history: [{ role: 'user', content: 'hello' }] },
  hermes_run_id: null,
  previous_hermes_run_id: null,
  ...over,
})

let h: FakeHermes
let g: FakeGateway
let logs: string[]
const make = (timing: Partial<Timing> = {}): Bridge => {
  const config = { gatewayUrl: g.url, bridgeToken: BRIDGE_TOKEN, hermesUrl: h.url, hermesKey: h.key, officeToolPrefix: 'mcp__office__' }
  return new Bridge({
    hermes: new HermesClient(h.url, h.key),
    gateway: new GatewayClient(g.url, BRIDGE_TOKEN),
    config,
    timing: { ...FAST, ...timing },
    log: (l) => logs.push(l),
  })
}
const finishes = (): Record<string, any>[] => g.of('/finish').map((c) => c.body)

beforeEach(async () => {
  h = new FakeHermes()
  g = new FakeGateway()
  logs = []
  await h.start()
  await g.start()
})
afterEach(async () => {
  await h.stop()
  await g.stop()
})

describe('configuration', () => {
  const good = {
    ENGINE_GATEWAY_URL: 'https://abc.supabase.co/functions/v1/engine',
    ENGINE_BRIDGE_TOKEN: BRIDGE_TOKEN,
    HERMES_URL: 'http://127.0.0.1:8642',
    HERMES_API_KEY: 'k'.repeat(40),
  }
  it('accepts a good environment and normalises the URLs', () => {
    const r = parseBridgeConfig({ ...good, ENGINE_GATEWAY_URL: `${good.ENGINE_GATEWAY_URL}/` })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.config.gatewayUrl).toBe(good.ENGINE_GATEWAY_URL)
      expect(r.config.officeToolPrefix).toBe('mcp__office__')
    }
  })
  it('defaults Hermes to the loopback address', () => {
    const { HERMES_URL: _omit, ...rest } = good
    const r = parseBridgeConfig(rest)
    expect(r.ok && r.config.hermesUrl).toBe('http://127.0.0.1:8642')
  })
  const refused = (env: Record<string, string>, needle: RegExp): void => {
    const r = parseBridgeConfig({ ...good, ...env })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.problems.join('\n')).toMatch(needle)
  }
  it('refuses a Hermes that is not on this machine, or not plain http', () => {
    refused({ HERMES_URL: 'http://10.0.0.5:8642' }, /HERMES_URL/)
    refused({ HERMES_URL: 'https://hermes.example.com' }, /HERMES_URL/)
    refused({ HERMES_URL: 'http://hermes.example.com:8642' }, /HERMES_URL/)
    expect(parseBridgeConfig({ ...good, HERMES_URL: 'http://localhost:9000' }).ok).toBe(true)
  })
  it('refuses a gateway that is not https, except loopback http when explicitly allowed for a test', () => {
    refused({ ENGINE_GATEWAY_URL: 'http://abc.supabase.co/functions/v1/engine' }, /must be https/)
    refused({ ENGINE_GATEWAY_URL: 'http://127.0.0.1:9/functions/v1/engine' }, /must be https/)
    expect(parseBridgeConfig({ ...good, ENGINE_GATEWAY_URL: 'http://127.0.0.1:9/e', ENGINE_BRIDGE_ALLOW_INSECURE_LOOPBACK: '1' }).ok).toBe(true)
    refused({ ENGINE_GATEWAY_URL: 'http://evil.example.com/e', ENGINE_BRIDGE_ALLOW_INSECURE_LOOPBACK: '1' }, /must be https/)
  })
  it('refuses credentials, a query or a fragment in the gateway URL, and a missing or malformed token or key', () => {
    refused({ ENGINE_GATEWAY_URL: 'https://user:pw@abc.supabase.co/e' }, /credentials/)
    refused({ ENGINE_GATEWAY_URL: 'https://abc.supabase.co/e?token=1' }, /query/)
    refused({ ENGINE_BRIDGE_TOKEN: 'ebt_short' }, /ENGINE_BRIDGE_TOKEN/)
    refused({ ENGINE_BRIDGE_TOKEN: `mcp_${'a'.repeat(48)}` }, /ENGINE_BRIDGE_TOKEN/)
    refused({ HERMES_API_KEY: 'tooshort' }, /HERMES_API_KEY/)
  })
  it('refuses to start where a database or Supabase credential is present, naming the variable and never its value', () => {
    const secret = 'sbp_THIS_MUST_NEVER_BE_PRINTED_0123456789'
    const r = parseBridgeConfig({ ...good, SUPABASE_SERVICE_ROLE_KEY: secret })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.problems.join('\n')).toMatch(/SUPABASE_SERVICE_ROLE_KEY/)
      expect(r.problems.join('\n')).not.toContain(secret)
    }
    // A connection-string specimen, assembled from pieces so no credential-shaped literal sits in the repository.
    refused({ DATABASE_URL: ['postgres', '://', 'u', ':', 'p', '@', 'h/db'].join('') }, /DATABASE_URL/)
    refused({ SUPABASE_ACCESS_TOKEN: 'x' }, /SUPABASE_ACCESS_TOKEN/)
    expect(parseBridgeConfig({ ...good, SUPABASE_URL: '' }).ok).toBe(true)
  })
  it('refuses HERMES_YOLO_MODE when it is on, and accepts it unset, empty or explicitly off', () => {
    refused({ HERMES_YOLO_MODE: '1' }, /HERMES_YOLO_MODE/)
    refused({ HERMES_YOLO_MODE: 'true' }, /HERMES_YOLO_MODE/)
    for (const v of ['', '0', 'false', 'off']) expect(parseBridgeConfig({ ...good, HERMES_YOLO_MODE: v }).ok).toBe(true)
  })
  it('no problem text ever repeats the token or the key', () => {
    const r = parseBridgeConfig({ ...good, ENGINE_GATEWAY_URL: 'http://x', HERMES_URL: 'http://1.2.3.4', HERMES_API_KEY: 'short-key-value' })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      const all = r.problems.join('\n')
      expect(all).not.toContain(BRIDGE_TOKEN)
      expect(all).not.toContain('short-key-value')
    }
  })
})

describe('what the bridge is allowed to import', () => {
  // M8b: the pure skill converter (src/engines/hermes/skills.ts, no I/O) and, for the two skill directories only, the file-system modules.
  const ALLOWED = [/^\.\/[a-z-]+\.ts$/, /^\.\.\/\.\.\/src\/engines\/hermes\/(types|timing|skills)\.ts$/, /^\.\.\/\.\.\/src\/safety\/require-production-writes\.ts$/, /^node:(fs\/promises|path)$/]
  const importsOf = (source: string): string[] =>
    [...source.matchAll(/(?:^|\n)\s*(?:import|export)\s[^'";]*?\sfrom\s+['"]([^'"]+)['"]|(?:^|\n)\s*import\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|require\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => String(m[1] ?? m[2] ?? m[3] ?? m[4]))
  const forbidden = (specs: string[]): string[] => specs.filter((s) => !ALLOWED.some((re) => re.test(s)))

  it('the checker can fail: a database client, a Supabase library and a repository module outside the two shared files are all found', () => {
    // The database module's name is assembled from pieces: the production-gate coverage test looks for the literal in any file.
    const dbModule = ['../../src/db/pg', '-executor.ts'].join('')
    const pgImport = ['import pg from ', "'", 'pg', "'"].join('')
    expect(forbidden(importsOf(`${pgImport}\nimport { x } from '@supabase/supabase-js'\nimport {\n  y,\n  z,\n} from '../../src/db/executor.ts'\nimport { ok } from './bridge.ts'`))).toEqual(['pg', '@supabase/supabase-js', '../../src/db/executor.ts'])
    expect(forbidden(importsOf(`const m = await import('${dbModule}')`))).toEqual([dbModule])
  })
  it('every file of the bridge imports only its own files, the two shared type and timing files, and the production-write gate', async () => {
    const { readdirSync, readFileSync } = await import('node:fs')
    const files = readdirSync('scripts/hermes-bridge').filter((f) => f.endsWith('.ts'))
    expect(files.sort()).toEqual(['bridge.ts', 'config.ts', 'gateway-client.ts', 'hermes-client.ts', 'main.ts', 'skills-sync.ts', 'sse.ts'])
    for (const f of files) {
      const specs = importsOf(readFileSync(`scripts/hermes-bridge/${f}`, 'utf8'))
      expect(forbidden(specs), f).toEqual([])
    }
    // The reader is not blind: the files that do import are seen importing (a found-nothing check needs a positive).
    expect(importsOf(readFileSync('scripts/hermes-bridge/bridge.ts', 'utf8')).length).toBeGreaterThanOrEqual(4)
    expect(importsOf(readFileSync('scripts/hermes-bridge/main.ts', 'utf8'))).toContain('./bridge.ts')
  })
  it('only the entry point imports the production-write gate, and it imports it first', async () => {
    const { readFileSync } = await import('node:fs')
    const main = readFileSync('scripts/hermes-bridge/main.ts', 'utf8')
    expect(importsOf(main)[0]).toBe('../../src/safety/require-production-writes.ts')
    for (const f of ['bridge.ts', 'config.ts', 'gateway-client.ts', 'hermes-client.ts', 'skills-sync.ts', 'sse.ts'])
      expect(readFileSync(`scripts/hermes-bridge/${f}`, 'utf8')).not.toContain('require-production-writes')
  })
})

describe('the event stream parser', () => {
  it('reads events split across chunks, with CRLF, comments, ids and multi-line data', () => {
    const p = new SseParser()
    const out = [
      ...p.push(': keep-alive\r\nid: 4\r\nda'),
      ...p.push('ta: {"event":"tool.started",\r\ndata: "tool":"x"}\r\n\r\nid: 5\ndata: {"event":"run.completed"}\n'),
      ...p.push('\n'),
    ]
    expect(out).toHaveLength(2)
    expect(out[0]?.id).toBe(4)
    expect(out[0]?.data).toEqual({ event: 'tool.started', tool: 'x' })
    expect(out[1]).toMatchObject({ id: 5, data: { event: 'run.completed' } })
  })
  it('never throws on junk: a non-JSON body is kept raw and a non-object is dropped to null', () => {
    const p = new SseParser()
    const out = [...p.push('data: not json\n\ndata: [1,2]\n\ndata: 7\n\nid: x\ndata: {"a":1}\n\n')]
    expect(out.map((e) => e.data)).toEqual([null, null, null, { a: 1 }])
    expect(out[0]?.raw).toBe('not json')
    expect(out[3]?.id).toBeNull()
  })
  it('an event with no data is not an event', () => {
    expect([...new SseParser().push('id: 1\n\n: hi\n\n')]).toEqual([])
  })
})

describe('polling rhythm', () => {
  it('is 15 seconds while idle and 60 seconds after ten idle minutes', () => {
    const t = DEFAULT_TIMING
    expect(idleDelay(0, t)).toBe(15_000)
    expect(idleDelay(599_999, t)).toBe(15_000)
    expect(idleDelay(600_000, t)).toBe(60_000)
    expect(idleDelay(3_600_000, t)).toBe(60_000)
  })
  it('uses the contract numbers, from the one file that holds them', () => {
    expect(DEFAULT_TIMING.heartbeatMs).toBe(5_000)
    expect(DEFAULT_TIMING.noProgressMs).toBe(90_000)
    expect(DEFAULT_TIMING.stopWaitMs).toBe(30_000)
    expect(DEFAULT_TIMING.deadlineGraceMs).toBe(30_000)
  })
})

describe('the preflight', () => {
  it('reports Hermes ready when it is healthy, capable and only the office toolset is enabled', async () => {
    expect(await make().preflight()).toEqual({ hermes_ok: true, toolsets_ok: true })
  })
  it('fails the toolsets when anything but the office server is enabled', async () => {
    h.toolsets = [{ name: 'office', enabled: true }, { name: 'terminal', enabled: true }]
    expect(await make().preflight()).toEqual({ hermes_ok: true, toolsets_ok: false })
  })
  it('an unreachable Hermes fails both, and a missing feature fails Hermes', async () => {
    h.healthy = false
    expect(await make().preflight()).toEqual({ hermes_ok: false, toolsets_ok: false })
    h.healthy = true
    h.features = { run_events_sse: true, run_stop: false, approval_events: true }
    expect((await make().preflight()).hermes_ok).toBe(false)
  })
  it('a wrong key is not healthy for the API calls (capabilities refuses it)', async () => {
    const b = new Bridge({ hermes: new HermesClient(h.url, 'wrong'.repeat(10)), gateway: new GatewayClient(g.url, BRIDGE_TOKEN), config: { gatewayUrl: g.url, bridgeToken: BRIDGE_TOKEN, hermesUrl: h.url, hermesKey: 'x', officeToolPrefix: 'mcp__office__' }, timing: FAST })
    expect((await b.preflight()).hermes_ok).toBe(false)
  })
  it('the claim carries the preflight result, and nothing else, so a failing host is recorded as not ready', async () => {
    h.toolsets = [{ name: 'terminal', enabled: true }]
    g.claims = [{ body: { run: null, refused: 'not ready', poll_after_s: 60 } }]
    const r = await make().pollOnce()
    const claim = g.of('/claim')[0]?.body
    expect(Object.keys(claim ?? {}).sort()).toEqual(['bridge_version', 'hermes_ok', 'toolsets_ok'])
    expect(claim).toMatchObject({ hermes_ok: true, toolsets_ok: false })
    expect(r.waitMs).toBe(60_000)
    expect(r.ran).toBeNull()
  })
})

describe('running a claimed run', () => {
  it('starts Hermes once with a per-attempt key, sorted keys and the session, and reports the answer, model and usage', async () => {
    h.queue = [{ script: [tool('mcp__office__list_tasks'), tool('mcp__office__search_documents'), completed('The venue is unchanged.')] }]
    const ended = await make().runClaimed(claimed())
    expect(ended).toMatchObject({ outcome: 'completed', sent: true })
    expect(h.started).toHaveLength(1)
    expect(h.started[0]?.key).toBe(`engine-run-${RUN}-1`)
    expect(h.started[0]?.raw).toBe(canonicalBody(claimed().request, RUN))
    expect(Object.keys(h.started[0]?.body ?? {})).toEqual(['conversation_history', 'input', 'instructions', 'session_id'])
    expect(h.started[0]?.body.session_id).toBe(RUN)
    const f = finishes()
    expect(f).toHaveLength(1)
    expect(f[0]).toMatchObject({ run_id: RUN, claim_gen: 1, outcome: 'completed' })
    expect(f[0]?.result).toMatchObject({
      answer: 'The venue is unchanged.',
      model: 'vendor/model:free',
      usage: { input_tokens: 12, output_tokens: 7 },
      tools_started: 2,
      approvals_denied: 0,
      hermes_run_id: h.started[0]?.id,
    })
  })
  it('sends the first heartbeat at once, carrying the Hermes run id and progress, so a Stop can reach the run', async () => {
    h.queue = [{ script: [tool('mcp__office__list_tasks', 120), completed('x', 120)] }]
    await make().runClaimed(claimed())
    const first = g.of('/heartbeat')[0]?.body
    expect(first).toMatchObject({ run_id: RUN, claim_gen: 1, hermes_run_id: h.started[0]?.id })
    expect(Object.keys((first?.progress as object) ?? {}).sort()).toEqual(['events', 'last_event', 'tools'])
    expect(g.of('/heartbeat').length).toBeGreaterThan(1)
  })
  it('the key follows the attempt: the same run claimed a second time uses a different key', async () => {
    h.queue = [{ script: [completed('one')] }, { script: [completed('two')] }]
    await make().runClaimed(claimed({ claim_gen: 1 }))
    await make().runClaimed(claimed({ claim_gen: 2 }))
    expect(h.started.map((s) => s.key)).toEqual([`engine-run-${RUN}-1`, `engine-run-${RUN}-2`])
    expect(h.started[0]?.raw).toBe(h.started[1]?.raw)
  })
  it('re-attaches to a live Hermes run by its id and never starts another', async () => {
    const id = hermesId()
    h.adopt(id, { script: [tool('mcp__office__list_tasks', 30), completed('still here', 60)] })
    const ended = await make().runClaimed(claimed({ hermes_run_id: id }))
    expect(ended).toMatchObject({ outcome: 'completed', sent: true })
    expect(h.started).toHaveLength(0)
    expect(finishes()[0]?.result).toMatchObject({ answer: 'still here', hermes_run_id: id })
  })
  it('stops an earlier attempt’s Hermes run before it starts this one', async () => {
    const prev = hermesId()
    h.adopt(prev, { script: [] })
    await make().runClaimed(claimed({ previous_hermes_run_id: prev, claim_gen: 2 }))
    expect(h.stops[0]).toBe(prev)
    expect(h.order.indexOf(`stop ${prev}`)).toBeLessThan(h.order.indexOf('POST /v1/runs'))
  })
})

describe('containment', () => {
  it('stops a run that uses a tool that is not an office tool, and reports containment with the tool’s name', async () => {
    h.queue = [{ script: [tool('terminal', 20), completed('never reached', 400)] }]
    const ended = await make().runClaimed(claimed())
    expect(ended).toMatchObject({ outcome: 'failed', sent: true })
    expect(finishes()[0]?.result.failure).toBe('containment: terminal')
    expect(h.stops).toHaveLength(1)
  })
  it('refuses an office-prefixed tool that is not on the read list (a write tool is not in the v1 list)', async () => {
    h.queue = [{ script: [tool('mcp__office__create_task', 20), completed('x', 400)] }]
    await make().runClaimed(claimed())
    expect(finishes()[0]?.result.failure).toBe('containment: mcp__office__create_task')
  })
  it('refuses the right name without the prefix, and a prefix on the wrong server', async () => {
    h.queue = [{ script: [tool('list_tasks', 20), completed('x', 400)] }, { script: [tool('mcp__other__list_tasks', 20), completed('x', 400)] }]
    await make().runClaimed(claimed())
    await make().runClaimed(claimed({ run_id: '55555555-5555-4555-8555-555555555555' }))
    expect(finishes().map((f) => f.result.failure)).toEqual(['containment: list_tasks', 'containment: mcp__other__list_tasks'])
  })
  it('makes a hostile tool name safe before it is reported or logged', async () => {
    h.queue = [{ script: [tool("evil'; drop table x; --\n<script>", 20), completed('x', 400)] }]
    await make().runClaimed(claimed())
    const failure = String(finishes()[0]?.result.failure)
    expect(failure).toMatch(/^containment: [A-Za-z0-9_.:?-]+$/)
    expect(failure.length).toBeLessThanOrEqual(300)
  })
  it('passes every tool on the read list', async () => {
    const names = ['check_job', 'inspect_activity', 'list_events', 'list_projects', 'list_staff', 'list_tasks', 'read_document', 'recent_work', 'search_documents', 'search_project']
    h.queue = [{ script: [...names.map((n) => tool(`mcp__office__${n}`, 3)), completed('fine', 3)] }]
    const ended = await make().runClaimed(claimed())
    expect(ended.outcome).toBe('completed')
    expect(finishes()[0]?.result.tools_started).toBe(10)
  })
})

describe('approvals', () => {
  it('denies every approval request with its id, counts it, notes it, and lets the run finish', async () => {
    h.queue = [{ script: [{ afterMs: 10, data: { event: 'approval.request', request_id: 'req-1', command: 'rm -rf /', choices: ['once', 'deny'] } }, completed('done', 60)] }]
    const ended = await make().runClaimed(claimed())
    expect(ended.outcome).toBe('completed')
    expect(h.approvals).toHaveLength(1)
    expect(h.approvals[0]?.body).toEqual({ choice: 'deny', request_id: 'req-1' })
    expect(finishes()[0]?.result).toMatchObject({ approvals_denied: 1, notes: ['a request for approval was denied'] })
    expect(JSON.stringify(finishes()[0])).not.toContain('rm -rf')
  })
})

describe("the office's Stop, the deadline and the watchdog", () => {
  it('a heartbeat that says stop stops Hermes and reports the run cancelled, whatever Hermes then says', async () => {
    h.queue = [{ script: [tool('mcp__office__list_tasks', 20), completed('too late', 3_000)] }]
    g.heartbeat = (n) => (n >= 2 ? { status: 200, body: { stop: true, because: 'the job was stopped', lease_until: null } } : { status: 200, body: { stop: false, because: null, lease_until: null } })
    const ended = await make().runClaimed(claimed())
    expect(ended).toMatchObject({ outcome: 'cancelled', sent: true })
    expect(h.stops).toHaveLength(1)
    expect(finishes()[0]?.outcome).toBe('cancelled')
    expect(finishes()[0]?.result.answer).toBeUndefined()
  })
  it('a run with no event for the no-progress limit is stopped and reported failed no_progress', async () => {
    h.queue = [{ script: [tool('mcp__office__list_tasks', 10)] }]
    const ended = await make({ noProgressMs: 250 }).runClaimed(claimed())
    expect(ended).toMatchObject({ outcome: 'failed', sent: true })
    expect(finishes()[0]?.result.failure).toBe('no_progress')
    expect(h.stops).toHaveLength(1)
  })
  it('a run past its deadline is stopped and reported failed deadline', async () => {
    h.queue = [{ script: [tool('mcp__office__list_tasks', 10), completed('late', 3_000)] }]
    const ended = await make().runClaimed(claimed({ deadline_at: new Date(Date.now() + 150).toISOString() }))
    expect(ended.outcome).toBe('failed')
    expect(finishes()[0]?.result.failure).toBe('deadline')
    expect(h.stops).toHaveLength(1)
  })
  it('does not wait for ever for Hermes to confirm a stop: the report goes after the stop wait', async () => {
    h.queue = [{ script: [] }]
    const hang = h.stops
    void hang
    const started = Date.now()
    const ended = await make({ noProgressMs: 150, stopWaitMs: 250 }).runClaimed(claimed())
    expect(ended.outcome).toBe('failed')
    expect(Date.now() - started).toBeLessThan(5_000)
  })
})

describe('the event stream', () => {
  it('reconnects with Last-Event-ID after a dropped stream and does not count an event twice', async () => {
    h.queue = [{ dropStreamAfter: 2, script: [tool('mcp__office__list_tasks', 10), tool('mcp__office__list_projects', 10), tool('mcp__office__recent_work', 60), completed('after the drop', 60)] }]
    const ended = await make().runClaimed(claimed())
    expect(ended.outcome).toBe('completed')
    const run = [...h.runs.values()][0]
    expect(run?.streams.length).toBeGreaterThanOrEqual(2)
    expect(run?.streams[0]?.lastEventId).toBeNull()
    // Whatever the client had read when the connection dropped (the last event is not always flushed), it resumes AFTER that.
    expect(Number(run?.streams[1]?.lastEventId)).toBeGreaterThanOrEqual(0)
    expect(Number(run?.streams[1]?.lastEventId)).toBeLessThanOrEqual(1)
    expect(finishes()[0]?.result).toMatchObject({ answer: 'after the drop', tools_started: 3 })
  })
  it('when the stream cannot be kept it reads the run’s own status and reports what that says', async () => {
    h.queue = [{ streamBroken: true, script: [], finalStatus: { status: 'completed', output: 'read from the status' } }]
    const ended = await make().runClaimed(claimed())
    expect(ended.outcome).toBe('completed')
    expect(finishes()[0]?.result.answer).toBe('read from the status')
  })
  it('a provider failure becomes a failed run with the engine’s sentence, bounded, never a long dump', async () => {
    h.queue = [{ script: [{ afterMs: 5, data: { event: 'run.failed', error: `HTTP 429: Rate limit exceeded: free-models-per-min. ${'x'.repeat(2_000)}` } }] }]
    await make().runClaimed(claimed())
    const failure = String(finishes()[0]?.result.failure)
    expect(finishes()[0]?.outcome).toBe('failed')
    expect(failure).toMatch(/^HTTP 429/)
    expect(failure.length).toBeLessThanOrEqual(300)
  })
  it('a run somebody else interrupted is reported failed interrupted, never cancelled', async () => {
    h.queue = [{ script: [{ afterMs: 10, data: { event: 'run.interrupted' } }] }]
    await make().runClaimed(claimed())
    expect(finishes()[0]).toMatchObject({ outcome: 'failed', result: { failure: 'interrupted' } })
  })
})

describe('what is sent back is bounded and honest', () => {
  it('cuts an over-long answer to the limit and says it did', async () => {
    h.queue = [{ script: [completed('y'.repeat(20_000))] }]
    await make().runClaimed(claimed())
    const r = finishes()[0]?.result
    expect(String(r.answer).length).toBeLessThanOrEqual(16_000)
    expect(r.notes).toEqual(['the answer was cut to fit'])
  })
  it('an empty answer is a failure, not an empty reply', async () => {
    h.queue = [{ script: [completed('   ')] }]
    await make().runClaimed(claimed())
    expect(finishes()[0]).toMatchObject({ outcome: 'failed', result: { failure: 'empty answer' } })
  })
  it('reports the result in a shape the office accepts (the same validator the database mirrors)', async () => {
    const { resultProblem } = await import('../../src/engines/hermes/types.ts')
    h.queue = [{ script: [tool('mcp__office__list_tasks', 3), completed('ok', 3)] }]
    await make().runClaimed(claimed())
    expect(resultProblem(finishes()[0]?.outcome, finishes()[0]?.result)).toBeNull()
  })
  it('never logs an answer, a tool argument, the bridge token or the Hermes key', async () => {
    h.queue = [{ script: [tool('mcp__office__list_tasks', 3), completed('THE-SECRET-ANSWER', 3)] }]
    await make().runClaimed(claimed())
    const all = logs.join('\n')
    expect(all).not.toContain('THE-SECRET-ANSWER')
    expect(all).not.toContain(BRIDGE_TOKEN)
    expect(all).not.toContain(h.key)
    expect(all.length).toBeGreaterThan(0)
  })
})

describe('Hermes refusing to start a run', () => {
  const cases: [string, { status: number; body?: Record<string, unknown> }, string][] = [
    ['a conflicting idempotency key', { status: 409 }, 'idempotency_conflict'],
    ['too many concurrent runs', { status: 429 }, 'hermes_busy'],
    ['a server error', { status: 500 }, 'hermes_refused_500'],
    ['an answer with no valid run id', { status: 202, body: { run_id: 'not-a-run' } }, 'hermes_refused_202'],
  ]
  for (const [name, start, failure] of cases)
    it(`${name} is a plain failure, with no event stream opened`, async () => {
      h.queue = [{ start }]
      const ended = await make().runClaimed(claimed())
      expect(ended).toMatchObject({ outcome: 'failed', sent: true })
      expect(finishes()[0]?.result.failure).toBe(failure)
      expect(h.stops).toHaveLength(0)
    })
  it('an unreachable Hermes is a failed run, not a crash', async () => {
    const dead = new HermesClient('http://127.0.0.1:1', h.key)
    const b = new Bridge({ hermes: dead, gateway: new GatewayClient(g.url, BRIDGE_TOKEN), config: { gatewayUrl: g.url, bridgeToken: BRIDGE_TOKEN, hermesUrl: 'http://127.0.0.1:1', hermesKey: h.key, officeToolPrefix: 'mcp__office__' }, timing: FAST })
    const ended = await b.runClaimed(claimed())
    expect(ended).toMatchObject({ outcome: 'failed', sent: true })
    expect(finishes()[0]?.result.failure).toBe('hermes_unreachable')
  })
})

describe('the gateway side', () => {
  it('a lost claim (409 on a heartbeat) abandons the run: Hermes is stopped and NOTHING is reported', async () => {
    h.queue = [{ script: [tool('mcp__office__list_tasks', 10), completed('x', 2_000)] }]
    g.heartbeat = (n) => (n >= 2 ? { status: 409, body: { error: 'not_yours' } } : { status: 200, body: { stop: false, because: null, lease_until: null } })
    const ended = await make().runClaimed(claimed())
    expect(ended).toMatchObject({ outcome: 'abandoned', sent: false })
    expect(g.of('/finish')).toHaveLength(0)
    expect(h.stops).toHaveLength(1)
  })
  it('retries a report while the gateway is unavailable, then lands it once', async () => {
    h.queue = [{ script: [completed('answer')] }]
    g.finish = (n) => (n <= 2 ? { status: 503, body: { error: 'unavailable' }, headers: { 'retry-after': '1' } } : { status: 200, body: { ok: true, resumed: true } })
    const ended = await make().runClaimed(claimed())
    expect(ended).toMatchObject({ outcome: 'completed', sent: true })
    expect(g.of('/finish')).toHaveLength(3)
  })
  it('gives up on a report after the give-up time, and says it was not delivered', async () => {
    h.queue = [{ script: [completed('answer')] }]
    g.finish = () => ({ status: 503, body: { error: 'unavailable' } })
    const ended = await make({ finishGiveUpMs: 150 }).runClaimed(claimed())
    expect(ended).toMatchObject({ outcome: 'completed', sent: false })
    expect(ended.reason).toMatch(/not delivered/)
  })
  it('does not retry a report the gateway refused as not this bridge’s', async () => {
    h.queue = [{ script: [completed('answer')] }]
    g.finish = () => ({ status: 409, body: { error: 'not_yours' } })
    const ended = await make().runClaimed(claimed())
    expect(ended.sent).toBe(false)
    expect(g.of('/finish')).toHaveLength(1)
  })
  it('a result the office would refuse is reported as a failure the office accepts, not dropped', async () => {
    h.queue = [{ script: [completed('answer')] }]
    g.finish = (n) => (n === 1 ? { status: 400, body: { error: 'bad_request', field: 'result' } } : { status: 200, body: { ok: true, resumed: false } })
    const ended = await make().runClaimed(claimed())
    expect(ended).toMatchObject({ outcome: 'failed', sent: true })
    expect(finishes()[1]?.result.failure).toBe('bridge_result_invalid')
  })
})

describe('polling', () => {
  it('a token the gateway no longer recognises is fatal, so a retired bridge stops instead of polling', async () => {
    g.claims = [{ status: 401, body: { error: 'unauthorized' } }]
    const r = await make().pollOnce()
    expect(r.fatal).toMatch(/does not recognise/)
  })
  it('a gateway that is down is waited out at least as long as it asked, never in a tight loop', async () => {
    g.claims = [{ status: 503, body: { error: 'unavailable', retry_after_s: 40 } }]
    const r = await make().pollOnce()
    expect(r.fatal).toBeNull()
    expect(r.waitMs).toBeGreaterThanOrEqual(40_000)
  })
  it('an idle answer waits what the gateway said, and a handed-over run is run and followed by an immediate poll', async () => {
    g.claims = [{ body: { run: null, poll_after_s: 15 } }]
    expect((await make().pollOnce()).waitMs).toBe(15_000)
    g.claims = [{ body: { run: claimed(), poll_after_s: 0 } }]
    h.queue = [{ script: [completed('polled')] }]
    const r = await make().pollOnce()
    expect(r.ran).toMatchObject({ outcome: 'completed', sent: true })
    expect(r.waitMs).toBe(0)
  })
  it('serve() stops when told to, and returns the fatal reason when the token is refused', async () => {
    const ac = new AbortController()
    g.claims = [{ body: { run: null, poll_after_s: 15 } }]
    const slow = make({ pollIdleMs: 20 })
    const done = slow.serve(ac.signal)
    await sleep(60)
    ac.abort()
    expect(await done).toBeNull()
    g.claims = [{ status: 401, body: { error: 'unauthorized' } }]
    expect(await make().serve(new AbortController().signal)).toMatch(/does not recognise/)
  })
})
