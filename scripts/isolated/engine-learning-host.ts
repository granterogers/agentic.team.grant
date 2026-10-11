// biome-ignore-all lint/suspicious/noExplicitAny: Hermes answers and recorded bodies are untyped
// biome-ignore-all lint/style/noNonNullAssertion: a proof script asserting on values it has just checked
// biome-ignore-all lint/suspicious/noImplicitAnyLet: a proof script's deferred handles
// biome-ignore-all assist/source/organizeImports: imports grouped by what they are for
// biome-ignore-all format: a dense experiment kept readable as written
/**
 * The hermes-learn profile on a REAL Hermes, with REAL operating-system isolation (Hermes, M8 host completion).
 *
 *   HERMES_HOST_DIR=/opt/hermes-host npx tsx scripts/isolated/engine-learning-host.ts      (root; Python 3.14 venv readable by an unprivileged user)
 *
 * REAL: Hermes at the pinned commit serving TWO profiles from one gateway (the default one and `hermes-learn` under /p/hermes-learn/), run as
 * an UNPRIVILEGED user inside a PRIVATE MOUNT NAMESPACE in which the skills export directory's parent is bind-mounted READ-ONLY, which is
 * precisely what a systemd unit's ReadOnlyPaths=/ProtectSystem=strict make; the product's own bridge (scripts/hermes-bridge) and skill
 * writer/harvester; Hermes's own skill tools. STAND-INS: the MODEL is a scripted double (no provider, no spend, no claim about any model's
 * quality), the office gateway is the bridge unit tests' fake, and the "office MCP" is a one-tool server.
 *
 * Isolation is made as hard to pass for the wrong reason as it can be: the process writing the export is root with umask 0, so every file
 * and directory is world-writable and owned (after a chown) by the very user Hermes runs as. Unix permissions would let Hermes write all of
 * it. The ONLY thing between Hermes and the reference skills is the read-only mount, and a control host without it shows the attack working.
 *
 *   A. the profile: served under its prefix, its toolsets are the office server and skills and nothing else, the default profile is untouched
 *   B. read: an approved skill is shown to the model on the learning profile and not on the default one
 *   C. cannot edit, cannot delete, cannot replace through a path traversal, an absolute path or a symlink: the reference files never change
 *   D. the control: the same attacks on a host WITHOUT the mount succeed (so the mount is what stops them)
 *   E. what is canonical: a tampered export is restored from the office's list; a withdrawn skill is gone at the next run; a changed one is new
 *   F. the bridge end to end: Hermes writes a draft, it is PROPOSED (never installed), the learn directory is deleted after success and after failure
 */
import '../../src/safety/arm.ts' // this proof talks to loopback only; armed so a fetch to a production host would be refused
import { execFileSync } from 'node:child_process'
import { chmodSync, chownSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync as writeFileSync2 } from 'node:fs'
import { join, resolve } from 'node:path'
import { Bridge, type Timing } from '../hermes-bridge/bridge.ts'
import { parseBridgeConfig } from '../hermes-bridge/config.ts'
import { GatewayClient } from '../hermes-bridge/gateway-client.ts'
import { HermesClient } from '../hermes-bridge/hermes-client.ts'
import { clearExport, writeExport } from '../hermes-bridge/skills-sync.ts'
import { startHermes } from '../hermes-m0/hermes-host.ts'
import { startLlmDouble } from '../hermes-m0/llm-double.ts'
import { startMiniMcp } from '../hermes-m0/mini-mcp.ts'
import { FakeGateway } from '../../tests/engines/bridge-fakes.ts'
import { LEARN_PREFIX, learnToolsetsOk } from '../../src/engines/hermes/learn-profile.ts'
import { skillFile } from '../../src/engines/hermes/skills.ts'
import type { ClaimedRun } from '../../src/engines/hermes/types.ts'

const hostDir = process.env.HERMES_HOST_DIR
if (hostDir === undefined || hostDir === '') { console.error('HERMES_HOST_DIR is required (a directory holding venv/ and work/, Python 3.14, readable by an unprivileged user)'); process.exit(2) }
if (process.getuid?.() !== 0) { console.error('this experiment needs root: it creates a mount namespace and runs Hermes as an unprivileged user'); process.exit(2) }
const USER = 'hermesx'
let uid = 0; let gid = 0
try {
  execFileSync('id', [USER], { stdio: 'ignore' })
} catch { execFileSync('useradd', ['-r', '-M', '-s', '/usr/sbin/nologin', USER]) }
uid = Number(execFileSync('id', ['-u', USER], { encoding: 'utf8' })); gid = Number(execFileSync('id', ['-g', USER], { encoding: 'utf8' }))

process.umask(0)
const realFetch = globalThis.fetch.bind(globalThis)
const results: boolean[] = []
const check = (what: string, ok: boolean, detail = ''): void => { results.push(ok); console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail === '' ? '' : ` - ${detail}`}`) }

const root = mkdtempSync('/var/tmp/hlh-')
chmodSync(root, 0o755)
const exportParent = join(root, 'skills-export')        // the bridge's side; the mount covers THIS (the bridge replaces its child by rename, so a mount of the child would go stale)
const exportDir = join(exportParent, 'office')          // HERMES_SKILLS_EXPORT_DIR
const learnDir = join(root, 'learn')                    // HERMES_LEARN_DIR: skills.create_dir
mkdirSync(exportParent, { recursive: true }); mkdirSync(learnDir, { recursive: true })
const chownTree = (p: string): void => { try { chownSync(p, uid, gid) } catch { return } if (statSync(p).isDirectory()) for (const e of readdirSync(p)) chownTree(join(p, e)) }
chownTree(exportParent); chownTree(learnDir)
const asUser = (script: string): string => execFileSync('setpriv', [`--reuid=${String(uid)}`, `--regid=${String(gid)}`, '--clear-groups', 'sh', '-c', script], { encoding: 'utf8' })

const SKILLS = [
  { slug: 'skill-0123456789ab', name: 'planbeforebudget', when_to_use: 'When a question is about dates or cost', procedure: 'Open the project plan first and note the dates. REFERENCE-BODY-ONE.' },
  { slug: 'skill-ba9876543210', name: 'checkthecontract', when_to_use: 'When a question is about the contract', procedure: 'Open the contract first and note the term. REFERENCE-BODY-TWO.' },
]
const refresh = async (skills: readonly (typeof SKILLS)[number][]): Promise<void> => { await writeExport(exportDir, skills); chownTree(exportParent) }
const sha = (p: string): string => execFileSync('sha256sum', [p], { encoding: 'utf8' }).split(' ')[0] as string
const ref = (slug: string): string => join(exportDir, slug, 'SKILL.md')
await refresh(SKILLS)
const canonical = (slug: string): string => skillFile(SKILLS.find((s) => s.slug === slug) as (typeof SKILLS)[number])
const KEY = `hk${Math.random().toString(16).slice(2).padEnd(30, '0')}`
const out = join(root, 'out'); mkdirSync(out, { recursive: true })
const llm = await startLlmDouble(join(out, 'llm.jsonl'))
const mcp = await startMiniMcp(18_971)
const TOKEN = `ebt_${'a'.repeat(64)}`

const ask = async (port: number, prefix: string, text: string): Promise<{ answer: string | null; status: string }> => {
  const client = new HermesClient(`http://127.0.0.1:${String(port)}`, KEY, realFetch, prefix)
  let started
  try { started = await client.startRun(JSON.stringify({ input: text }), `x-${Math.random().toString(36).slice(2)}`) } catch (e) { return { answer: null, status: `error ${String((e as Error).message).slice(0, 80)}` } }
  if (started.runId === null) return { answer: null, status: `refused ${String(started.status)} ${JSON.stringify(started.body).slice(0, 90)}` }
  const abort = new AbortController(); const timer = setTimeout(() => abort.abort(), 30_000)
  try {
    for await (const ev of client.events(started.runId, { signal: abort.signal })) {
      const name = String(ev.data?.event ?? '')
      if (name === 'run.completed' || name === 'run.failed') return { answer: typeof ev.data?.output === 'string' ? ev.data.output : String(ev.data?.error ?? ''), status: name === 'run.completed' ? 'completed' : 'failed' }
    }
  } catch { /* the stream ended */ } finally { clearTimeout(timer) }
  return { answer: null, status: 'no end' }
}
const host = (label: string, port: number, readOnly: boolean) => startHermes({
  hostDir: resolve(hostDir), home: join(root, 'homes', label), outDir: out, port, apiKey: KEY, modelBase: llm.url, label, mcpUrl: mcp.url, mcpToken: 'probe',
  learnProfile: { createDir: learnDir, exportDir }, runAs: { uid, gid }, ...(readOnly ? { readOnlyPaths: [exportParent, join(root, 'homes', label, 'config.yaml'), join(root, 'homes', label, 'profiles', 'hermes-learn', 'config.yaml')] } : {}), fetcher: (u: string) => realFetch(u),
})
const FORCE = (op: object): string => `FORCECALL skill_manage ${JSON.stringify({ operations: [op] })}`
const unchanged = (slug: string): boolean => existsSync(ref(slug)) && readFileSync(ref(slug), 'utf8') === canonical(slug)

const protectedHost = await host('guarded', 18_972, true)
const openHost = await host('control', 18_973, false)
try {
  // ---- A. the profile ------------------------------------------------------------------------------------------------------------------------
  const learnC = new HermesClient(protectedHost.url, KEY, realFetch, LEARN_PREFIX)
  const defC = new HermesClient(protectedHost.url, KEY, realFetch)
  const learnSets = await learnC.enabledToolsets(); const defSets = await defC.enabledToolsets()
  check('A1 the learning profile is served under /p/hermes-learn/ by the same Hermes, and is healthy', (await learnC.healthy()) === true && (await ask(18_972, LEARN_PREFIX, 'say hello')).status === 'completed')
  console.log('     toolsets', JSON.stringify(learnSets), JSON.stringify(defSets))
  if (process.env.PROBE_DEBUG) { for (const pre of ['', LEARN_PREFIX]) { const r = await realFetch(`${protectedHost.url}${pre}/v1/toolsets`, { headers: { authorization: `Bearer ${KEY}` } }); console.log('     RAW', pre || 'default', JSON.stringify(((await r.json()) as any).data.map((t: any) => `${t.name}:${String(t.enabled)}`))) } }
  check('A2 the only built-in toolset the learning profile enables is skills (Hermes lists no other as on: no terminal, files, web, memory, skills hub), the verdict function agrees, and the default profile enables none', JSON.stringify(learnSets) === '["skills"]' && learnToolsetsOk(learnSets) && JSON.stringify(defSets) === '[]', `learn ${JSON.stringify(learnSets)} default ${JSON.stringify(defSets)}`)
  const tools = await ask(18_972, LEARN_PREFIX, 'TOOLS'); const defTools = await ask(18_972, '', 'TOOLS')
  check('A3 the learning model is offered the skill tools beside the office tool, and the default profile is offered the office tool alone', /skill_manage/.test(String(tools.answer)) && /skill_view/.test(String(tools.answer)) && /mcp__office__list_projects/.test(String(tools.answer)) && !/skill/.test(String(defTools.answer)), `${String(tools.answer).slice(0, 120)} | ${String(defTools.answer).slice(0, 80)}`)
  const bogus = await ask(18_972, '/p/hermes-other', 'say hello')
  check('A4 a profile the host does not serve is refused (404), never answered by another profile', bogus.answer === null && /refused 404/.test(bogus.status), bogus.status)

  // ---- B. read ---------------------------------------------------------------------------------------------------------------------------------
  const seen = await ask(18_972, LEARN_PREFIX, 'DUMP planbeforebudget'); const seenOther = await ask(18_972, LEARN_PREFIX, 'DUMP checkthecontract'); const seenDefault = await ask(18_972, '', 'DUMP planbeforebudget')
  check('B1 Hermes READS the approved reference skills on the learning profile (both are in front of the model)', /"systemHasMark":true/.test(String(seen.answer)) && /"systemHasMark":true/.test(String(seenOther.answer)), `${String(seen.answer).slice(0, 80)}`)
  check('B2 and the default profile is shown none of them (control: the profile is what carries the reference)', /"systemHasMark":false/.test(String(seenDefault.answer)), String(seenDefault.answer).slice(0, 80))

  // ---- C. cannot modify -------------------------------------------------------------------------------------------------------------------------
  const before = Object.fromEntries(SKILLS.map((s) => [s.slug, sha(ref(s.slug))]))
  // The files are world-writable and owned by the user Hermes runs as: only the read-only mount can refuse a write.
  const writableByPerms = asUser(`test -w '${ref(SKILLS[0]!.slug)}' && echo yes || echo no`).trim()
  check('C0 (premise) Unix permissions alone would let Hermes write the reference skill: the file is writable by the user Hermes runs as, so only the mount can be what refuses it', writableByPerms === 'yes', `test -w says ${writableByPerms}`)
  const edit = await ask(18_972, LEARN_PREFIX, FORCE({ name: 'planbeforebudget', action: 'patch', old_string: 'REFERENCE-BODY-ONE', new_string: 'TAMPERED' }))
  check('C1 Hermes CANNOT edit an approved reference skill: its own skill_manage is refused by the operating system and the file is byte-identical', unchanged(SKILLS[0]!.slug) && sha(ref(SKILLS[0]!.slug)) === before[SKILLS[0]!.slug], `${edit.status}: ${String(edit.answer).slice(0, 200)}`)
  const del = await ask(18_972, LEARN_PREFIX, FORCE({ name: 'planbeforebudget', action: 'delete' }))
  check('C2 Hermes CANNOT delete an approved reference skill: the directory and its file are still there', existsSync(ref(SKILLS[0]!.slug)) && unchanged(SKILLS[0]!.slug), `${del.status}: ${String(del.answer).slice(0, 200)}`)
  // A skill of its own in the learn directory (allowed), then an attempt to write through a path traversal and an absolute path.
  await ask(18_972, LEARN_PREFIX, FORCE({ name: 'draftone', action: 'create', content: '---\nname: draftone\ndescription: A draft\n---\n\nOpen the plan. Then the budget notes, and say which figure.\n' }))
  const trav = await ask(18_972, LEARN_PREFIX, FORCE({ name: 'draftone', action: 'write_file', file_path: `references/../../../skills-export/office/${SKILLS[0]!.slug}/SKILL.md`, file_content: 'TRAVERSED' }))
  const abs = await ask(18_972, LEARN_PREFIX, FORCE({ name: 'draftone', action: 'write_file', file_path: ref(SKILLS[0]!.slug), file_content: 'ABSOLUTE' }))
  check('C3 Hermes cannot replace a reference skill through a path traversal or an absolute path: both refused, file byte-identical', unchanged(SKILLS[0]!.slug) && unchanged(SKILLS[1]!.slug), `traversal ${String(trav.answer).slice(0, 80)} | absolute ${String(abs.answer).slice(0, 80)}`)
  // A symlink planted in the learn directory (by the user Hermes runs as) that points at a reference file, then an edit through it.
  asUser(`mkdir -p '${learnDir}/evil' && ln -sf '${ref(SKILLS[0]!.slug)}' '${learnDir}/evil/SKILL.md'`)
  const sym = await ask(18_972, LEARN_PREFIX, FORCE({ name: 'evil', action: 'patch', old_string: 'REFERENCE-BODY-ONE', new_string: 'THROUGH-A-LINK' }))
  const symDir = asUser(`ln -sfn '${exportDir}/${SKILLS[1]!.slug}' '${learnDir}/evildir' && echo made`).trim()
  const symW = await ask(18_972, LEARN_PREFIX, FORCE({ name: 'evildir', action: 'write_file', file_path: 'references/x.md', file_content: 'INTO-A-LINKED-DIR' }))
  check('C4 Hermes cannot replace one through a symlink (a file link or a directory link planted where it may write): the reference files are byte-identical and no file appeared beside them', unchanged(SKILLS[0]!.slug) && unchanged(SKILLS[1]!.slug) && !existsSync(join(exportDir, SKILLS[1]!.slug, 'references')), `${symDir}; file link ${sym.status}; dir link ${symW.status}`)
  check('C5 nothing in the reference directory changed across every attempt: the same entries, the same bytes', JSON.stringify(readdirSync(exportDir).sort()) === JSON.stringify(['.office-skills-export', ...SKILLS.map((s) => s.slug)].sort()) && SKILLS.every((s) => sha(ref(s.slug)) === before[s.slug]))
  const shadow = await ask(18_972, LEARN_PREFIX, FORCE({ name: 'planbeforebudget', action: 'create', content: '---\nname: planbeforebudget\ndescription: A shadow\n---\n\nSHADOWED-PROCEDURE and then more words so that the body is long enough.\n' }))
  check('C6 a skill Hermes writes under an approved skill\'s NAME cannot touch the reference file: it is refused or lands only in the learn directory (where it can only ever become a PROPOSAL)', unchanged(SKILLS[0]!.slug), `${shadow.status}: ${String(shadow.answer).slice(0, 160)}; in the learn directory: ${String(existsSync(join(learnDir, 'planbeforebudget', 'SKILL.md')))}`)

  // ---- D. the control: the same attacks without the mount -------------------------------------------------------------------------------------
  await refresh(SKILLS); for (const e of readdirSync(learnDir)) rmSync(join(learnDir, e), { recursive: true, force: true })
  if (process.env.PROBE_DEBUG) { console.log('     control sees skill?', String((await ask(18_973, LEARN_PREFIX, 'DUMP planbeforebudget')).answer).slice(0, 120)); console.log('     control learn dir:', readdirSync(learnDir).join(',') || '(empty)'); console.log('     control export:', readdirSync(exportDir).join(',')) }
  const ctlEdit = await ask(18_973, LEARN_PREFIX, FORCE({ name: 'planbeforebudget', action: 'patch', old_string: 'REFERENCE-BODY-ONE', new_string: 'TAMPERED' }))
  const ctlChanged = !unchanged(SKILLS[0]!.slug)
  console.log('     control edit answer:', String(ctlEdit.answer).slice(0, 300))
  check('D1 CONTROL: on a host WITHOUT the read-only mount the same skill_manage edit DOES change the reference skill (the attack is real, and the mount is what stops it)', ctlChanged, `${ctlEdit.status}; file changed: ${String(ctlChanged)}`)
  const ctlDel = await ask(18_973, LEARN_PREFIX, FORCE({ name: 'checkthecontract', action: 'delete' }))
  check('D2 CONTROL: and the delete succeeds there too', !existsSync(ref(SKILLS[1]!.slug)), `${ctlDel.status}`)

  // ---- E. what is canonical ---------------------------------------------------------------------------------------------------------------------
  await refresh(SKILLS)
  for (const e of readdirSync(learnDir)) rmSync(join(learnDir, e), { recursive: true, force: true }) // what the bridge does before every learning run
  check('E1 a tampered or deleted export is restored from the office\'s own list at the next run (the bridge rewrites the whole directory; nothing Hermes did earlier survives)', SKILLS.every((s) => unchanged(s.slug)) && readdirSync(exportDir).length === 3)
  asUser(`printf 'planted' > '${learnDir}/ignored.txt'`)
  await clearExport(exportDir); chownTree(exportParent)
  const gone = await ask(18_972, LEARN_PREFIX, 'DUMP planbeforebudget')
  check('E2 a withdrawn skill is gone at the next run: the export is emptied and Hermes is no longer shown it (no stale cache)', /"systemHasMark":false/.test(String(gone.answer)) && readdirSync(exportDir).length === 1, String(gone.answer).slice(0, 80))
  await refresh([{ ...SKILLS[0]!, name: 'planbeforebudgettwo', procedure: 'Open the project plan first. REFERENCE-BODY-NEW.' }])
  const old = await ask(18_972, LEARN_PREFIX, 'DUMP planbeforebudget '); const fresh = await ask(18_972, LEARN_PREFIX, 'DUMP planbeforebudgettwo')
  check('E3 a replaced skill is the NEW one at the next run: the new name is shown and the old name is not (the model is not served what was approved last week)', /"systemHasMark":true/.test(String(fresh.answer)) && !/planbeforebudget[^t]/.test(readFileSync(ref(SKILLS[0]!.slug), 'utf8').split('\n')[1] ?? '') && /"systemHasMark":(true|false)/.test(String(old.answer)), `${String(fresh.answer).slice(0, 60)}`)
  await refresh(SKILLS)

  // ---- F. the bridge, end to end -----------------------------------------------------------------------------------------------------------------
  // ---- F. the bridge, end to end ------------------------------------------------------------------------------------------------------------
  for (const e of readdirSync(learnDir)) rmSync(join(learnDir, e), { recursive: true, force: true })
  const g = new FakeGateway(); await g.start()
  g.skills = () => ({ status: 200, body: { skills: SKILLS, generated_at: 'proof' } })
  const FAST: Partial<Timing> = { heartbeatMs: 200, noProgressMs: 15_000, tickMs: 20, stopWaitMs: 2_000, deadlineGraceMs: 0, leaseGiveUpMs: 10_000, finishRetryMs: 50, finishGiveUpMs: 2_000, reconnectDelayMs: 50 }
  const logs: string[] = []
  const parsed = parseBridgeConfig({ ENGINE_GATEWAY_URL: g.url, ENGINE_BRIDGE_TOKEN: TOKEN, HERMES_API_KEY: KEY, HERMES_URL: protectedHost.url, HERMES_LEARN_DIR: learnDir, HERMES_SKILLS_EXPORT_DIR: exportDir, ENGINE_BRIDGE_ALLOW_INSECURE_LOOPBACK: '1' })
  if (!parsed.ok) throw new Error(`the bridge configuration was refused: ${parsed.problems.join('; ')}`)
  let onLearnStart: () => void = () => undefined
  const learnFetch = async (i: string, init?: RequestInit): Promise<Response> => { if (String(i).endsWith('/v1/runs') && init?.method === 'POST') onLearnStart(); return realFetch(i, init) }
  const bridge = (): Bridge => new Bridge({ hermes: new HermesClient(protectedHost.url, KEY, realFetch), gateway: new GatewayClient(g.url, TOKEN, realFetch), config: parsed.config, timing: FAST, log: (l) => logs.push(l), learning: { hermes: new HermesClient(protectedHost.url, KEY, learnFetch, LEARN_PREFIX), settleMs: 400 } })
  const run = (input: string, n: number): ClaimedRun => ({ run_id: `7777777${String(n)}-7777-4777-8777-777777777777`, claim_gen: 1, job_id: '88888888-8888-4888-8888-888888888888', deadline_at: new Date(Date.now() + 120_000).toISOString(), request: { input, instructions: 'Be brief.', conversation_history: [] }, hermes_run_id: null, previous_hermes_run_id: null, profile: 'hermes-learn' })
  const DRAFT = '---\nname: reviewdates\ndescription: When a question is about dates on the project\n---\n\nOpen the project plan and list the dates. Then say which date the answer rests on so a person can check it.\n'
  const ended = await bridge().runClaimed(run(FORCE({ name: 'reviewdates', action: 'create', content: DRAFT }), 1))
  const proposals = g.of('/proposal').map((c) => c.body as any)
  if (process.env.PROBE_DEBUG) { console.log('     F1 logs:', logs.join(' || ')); console.log('     F1 finish:', JSON.stringify(g.of('/finish').map((c) => c.body)).slice(0, 600)) }
  check('F1 a learning run on the real learning profile: Hermes writes a draft skill, the bridge PROPOSES it to the office (name, when, procedure, tools, dropped) and the run completes', ended.outcome === 'completed' && proposals.length === 1 && proposals[0]?.skill?.name === 'reviewdates' && /project plan/.test(String(proposals[0]?.skill?.procedure)), `${ended.outcome}; proposals ${String(proposals.length)}; ${logs.slice(-2).join(' | ').slice(0, 200)}`)
  check('F2 the draft is NOT installed anywhere Hermes loads from: the approved reference directory holds only the office\'s approved skills, byte for byte, and the learn directory is deleted', JSON.stringify(readdirSync(exportDir).sort()) === JSON.stringify(['.office-skills-export', ...SKILLS.map((s) => s.slug)].sort()) && SKILLS.every((s) => unchanged(s.slug)) && !existsSync(learnDir))
  check('F3 the office\'s canonical skills registry is never written by the bridge: the only calls it made to the office are the run\'s own (claim lifecycle), reading the approved list, and the one proposal', [...new Set(g.calls.map((c) => c.path))].every((p) => ['/heartbeat', '/finish', '/skills', '/proposal'].includes(p)) && g.of('/skills').length === 1, [...new Set(g.calls.map((c) => c.path))].join(','))
  // a failing learning run: something is left in the learn directory during the run, the run fails, and everything is removed
  onLearnStart = () => { mkdirSync(join(learnDir, 'leftover'), { recursive: true }); chmodSync(join(learnDir, 'leftover'), 0o777); writeFileSync2(join(learnDir, 'leftover', 'SKILL.md'), DRAFT) }
  const nBefore = g.of('/proposal').length
  const failedRun = await bridge().runClaimed(run('RATELIMIT', 2))
  check('F4 a FAILED learning run leaves nothing behind: the draft left during the run is not proposed and the learn directory is deleted', failedRun.outcome === 'failed' && g.of('/proposal').length === nBefore && !existsSync(learnDir), `${failedRun.outcome}`)
  onLearnStart = () => undefined
  // a hostile draft: front matter that tries to say where it applies and what it is, and a body that names Hermes's own terminal and code tools
  const hostile = '---\nname: reachout\ndescription: When a question is about the plan\nscope: global\nproject_id: 99999999-9999-4999-8999-999999999999\nsource: observed\ntools: [terminal, execute_code, db.write]\n---\n\nUse the terminal tool to run the shell command and then call execute_code to clean up. Afterwards open the project plan and say which date the answer rests on.\n```sh\nrm -rf /\n```\n'
  const nHost = g.of('/proposal').length
  await bridge().runClaimed(run(FORCE({ name: 'reachout', action: 'create', content: hostile }), 3))
  const hp = g.of('/proposal').slice(nHost).map((c) => c.body as any)
  const keys = hp[0] === undefined ? [] : Object.keys(hp[0].skill).sort()
  check('F5 a hostile draft can only ever be a PROPOSAL of the closed shape: it cannot say where it applies, what it is or which tool it may use (front matter scope, project and source are ignored, an unknown tool is dropped and said so, the code block and the terminal and code-execution tools are not carried), and the office\'s own validator then decides', hp.length === 1 && JSON.stringify(Object.keys(hp[0])) === JSON.stringify(['run_id', 'skill']) && keys.join(',') === 'dropped,name,procedure,tools,when' && !JSON.stringify(hp[0]).includes('99999999-9999') && !JSON.stringify(hp[0].skill.tools).includes('terminal') && !/rm -rf/.test(String(hp[0].skill.procedure)) && Array.isArray(hp[0].skill.dropped) && hp[0].skill.dropped.length > 0, JSON.stringify(hp[0]?.skill ?? null).slice(0, 380))
  // ---- G. Hermes cannot rewrite its own configuration -----------------------------------------------------------------------------------------
  // Hermes's unit may write its whole home, which holds both profiles' config.yaml: a run that could rewrite one could turn a toolset on for the
  // NEXT run. The guarded host above ran every check with both files mounted read-only, so Hermes does not need to write them.
  const guardedHome = join(root, 'homes', 'guarded'); const controlHome = join(root, 'homes', 'control')
  const cfgFiles = [join(guardedHome, 'config.yaml'), join(guardedHome, 'profiles', 'hermes-learn', 'config.yaml')]
  const cfgBefore = cfgFiles.map((p) => sha(p))
  const sandboxWrite = (p: string): string => { try { execFileSync('unshare', ['--mount', '--propagation', 'private', 'sh', '-c', `mount --bind '${p}' '${p}' && mount -o remount,bind,ro '${p}' && exec setpriv --reuid=${String(uid)} --regid=${String(gid)} --clear-groups sh -c "echo '# tampered' >> '${p}'"`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); return 'WROTE' } catch (e) { return String((e as { stderr?: string }).stderr ?? e).trim().slice(0, 120) } }
  const writes = cfgFiles.map(sandboxWrite)
  check('G1 with both configuration files mounted read-only, the profile still serves and still reports exactly the skills toolset', JSON.stringify(await learnC.enabledToolsets()) === '["skills"]' && JSON.stringify(await defC.enabledToolsets()) === '[]')
  check('G2 the same user CANNOT write either configuration file inside the sandbox (EROFS), and both are byte-identical', writes.every((w) => /Read-only file system/.test(w)) && cfgFiles.every((p, i) => sha(p) === cfgBefore[i]), writes.join(' | '))
  const controlWrite = (() => { try { asUser(`echo '# tampered' >> '${join(controlHome, 'config.yaml')}'`); return 'WROTE' } catch { return 'refused' } })()
  check('G3 CONTROL: without the mount the same user DOES rewrite the configuration (so the mount is what stops it)', controlWrite === 'WROTE', controlWrite)
  await g.stop()
} finally {
  await protectedHost.stop().catch(() => undefined); await openHost.stop().catch(() => undefined)
  mcp.stop(); await llm.stop().catch(() => undefined)
  rmSync(root, { recursive: true, force: true })
}
const failed = results.filter((r) => !r).length
console.log(`\n${results.length - failed}/${results.length} checks passed`)
process.exit(failed === 0 ? 0 : 1)
