/**
 * Asking somebody else's MCP server what it offers (#265).
 *
 * The office is an MCP **server** — `supabase/functions/mcp`, 22 rows in
 * `mcp_clients`, OAuth clients and auth codes — and things connect TO it.
 * This is the other direction, which did not exist at all: the office as a
 * client. Worth saying, because "working MCP read/write support" reads as
 * though half of this were already here.
 *
 * ## Why it is a hundred lines and not a dependency
 *
 * Discovery is two JSON-RPC calls over HTTP: `initialize`, then `tools/list`.
 * That is the whole of what this needs, it runs in Deno where a bundled SDK is
 * a cold start, and the protocol's own versioning is the thing most likely to
 * change — which is easier to follow in code that is visibly two requests.
 *
 * Calling a tool is deliberately NOT here. Discovery is not permission
 * (0440), and a client that could call would be the second execution path
 * #169 and #170 both warn against. When a discovered tool is eventually
 * invoked it will be invoked by a handler, under `app.staff_may_use`, like
 * anything else.
 *
 * ## The credential
 *
 * Passed in, never read from anywhere. Signing and secret-reading happen in
 * the caller, so importing this module cannot give anybody the ability to
 * authenticate — the same rule `src/files/store.ts` states about the service
 * key.
 */

import {
  type GuardedFetchDeps,
  guardedFetch,
  type Resolver,
  readCapped,
} from '../net/destination.ts'

/** What the protocol version field said. Sent, and echoed back in the record. */
export const PROTOCOL_VERSION = '2025-06-18'

export interface DiscoveredTool {
  readonly name: string
  readonly description: string
  readonly inputSchema: Record<string, unknown>
}

export interface Discovery {
  readonly ok: boolean
  readonly tools: readonly DiscoveredTool[]
  readonly serverName: string | null
  readonly serverVersion: string | null
  readonly protocolVersion: string | null
  /** The whole reason it failed, in the words of whatever refused. */
  readonly error: string | null
}

/** A reply is read at most this far. */
const MAX_REPLY_BYTES = 200_000

/** The destination policy or the network said no. The message is ours, never the remote server's. */
class Refused extends Error {}

/**
 * A short sentence for a status and nothing else. Whatever a provider put in its body or its JSON-RPC error message is
 * remote text: it would reach the person in an announced job body and the provider's health row, so it is not carried.
 */
const saidNo = (status: number, code: number | undefined): string =>
  code === undefined
    ? `the server answered ${String(status)}`
    : `the server answered ${String(status)} with an error (code ${String(code)})`

const rpcCode = (r: { body: RpcResult }): number | undefined =>
  typeof r.body.error?.code === 'number' && Number.isFinite(r.body.error.code)
    ? r.body.error.code
    : undefined

interface RpcResult {
  result?: Record<string, unknown>
  error?: { code?: number; message?: string }
}

/**
 * One JSON-RPC call.
 *
 * Accepts both content types the transport allows: a plain JSON body, and an
 * SSE stream whose first `data:` line carries the response. The second is what
 * a Streamable HTTP server returns by default and skipping it would make the
 * office unable to talk to most of them.
 */
async function rpc(
  endpoint: string,
  method: string,
  params: Record<string, unknown>,
  headers: Record<string, string>,
  deps: GuardedFetchDeps,
  sessionId: string | null,
): Promise<{ body: RpcResult; session: string | null; status: number; raw: string }> {
  /*
    The endpoint was typed by a person and is judged as untrusted on every request: shape, resolution and each
    redirect hop (src/net/destination.ts). A refusal is thrown as a `Refused` so `discoverTools` can say it in its own
    fixed words; nothing the remote server said is carried in it.
  */
  const got = await guardedFetch(
    endpoint,
    {
      body: JSON.stringify({ id: Math.floor(Math.random() * 1e9), jsonrpc: '2.0', method, params }),
      headers: {
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
        'mcp-protocol-version': PROTOCOL_VERSION,
        ...(sessionId === null ? {} : { 'mcp-session-id': sessionId }),
        ...headers,
      },
      method: 'POST',
    },
    deps,
  )
  if (!got.ok) throw new Refused(got.reason)
  const r = got.response
  const raw = await readCapped(r, MAX_REPLY_BYTES)
  const session = r.headers.get('mcp-session-id') ?? sessionId
  if (!r.ok) return { body: {}, raw, session, status: r.status }

  const text = raw.trimStart()
  if (text.startsWith('{')) {
    try {
      return { body: JSON.parse(text) as RpcResult, raw, session, status: r.status }
    } catch {
      return { body: {}, raw, session, status: r.status }
    }
  }
  // An event stream. The response is the first `data:` line that parses.
  for (const line of text.split('\n')) {
    if (!line.startsWith('data:')) continue
    try {
      return { body: JSON.parse(line.slice(5).trim()) as RpcResult, raw, session, status: r.status }
    } catch {
      // Keep looking: a stream may open with a comment or a ping.
    }
  }
  return { body: {}, raw, session, status: r.status }
}

/**
 * Ask a provider what it offers.
 *
 * Never throws. A provider that is down, slow, wrong or hostile produces
 * `ok: false` and a sentence, because this runs inside a job and an exception
 * here would fail work that has nothing to do with the provider.
 */
export async function discoverTools(
  endpoint: string,
  options: {
    readonly bearer?: string | undefined
    readonly fetchImpl?: typeof fetch
    /** Resolves names for the destination check; see `guardedFetch`. A test with an injected fetch injects this too. */
    readonly resolve?: Resolver
    readonly timeoutMs?: number
  } = {},
): Promise<Discovery> {
  const deps: GuardedFetchDeps = {
    ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
    ...(options.resolve === undefined ? {} : { resolve: options.resolve }),
    timeoutMs: options.timeoutMs ?? 20_000,
  }
  const headers: Record<string, string> =
    options.bearer === undefined || options.bearer === ''
      ? {}
      : { authorization: `Bearer ${options.bearer}` }
  const nothing = {
    protocolVersion: null,
    serverName: null,
    serverVersion: null,
    tools: [] as DiscoveredTool[],
  }

  try {
    const hello = await rpc(
      endpoint,
      'initialize',
      {
        capabilities: {},
        clientInfo: { name: 'agentic-team-hq', version: '1' },
        protocolVersion: PROTOCOL_VERSION,
      },
      headers,
      deps,
      null,
    )
    if (hello.status !== 200 || hello.body.result === undefined) {
      return { ...nothing, error: saidNo(hello.status, rpcCode(hello)), ok: false }
    }
    const info = (hello.body.result.serverInfo ?? {}) as { name?: string; version?: string }

    const listed = await rpc(endpoint, 'tools/list', {}, headers, deps, hello.session)
    if (listed.status !== 200 || listed.body.result === undefined) {
      return {
        error: `it introduced itself and then refused to list its tools (${String(listed.status)}${
          rpcCode(listed) === undefined ? '' : `, code ${String(rpcCode(listed))}`
        })`,
        ok: false,
        protocolVersion: String(hello.body.result.protocolVersion ?? ''),
        serverName: info.name ?? null,
        serverVersion: info.version ?? null,
        tools: [],
      }
    }

    const raw = Array.isArray(listed.body.result.tools) ? listed.body.result.tools : []
    const tools = raw
      .map((t): DiscoveredTool | null => {
        const tool = t as Record<string, unknown>
        const name = String(tool.name ?? '').trim()
        if (name === '' || name.length > 120) return null
        return {
          description: String(tool.description ?? '').slice(0, 2_000),
          inputSchema:
            typeof tool.inputSchema === 'object' && tool.inputSchema !== null
              ? (tool.inputSchema as Record<string, unknown>)
              : {},
          name,
        }
      })
      .filter((t): t is DiscoveredTool => t !== null)
      /*
        A provider advertising five hundred tools is either a directory or a
        mistake, and either way the office should not write five hundred rows
        before a person has looked. Capped and SAID, so the cap is visible
        rather than a silent truncation.
      */
      .slice(0, 200)

    return {
      error:
        raw.length > tools.length
          ? `kept ${String(tools.length)} of ${String(raw.length)} advertised tools`
          : null,
      ok: true,
      protocolVersion: String(hello.body.result.protocolVersion ?? ''),
      serverName: info.name ?? null,
      serverVersion: info.version ?? null,
      tools,
    }
  } catch (error) {
    // Only our own sentences are repeated. Any other exception came from the runtime or the network and can carry the
    // address, a header or a piece of the response, so it becomes one fixed phrase.
    return {
      ...nothing,
      error: error instanceof Refused ? error.message : 'the server could not be reached',
      ok: false,
    }
  }
}
