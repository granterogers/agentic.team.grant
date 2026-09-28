/**
 * The REAL `/voice/turn` door, run in Node against the isolated replica.
 *
 * `supabase/functions/voice/index.ts` is one file with no imports, and it
 * touches the runtime in exactly two places, `Deno.env.get` and `Deno.serve`.
 * So this supplies a stand-in `Deno`, captures the handler `Deno.serve` is
 * given, and answers the door's `fetch` calls to the database with a minimal
 * PostgREST emulator over the replica. The adapter's own code is what runs,
 * unmodified. Nothing here can reach production: the only database is the
 * marked local socket `guard.ts` insists on, and any other URL is refused.
 *
 * THE EMULATOR'S ASSUMPTIONS, stated because a test is only as honest as its
 * stand-ins. It reproduces the PostgREST behaviours the door depends on:
 * `POST /rest/v1/<table>` inserts one row and returns it (201, JSON array);
 * `POST /rest/v1/rpc/<fn>` calls `public.<fn>` with named arguments and returns
 * its JSON; a constraint violation returns HTTP 409 with the Postgres
 * `code`, `message` and `details`, which is PostgREST's documented mapping for
 * both 23505 (unique) and 23503 (foreign key). Nothing else is emulated.
 */
import type { PgExecutor } from '../../src/db/pg-executor.ts'

const DB_URL = 'http://replica.invalid'
export const DOOR_TOKEN = 'isolated-door-token'

type Handler = (request: Request) => Promise<Response>

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

export async function startDoor(db: PgExecutor): Promise<Handler> {
  let handler: Handler | null = null
  const env: Record<string, string> = {
    HQ_API_TOKEN: DOOR_TOKEN,
    SUPABASE_URL: DB_URL,
    SUPABASE_SERVICE_ROLE_KEY: 'isolated-service-key',
  }
  ;(globalThis as unknown as { Deno: unknown }).Deno = {
    env: { get: (k: string) => env[k] },
    serve: (h: Handler) => {
      handler = h
    },
  }
  const realFetch = globalThis.fetch
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input)
    if (!url.startsWith(DB_URL)) {
      throw new Error(`REFUSED: the isolated door may only reach the replica, not ${url}`)
    }
    const path = new URL(url).pathname
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
    const reply = (status: number, value: unknown) =>
      new Response(JSON.stringify(value), {
        status,
        headers: { 'content-type': 'application/json' },
      })
    try {
      if (path.startsWith('/rest/v1/rpc/')) {
        const fn = path.slice('/rest/v1/rpc/'.length)
        const args = Object.entries(body)
          .map(([k, v]) => `${k} => ${v === null ? 'null' : lit(String(v))}`)
          .join(', ')
        const { rows } = await db.execute(`select to_jsonb(public.${fn}(${args})) as r`)
        return reply(200, (rows[0] as { r: unknown }).r)
      }
      const table = path.slice('/rest/v1/'.length)
      /* Only the columns the body names, as PostgREST does, so every other
         column keeps its DEFAULT (project_id's is app.unnamed_project()). */
      const cols = Object.keys(body)
        .filter((k) => /^[a-z_]+$/.test(k))
        .join(', ')
      const { rows } = await db.execute(`
        insert into public.${table} (${cols})
        select ${cols} from jsonb_populate_record(null::public.${table}, ${lit(JSON.stringify(body))}::jsonb)
        returning to_jsonb(${table}.*) as r`)
      return reply(201, [(rows[0] as { r: unknown }).r])
    } catch (e) {
      const m = String((e as Error).message)
      if (process.env.DOOR_DEBUG) console.error(`emulator: ${path} -> ${m.slice(0, 300)}`)
      const code = /^(\d{5}|[0-9A-Z]{5}):/.exec(m)?.[1] ?? 'XX000'
      return reply(code === '23503' || code === '23505' ? 409 : 400, {
        code,
        message: m.replace(/^[0-9A-Z]{5}:\s*/, ''),
        details: null,
      })
    }
  }) as typeof fetch
  /* A variable specifier, as the unit tests do: the edge file is Deno code,
     and tsc must not type-check it as Node code by following this import. */
  const EDGE = '../../supabase/functions/voice/index.ts'
  await import(EDGE)
  if (handler === null) {
    globalThis.fetch = realFetch
    throw new Error('the voice door did not call Deno.serve')
  }
  return handler
}

/** One turn through the door, as the page posts it. */
export async function postTurn(
  door: Handler,
  body: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const r = await door(
    new Request('https://door.invalid/functions/v1/voice/turn', {
      method: 'POST',
      headers: { Authorization: `Bearer ${DOOR_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
  return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, unknown> }
}
