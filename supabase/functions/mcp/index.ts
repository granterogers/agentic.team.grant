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

const DB_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const PROTOCOL_VERSION = '2024-11-05'

interface ToolSpec {
  readonly description: string
  readonly fn: string
  readonly schema: Record<string, unknown>
  readonly args: (input: Record<string, unknown>) => Record<string, unknown>
}

/**
 * The complete list. A tool not named here does not exist.
 *
 * Descriptions are written for a model that has never seen this system: they
 * say what the thing IS in this project's terms, because a model that does not
 * know what a "project" means here will use the wrong tool confidently.
 */
const TOOLS: Readonly<Record<string, ToolSpec>> = {
  list_projects: {
    description:
      'List the active projects the AI team is attached to. A project is the ' +
      'unit of work here: it owns documents and jobs. Start here when you do ' +
      'not know which project a question is about.',
    fn: 'mcp_projects',
    schema: { type: 'object', properties: {} },
    args: () => ({}),
  },
  search_documents: {
    description:
      'Full-text search across every document the team holds, whatever tool it ' +
      'came from (NotebookLM, Notion, uploads). Returns ranked snippets. This ' +
      'is the main way to answer a question about what the team knows — prefer ' +
      'it over guessing, and cite the documents it returns.',
    fn: 'mcp_search',
    schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'A question or phrase in plain language.' },
        project: { type: 'string', description: 'Optional project slug to narrow to.' },
        limit: { type: 'number', description: 'Max results, 1-25. Default 8.' },
      },
      required: ['query'],
    },
    args: (i) => ({
      p_query: String(i.query ?? ''),
      p_project: i.project === undefined ? null : String(i.project),
      p_limit: i.limit === undefined ? 8 : Number(i.limit),
    }),
  },
  read_document: {
    description:
      'Read one document in full, by the id search_documents returned. Long ' +
      'documents are truncated and say so.',
    fn: 'mcp_document',
    schema: {
      type: 'object',
      properties: {
        document_id: { type: 'string', description: 'The uuid from search_documents.' },
        max_chars: { type: 'number', description: 'Truncation budget, 1000-60000.' },
      },
      required: ['document_id'],
    },
    args: (i) => ({
      p_document_id: String(i.document_id ?? ''),
      p_max_chars: i.max_chars === undefined ? 20_000 : Number(i.max_chars),
    }),
  },
  list_staff: {
    description:
      'The AI team roster: who exists, their titles and what each is ' +
      'responsible for. Use it to attribute work or to say who would handle ' +
      'something.',
    fn: 'mcp_staff',
    schema: { type: 'object', properties: {} },
    args: () => ({}),
  },
  recent_work: {
    description:
      'What the team recently produced, with its provenance — confidence, ' +
      'evidence type, whether it was reviewed, and which sources it used. ' +
      'Evidence "inferred" means a model wrote it; do not present it as fact.',
    fn: 'mcp_recent_work',
    schema: {
      type: 'object',
      properties: { limit: { type: 'number', description: 'Max items, 1-50. Default 20.' } },
    },
    args: (i) => ({ p_limit: i.limit === undefined ? 20 : Number(i.limit) }),
  },
}

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

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === 'OPTIONS') return json({ ok: true })

  if (request.method === 'GET') {
    // Liveness only. It names no tool: an unauthenticated caller learning the
    // tool list is a probing aid, and the list is the interesting part.
    return json({ ok: true, endpoint: 'mcp', protocol: PROTOCOL_VERSION })
  }
  if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  const presented = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (presented === '') return json({ error: 'unauthorized' }, 401)

  const clients = (await rpc('mcp_client_for', { p_token_sha256: await sha256(presented) })) as {
    client_id?: string
    scopes?: string[]
  }[]
  const client = clients[0]
  if (client?.client_id === undefined) return json({ error: 'unauthorized' }, 401)

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
          'documents attached to them, and the work the team has produced. It is ' +
          'read-only. Search before answering questions about the projects, and ' +
          'cite the documents you use. Output marked evidence "inferred" was ' +
          'written by a model and is not established fact.',
      },
    })
  }

  // A notification has no id and expects no reply.
  if (method === 'notifications/initialized') return new Response(null, { status: 202 })

  if (method === 'tools/list') {
    return json({
      jsonrpc: '2.0',
      id: id ?? null,
      result: {
        tools: Object.entries(TOOLS).map(([name, spec]) => ({
          name,
          description: spec.description,
          inputSchema: spec.schema,
        })),
      },
    })
  }

  if (method === 'tools/call') {
    const name = String(params?.name ?? '')
    // `Object.hasOwn`, not a bare lookup: `TOOLS['constructor']` is truthy
    // through the prototype chain. The HQ endpoint had exactly that bug and it
    // is worse here, where the caller is a model that will try the name.
    const spec = Object.hasOwn(TOOLS, name) ? TOOLS[name] : undefined
    const input = (params?.arguments ?? {}) as Record<string, unknown>
    const started = Date.now()

    if (spec === undefined) {
      await rpc('mcp_record_call', {
        p_client_id: client.client_id,
        p_tool: name,
        p_arguments: input,
        p_outcome: 'refused',
      }).catch(() => undefined)
      return rpcError(id, -32_601, `no such tool: ${name}`)
    }

    try {
      const result = await rpc(spec.fn, spec.args(input))
      const rows = Array.isArray(result) ? result.length : 1
      await rpc('mcp_record_call', {
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
