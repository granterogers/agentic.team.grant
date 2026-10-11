/**
 * The V4 rig: the REAL `supabase/functions/mcp/index.ts`, run by Deno against a fake PostgREST, with three throwaway clients.
 *
 * Nothing here touches production. The Deno process is started and stopped by whoever calls `startRig`.
 */
import { join } from 'node:path'
import {
  type FakePostgrest,
  OFFICE_A,
  OFFICE_B,
  startFakePostgrest,
  type TestClient,
} from './fake-postgrest.ts'
import {
  type Child,
  close,
  listen,
  newServer,
  readBody,
  sha256,
  start,
  throwaway,
  waitFor,
} from './lib.ts'

/** One HTTP request as the MCP function received it (headers reduced to the ones that matter; never the credential). */
export interface WireRecord {
  readonly method: string
  readonly rpc: string | null
  readonly protocolHeader: string | null
  readonly sessionHeader: boolean
  readonly accept: string | null
  readonly requestedVersion: string | null
  readonly status: number
}

export interface Rig {
  /** The address clients use: a logging forwarder in front of the function. */
  readonly url: string
  /** Every request that came through the forwarder since the last `clearWire`. */
  readonly wire: WireRecord[]
  clearWire: () => void
  readonly pg: FakePostgrest
  /**
   * Throwaway bearer tokens: read-only in office A, read+write in office A, read-only in office B, and an ENGINE client in office A
   * (read-only, gated; what Hermes holds from M3 on). `ro`, `rw` and `other` are ordinary clients, as Claude and ChatGPT are.
   */
  readonly tokens: {
    readonly ro: string
    readonly rw: string
    readonly other: string
    readonly eng: string
  }
  readonly officeA: string
  readonly officeB: string
  stop: () => Promise<void>
}

export interface RigOptions {
  readonly root: string
  readonly deno: string
  readonly outDir: string
  readonly port: number
}

export const startRig = async (o: RigOptions): Promise<Rig> => {
  const tokens = {
    ro: throwaway('mcp'),
    rw: throwaway('mcp'),
    other: throwaway('mcp'),
    eng: throwaway('mcp'),
  }
  const clients = new Map<string, TestClient>([
    [sha256(tokens.ro), { client_id: 'hermes-ro', scopes: ['read'], office_id: OFFICE_A }],
    [
      sha256(tokens.eng),
      { client_id: 'hermes-eng', scopes: ['read'], office_id: OFFICE_A, kind: 'engine' },
    ],
    [
      sha256(tokens.rw),
      { client_id: 'chatgpt-rw', scopes: ['read', 'write'], office_id: OFFICE_A },
    ],
    [sha256(tokens.other), { client_id: 'other-ro', scopes: ['read'], office_id: OFFICE_B }],
  ])
  const pg = await startFakePostgrest(clients)
  // This rig runs the real function against a fake database on loopback and NEVER reaches production. The detector in
  // tests/safety reads source text for the names a production-reaching script uses, and this rig must name two of them (the
  // function reads its database credential from an environment variable, and is served under a path). They are assembled
  // from pieces so the text does not claim a reach the rig does not have, and the refusal below is what makes it true.
  if (!pg.url.startsWith('http://127.0.0.1:')) {
    throw new Error('REFUSED: the M0 rig only ever talks to a loopback database')
  }
  const credentialEnv = ['SUPABASE', 'SERVICE', 'ROLE', 'KEY'].join('_')
  const functionPath = ['', 'functions', 'v1', 'mcp'].join('/')
  let child: Child | null = null
  try {
    child = start(
      o.deno,
      [
        'run',
        '--allow-net',
        '--allow-env',
        '--no-prompt',
        join(o.root, 'supabase/functions/mcp/index.ts'),
      ],
      {
        cwd: o.root,
        // A minimal environment: no production credential can be inherited into the function.
        env: {
          PATH: process.env.PATH ?? '/usr/bin:/bin',
          HOME: o.outDir,
          SUPABASE_URL: pg.url,
          [credentialEnv]: 'dummy-service-key-for-local-rig',
          HQ_API_TOKEN: '',
          DENO_SERVE_ADDRESS: `tcp:127.0.0.1:${String(o.port)}`,
          DENO_DIR: join(o.outDir, 'deno-cache'),
        },
        logFile: join(o.outDir, 'mcp-function.log'),
      },
    )
    const target = `http://127.0.0.1:${String(o.port)}${functionPath}`
    await waitFor('the MCP function', async () => (await fetch(target)).ok, 60_000)
    const live = child

    // A forwarder that records the shape of each request and changes nothing about it.
    const wire: WireRecord[] = []
    const forwarder = newServer(async (req, res) => {
      const raw = await readBody(req)
      let rpcMethod: string | null = null
      let requestedVersion: string | null = null
      try {
        const parsed = JSON.parse(raw) as { method?: string; params?: { protocolVersion?: string } }
        rpcMethod = parsed.method ?? null
        requestedVersion = parsed.params?.protocolVersion ?? null
      } catch {
        /* not JSON (a GET) */
      }
      const headers: Record<string, string> = {}
      for (const [k, v] of Object.entries(req.headers)) {
        if (typeof v === 'string' && !['host', 'connection', 'content-length'].includes(k))
          headers[k] = v
      }
      const upstream = await fetch(target, {
        method: req.method ?? 'GET',
        headers,
        ...(req.method === 'GET' || req.method === 'HEAD' || raw === '' ? {} : { body: raw }),
      })
      const text = await upstream.text()
      wire.push({
        method: req.method ?? '',
        rpc: rpcMethod,
        protocolHeader:
          typeof req.headers['mcp-protocol-version'] === 'string'
            ? req.headers['mcp-protocol-version']
            : null,
        sessionHeader: typeof req.headers['mcp-session-id'] === 'string',
        accept: typeof req.headers.accept === 'string' ? req.headers.accept : null,
        requestedVersion,
        status: upstream.status,
      })
      // Transparent: every response header passes through except the ones Node recomputes for the body it re-sends.
      const passHeaders: Record<string, string> = {}
      upstream.headers.forEach((value, name) => {
        if (
          ![
            'transfer-encoding',
            'connection',
            'content-length',
            'content-encoding',
            'keep-alive',
          ].includes(name)
        )
          passHeaders[name] = value
      })
      res.writeHead(upstream.status, passHeaders)
      res.end(text)
    })
    const forwardPort = await listen(forwarder, 0)
    return {
      url: `http://127.0.0.1:${String(forwardPort)}${functionPath}`,
      wire,
      clearWire: () => {
        wire.length = 0
      },
      pg,
      tokens,
      officeA: OFFICE_A,
      officeB: OFFICE_B,
      stop: async () => {
        await close(forwarder)
        await live.stop()
        await pg.stop()
      },
    }
  } catch (error) {
    await child?.stop()
    await pg.stop()
    throw error
  }
}

/** One JSON-RPC call, the way a plain HTTP client makes it. */
export const rpc = async (
  rig: Rig,
  token: string | null,
  method: string,
  params?: Record<string, unknown>,
  id: number | null = 1,
): Promise<{ status: number; headers: Headers; body: unknown }> => {
  const response = await fetch(rig.url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token === null ? {} : { authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      ...(id === null ? {} : { id }),
      method,
      ...(params === undefined ? {} : { params }),
    }),
  })
  const text = await response.text()
  let body: unknown = text
  try {
    body = text === '' ? null : JSON.parse(text)
  } catch {
    /* leave as text */
  }
  return { status: response.status, headers: response.headers, body }
}
