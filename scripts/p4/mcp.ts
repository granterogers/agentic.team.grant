/**
 * P4 step 8: MCP for a second person.
 *   npx tsx scripts/p4/mcp.ts
 * The second person consents with their OWN session (the consent form takes a signed-in session; nothing in the form can
 * name an office). The client that results must be bound to THEIR office, must not inherit either of Grant's two clients,
 * must read only their data, and must ignore an office the caller names. The client is disabled again at the end.
 */
import { check, db, REF, results, SECOND_OFFICE, secondSession } from './lib.ts'

const B = `https://${REF}.supabase.co/functions/v1/mcp`
const REDIRECT = 'https://chatgpt.com/connector_platform_oauth_redirect'
const rows = async (sql: string): Promise<Record<string, unknown>[]> => (await db.execute(sql)).rows as Record<string, unknown>[]
const b64u = (b: Uint8Array): string => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const s256 = async (v: string): Promise<string> => b64u(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v))))
const T = (await secondSession()).access_token
const grantOffice = String((await rows(`select app.operator_office()::text v`))[0]?.v)
const grantClientsBefore = await rows(`select client_id, office_id::text off, enabled from public.mcp_clients where office_id = app.operator_office() order by client_id`)

const reg = (await (await fetch(`${B}/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'P4 second person probe', redirect_uris: [REDIRECT] }) })).json()) as { client_id?: string }
check('a client registered', typeof reg.client_id === 'string')
const verifier = b64u(crypto.getRandomValues(new Uint8Array(32)))
const q = new URLSearchParams({ response_type: 'code', client_id: String(reg.client_id), redirect_uri: REDIRECT, code_challenge: await s256(verifier), code_challenge_method: 'S256', state: 'p4' })

// consent with a made-up session is refused; with the second person's own session it yields a code
const refused = await fetch(`${B}/authorize`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ...Object.fromEntries(q), hq_password: 'not-a-session' }).toString(), redirect: 'manual' })
check('consent with a made-up session gets no code', refused.status === 401, `http ${refused.status}`)
// the consent form also carries what a hostile page could add: an office field
const allowed = await fetch(`${B}/authorize`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ...Object.fromEntries(q), hq_password: T, office_id: grantOffice, office: grantOffice }).toString(), redirect: 'manual' })
const code = new URL(allowed.headers.get('location') ?? 'https://x.invalid').searchParams.get('code') ?? ''
check("consent with the second person's own session yields a code", allowed.status === 302 && code !== '', `http ${allowed.status}`)

const ex = (await (await fetch(`${B}/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id: String(reg.client_id), redirect_uri: REDIRECT }).toString() })).json()) as { access_token?: string }
check('a token was minted', typeof ex.access_token === 'string')
const bound = await rows(`select office_id::text off from public.mcp_clients where office_id = '${SECOND_OFFICE}' or office_id = app.operator_office() order by created_at desc limit 1`)
const mine = await rows(`select client_id, office_id::text off from public.mcp_clients where office_id = '${SECOND_OFFICE}'`)
console.log(`   mcp_clients in the second office after consent: ${mine.length}`)
check('the resulting client is bound to the SECOND office, whatever office the form named', mine.length === 1 && bound[0]?.off === SECOND_OFFICE, JSON.stringify(mine))
const rpc = async (method: string, params?: unknown): Promise<{ status: number; json: { result?: Record<string, unknown>; error?: unknown }; text: string }> => {
  const r = await fetch(B, { method: 'POST', headers: { 'content-type': 'application/json', Authorization: `Bearer ${String(ex.access_token)}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })
  const text = await r.text()
  let json: { result?: Record<string, unknown>; error?: unknown } = {}
  try { json = JSON.parse(text.includes('data:') ? text.split('data:').pop() ?? '{}' : text) } catch { /* keep empty */ }
  return { status: r.status, json, text }
}
const list = await rpc('tools/list')
const tools = ((list.json.result?.tools ?? []) as { name: string; description?: string; inputSchema?: { properties?: Record<string, unknown> } }[])
console.log(`   tools: ${tools.map((t) => t.name).join(', ')}`)
check('the token lists tools', list.status === 200 && tools.length > 0)
check('no tool takes an office argument (the office comes from the credential)', tools.every((t) => !Object.keys(t.inputSchema?.properties ?? {}).some((k) => /office/i.test(k))))

const grantStrings = (await rows(`select distinct name v from public.projects where office_id = app.operator_office() and not is_fixture and slug <> 'unnamed' and length(name) > 5`)).map((r) => String(r.v))
let sawOwn = false
let leaks: string[] = []
for (const t of tools.filter((x) => /^(list|search|get|read|find|recent|projects?)/i.test(x.name))) {
  const props = Object.keys(t.inputSchema?.properties ?? {})
  const args: Record<string, unknown> = {}
  for (const p of props) if (/query|q|text|term/.test(p)) args[p] = 'project'
  args.office_id = grantOffice
  const out = await rpc('tools/call', { name: t.name, arguments: args })
  const body = out.text
  if (body.includes('Personal')) sawOwn = true
  leaks = [...leaks, ...grantStrings.filter((s) => body.includes(s)).map((s) => `${t.name}:${s}`)]
  console.log(`   ${t.name}: http ${out.status}, ${body.length} bytes`)
}
check('positive control: a read tool shows the second person their own project', sawOwn)
check("no read tool returned any of Grant's project names, even when given his office id", leaks.length === 0, JSON.stringify(leaks))
const grantClientsAfter = await rows(`select client_id, office_id::text off, enabled from public.mcp_clients where office_id = app.operator_office() order by client_id`)
check("Grant's own MCP clients are untouched by the second person's consent", JSON.stringify(grantClientsBefore) === JSON.stringify(grantClientsAfter), `${grantClientsAfter.length} clients`)

// leave the second office with nothing enabled
await rows(`update public.mcp_clients set enabled = false, disabled_reason = 'P4 acceptance probe finished' where office_id = '${SECOND_OFFICE}' and enabled returning client_id`)
const live = await rows(`select count(*)::int n from public.mcp_clients where office_id = '${SECOND_OFFICE}' and enabled`)
check('the probe client is disabled again', Number(live[0]?.n) === 0)

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} ok`)
process.exitCode = failed.length === 0 ? 0 : 1
