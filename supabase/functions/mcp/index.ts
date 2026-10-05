/**
 * The MCP endpoint: what the team knows, to any MCP client.
 *
 * ADR-0014. Rather than the team pulling every tool's content inward so its
 * agents can reason over it, this exposes what the team already knows — the
 * projects, the corpus, the staff, the work — to anything that speaks Model
 * Context Protocol. Claude and ChatGPT both do, which is why this is one
 * adapter and not two integrations.
 *
 * ## Streamable HTTP, and only the parts that matter
 *
 * MCP's HTTP transport is JSON-RPC 2.0 over POST. A server that only offers
 * tools needs four methods — `initialize`, `notifications/initialized`,
 * `tools/list`, `tools/call` — and this implements exactly those. There is no
 * SSE stream, no session id and no sampling: none is required for a read-only
 * tool server, and each would be surface to defend.
 *
 * ## Every rule the HQ API has, for stronger reasons
 *
 * That endpoint serves a page we wrote. This one serves a general-purpose model
 * that will try things — so the fixed-shape rule is not a preference:
 *
 *   - **Named tools over reviewed projections.** No SQL from the client, ever,
 *     not even a table name. The projections are `app.mcp_*` (0065) where they
 *     can be read and argued with.
 *   - **A token per client, hashed** (0064). Withdrawing ChatGPT must not lock
 *     out Claude, and a call recorded against "someone" is not an audit trail.
 *   - **Every call recorded** — §11 measures every inference attempt, and a
 *     model reading this corpus through a tool is one. Not paying for it does
 *     not make it unmeasured.
 *   - **Read-only.** Team HQ is read-only because a dashboard where you can do
 *     something irreversible by accident is worse than one where you cannot do
 *     anything. A model has better reach and worse judgement about what is
 *     irreversible.
 *
 * `verify_jwt` is false because an MCP client has no Supabase JWT. The bearer
 * token is the whole of the authentication, which is why an absent one rejects
 * everything rather than waving requests through.
 */

import { resolveSpeaker } from '../../../src/auth/speaker.ts'
import { badValue, rpcArgs, scopeRefusal, toolNamed, visibleTools } from './tools.ts'

const DB_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const PROTOCOL_VERSION = '2024-11-05'

const sha256 = async (v: string): Promise<string> => {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v)))
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

const rpc = async (fn: string, args: Record<string, unknown>): Promise<unknown> => {
  const response = await fetch(`${DB_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  })
  if (!response.ok) throw new Error(`upstream ${String(response.status)}`)
  return await response.json()
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'authorization, content-type, mcp-protocol-version',
      'cache-control': 'no-store',
    },
  })

const rpcError = (id: unknown, code: number, message: string): Response =>
  json({ jsonrpc: '2.0', id: id ?? null, error: { code, message } })

// ---------------------------------------------------------------------------
// OAuth 2.1, because ChatGPT cannot be handed a static bearer
//
// Grant: *"ChatGPT does not support manually entering an arbitrary static
// bearer header when installing a developer-mode MCP app. It supports OAuth, no
// authentication, or mixed authentication."*
//
// "No authentication" is not an option: this endpoint writes to his project
// store (0068) and its URL is in a chat transcript. So the endpoint is now also
// an authorization server — a small one, for one user.
//
// ## Everything is under this function's own path
//
// The MCP discovery convention puts metadata at the ORIGIN's `/.well-known/…`,
// and this function does not own `baujwlzcziasnfhhkchg.supabase.co` — Supabase
// does. What it can do is what RFC 9728 provides for: the 401 carries
// `WWW-Authenticate: Bearer resource_metadata="<url>"`, naming a URL this
// function serves. A client that follows the header finds everything; a client
// that only probes the origin will not, and that is a real limitation stated
// here rather than discovered later.
//
// ## PKCE, and one password
//
// The client is public and registers itself, so the code is protected by PKCE
// (S256 only) rather than a secret. Consent is a page that asks for the Team HQ
// password — the one Grant already has. Inventing a second credential for a
// system with one user would be ceremony, not security.
// ---------------------------------------------------------------------------

/**
 * The PUBLIC url of this function.
 *
 * Not `new URL(request.url).origin`, which is what the first version used and
 * which is wrong twice: inside Supabase's edge runtime the request arrives as
 * `http://<host>/mcp` — plain http, and with the `/functions/v1` prefix
 * already stripped by the router. OAuth metadata containing an http issuer is
 * metadata every client is right to reject, and an issuer missing half its
 * path points at nothing.
 *
 * `SUPABASE_URL` is the function's own environment and is exactly the public
 * origin, so the whole url is derivable without trusting a proxy header.
 */
const PUBLIC_BASE = `${(Deno.env.get('SUPABASE_URL') ?? '').replace(/\/+$/, '')}/functions/v1/mcp`

const HQ_TOKEN = Deno.env.get('HQ_API_TOKEN') ?? ''

const base64url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

const randomToken = (prefix: string): string =>
  `${prefix}_${base64url(crypto.getRandomValues(new Uint8Array(32)))}`

/** S256, as the spec defines it: base64url(sha256(verifier)). */
const s256 = async (verifier: string): Promise<string> =>
  base64url(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))),
  )

const html = (body: string, status = 200): Response =>
  new Response(body, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  })

/**
 * The consent page.
 *
 * Names the client asking, because "some application wants access" is not
 * consent — and this is the only moment Grant can notice that something he did
 * not install is asking for his project store.
 */
const consentPage = (
  clientName: string,
  params: URLSearchParams,
  error?: string,
): string => `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Authorise ${escapeHtml(clientName)}</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    margin: 0; min-height: 100vh; display: grid; place-items: center;
    background: #0f1115; color: #e8eaed; padding: 24px; }
  .card { width: 100%; max-width: 380px; background: #171a21; border: 1px solid #262a33;
    border-radius: 14px; padding: 26px; }
  h1 { font-size: 17px; margin: 0 0 4px; }
  p { color: #9aa3b2; margin: 0 0 18px; font-size: 13px; }
  b { color: #e8eaed; }
  ul { color: #9aa3b2; font-size: 13px; padding-left: 18px; margin: 0 0 18px; }
  input { width: 100%; box-sizing: border-box; padding: 11px 12px; font: inherit;
    border: 1px solid #2c313b; border-radius: 9px; background: #0f1115; color: #e8eaed; }
  button { width: 100%; margin-top: 12px; padding: 11px; font: inherit; font-weight: 600;
    border: 0; border-radius: 9px; background: #4f7cff; color: #fff; cursor: pointer; }
  .err { color: #ff8a8a; font-size: 13px; margin-top: 12px; }
</style></head><body>
<form class="card" method="POST">
  <h1>Authorise <b>${escapeHtml(clientName)}</b></h1>
  <p>It is asking to connect to AI Team HQ. If you did not just start this, close the page.</p>
  <ul>
    <li>Read your projects, documents and staff</li>
    <li>Add documents and ask the team for work</li>
  </ul>
  ${[...params.entries()]
    .map(([k, v]) => `<input type="hidden" name="${escapeHtml(k)}" value="${escapeHtml(v)}">`)
    .join('')}
  <input type="password" name="hq_password" placeholder="Your Team HQ sign-in token" autofocus
    autocomplete="current-password">
  <button type="submit">Allow</button>
  ${error === undefined ? '' : `<div class="err">${escapeHtml(error)}</div>`}
</form></body></html>`

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** A Supabase session is a three-part JWT of real length; the machine key is not. */
const looksLikeSession = (v: string): boolean => v.split('.').length === 3 && v.length > 60

/** Constant-time-ish comparison of the machine key (binds to the TEST office only). */
const passwordMatches = async (presented: string): Promise<boolean> => {
  if (HQ_TOKEN === '' || presented === '') return false
  const [a, b] = await Promise.all([sha256(presented), sha256(HQ_TOKEN)])
  return a === b
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === 'OPTIONS') return json({ ok: true })

  const url = new URL(request.url)
  const base = PUBLIC_BASE
  // Both shapes: `/functions/v1/mcp/token` from outside, `/mcp/token` from
  // inside the edge router, which strips the prefix before we see it.
  const path = url.pathname.replace(/^.*?\/mcp/, '')

  // --- discovery -----------------------------------------------------------

  if (path.endsWith('/.well-known/oauth-protected-resource')) {
    return json({
      resource: base,
      authorization_servers: [base],
      bearer_methods_supported: ['header'],
      scopes_supported: ['read', 'write'],
    })
  }

  if (
    path.endsWith('/.well-known/oauth-authorization-server') ||
    path.endsWith('/.well-known/openid-configuration')
  ) {
    return json({
      issuer: base,
      authorization_endpoint: `${base}/authorize`,
      token_endpoint: `${base}/token`,
      registration_endpoint: `${base}/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code'],
      // S256 only. A public client with no secret and no PKCE has an
      // authorization code that is a bearer token for anyone who sees a
      // redirect, and a redirect goes through a browser.
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      scopes_supported: ['read', 'write'],
    })
  }

  // --- dynamic registration (RFC 7591) -------------------------------------

  if (path === '/register' && request.method === 'POST') {
    let reg: { client_name?: string; redirect_uris?: string[] }
    try {
      reg = (await request.json()) as typeof reg
    } catch {
      return json({ error: 'invalid_client_metadata' }, 400)
    }
    const result = (await rpc('mcp_register_client', {
      p_client_name: reg.client_name ?? 'MCP client',
      p_redirect_uris: reg.redirect_uris ?? [],
    })) as Record<string, unknown>
    if (result.error !== undefined) return json({ error: result.error }, 400)
    return json(result, 201)
  }

  // --- authorize -----------------------------------------------------------

  if (path === '/authorize') {
    const params =
      request.method === 'POST' ? new URLSearchParams(await request.text()) : url.searchParams

    const clientId = params.get('client_id') ?? ''
    const redirectUri = params.get('redirect_uri') ?? ''
    const challenge = params.get('code_challenge') ?? ''
    const method = params.get('code_challenge_method') ?? ''
    const state = params.get('state') ?? ''

    if (clientId === '' || redirectUri === '') {
      return html('<p>Missing client_id or redirect_uri.</p>', 400)
    }
    if (challenge === '' || method !== 'S256') {
      return html('<p>This server requires PKCE with S256.</p>', 400)
    }

    // From the registration, never from the query string. `?client_name=` is a
    // string the caller controls, on the one page whose job is to let Grant
    // recognise what is asking — so anything could have presented itself as
    // "ChatGPT" and been believed (0093).
    const registered = (await rpc('mcp_client_name', { p_client_id: clientId })) as string | null
    if (registered === null) return html('<p>Unknown client.</p>', 400)
    const shown = registered

    if (request.method !== 'POST') {
      // Ask. Everything the client sent is carried through as hidden fields, so
      // the POST that follows is the same request plus a password.
      return html(consentPage(shown, params))
    }

    /*
      WHO IS CONSENTING decides WHICH OFFICE this client will belong to for the rest of its life (P3). The machine key
      names nobody, so it can no longer consent for a real office: it binds the client to the TEST office (the office
      every harness credential belongs to). A signed-in person consents with their own session, and the client is bound to
      the office THEIR LOGIN resolved to. Neither can name an office; nothing in the form can.
    */
    const offered = params.get('hq_password') ?? ''
    let consentOffice: string | null = null
    if (looksLikeSession(offered)) {
      const who = await resolveSpeaker(offered, {
        hqToken: HQ_TOKEN,
        supabaseUrl: DB_URL,
        anonKey: Deno.env.get('SUPABASE_ANON_KEY') ?? '',
        serviceKey: SERVICE_KEY,
      })
      if (who !== null && who.kind !== 'service' && who.office !== null) consentOffice = who.office
    } else if (await passwordMatches(offered)) {
      const machine = (await rpc('resolve_machine_office', {}).catch(() => null)) as {
        ok?: boolean
        office_id?: string
      } | null
      if (machine?.ok === true && typeof machine.office_id === 'string')
        consentOffice = machine.office_id
    }
    if (consentOffice === null) {
      const retry = new URLSearchParams(params)
      retry.delete('hq_password')
      return html(consentPage(shown, retry, 'That was not accepted.'), 401)
    }

    const code = randomToken('mcpa')
    const issued = (await rpc('mcp_issue_code', {
      p_office: consentOffice,
      p_client_id: clientId,
      p_redirect_uri: redirectUri,
      p_code_sha256: await sha256(code),
      p_code_challenge: challenge,
      p_resource: params.get('resource'),
    })) as Record<string, unknown>
    if (issued.error !== undefined) {
      return html(`<p>${escapeHtml(String(issued.error))}</p>`, 400)
    }

    const back = new URL(redirectUri)
    back.searchParams.set('code', code)
    if (state !== '') back.searchParams.set('state', state)
    return new Response(null, { status: 302, headers: { location: back.toString() } })
  }

  // --- token ---------------------------------------------------------------

  if (path === '/token' && request.method === 'POST') {
    const form = new URLSearchParams(await request.text())
    if (form.get('grant_type') !== 'authorization_code') {
      return json({ error: 'unsupported_grant_type' }, 400)
    }
    const code = form.get('code') ?? ''
    const verifier = form.get('code_verifier') ?? ''
    const clientId = form.get('client_id') ?? ''
    const redirectUri = form.get('redirect_uri') ?? ''
    if (code === '' || verifier === '') return json({ error: 'invalid_request' }, 400)

    const codeHash = await sha256(code)
    const expected = (await rpc('mcp_code_challenge', { p_code_sha256: codeHash })) as string | null
    // Checked HERE and not in the database: the verifier must never leave this
    // function, and hashing it in SQL would put it in a statement.
    if (expected === null || (await s256(verifier)) !== expected) {
      return json({ error: 'invalid_grant' }, 400)
    }

    const token = randomToken('mcp')
    const redeemed = (await rpc('mcp_redeem_code', {
      p_code_sha256: codeHash,
      p_client_id: clientId,
      p_redirect_uri: redirectUri,
      p_token_sha256: await sha256(token),
    })) as Record<string, unknown>
    if (redeemed.error !== undefined) return json({ error: redeemed.error }, 400)

    return json({
      access_token: token,
      token_type: 'Bearer',
      // No expiry: this is a personal integration for one user, and a token
      // that silently stops working in an hour is a connector he has to
      // reconnect every hour. Revocation is `npm run mcp:revoke`, which is
      // immediate and is the control that actually gets used.
      scope: String(redeemed.scope ?? 'read write'),
    })
  }

  if (request.method === 'GET') {
    // Liveness only. It names no tool: an unauthenticated caller learning the
    // tool list is a probing aid, and the list is the interesting part.
    return json({ ok: true, endpoint: 'mcp', protocol: PROTOCOL_VERSION })
  }
  if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  const presented = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  // RFC 9728: the 401 names where to go. This is the whole of how a client
  // that was given only the endpoint URL discovers that it can authenticate at
  // all, and the reason this function can be an authorization server without
  // owning the origin's `/.well-known/`.
  const challenge = {
    'www-authenticate': `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource"`,
  }
  if (presented === '') {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'access-control-allow-origin': '*',
        ...challenge,
      },
    })
  }

  const clients = (await rpc('mcp_client_for', { p_token_sha256: await sha256(presented) })) as {
    client_id?: string
    scopes?: string[]
    office_id?: string
  }[]
  const client = clients[0]
  // A client with no office is not a client: the credential itself must establish the office (P3).
  if (client?.client_id === undefined || typeof client.office_id !== 'string') {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'access-control-allow-origin': '*',
        ...challenge,
      },
    })
  }

  const clientOffice: string = client.office_id
  let body: { jsonrpc?: string; id?: unknown; method?: string; params?: Record<string, unknown> }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return rpcError(null, -32_700, 'parse error')
  }

  const { id, method, params } = body

  if (method === 'initialize') {
    return json({
      jsonrpc: '2.0',
      id: id ?? null,
      result: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: 'ai-team-hq', version: '1.0.0' },
        // Said to the model, not just to the developer: a client that knows the
        // corpus is one team's and read-only will not try to write to it.
        instructions:
          "This is one person's private AI team. It holds their projects, the " +
          'documents attached to them, and the work the team has produced. ' +
          'Search before answering questions about the projects, and cite the ' +
          'documents you use. Output marked evidence "inferred" was written by a ' +
          'model and is not established fact. You may add documents, tasks and ' +
          'calendar events to a project, ask the team a question, start research ' +
          'and request a report, and everything you do is recorded as yours. You ' +
          "cannot delete or cancel anything, and where the owner's policy says a " +
          'request needs their approval you are told so and nothing starts.',
      },
    })
  }

  // A notification has no id and expects no reply.
  if (method === 'notifications/initialized') return new Response(null, { status: 202 })

  if (method === 'tools/list') {
    // Optional tools (the calendar) are listed only where this database can perform them. A failure to ask is "none":
    // advertising a tool that cannot work is worse than not advertising it.
    const optional = (await rpc('mcp_optional_tools', { p_office: clientOffice }).catch(
      () => [],
    )) as string[]
    return json({
      jsonrpc: '2.0',
      id: id ?? null,
      result: {
        tools: visibleTools(Array.isArray(optional) ? optional : []).map(([name, spec]) => ({
          name,
          description: spec.description,
          inputSchema: spec.schema,
        })),
      },
    })
  }

  if (method === 'tools/call') {
    const name = String(params?.name ?? '')
    // Own properties only (`toolNamed`): `TOOLS['constructor']` is truthy through the prototype chain. The HQ
    // endpoint had exactly that bug and it is worse here, where the caller is a model that will try the name.
    const spec = toolNamed(name)
    const input = (params?.arguments ?? {}) as Record<string, unknown>
    const started = Date.now()

    if (spec === undefined) {
      await rpc('mcp_record_call', {
        p_office: clientOffice,
        p_client_id: client.client_id,
        p_tool: name,
        p_arguments: input,
        p_outcome: 'refused',
      }).catch(() => undefined)
      return rpcError(id, -32_601, `no such tool: ${name}`)
    }

    try {
      // The scope check, before the call rather than inside the projection: a
      // read-only client must not be able to make the attempt, not merely fail
      // at it.
      if (scopeRefusal(spec, client.scopes ?? []) !== null) {
        await rpc('mcp_record_call', {
          p_office: clientOffice,
          p_client_id: client.client_id,
          p_tool: name,
          p_arguments: input,
          p_outcome: 'refused',
        }).catch(() => undefined)
        return rpcError(id, -32_602, `${name} needs the write scope; this client is read-only`)
      }

      const unreadable = badValue(input)
      if (unreadable !== null) return rpcError(id, -32_602, unreadable)

      // The OFFICE is the client's own - resolved from the token, never from anything the model sent.
      const result = await rpc(spec.fn, rpcArgs(spec, clientOffice, client.client_id, input))
      const rows = Array.isArray(result) ? result.length : 1
      await rpc('mcp_record_call', {
        p_office: clientOffice,
        p_client_id: client.client_id,
        p_tool: name,
        p_arguments: input,
        p_outcome: 'ok',
        p_rows: rows,
        p_duration_ms: Date.now() - started,
      }).catch(() => undefined)

      return json({
        jsonrpc: '2.0',
        id: id ?? null,
        result: {
          content: [{ type: 'text', text: JSON.stringify(result, null, 1) }],
        },
      })
    } catch (error) {
      await rpc('mcp_record_call', {
        p_office: clientOffice,
        p_client_id: client.client_id,
        p_tool: name,
        p_arguments: input,
        p_outcome: 'error',
        p_duration_ms: Date.now() - started,
      }).catch(() => undefined)
      // The upstream detail stays here: a database error in a model's context
      // is schema disclosure, and the model will faithfully repeat it.
      console.error(`mcp ${name}: ${(error as Error).message}`)
      return rpcError(id, -32_603, 'the tool failed')
    }
  }

  return rpcError(id, -32_601, `unsupported method: ${String(method)}`)
})
