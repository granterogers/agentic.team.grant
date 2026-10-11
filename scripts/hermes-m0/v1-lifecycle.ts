/**
 * M0 experiments V1, V2, V3, V7, V9, V10, V13 and the failure, egress and authentication checks, against a REAL Hermes with a
 * scripted model (no model cost) and the real office MCP function over a fake database.
 *
 *   npx tsx scripts/hermes-m0/v1-lifecycle.ts <out-dir> <deno-binary> <hermes-host-dir> [--only s1,s2,...]
 *
 * Sections: s1 toolsets and platforms, s2 idempotency, s3 event replay, s4 stop, s5 approvals, s6 memory and skills,
 * s7 session pruning, s8 failure recovery, s9 egress, s10 memory footprint, s11 authentication.
 * Environment: MOCK model and database; real Hermes and real MCP function code.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { egressEnv, startEgress } from './egress.ts'
import {
  configYaml,
  DISABLED_TOOLSETS,
  type HermesHost,
  hermes,
  startHermes,
} from './hermes-host.ts'
import { type Check, matrix, scrub, sleep, throwaway } from './lib.ts'
import { startLlmDouble } from './llm-double.ts'
import { startRig } from './mcp-rig.ts'
import { readEvents, runToEnd, startRun, status, TERMINAL, waitTerminal } from './runs.ts'

const args = process.argv.slice(2)
const onlyIdx = args.indexOf('--only')
const only = onlyIdx === -1 ? null : new Set((args[onlyIdx + 1] ?? '').split(','))
const [outArg, denoArg, hostArg] = args
if (outArg === undefined || denoArg === undefined || hostArg === undefined) {
  console.error('usage: v1-lifecycle.ts <out-dir> <deno-binary> <hermes-host-dir> [--only s1,s2]')
  process.exit(2)
}
const outDir = resolve(outArg)
const hostDir = resolve(hostArg)
mkdirSync(outDir, { recursive: true })
const wants = (s: string): boolean => only === null || only.has(s)

const checks: Check[] = []
const check = (
  id: string,
  name: string,
  ok: boolean | 'BLOCKED',
  evidence: string,
  environment: Check['environment'] = 'mock',
): void => {
  const verdict = ok === 'BLOCKED' ? 'BLOCKED' : ok ? 'PASS' : 'FAIL'
  checks.push({ id, name, verdict, environment, evidence })
  console.log(`${verdict}  ${id}  ${name}  ${scrub(evidence)}`)
}

const llmLog = join(outDir, 'llm-lifecycle.jsonl')
rmSync(llmLog, { force: true })
const rig = await startRig({ root: resolve('.'), deno: denoArg, outDir, port: 18_086 })
const llm = await startLlmDouble(llmLog)
let port = 18_800
const up = (
  label: string,
  extra: Partial<Parameters<typeof startHermes>[0]> = {},
): Promise<HermesHost> =>
  startHermes({
    hostDir,
    home: `/tmp/hm/lc-${label}`,
    outDir,
    port: port++,
    apiKey: throwaway('apikey'),
    modelBase: llm.url,
    mcpUrl: rig.url,
    mcpToken: rig.tokens.ro,
    label: `lc-${label}`,
    ...extra,
  })
const using = async <T>(
  label: string,
  extra: Partial<Parameters<typeof startHermes>[0]>,
  fn: (h: HermesHost) => Promise<T>,
): Promise<T> => {
  const h = await up(label, extra)
  try {
    return await fn(h)
  } finally {
    await h.stop()
  }
}
const listFiles = (dir: string): string[] => {
  if (!existsSync(dir)) return []
  const out: string[] = []
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name)
      if (e.isDirectory()) walk(p)
      else out.push(p.slice(dir.length))
    }
  }
  walk(dir)
  return out.sort()
}
const rssMb = (pid: number): number => {
  try {
    const kb = /VmRSS:\s+(\d+) kB/.exec(readFileSync(`/proc/${String(pid)}/status`, 'utf8'))?.[1]
    return kb === undefined ? 0 : Number(kb) / 1024
  } catch {
    return 0
  }
}
const treeRssMb = (pid: number): number => {
  let total = rssMb(pid)
  try {
    const kids = execFileSync('pgrep', ['-P', String(pid)], { encoding: 'utf8' })
      .split('\n')
      .filter((s) => s !== '')
    for (const k of kids) total += treeRssMb(Number(k))
  } catch {
    /* no children */
  }
  return total
}

try {
  // ---------------------------------------------------------------- s1: tools off, no messaging platform
  if (wants('s1')) {
    await using('s1', {}, async (h) => {
      const ts =
        (
          (await hermes(h, 'GET', '/v1/toolsets')).body as {
            data?: { name: string; enabled: boolean }[]
          } | null
        )?.data ?? []
      const enabled = ts.filter((t) => t.enabled).map((t) => t.name)
      check(
        'V1-1',
        '/v1/toolsets with the hardened config lists no built-in toolset as enabled; the response shape is {data:[{name,enabled,tools,...}]}',
        ts.length > 10 && enabled.length === 0,
        `${String(ts.length)} toolsets listed, enabled: [${enabled.join(',')}] (the MCP server is not a built-in and is not listed here; its tools are shown by V4b-1)`,
      )
      const detailed = (await hermes(h, 'GET', '/health/detailed')).body as Record<
        string,
        unknown
      > | null
      const platforms = Object.keys((detailed?.platforms ?? {}) as Record<string, unknown>)
      check(
        'V1-2',
        'the running gateway has exactly one platform, the API server: no chat platform is configured, so it cannot message a person',
        platforms.length === 1 && platforms[0] === 'api_server',
        `platforms: ${platforms.join(',') || '(none reported)'}; detail keys: ${Object.keys(detailed ?? {}).join(',')}`,
      )
      const sendMsg = await runToEnd(
        h,
        'FORCECALL send_message {"target":"telegram","message":"hello"}',
      )
      check(
        'V1-3',
        'a model naming send_message (messaging) runs nothing: no such tool is registered under the hardened config',
        sendMsg.final.status === 'completed' &&
          !sendMsg.events.some((e) => e.event === 'tool.started'),
        `run ${String(sendMsg.final.status)}; tool.started events: ${String(sendMsg.events.filter((e) => e.event === 'tool.started').length)}`,
      )
    })
    // Control: the DEFAULT api-server config exposes built-ins, so the hardening above is doing the work.
    await using('s1c', { toolsets: ['hermes-api-server'], disabledToolsets: [] }, async (h) => {
      const r = await runToEnd(h, 'TOOLS')
      const names = (/TOOLS: (\[.*\])/s.exec(r.output)?.[1] ?? '[]') as string
      const offered = JSON.parse(names) as string[]
      check(
        'V1-4',
        'control: the DEFAULT api-server toolset offers the model built-ins including terminal and file tools (so V1-1 and V4b-1 prove the hardening, not an empty product)',
        offered.includes('terminal') && offered.length > 10,
        `${String(offered.length)} tools offered by default, including: ${offered.filter((n) => ['terminal', 'read_file', 'write_file', 'web_search', 'browser_navigate', 'execute_code', 'delegate_task', 'memory', 'cronjob'].includes(n)).join(',')}`,
      )
    })
  }

  // ---------------------------------------------------------------- s2: idempotent run creation
  if (wants('s2')) {
    await using('s2', {}, async (h) => {
      const key = `engine-run-${throwaway('k').slice(2, 18)}`
      const body = { input: 'a plain question', session_id: 'engine-run-session-1' }
      const a = await startRun(h, body, { 'Idempotency-Key': key })
      await waitTerminal(h, a.runId ?? '')
      const b = await startRun(h, body, { 'Idempotency-Key': key })
      const c = await startRun(
        h,
        { ...body, input: 'a different question' },
        { 'Idempotency-Key': key },
      )
      const bad = await startRun(h, body, { 'Idempotency-Key': 'has a space' })
      const d = await startRun(h, body)
      // max_concurrent_runs is 1 (HD-6): wait for the first keyless run before starting the second.
      await waitTerminal(h, d.runId ?? '')
      const e = await startRun(h, body)
      const sess = a.runId === null ? {} : await status(h, a.runId)
      await waitTerminal(h, e.runId ?? '')
      check(
        'V2-1',
        'same Idempotency-Key and byte-identical body returns the SAME run (replayed:true); the same key with a different body is refused (409); a malformed key is refused (400)',
        a.runId !== null &&
          b.runId === a.runId &&
          (b.body as { replayed?: boolean }).replayed === true &&
          c.status === 409 &&
          bad.status === 400,
        `first ${String(a.status)} replayed=${String((a.body as { replayed?: boolean }).replayed)}; repeat ${String(b.status)} same run=${String(b.runId === a.runId)} replayed=${String((b.body as { replayed?: boolean }).replayed)}; different body ${String(c.status)}; bad key ${String(bad.status)}`,
      )
      check(
        'V2-2',
        'control: requests without a key are independent runs, and session_id is honoured',
        d.runId !== null &&
          e.runId !== null &&
          d.runId !== e.runId &&
          sess.session_id === 'engine-run-session-1',
        `two keyless runs differ: ${String(d.runId !== e.runId)} (statuses ${String(d.status)}/${String(e.status)}); session_id on status: ${String(sess.session_id)}`,
      )
      // The office sends its brief as `instructions` and the thread as `conversation_history` (INTERFACE-CONTRACTS section 7).
      const mark = 'BRIEF-MARK-7f3a'
      const brief = await runToEnd(h, `DUMP ${mark}`, {
        instructions: `You answer for the office. ${mark}`,
        conversation_history: [
          { role: 'user', content: 'what did we decide about the venue?' },
          { role: 'assistant', content: 'We kept the original date.' },
        ],
      })
      const digest = JSON.parse(/DUMP: (\{.*\})/s.exec(brief.output)?.[1] ?? '{}') as {
        roles?: string[]
        systemHasMark?: boolean
        earlier?: string[]
      }
      check(
        'V2-7',
        '`instructions` reaches the model inside the system message, and `conversation_history` arrives as earlier user/assistant turns before the new input, in order',
        digest.systemHasMark === true &&
          (digest.earlier ?? []).length === 2 &&
          (digest.earlier?.[0] ?? '').startsWith('user:what did we decide') &&
          (digest.earlier?.[1] ?? '').startsWith('assistant:We kept'),
        `roles in order: ${(digest.roles ?? []).join(',')}; marker in system message: ${String(digest.systemHasMark)}; earlier turns: ${(digest.earlier ?? []).join(' | ')}`,
      )
      // The concurrency cap (HD-6): a second run while one is active is refused, and the first is unharmed.
      const first = await startRun(h, { input: 'SLOW 60' })
      await sleep(1500)
      const second = await startRun(h, { input: 'a plain question' })
      const stillRunning = first.runId === null ? {} : await status(h, first.runId)
      await hermes(h, 'POST', `/v1/runs/${first.runId ?? ''}/stop`)
      await waitTerminal(h, first.runId ?? '', 40_000)
      check(
        'V2-6',
        'with max_concurrent_runs 1, a second run started while one is active is refused (429) and the active run is unharmed',
        first.status === 202 && second.status === 429 && stillRunning.status === 'running',
        `first ${String(first.status)}, second ${String(second.status)} ${JSON.stringify(second.body).slice(0, 160)}; first's status meanwhile: ${String(stillRunning.status)}`,
      )
    })
  }

  // ---------------------------------------------------------------- s3: replayable event stream
  if (wants('s3')) {
    await using('s3', {}, async (h) => {
      const r = await runToEnd(h, 'CALL list_projects {}')
      const id = r.started.runId ?? ''
      const all = r.events.map((e) => Number((e as { seq?: number }).seq))
      const mid = all[1] ?? 0
      const viaQuery = await fetch(`${h.url}/v1/runs/${id}/events?last_seq=${String(mid)}`, {
        headers: { authorization: `Bearer ${h.key}` },
      })
      const queryText = await viaQuery.text()
      const querySeqs = [...queryText.matchAll(/"seq":\s*(\d+)/g)].map((m) => Number(m[1]))
      const viaHeader = await readEvents(h, id, { lastEventId: mid })
      const headerSeqs = viaHeader.events.map((e) => Number((e as { seq?: number }).seq))
      const idLines = [...queryText.matchAll(/^id:\s*(\S+)/gm)].map((m) => m[1])
      check(
        'V2-3',
        "a finished run's events can be replayed after the fact; last_seq (query) and Last-Event-ID (header) both resume strictly after the given sequence number",
        all.length >= 4 &&
          querySeqs.length > 0 &&
          querySeqs.every((s) => s > mid) &&
          headerSeqs.length > 0 &&
          headerSeqs.every((s) => s > mid),
        `original seqs ${all.join(',')}; resume after ${String(mid)} -> query ${querySeqs.join(',')} header ${headerSeqs.join(',')}; SSE id: lines present: ${String(idLines.length > 0)} (${idLines.join(',')})`,
      )
      const status404 = await hermes(
        h,
        'GET',
        '/v1/runs/run_00000000000000000000000000000000/events',
      )
      check(
        'V2-4',
        'events of an unknown run are 404',
        status404.status === 404,
        `status ${String(status404.status)}`,
      )
    })
  }

  // ---------------------------------------------------------------- s4: stop
  if (wants('s4')) {
    await using('s4', {}, async (h) => {
      // a) during a model stream
      const slow = await startRun(h, { input: 'SLOW 120' })
      await sleep(3000)
      const t0 = Date.now()
      const stop = await hermes(h, 'POST', `/v1/runs/${slow.runId ?? ''}/stop`)
      const fin = await waitTerminal(h, slow.runId ?? '', 40_000)
      const sec = (Date.now() - t0) / 1000
      const ev = await readEvents(h, slow.runId ?? '', { timeoutMs: 5000 })
      check(
        'V3-1',
        'stop during a model stream: POST /stop answers "stopping", the run reaches cancelled (event run.cancelled, interrupted:true) within 30 s',
        stop.status === 200 &&
          fin.status === 'cancelled' &&
          sec < 30 &&
          ev.events.some((e) => e.event === 'run.cancelled'),
        `stop ${String(stop.status)} ${JSON.stringify(stop.body)}; final ${String(fin.status)} after ${sec.toFixed(1)} s; interrupted=${String(fin.interrupted)}; turn_exit_reason=${String(fin.turn_exit_reason)}`,
      )
      // b) during an MCP tool call
      rig.pg.reset()
      rig.pg.delayNext('mcp_projects', 25_000)
      const tool = await startRun(h, { input: 'CALL list_projects {}' })
      await sleep(3500)
      const t1 = Date.now()
      await hermes(h, 'POST', `/v1/runs/${tool.runId ?? ''}/stop`)
      const fin2 = await waitTerminal(h, tool.runId ?? '', 45_000)
      const sec2 = (Date.now() - t1) / 1000
      check(
        'V3-2',
        'stop during a slow MCP tool call (database takes 25 s): the run still reaches a terminal state; time recorded (this is what the bridge\'s "wait up to 30 s, then report" rule must expect)',
        TERMINAL.includes(String(fin2.status)),
        `final ${String(fin2.status)} ${sec2.toFixed(1)} s after the stop request (the tool call was ${sec2 < 20 ? 'abandoned promptly' : 'allowed to finish'}); interrupted=${String(fin2.interrupted)}`,
      )
      // c) stop on a terminal run, unknown run, bad key
      const again = await hermes(h, 'POST', `/v1/runs/${slow.runId ?? ''}/stop`)
      const unknown = await hermes(h, 'POST', '/v1/runs/run_00000000000000000000000000000000/stop')
      const forged = await fetch(`${h.url}/v1/runs/${slow.runId ?? ''}/stop`, {
        method: 'POST',
        headers: { authorization: 'Bearer wrong' },
      })
      check(
        'V3-3',
        'stop on a finished run is a harmless 200 with its terminal status; on an unknown run 404; with a wrong key 401',
        again.status === 200 && unknown.status === 404 && forged.status === 401,
        `terminal ${String(again.status)}, unknown ${String(unknown.status)}, wrong key ${String(forged.status)}`,
      )
    })
  }

  // ---------------------------------------------------------------- s5: approvals
  if (wants('s5')) {
    const victim = join(outDir, 'approval-victim')
    const fresh = (): void => {
      rmSync(victim, { recursive: true, force: true })
      mkdirSync(victim, { recursive: true })
      writeFileSync(join(victim, 'keep.txt'), 'x')
    }
    const withTerminal = DISABLED_TOOLSETS.filter((t) => t !== 'terminal')
    await using(
      's5',
      {
        toolsets: ['office', 'terminal'],
        disabledToolsets: withTerminal,
        extraConfig: 'approvals:\n  mode: manual\n  timeout: 25\n',
      },
      async (h) => {
        fresh()
        const cmd = `rm -rf ${victim}`
        // deny
        const run = await startRun(h, {
          input: `CALL terminal ${JSON.stringify({ command: cmd })}`,
        })
        const gotRequest = await readEvents(h, run.runId ?? '', {
          timeoutMs: 40_000,
          stopAfter: (e) => e.event === 'approval.request',
        })
        const req = gotRequest.events.find((e) => e.event === 'approval.request')
        const waiting = await status(h, run.runId ?? '')
        const reqId = typeof req?.request_id === 'string' ? req.request_id : undefined
        const bad = await hermes(h, 'POST', `/v1/runs/${run.runId ?? ''}/approval`, {
          choice: 'maybe',
        })
        const forged = await fetch(`${h.url}/v1/runs/${run.runId ?? ''}/approval`, {
          method: 'POST',
          headers: { authorization: 'Bearer wrong', 'content-type': 'application/json' },
          body: '{"choice":"once"}',
        })
        const deny = await hermes(h, 'POST', `/v1/runs/${run.runId ?? ''}/approval`, {
          choice: 'deny',
          ...(reqId === undefined ? {} : { request_id: reqId }),
        })
        const end = await waitTerminal(h, run.runId ?? '', 40_000)
        const stillThere = existsSync(join(victim, 'keep.txt'))
        check(
          'V9-1',
          'a dangerous terminal command raises approval.request and parks the run (waiting_for_approval); answering deny leaves the target untouched',
          req !== undefined &&
            waiting.status === 'waiting_for_approval' &&
            deny.status === 200 &&
            stillThere &&
            TERMINAL.includes(String(end.status)),
          `approval.request seen: ${String(req !== undefined)} (fields: ${Object.keys(req ?? {}).join(',')}); status while waiting: ${String(waiting.status)}; deny -> ${String(deny.status)}; victim intact: ${String(stillThere)}; run ended ${String(end.status)}`,
        )
        check(
          'V9-2',
          'a forged approval is refused: an unknown choice is 400, a wrong API key 401, a run with nothing pending 409',
          bad.status === 400 &&
            forged.status === 401 &&
            (await hermes(h, 'POST', `/v1/runs/${run.runId ?? ''}/approval`, { choice: 'once' }))
              .status === 409,
          `bad choice ${String(bad.status)}, wrong key ${String(forged.status)}, after settle ${String((await hermes(h, 'POST', `/v1/runs/${run.runId ?? ''}/approval`, { choice: 'once' })).status)}`,
        )
        // once: the positive control, then a second identical run must ask again (an approval is not remembered)
        fresh()
        const run2 = await startRun(h, {
          input: `CALL terminal ${JSON.stringify({ command: cmd })}`,
        })
        const req2 = await readEvents(h, run2.runId ?? '', {
          timeoutMs: 40_000,
          stopAfter: (e) => e.event === 'approval.request',
        })
        const id2 = req2.events.find((e) => e.event === 'approval.request')?.request_id
        await hermes(h, 'POST', `/v1/runs/${run2.runId ?? ''}/approval`, {
          choice: 'once',
          ...(typeof id2 === 'string' ? { request_id: id2 } : {}),
        })
        await waitTerminal(h, run2.runId ?? '', 40_000)
        const removed = !existsSync(join(victim, 'keep.txt'))
        fresh()
        const run3 = await startRun(h, {
          input: `CALL terminal ${JSON.stringify({ command: cmd })}`,
        })
        const req3 = await readEvents(h, run3.runId ?? '', {
          timeoutMs: 40_000,
          stopAfter: (e) => e.event === 'approval.request',
        })
        const asksAgain = req3.events.some((e) => e.event === 'approval.request')
        await hermes(h, 'POST', `/v1/runs/${run3.runId ?? ''}/stop`)
        await waitTerminal(h, run3.runId ?? '', 40_000)
        check(
          'V9-3',
          "control and re-use: approving once performs the command (so V9-1's untouched target was the approval, not a dead path), and an identical command in a later run asks again (a once-approval is not reusable)",
          removed && asksAgain,
          `approved once -> target removed: ${String(removed)}; same command in the next run asks again: ${String(asksAgain)}`,
        )
      },
    )
    rmSync(victim, { recursive: true, force: true })
  }

  // ---------------------------------------------------------------- s6: memory and skills
  if (wants('s6')) {
    const home = '/tmp/hm/lc-s6'
    await using('s6', {}, async (h) => {
      const before = listFiles(`${home}/memories`).concat(listFiles(`${home}/skills`))
      await runToEnd(h, 'CALL list_projects {}')
      await runToEnd(h, 'FORCECALL memory {"action":"add","target":"memory","content":"remember"}')
      await runToEnd(
        h,
        'FORCECALL skill_manage {"action":"create","name":"m0-probe","content":"---\\nname: m0-probe\\ndescription: probe\\n---\\n# probe\\n"}',
      )
      const after = listFiles(`${home}/memories`).concat(listFiles(`${home}/skills`))
      const newFiles = after.filter((f) => !before.includes(f))
      check(
        'V10-1',
        'with memory and skills disabled, a run and even forced memory/skill_manage calls write nothing under memories/ or skills/',
        newFiles.length === 0,
        `files before ${String(before.length)}, after ${String(after.length)}; new: ${newFiles.join(',') || 'none'}`,
      )
    })
    // Control: with memory and the skills toolset ON, the same calls DO write.
    const home2 = '/tmp/hm/lc-s6c'
    const skillsDir = join(outDir, 'skills-create-dir')
    rmSync(skillsDir, { recursive: true, force: true })
    mkdirSync(skillsDir, { recursive: true })
    await using(
      's6c',
      {
        toolsets: ['office', 'memory', 'skills'],
        disabledToolsets: DISABLED_TOOLSETS.filter((t) => t !== 'memory' && t !== 'skills'),
        skillsCreateDir: skillsDir,
      },
      async (h) => {
        await runToEnd(
          h,
          'FORCECALL skill_manage {"action":"create","name":"m0-probe","content":"---\\nname: m0-probe\\ndescription: a probe skill for the validation harness\\n---\\n# probe\\nDo nothing.\\n"}',
        )
        const skillFiles = listFiles(skillsDir)
        const inHome = listFiles(`${home2}/skills`).filter((f) => f.includes('m0-probe'))
        check(
          'V10-2',
          'control: with the skills toolset enabled, a created skill appears, and appears ONLY in skills.create_dir (an isolated directory the bridge can harvest then wipe)',
          skillFiles.some((f) => f.includes('m0-probe')) && inHome.length === 0,
          `in create_dir: ${skillFiles.join(',') || 'none'}; in HERMES_HOME/skills: ${inHome.join(',') || 'none'}`,
        )
      },
    )
  }

  // ---------------------------------------------------------------- s7: pruning sessions
  if (wants('s7')) {
    const home = '/tmp/hm/lc-s7'
    const env = {
      PATH: `${hostDir}/venv/bin:/usr/bin:/bin`,
      HOME: join(hostDir, 'work'),
      HERMES_HOME: home,
    }
    const hermesBin = join(hostDir, 'venv/bin/hermes')
    const cli = (a: string[]): string => {
      try {
        return execFileSync(hermesBin, a, {
          env,
          encoding: 'utf8',
          timeout: 60_000,
          stdio: ['ignore', 'pipe', 'pipe'],
        })
      } catch (error) {
        return `EXIT ${String((error as { status?: number }).status)}: ${String((error as { stdout?: string }).stdout ?? '')}${String((error as { stderr?: string }).stderr ?? '')}`
      }
    }
    const summary = (s: string): string => s.replace(/\s+/g, ' ').slice(0, 200)
    const h = await up('s7', {})
    let liveAttempt = ''
    try {
      for (let i = 0; i < 3; i += 1) await runToEnd(h, 'a plain question')
      // While Hermes is running: the documented prune is refused to protect its live database.
      liveAttempt = cli(['sessions', 'prune', '--older-than', '0', '--yes'])
    } finally {
      await h.stop()
    }
    // With Hermes stopped.
    const listed = cli(['sessions', 'list'])
    const offlinePrune = cli(['sessions', 'prune', '--older-than', '0', '--yes'])
    const ids = [...listed.matchAll(/\b(run_[0-9a-f]{32})\b/g)].map((m) => m[1] ?? '')
    const deleted = ids.map((id) => cli(['sessions', 'delete', id, '--yes']))
    const after = cli(['sessions', 'list'])
    writeFileSync(
      join(outDir, 'v13-prune.txt'),
      scrub(
        `LIST (stopped)\n${listed}\nPRUNE while running\n${liveAttempt}\nPRUNE offline\n${offlinePrune}\nDELETE\n${deleted.join('\n')}\nAFTER\n${after}\n`,
      ),
    )
    check(
      'V13-1',
      'session retention: `prune` refuses while Hermes runs and skips open (API) sessions even offline; `hermes sessions delete <id>` with Hermes stopped removes them (a maintenance-window procedure, not a live prune)',
      /another process is using/.test(liveAttempt) &&
        ids.length >= 3 &&
        !/run_[0-9a-f]{32}/.test(after),
      `ids found ${String(ids.length)}; prune while running: ${summary(liveAttempt)}; prune offline: ${summary(offlinePrune)}; after delete: ${summary(after)}`,
    )
  }

  // ---------------------------------------------------------------- s8: failure and recovery
  if (wants('s8')) {
    await using('s8', {}, async (h) => {
      const callsFor = (word: string): number =>
        existsSync(llmLog)
          ? readFileSync(llmLog, 'utf8')
              .split('\n')
              .filter((l) => l.includes(`"command":"${word}`)).length
          : 0
      // A provider that keeps failing: Hermes retries with backoff rather than failing fast, so what matters to the bridge is
      // that the run is observable, bounded in its call rate, and ALWAYS stoppable.
      for (const [word, id, what] of [
        ['ERR500', 'V5-5', 'a persistent provider 500'],
        ['RATELIMIT', 'V5-6', 'a persistent free-capacity 429'],
      ] as const) {
        const before = callsFor(word)
        const started = await startRun(h, { input: word })
        const t0 = Date.now()
        await sleep(60_000)
        const mid = await status(h, started.runId ?? '')
        const callsIn60 = callsFor(word) - before
        const t1 = Date.now()
        await hermes(h, 'POST', `/v1/runs/${started.runId ?? ''}/stop`)
        const fin = await waitTerminal(h, started.runId ?? '', 40_000)
        const stopSec = (Date.now() - t1) / 1000
        check(
          id,
          `${what}: the run is not wedged: after 60 s it is observable (status ${String(mid.status)}), it made ${String(callsIn60)} model calls, and a stop ends it as cancelled or failed within 30 s (the bridge must therefore enforce a deadline and a no-progress limit itself)`,
          TERMINAL.includes(String(fin.status)) && stopSec < 30 && callsIn60 > 0,
          `after 60 s status ${String(mid.status)}; model calls in the window ${String(callsIn60)}; stop -> ${String(fin.status)} in ${stopSec.toFixed(1)} s; last error field: ${scrub(String(fin.error ?? mid.error ?? 'none')).slice(0, 160)}; elapsed ${((Date.now() - t0) / 1000).toFixed(0)} s`,
        )
      }
    })
    // Hermes killed mid-run, restarted on the same home
    const first = await up('s8k', {})
    const key1 = `engine-run-${throwaway('k').slice(2, 18)}`
    const body = { input: 'SLOW 120', session_id: 'engine-run-recover' }
    const started = await startRun(first, body, { 'Idempotency-Key': key1 })
    await sleep(3000)
    const pid = first.child.proc.pid
    if (pid !== undefined) process.kill(pid, 'SIGKILL')
    await sleep(1500)
    const apiKey = first.key
    let second: HermesHost | null = null
    try {
      second = await startHermes({
        hostDir,
        home: '/tmp/hm/lc-s8k',
        outDir,
        port: port++,
        apiKey,
        modelBase: llm.url,
        mcpUrl: rig.url,
        mcpToken: rig.tokens.ro,
        label: 'lc-s8k2',
        keepHome: true,
      })
      const st = await hermes(second, 'GET', `/v1/runs/${started.runId ?? ''}`)
      const replay = await startRun(second, body, { 'Idempotency-Key': key1 })
      const fresh = await startRun(second, { input: 'a plain question' })
      check(
        'V2-5',
        "Hermes killed mid-run and restarted on the same home: the old run's status and the idempotency reservation after restart are recorded (this decides the bridge's re-attach rule)",
        fresh.status === 202,
        `old run status via GET: ${String(st.status)} ${JSON.stringify(st.body).slice(0, 220)}; same key + same body re-POST: ${String(replay.status)} run_id ${replay.runId === started.runId ? 'SAME' : String(replay.runId)} body ${JSON.stringify(replay.body).slice(0, 200)}; a fresh run is accepted: ${String(fresh.status === 202)}`,
      )
    } catch (error) {
      check(
        'V2-5',
        'Hermes restarts on the same home after a kill',
        false,
        `restart failed: ${scrub(String((error as Error).message))}`,
      )
    } finally {
      await second?.stop()
    }
    // The 64K context floor
    const small = await startLlmDouble(join(outDir, 'llm-small.jsonl'), { contextLength: 32_768 })
    try {
      await using('s8s', { modelBase: small.url, contextLength: null }, async (h) => {
        const r = await runToEnd(h, 'a plain question', {}, 60_000)
        check(
          'V5-7',
          'Hermes refuses a model whose context window is under 64,000 tokens (detected from the endpoint): the run does not complete',
          r.final.status !== 'completed',
          `status ${String(r.final.status)}; error: ${scrub(String(r.final.error ?? r.events.map((e) => JSON.stringify(e)).join(' '))).slice(0, 260)}`,
        )
      })
    } finally {
      await small.stop()
    }
  }

  // ---------------------------------------------------------------- s9: egress
  if (wants('s9')) {
    const eg = await startEgress()
    try {
      await using('s9', { env: egressEnv(eg.url) }, async (h) => {
        await runToEnd(h, 'CALL list_projects {}')
        await runToEnd(h, 'a plain question')
        await sleep(3000)
      })
    } finally {
      await eg.stop()
    }
    const hosts = [...eg.attempts].sort()
    writeFileSync(join(outDir, 'v1-egress.txt'), `${hosts.join('\n')}\n`)
    check(
      'V1-5',
      'every outbound attempt Hermes makes through the standard proxy variables during startup and two runs is recorded; the expected set is EMPTY (loopback is excluded: the model and MCP double are local)',
      hosts.length === 0,
      hosts.length === 0 ? 'no host was contacted' : `hosts attempted: ${hosts.join(', ')}`,
    )
    // Control: a found-nothing check must be shown able to find something. Point a Hermes at a non-local model host.
    const eg2 = await startEgress()
    try {
      await using(
        's9c',
        {
          env: egressEnv(eg2.url),
          modelBase: 'http://control.example.test',
          contextLength: 131_072,
        },
        async (h) => {
          await startRun(h, { input: 'a plain question' })
          await sleep(6000)
        },
      )
    } finally {
      await eg2.stop()
    }
    check(
      'V1-6',
      'control for V1-5: with the model host set to a non-local name, the recorder DOES see Hermes try to reach it (so an empty V1-5 is a real result)',
      [...eg2.attempts].some((a) => a.startsWith('control.example.test')),
      `attempts: ${[...eg2.attempts].sort().join(', ') || 'none'}`,
    )
  }

  // ---------------------------------------------------------------- s10: memory footprint
  if (wants('s10')) {
    await using('s10', {}, async (h) => {
      const pid = h.child.proc.pid ?? 0
      const idle = treeRssMb(pid)
      let peak = idle
      const start = startRun(h, { input: 'CALL list_projects {}' })
      const until = Date.now() + 12_000
      while (Date.now() < until) {
        peak = Math.max(peak, treeRssMb(pid))
        await sleep(100)
      }
      await start
      const floor = rssMb(process.pid)
      check(
        'V7-1',
        'resident memory of Hermes (process tree) idle and at its peak during a run, recorded; this decides whether a 1 GB VM is viable',
        idle > 0,
        `idle ${idle.toFixed(0)} MB, peak during one tool-calling run ${peak.toFixed(0)} MB (the harness's own Node process is ${floor.toFixed(0)} MB, a floor for the bridge, which is not built yet)`,
        'local',
      )
    })
  }

  // ---------------------------------------------------------------- s12: multiplexed profiles (for the skill-learning milestone)
  if (wants('s12')) {
    const home = '/tmp/hm/lc-s12'
    const learnKey = throwaway('apikey')
    const learnDir = join(outDir, 'learn-skills')
    rmSync(learnDir, { recursive: true, force: true })
    mkdirSync(learnDir, { recursive: true })
    // Initialise the default home, then create the named profile offline.
    const init = await up('s12', {})
    const defaultKey = init.key
    await init.stop()
    const env = {
      PATH: `${hostDir}/venv/bin:/usr/bin:/bin`,
      HOME: join(hostDir, 'work'),
      HERMES_HOME: home,
    }
    let createOut = ''
    try {
      createOut = execFileSync(
        join(hostDir, 'venv/bin/hermes'),
        ['profile', 'create', 'hermes-learn', '--no-alias', '--no-skills'],
        { env, encoding: 'utf8', timeout: 60_000, stdio: ['ignore', 'pipe', 'pipe'] },
      )
    } catch (error) {
      createOut = `EXIT: ${String((error as { stdout?: string }).stdout ?? '')}${String((error as { stderr?: string }).stderr ?? '')}`
    }
    const profileDir = join(home, 'profiles', 'hermes-learn')
    const created = existsSync(profileDir)
    const apiPort = port++
    if (created) {
      // The learn profile: skills ON, no office access, its own key and its own isolated skills directory.
      writeFileSync(
        join(profileDir, 'config.yaml'),
        configYaml({
          hostDir,
          home: profileDir,
          outDir,
          port: 0,
          apiKey: learnKey,
          modelBase: llm.url,
          toolsets: ['skills'],
          disabledToolsets: DISABLED_TOOLSETS.filter((t) => t !== 'skills'),
          skillsCreateDir: learnDir,
          label: 'learn',
        }),
      )
      writeFileSync(join(profileDir, '.env'), `API_SERVER_KEY=${learnKey}\n`)
      // In multiplex mode every profile reads its secrets from its OWN .env, not from the process environment.
      writeFileSync(
        join(home, '.env'),
        `API_SERVER_ENABLED=true\nAPI_SERVER_HOST=127.0.0.1\nAPI_SERVER_PORT=${String(apiPort)}\nAPI_SERVER_KEY=${defaultKey}\nOFFICE_ENGINE_MCP_TOKEN=${rig.tokens.ro}\n`,
      )
    }
    let h: HermesHost | null = null
    try {
      h = await up('s12', { keepHome: true, apiKey: defaultKey, port: apiPort })
      const asLearn = async (
        method: string,
        path: string,
        body?: unknown,
        key = learnKey,
      ): Promise<{ status: number; body: unknown }> => {
        const r = await fetch(`${h?.url ?? ''}/p/hermes-learn${path}`, {
          method,
          headers: {
            authorization: `Bearer ${key}`,
            ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        })
        const t = await r.text()
        let parsed: unknown = t
        try {
          parsed = JSON.parse(t)
        } catch {
          /* text */
        }
        return { status: r.status, body: parsed }
      }
      const learnTs = await asLearn('GET', '/v1/toolsets')
      const learnEnabled = (
        (learnTs.body as { data?: { name: string; enabled: boolean }[] } | null)?.data ?? []
      )
        .filter((t) => t.enabled)
        .map((t) => t.name)
      const defaultTs =
        (
          (await hermes(h, 'GET', '/v1/toolsets')).body as {
            data?: { name: string; enabled: boolean }[]
          } | null
        )?.data ?? []
      const defaultEnabled = defaultTs.filter((t) => t.enabled).map((t) => t.name)
      const crossKey = await asLearn('GET', '/v1/toolsets', undefined, defaultKey)
      check(
        'V11-3',
        'a second profile is served at /p/<profile>/ with its OWN toolsets and its OWN key: it has skills enabled, the default profile has none, and the default key is refused on the second profile',
        created &&
          learnTs.status === 200 &&
          learnEnabled.includes('skills') &&
          defaultEnabled.length === 0 &&
          crossKey.status === 401,
        `profile dir created: ${String(created)}; learn toolsets enabled: [${learnEnabled.join(',')}] (status ${String(learnTs.status)}); default enabled: [${defaultEnabled.join(',')}]; default key on the learn profile: ${String(crossKey.status)}; create output: ${scrub(createOut).replace(/\s+/g, ' ').slice(0, 160)}`,
      )
      // Isolation of writes: the skill lands in the learn profile's create_dir only when asked of the learn profile.
      const skill =
        'FORCECALL skill_manage {"action":"create","name":"m0-learned","content":"---\\nname: m0-learned\\ndescription: a probe skill for the validation harness\\n---\\n# probe\\nDo nothing.\\n"}'
      const learnRun = await asLearn('POST', '/v1/runs', { input: skill })
      const learnId = (learnRun.body as { run_id?: string } | null)?.run_id ?? ''
      for (let i = 0; i < 60 && learnId !== ''; i += 1) {
        const s = await asLearn('GET', `/v1/runs/${learnId}`)
        if (TERMINAL.includes(String((s.body as { status?: string } | null)?.status))) break
        await sleep(500)
      }
      const defaultRun = await runToEnd(h, skill)
      const landed = listFiles(learnDir).filter((f) => f.includes('m0-learned'))
      check(
        'V11-4',
        'the same skill-creating call writes a skill when made to the learn profile and writes nothing when made to the default profile',
        learnRun.status === 202 &&
          landed.length > 0 &&
          defaultRun.final.status === 'completed' &&
          !listFiles(`${home}/skills`).some((f) => f.includes('m0-learned')),
        `learn run ${String(learnRun.status)}; files in the learn create_dir: ${landed.join(',') || 'none'}; default-profile run ${String(defaultRun.final.status)} and default skills dir has no m0-learned`,
      )
    } finally {
      await h?.stop()
    }
  }

  // ---------------------------------------------------------------- s11: authentication of the Hermes API
  if (wants('s11')) {
    await using('s11', {}, async (h) => {
      const none = await fetch(`${h.url}/v1/runs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{"input":"x"}',
      })
      const wrong = await fetch(`${h.url}/v1/runs`, {
        method: 'POST',
        headers: { authorization: 'Bearer wrong', 'content-type': 'application/json' },
        body: '{"input":"x"}',
      })
      const health = await fetch(`${h.url}/health`)
      const caps = await fetch(`${h.url}/v1/capabilities`)
      check(
        'X-AUTH-1',
        'the Hermes API requires the bearer key: no key and a wrong key are 401 on /v1/runs (and /v1/capabilities); /health is open for liveness',
        none.status === 401 && wrong.status === 401 && caps.status === 401 && health.status === 200,
        `no key ${String(none.status)}, wrong key ${String(wrong.status)}, capabilities without key ${String(caps.status)}, health ${String(health.status)}`,
      )
    })
    // A weak key: the server refuses to start.
    let started = false
    try {
      const weak = await startHermes({
        hostDir,
        home: '/tmp/hm/lc-weak',
        outDir,
        port: port++,
        apiKey: 'abc',
        modelBase: llm.url,
        label: 'lc-weak',
      })
      started = true
      await weak.stop()
    } catch {
      started = false
    }
    check(
      'X-AUTH-2',
      'Hermes refuses to start its API server with a weak key (a 3-character key never serves /health)',
      !started,
      `server came up with the weak key: ${String(started)}`,
    )
  }
} finally {
  await llm.stop()
  await rig.stop()
}

writeFileSync(
  join(outDir, `lifecycle-matrix${only === null ? '' : `-${[...only].join('-')}`}.md`),
  `${matrix(checks)}\n`,
)
const failed = checks.filter((c) => c.verdict === 'FAIL')
console.log(
  `\nlifecycle: ${String(checks.length - failed.length)}/${String(checks.length)} not failed`,
)
process.exit(failed.length === 0 ? 0 : 1)
