/**
 * The OAuth flow an MCP client actually walks, end to end, against the live
 * endpoint.
 *
 *   npm run verify:oauth
 *
 * Grant: *"ChatGPT does not support manually entering an arbitrary static
 * bearer header. It supports OAuth, no authentication, or mixed
 * authentication."* "No authentication" would leave his project store open to
 * anyone with the URL, and the URL is in a chat transcript — so the endpoint
 * became an authorization server (0091), and this is what proves it is one.
 *
 * ## Every check is a real HTTP request to the deployed function
 *
 * Not a unit test of the handler. The three defects this found on its first run
 * were all outside any handler: an `http://` issuer because the edge runtime
 * sees the request as plain http, a path missing `/functions/v1` because the
 * router strips it before the function sees it, and a 500 from `gen_random_bytes`
 * because pgcrypto is in a schema the function's search_path does not reach.
 * None of those is visible from inside the process.
 *
 * ## The refusals matter more than the successes
 *
 * A wrong password, a wrong PKCE verifier and a replayed code are the three
 * ways this becomes an open door, and each has its own check. A flow test that
 * only walked the happy path would pass just as well with the password check
 * commented out.
 *
 * Leaves a registered client behind on purpose: `mcp_oauth_clients` rows are
 * inert without a redeemed code, they record who registered when, and deleting
 * them would remove the only evidence of a registration that should not have
 * happened.
 */
const ref = process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg'
const B = `https://${ref}.supabase.co/functions/v1/mcp`

const password = process.env.HQ_PASSWORD ?? ''
if (password === '') {
  // Read from the vault rather than required in the environment, so this runs
  // with the same two variables as every other suite.
  const { ManagementApiExecutor } = await import('../../src/db/executor.ts')
  const db = new ManagementApiExecutor(ref, process.env.SUPABASE_ACCESS_TOKEN ?? '')
  const row = (
    await db.execute(
      "select decrypted_secret as s from vault.decrypted_secrets where name = 'hq.api_token'",
    )
  ).rows[0] as { s?: string } | undefined
  if (row?.s === undefined) {
    console.error('no hq.api_token in the vault, and HQ_PASSWORD is not set')
    process.exit(2)
  }
  process.env.HQ_PASSWORD = String(row.s)
}
const b64u = (b: Uint8Array): string =>
  btoa(String.fromCharCode(...b))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
const s256 = async (v: string): Promise<string> =>
  b64u(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v))))

const failures: string[] = []
const say = (label: string, ok: boolean, detail: string): void => {
  console.log(`${ok ? '✅' : '❌'} ${label} — ${detail}`)
  if (!ok) failures.push(label)
}

// 1. register
const reg = await fetch(`${B}/register`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    client_name: 'Flow probe',
    redirect_uris: ['https://chatgpt.com/connector_platform_oauth_redirect'],
  }),
})
const client = (await reg.json()) as { client_id?: string; error?: string }
say(
  'dynamic registration',
  reg.status === 201 && client.client_id !== undefined,
  `${String(reg.status)} ${String(client.client_id ?? client.error)}`,
)
if (client.client_id === undefined) process.exit(1)

// 2. authorize — the consent page
const verifier = b64u(crypto.getRandomValues(new Uint8Array(32)))
const challenge = await s256(verifier)
const q = new URLSearchParams({
  response_type: 'code',
  client_id: String(client.client_id),
  redirect_uri: 'https://chatgpt.com/connector_platform_oauth_redirect',
  code_challenge: challenge,
  code_challenge_method: 'S256',
  state: 'probe-state',
})
const page = await fetch(`${B}/authorize?${q.toString()}`)
const pageText = await page.text()
say(
  'consent page names the client and asks for the password',
  page.status === 200 && pageText.includes('Flow probe') && pageText.includes('Team HQ password'),
  `${String(page.status)}, ${String(pageText.length)} bytes`,
)

// 3. wrong password is refused
const bad = new URLSearchParams(q)
bad.set('hq_password', 'not-the-password')
const refused = await fetch(`${B}/authorize`, {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: bad.toString(),
  redirect: 'manual',
})
say('a wrong password gets no code', refused.status === 401, `http ${String(refused.status)}`)

// 4. right password redirects with a code
const good = new URLSearchParams(q)
good.set('hq_password', process.env.HQ_PASSWORD ?? '')
const allowed = await fetch(`${B}/authorize`, {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: good.toString(),
  redirect: 'manual',
})
const location = allowed.headers.get('location') ?? ''
const code = new URL(location || 'https://x.invalid').searchParams.get('code') ?? ''
say(
  'the right password redirects with a code and the state',
  allowed.status === 302 && code !== '' && location.includes('state=probe-state'),
  `http ${String(allowed.status)}, code ${code === '' ? 'missing' : 'present'}`,
)

// 5. a wrong PKCE verifier is refused
const wrongPkce = await fetch(`${B}/token`, {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    code_verifier: b64u(crypto.getRandomValues(new Uint8Array(32))),
    client_id: String(client.client_id),
    redirect_uri: 'https://chatgpt.com/connector_platform_oauth_redirect',
  }).toString(),
})
say(
  'a wrong PKCE verifier is refused',
  wrongPkce.status === 400,
  `http ${String(wrongPkce.status)}`,
)

// 6. the right one mints a token
const exchange = await fetch(`${B}/token`, {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    code_verifier: verifier,
    client_id: String(client.client_id),
    redirect_uri: 'https://chatgpt.com/connector_platform_oauth_redirect',
  }).toString(),
})
const tok = (await exchange.json()) as { access_token?: string; scope?: string; error?: string }
say(
  'the code plus the verifier mints a token',
  exchange.status === 200 && tok.access_token !== undefined,
  `${String(exchange.status)} scope=${String(tok.scope ?? tok.error)}`,
)

// 7. the code cannot be used twice
const replay = await fetch(`${B}/token`, {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    code_verifier: verifier,
    client_id: String(client.client_id),
    redirect_uri: 'https://chatgpt.com/connector_platform_oauth_redirect',
  }).toString(),
})
say(
  'the same code cannot be redeemed twice',
  replay.status === 400,
  `http ${String(replay.status)}`,
)

// 8. the token actually works on the MCP endpoint
const call = await fetch(B, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    Authorization: `Bearer ${String(tok.access_token)}`,
  },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
})
const tools = (await call.json()) as { result?: { tools?: unknown[] } }
say(
  'the token authenticates a real MCP call',
  call.status === 200 && (tools.result?.tools?.length ?? 0) > 0,
  `${String(call.status)}, ${String(tools.result?.tools?.length ?? 0)} tool(s)`,
)

console.log(
  `\n${String(8 - failures.length)}/8 checks passed` +
    (failures.length === 0 ? '' : `\nfailed: ${failures.join('; ')}`),
)
if (failures.length > 0) process.exit(1)

export {}
