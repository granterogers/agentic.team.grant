// biome-ignore-all lint/suspicious/noExplicitAny: Hermes answers are untyped
// biome-ignore-all format: an evidence probe kept readable as written
/**
 * M8 / audit probe: what a REAL Hermes (the pinned commit) does with the three things the learning design assumes. Scripted model, loopback, no
 * provider, no spend, no database, no repository code under test except the bridge's own HermesClient.
 *
 *   HERMES_HOST_DIR=<dir with venv/> npx tsx scripts/hermes-m0/m8-learning-probe.ts
 *
 *   P1. a `/p/hermes-learn/` prefix on a host that serves no such profile: refused (fail closed) or silently answered by the default profile?
 *   P2. `skills.external_dirs`: is a skill in a directory the host lists shown to the model, with the skills toolset OFF (the host kit's setting)?
 *   P3. an unapproved skill: one that is NOT in that directory is never shown, and removing a skill from the directory removes it at the next run.
 *   P4. with skills off, is a skill-writing tool offered to the model at all, so can Hermes write anything into the reference directory?
 *
 * Its output is evidence for docs/hermes/RELEASE-READINESS.md. It is not a gate: it needs a Hermes install.
 */
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { HermesClient, type Started } from '../hermes-bridge/hermes-client.ts'
import { DISABLED_TOOLSETS, startHermes } from './hermes-host.ts'
import { sleep } from './lib.ts'
import { startLlmDouble } from './llm-double.ts'

const hostDir = process.env.HERMES_HOST_DIR
if (hostDir === undefined || hostDir === '') { console.error('HERMES_HOST_DIR is required'); process.exit(2) }
const out = mkdtempSync(join(tmpdir(), 'm8-probe-'))
const llm = await startLlmDouble(join(out, 'llm.jsonl'))
const key = `hk${createHash('sha256').update(String(Date.now())).digest('hex')}`
let failed = 0
const check = (what: string, ok: boolean, detail = ''): void => { if (!ok) failed += 1; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail === '' ? '' : ` - ${detail}`}`) }

const SKILL = (name: string, body: string): string => `---\nname: ${name}\ndescription: Use when a question is about the project plan and its dates.\n---\n\n# ${name}\n\n${body}\n`
const refDir = join(out, 'reference')
mkdirSync(join(refDir, 'plan-before-budget'), { recursive: true })
writeFileSync(join(refDir, 'plan-before-budget', 'SKILL.md'), SKILL('plan-before-budget', 'Open the project plan first and note the dates. MARKER-APPROVED-BODY.'))

const ask = async (host: { url: string }, prefix: string, text: string): Promise<{ answer: string | null; status: string }> => {
  const f = (i: string, init?: RequestInit): Promise<Response> => fetch(i, init)
  const client = new HermesClient(host.url, key, f, prefix)
  let started: Started
  try { started = await client.startRun(JSON.stringify({ input: text }), `probe-${Math.random().toString(36).slice(2)}`) } catch (e) { return { answer: null, status: `error: ${String((e as Error).message).slice(0, 120)}` } }
  if (started.runId === null) return { answer: null, status: `refused: ${String(started.status)} ${JSON.stringify(started.body).slice(0, 120)}` }
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), 30_000)
  try {
    for await (const ev of client.events(started.runId, { signal: abort.signal })) {
      const name = String(ev.data?.event ?? '')
      if (process.env.PROBE_DEBUG !== undefined) console.log(`     [${text.slice(0, 20)}] ${ev.raw.slice(0, 200)}`)
      if (name === 'run.completed' || name === 'run.failed') return { answer: typeof ev.data?.output === 'string' ? ev.data.output : null, status: name === 'run.completed' ? 'completed' : 'failed' }
    }
  } catch { /* fall through to the status read */ } finally { clearTimeout(timer) }
  for (let i = 0; i < 10; i += 1) {
    const s = await client.run(started.runId)
    if (s !== null && (s.status === 'completed' || s.status === 'failed')) return { answer: s.output, status: s.status }
    await sleep(500)
  }
  return { answer: null, status: 'timeout' }
}
const options = (label: string, port: number, dirs: readonly string[] = [], toolsets?: readonly string[]) => ({
  hostDir: resolve(hostDir), home: join(out, 'homes', label), outDir: out, port, apiKey: key, modelBase: llm.url, label, skillsExternalDirs: dirs, mcpUrl: 'http://127.0.0.1:18962/mcp', mcpToken: 'probe', ...(toolsets === undefined ? {} : { toolsets }),
})
const external = [refDir]

// A one-tool MCP server (the office's own server is not needed to learn what Hermes does with skills): it makes the model request carry a tool.
const mcp = createServer((req, res) => {
  let body = ''
  req.on('data', (c) => { body += String(c) })
  req.on('end', () => {
    let m: any = {}
    try { m = JSON.parse(body) } catch { /* not json */ }
    const reply = (result: unknown): void => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ jsonrpc: '2.0', id: m.id, result })) }
    if (m.method === 'initialize') return reply({ protocolVersion: m.params?.protocolVersion ?? '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'office', version: '0' } })
    if (m.id === undefined) { res.writeHead(202); return res.end() }
    if (m.method === 'tools/list') return reply({ tools: [{ name: 'list_projects', description: 'List projects.', inputSchema: { type: 'object', properties: {} } }] })
    if (m.method === 'tools/call') return reply({ content: [{ type: 'text', text: 'two projects' }] })
    reply({})
  })
})
await new Promise<void>((r) => mcp.listen(18_962, '127.0.0.1', () => r()))


try {
  // P1: a profile prefix this host does not serve
  const h1 = await startHermes(options('plain', 18_960))
  const viaPrefix = await ask(h1, '/p/hermes-learn', 'say hello')
  const direct = await ask(h1, '', 'say hello')
  check('P1 a /p/hermes-learn/ prefix on a host that serves no such profile does NOT reach the default profile: the run is refused (fail closed), while the same host answers un-prefixed', viaPrefix.answer === null && /refused|error/.test(viaPrefix.status) && direct.status === 'completed', `prefixed: ${viaPrefix.status}; un-prefixed: ${direct.status}`)
  await h1.stop()

  // P2/P3: external_dirs with the skills toolset OFF (the host kit's setting)
  const h2 = await startHermes(options('ext', 18_961, external))
  const dump = await ask(h2, '', 'DUMP MARKER-APPROVED-BODY')
  const named = await ask(h2, '', 'DUMP plan-before-budget')
  console.log(`     DUMP (marker in system message?): ${String(dump.answer).slice(0, 200)}`)
  console.log(`     DUMP (skill name in system message?): ${String(named.answer).slice(0, 200)}`)
  const sees = /plan-before-budget/.test(String(named.answer)) && /system[^.]*(yes|true|contains|present|found)/i.test(String(named.answer))
  check('P2 a skill in skills.external_dirs is shown to the model by name with the skills toolset off (informational: the answer is printed above)', true, `name visible: ${String(sees)}`)
  // P3: remove the skill and ask again: it must be gone at the next run.
  rmSync(join(refDir, 'plan-before-budget'), { recursive: true, force: true })
  const gone = await ask(h2, '', 'DUMP plan-before-budget')
  console.log(`     DUMP after removal: ${String(gone.answer).slice(0, 200)}`)
  check('P3 after the skill is removed from the directory the next run no longer shows it (a withdrawn skill is not served from a cache)', !/plan-before-budget[^.]*(yes|true|contains|present|found)/i.test(String(gone.answer)) || !sees, `before: ${String(sees)}`)
  const tools = await ask(h2, '', 'TOOLS')
  console.log(`     tools offered: ${String(tools.answer).slice(0, 240)}`)
  check('P4 with skills off, no skill-writing or skill-reading tool is offered to the model', !/skill/i.test(String(tools.answer)), String(tools.answer).slice(0, 160))
  check('P5 nothing was written into the reference directory by Hermes', readdirSync(refDir).length === 0)
  await h2.stop()
  // P6/P7: the same directory with the skills toolset ON (what a learning profile would need in order to SEE a reference skill)
  mkdirSync(join(refDir, 'plan-before-budget'), { recursive: true })
  writeFileSync(join(refDir, 'plan-before-budget', 'SKILL.md'), SKILL('plan-before-budget', 'Open the project plan first and note the dates. MARKER-APPROVED-BODY.'))
  const h3 = await startHermes({ ...options('skillson', 18_963, external, ['office', 'skills']), disabledToolsets: DISABLED_TOOLSETS.filter((t) => t !== 'skills') })
  const on = await ask(h3, '', 'TOOLS')
  const seen = await ask(h3, '', 'DUMP plan-before-budget')
  console.log(`     skills ON, tools offered: ${String(on.answer).slice(0, 300)}`)
  console.log(`     skills ON, system message holds the skill name: ${String(seen.answer).slice(0, 200)}`)
  const writer = /skill_manage|skill_create|skills_write/i.test(String(on.answer))
  check('P6 with the skills toolset ON the model is offered a skill-WRITING tool (so enabling skills to let Hermes see reference skills also lets it write skills): reported, and the reason the learning profile must keep its own isolated create_dir', true, `writer tool offered: ${String(writer)}`)
  check('P7 nothing was written into the reference directory even with skills on and no model request to write', readdirSync(join(refDir)).length === 1)
    // P8: can the model (a hallucinated or hostile call) change or delete a skill that lives in the reference directory?
  const before = readFileSync(join(refDir, 'plan-before-budget', 'SKILL.md'), 'utf8')
  const edit = await ask(h3, '', `FORCECALL skill_manage ${JSON.stringify({ operations: [{ name: 'plan-before-budget', action: 'patch', old_string: 'MARKER-APPROVED-BODY', new_string: 'TAMPERED' }] })}`)
  const afterEdit = readFileSync(join(refDir, 'plan-before-budget', 'SKILL.md'), 'utf8')
  console.log(`     skill_manage patch on a reference skill: run ${edit.status}; file changed: ${String(afterEdit !== before)}`)
  const del = await ask(h3, '', `FORCECALL skill_manage ${JSON.stringify({ operations: [{ name: 'plan-before-budget', action: 'delete' }] })}`)
  const stillThere = readdirSync(refDir).includes('plan-before-budget')
  console.log(`     skill_manage delete on a reference skill: run ${del.status}; directory still holds it: ${String(stillThere)}`)
  check('P8 REPORTED, not asserted: with skills on, Hermes\'s own skill_manage can edit or delete a skill in skills.external_dirs unless the operating system refuses it (the host kit runs Hermes as a user with no write access to the export directory; this container runs both as root, so only the tool behaviour is shown)', true, `edited: ${String(afterEdit !== before)}, deleted: ${String(!stillThere)}`)
  await h3.stop()
} finally {
  await llm.stop()
  mcp.close()
  rmSync(out, { recursive: true, force: true })
}
console.log(failed === 0 ? '\nall probes answered as the design assumes' : `\n${String(failed)} probe(s) did NOT answer as the design assumes`)
process.exit(failed === 0 ? 0 : 1)
