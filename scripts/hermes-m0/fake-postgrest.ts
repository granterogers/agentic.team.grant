/**
 * A stand-in for the part of PostgREST that `supabase/functions/mcp` talks to, so the REAL function code can run under Deno
 * with no database and no production host.
 *
 * What it is evidence of: the arguments the real function sends to the database (which office, which project, which client),
 * and how it behaves on each answer. What it is NOT evidence of: anything the SQL does (`app.mcp_write_client`,
 * `app.engine_tool_gate`, row security). Those need the replica, and every check that rests on this file says MOCK.
 */
import { close, listen, newServer, readBody, sendJson, sleep } from './lib.ts'

export interface TestClient {
  readonly client_id: string
  readonly scopes: readonly string[]
  readonly office_id: string
}

export interface RpcCall {
  readonly fn: string
  readonly args: Record<string, unknown>
}

export interface FakePostgrest {
  readonly url: string
  readonly calls: RpcCall[]
  /** Calls to one function since the last reset. */
  callsTo: (fn: string) => RpcCall[]
  reset: () => void
  /** Make the next call to `fn` fail like a database error. */
  failNext: (fn: string) => void
  /** Make the next call to `fn` take this long to answer (a slow database, so a stop can land mid tool call). */
  delayNext: (fn: string, ms: number) => void
  stop: () => Promise<void>
}

export const OFFICE_A = '11111111-1111-4111-8111-111111111111'
export const OFFICE_B = '22222222-2222-4222-8222-222222222222'

const PROJECTS = [
  { office_id: OFFICE_A, slug: 'harvest-lane', name: 'Harvest Lane' },
  { office_id: OFFICE_A, slug: 'budget-2027', name: 'Budget 2027' },
  { office_id: OFFICE_B, slug: 'other-office-secret', name: 'Somebody Else' },
]

export const startFakePostgrest = async (
  clientsBySha: ReadonlyMap<string, TestClient>,
): Promise<FakePostgrest> => {
  const calls: RpcCall[] = []
  const failing = new Set<string>()
  const delays = new Map<string, number>()
  const server = newServer(async (req, res) => {
    const match = /^\/rest\/v1\/rpc\/([a-z_0-9]+)$/.exec(req.url ?? '')
    if (req.method !== 'POST' || match === null) {
      sendJson(res, 404, { message: 'not found' })
      return
    }
    const fn = match[1] ?? ''
    const args = JSON.parse((await readBody(req)) || '{}') as Record<string, unknown>
    calls.push({ fn, args })
    const wait = delays.get(fn)
    if (wait !== undefined) {
      delays.delete(fn)
      await sleep(wait)
    }
    if (failing.delete(fn)) {
      // The real thing says something about the schema here; the function must never repeat it to the model.
      sendJson(res, 400, {
        message: 'relation "public.secret_table" does not exist',
        code: '42P01',
      })
      return
    }
    if (fn === 'mcp_client_for') {
      const client = clientsBySha.get(String(args.p_token_sha256 ?? ''))
      sendJson(res, 200, client === undefined ? [] : [client])
      return
    }
    if (fn === 'mcp_optional_tools') {
      sendJson(res, 200, [])
      return
    }
    if (fn === 'mcp_record_call') {
      sendJson(res, 200, null)
      return
    }
    if (fn === 'mcp_projects') {
      sendJson(
        res,
        200,
        PROJECTS.filter((p) => p.office_id === args.p_office),
      )
      return
    }
    // Every other projection: say which function was reached and with what, scoped to the office it was handed.
    sendJson(res, 200, [{ echo_fn: fn, office: args.p_office ?? null, args }])
  })
  const port = await listen(server, 0)
  return {
    url: `http://127.0.0.1:${String(port)}`,
    calls,
    callsTo: (fn) => calls.filter((c) => c.fn === fn),
    reset: () => {
      calls.length = 0
      failing.clear()
      delays.clear()
    },
    failNext: (fn) => {
      failing.add(fn)
    },
    delayNext: (fn, ms) => {
      delays.set(fn, ms)
    },
    stop: () => close(server),
  }
}
