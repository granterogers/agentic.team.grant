/**
 * V4, layer B: a REAL Hermes (pinned source) against the REAL office MCP function.
 *
 *   npx tsx scripts/hermes-m0/v4b-hermes-mcp.ts <out-dir> <deno-binary> <hermes-host-dir>
 *
 * Environment: the model is a scripted double (no model cost), the database is a fake PostgREST (no production). So this is
 * evidence about Hermes's behaviour and about the function's code paths; it is NOT evidence about SQL or about any model.
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { type HermesHost, OFFICE_READ_TOOLS, startHermes } from './hermes-host.ts'
import { type Check, matrix, scrub, throwaway } from './lib.ts'
import { startLlmDouble } from './llm-double.ts'
import { type Rig, startRig } from './mcp-rig.ts'
import { runToEnd } from './runs.ts'

const [outArg, denoArg, hostArg, rootArg] = process.argv.slice(2)
if (outArg === undefined || denoArg === undefined || hostArg === undefined) {
  console.error(
    'usage: v4b-hermes-mcp.ts <out-dir> <deno-binary> <hermes-host-dir> [function-root]',
  )
  process.exit(2)
}
// The optional root is for the sabotage runs: a scratch copy of the function with a deliberate defect.
const functionRoot = resolve(rootArg ?? '.')
const outDir = resolve(outArg)
const hostDir = resolve(hostArg)
mkdirSync(outDir, { recursive: true })

const checks: Check[] = []
const check = (id: string, name: string, ok: boolean, evidence: string): void => {
  checks.push({ id, name, verdict: ok ? 'PASS' : 'FAIL', environment: 'mock', evidence })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${name}  ${scrub(evidence)}`)
}

const PREFIX = 'mcp__office__'
let nextPort = 18_650
const llmLog = join(outDir, 'llm-v4b.jsonl')
rmSync(llmLog, { force: true })
const rig: Rig = await startRig({ root: functionRoot, deno: denoArg, outDir, port: 18_083 })
const llm = await startLlmDouble(llmLog)

const withHermes = async <T>(
  label: string,
  token: string,
  fn: (host: HermesHost) => Promise<T>,
  include?: readonly string[],
): Promise<T> => {
  const host = await startHermes({
    hostDir,
    home: `/tmp/hm/v4b-${label}`,
    outDir,
    port: nextPort++,
    apiKey: throwaway('apikey'),
    modelBase: llm.url,
    mcpUrl: rig.url,
    mcpToken: token,
    ...(include === undefined ? {} : { mcpInclude: include }),
    label: `v4b-${label}`,
  })
  try {
    return await fn(host)
  } finally {
    await host.stop()
  }
}

/** What the tool returned, from Hermes's own tool.completed event (not from the model's reply, which the double truncates). */
const resultSeen = (r: { events: { event: string; preview?: unknown }[] }): string =>
  String(r.events.find((e) => e.event === 'tool.completed')?.preview ?? '')

const offeredNames = async (host: HermesHost): Promise<string[]> => {
  const r = await runToEnd(host, 'TOOLS')
  const m = /^TOOLS: (\[.*\])$/s.exec(r.output.trim())
  return m?.[1] === undefined ? [] : (JSON.parse(m[1]) as string[])
}

try {
  const expected = OFFICE_READ_TOOLS.filter((t) => t !== 'list_events')
    .map((t) => `${PREFIX}${t}`)
    .sort()

  rig.clearWire()
  await withHermes('main', rig.tokens.ro, async (host) => {
    // B1 discovery and exposure
    const offered = (await offeredNames(host)).sort()
    check(
      'V4b-1',
      'Hermes connects to the office MCP server and offers the model exactly the allowed office tools, under the mcp__office__ prefix, and no built-in',
      JSON.stringify(offered) === JSON.stringify(expected) &&
        rig.pg.callsTo('mcp_optional_tools').length > 0,
      `offered ${String(offered.length)}: ${offered.join(',')}`,
    )

    // B2 an allowed call end to end
    rig.pg.reset()
    const call = await runToEnd(host, 'CALL list_projects {}')
    const started = call.events.find((e) => e.event === 'tool.started')
    const done = call.events.find((e) => e.event === 'tool.completed')
    const sentProjects = rig.pg.callsTo('mcp_projects')[0]
    const recorded = rig.pg.callsTo('mcp_record_call')[0]
    check(
      'V4b-2',
      "an allowed read call completes; Hermes reports tool.started/tool.completed with the real tool name; the function binds the credential's office and records the call",
      started?.tool === `${PREFIX}list_projects` &&
        done?.error === false &&
        sentProjects?.args.p_office === rig.officeA &&
        recorded?.args.p_client_id === 'hermes-ro' &&
        recorded.args.p_outcome === 'ok' &&
        resultSeen(call).includes('harvest-lane') &&
        !resultSeen(call).includes('other-office-secret'),
      `tool=${String(started?.tool)} error=${String(done?.error)} office=${String(sentProjects?.args.p_office)} client=${String(recorded?.args.p_client_id)}`,
    )
    check(
      'V4b-3',
      'a tool result reaches the model fenced as untrusted data (Hermes wraps MCP output)',
      call.output.includes('<untrusted_tool_result'),
      'the model-visible result begins with an <untrusted_tool_result ...> block',
    )

    // B3b what Hermes's MCP client actually sent (facts recorded, and a compatibility verdict)
    const seen = new Set(rig.wire.map((w) => `${w.method} ${w.rpc ?? '-'}`))
    const asked = rig.wire.find((w) => w.rpc === 'initialize')?.requestedVersion ?? null
    const versions = [...new Set(rig.wire.map((w) => w.protocolHeader ?? 'none'))]
    const supported = new Set([
      'POST initialize',
      'POST notifications/initialized',
      'POST tools/list',
      'POST tools/call',
    ])
    // Probes Hermes sends outside JSON-RPC (found by this check on its first run): recorded with the status the function gave.
    const probes = rig.wire
      .filter((w) => w.rpc === null)
      .map((w) => `${w.method}->${String(w.status)}`)
    check(
      'V4b-10',
      'every request Hermes sends is answered without a server error, the JSON-RPC methods are the four the function implements, and the extra HEAD/GET probes are tolerated; wire facts recorded',
      rig.wire.length > 0 &&
        rig.wire.every((w) => w.status < 500) &&
        [...seen].every((s) => supported.has(s) || s === 'HEAD -' || s === 'GET -') &&
        [...supported].every((s) => seen.has(s)),
      `rpc: ${[...seen].filter((s) => supported.has(s)).join(' | ')}; non-rpc probes: ${probes.join(', ')}; asked protocol ${String(asked)} (function answers 2024-11-05, Hermes then sent mcp-protocol-version values: ${versions.join(',')}); session header ever sent: ${String(rig.wire.some((w) => w.sessionHeader))}; accept: ${[...new Set(rig.wire.map((w) => w.accept))].join(' ; ')}`,
    )

    // B4 a hallucinated write tool that was never offered
    rig.pg.reset()
    const write = await runToEnd(
      host,
      `FORCECALL ${PREFIX}create_task {"project":"harvest-lane","title":"never"}`,
    )
    const reachedWrite = rig.pg.callsTo('mcp_task_add').length
    const sawToolCall = rig.pg
      .callsTo('mcp_record_call')
      .some((c) => c.args.p_tool === 'create_task')
    check(
      'V4b-4',
      'a write tool the model names but Hermes never offered is not executed and never reaches the office',
      write.final.status === 'completed' && reachedWrite === 0 && !sawToolCall,
      `run ${String(write.final.status)}; mcp_task_add calls ${String(reachedWrite)}; record_call for create_task ${String(sawToolCall)}`,
    )

    // B5 hallucinated built-in tools
    const marker = join(outDir, 'terminal-marker')
    rmSync(marker, { force: true })
    const term = await runToEnd(host, `FORCECALL terminal {"command":"touch ${marker}"}`)
    const bridge = await runToEnd(
      host,
      `FORCECALL tool_call {"name":"terminal","arguments":{"command":"touch ${marker}"}}`,
    )
    check(
      'V4b-5',
      'a model naming a disabled built-in (terminal), directly or through the tool_call bridge name, runs nothing',
      !existsSync(marker) &&
        term.final.status === 'completed' &&
        bridge.final.status === 'completed',
      `marker created: ${String(existsSync(marker))}; runs ${String(term.final.status)}/${String(bridge.final.status)}`,
    )

    // B7 a database failure behind the office function
    rig.pg.reset()
    rig.pg.failNext('mcp_projects')
    const broken = await runToEnd(host, 'CALL list_projects {}')
    check(
      'V4b-7',
      'a database failure behind the function reaches the model only as "the tool failed"; the run still completes; no schema detail',
      broken.final.status === 'completed' &&
        !JSON.stringify(broken.events).includes('secret_table'),
      `run ${String(broken.final.status)}; output ${scrub(broken.output).slice(0, 160)}`,
    )
  })

  // B3 isolation: a credential of another office
  await withHermes('other', rig.tokens.other, async (host) => {
    rig.pg.reset()
    const r = await runToEnd(host, 'CALL list_projects {}')
    check(
      'V4b-6',
      "another office's credential sees only that office's projects through Hermes",
      resultSeen(r).includes('other-office-secret') &&
        !resultSeen(r).includes('harvest-lane') &&
        rig.pg.callsTo('mcp_projects')[0]?.args.p_office === rig.officeB,
      `p_office=${String(rig.pg.callsTo('mcp_projects')[0]?.args.p_office)}`,
    )
  })

  // B6 a MISCONFIGURED Hermes (write tool listed) with a read-only credential: the server still refuses.
  const widened = [...OFFICE_READ_TOOLS, 'create_task']
  await withHermes(
    'widened-ro',
    rig.tokens.ro,
    async (host) => {
      rig.pg.reset()
      const r = await runToEnd(
        host,
        'CALL create_task {"project":"harvest-lane","title":"should be refused"}',
      )
      const done = r.events.find((e) => e.event === 'tool.completed')
      const outcomes = rig.pg.callsTo('mcp_record_call').map((c) => String(c.args.p_outcome))
      check(
        'V4b-8',
        'even if Hermes is misconfigured to offer a write tool, a read-only credential is refused by the server and the write function is never reached',
        done?.error === true &&
          rig.pg.callsTo('mcp_task_add').length === 0 &&
          outcomes.includes('refused'),
        `tool error ${String(done?.error)}; mcp_task_add ${String(rig.pg.callsTo('mcp_task_add').length)}; outcomes ${outcomes.join(',')}`,
      )
    },
    widened,
  )
  // Control for B6: the same widened config with a write credential DOES reach the function, so the refusal above was the scope, not a dead path.
  await withHermes(
    'widened-rw',
    rig.tokens.rw,
    async (host) => {
      rig.pg.reset()
      await runToEnd(host, 'CALL create_task {"project":"harvest-lane","title":"control"}')
      check(
        'V4b-8c',
        'control for V4b-8: the identical configuration with a write credential reaches the write function',
        rig.pg.callsTo('mcp_task_add').length === 1,
        `mcp_task_add ${String(rig.pg.callsTo('mcp_task_add').length)}`,
      )
    },
    widened,
  )

  // B8 a bad credential
  // Assembled from pieces so no credential-shaped literal sits in the repository.
  await withHermes('bad', `${'mcp'}_${'definitely_not_a_valid_token_0000'}`, async (host) => {
    const offered = await offeredNames(host)
    check(
      'V4b-9',
      'with an unknown credential Hermes offers no office tool and does not crash',
      offered.every((n) => !n.startsWith(PREFIX)),
      `offered: ${offered.join(',') || '(none)'}`,
    )
  })
} finally {
  await llm.stop()
  await rig.stop()
}

writeFileSync(join(outDir, 'v4b-matrix.md'), `${matrix(checks)}\n`)
const failed = checks.filter((c) => c.verdict !== 'PASS')
console.log(`\nV4b: ${String(checks.length - failed.length)}/${String(checks.length)} passed`)
process.exit(failed.length === 0 ? 0 : 1)
