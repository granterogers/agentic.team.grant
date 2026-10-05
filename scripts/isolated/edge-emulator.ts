/**
 * A stand-in Deno runtime and PostgREST for running a REAL edge function in
 * Node against the isolated replica (see voice-door.ts, where this began).
 *
 * The function's own file runs unmodified. It touches the runtime in
 * `Deno.env.get`, `Deno.serve` and `fetch`; this supplies the first two and
 * answers the third for the replica only. Every other URL is REFUSED and
 * recorded, so a test can assert nothing tried to leave the machine.
 *
 * ASSUMPTIONS, stated because a test is only as honest as its stand-ins:
 *   - `POST /rest/v1/rpc/<fn>` calls `public.<fn>` with named arguments and
 *     returns its JSON (a set-returning function returns an array);
 *   - `GET /rest/v1/<table>?select=..&col=eq.v&limit=n` is a filtered read (eq only);
 *   - `POST /rest/v1/<table>` inserts one row and returns it (201, array);
 *     `Prefer: resolution=ignore-duplicates` on a duplicate returns 201 [];
 *   - every request runs in a session whose application_name is PostgREST,
 *     which the ingress trigger reads (0541);
 *   - 23503 and 23505 are 409, any other error 400;
 *   - `GET /auth/v1/user` answers from `authUsers`, keyed by bearer token;
 *   - `POST /auth/v1/admin/generate_link` answers a link and records the address.
 */
import { copyFile, mkdir, readFile } from 'node:fs/promises'
import type { PgExecutor } from '../../src/db/pg-executor.ts'

export const DB_URL = 'http://replica.invalid'
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
// The edge functions call PostgREST with the SERVICE key, so the request's claims carry that role
// (app.withdraw_refusal refuses a call that did not arrive this way).
const AS_POSTGREST =
  "set local application_name = 'PostgREST 14.5'; select set_config('request.jwt.claims', '{\"role\":\"service_role\"}', true);"

export interface EdgeOptions {
  db: PgExecutor
  /** The edge function's index.ts, relative to the repository root. */
  edgeFile: string
  /** Files laid beside it as the deploy does: [source relative to repo root, published name]. */
  beside?: [string, string][]
  env: Record<string, string>
  /** Verified sessions the stand-in identity service knows: bearer token -> email. */
  authUsers?: Record<string, string>
}

export interface Edge {
  call(request: Request): Promise<Response>
  readonly refusedUrls: string[]
  /** Emails an admin sign-in link was generated for (the identity service's `generate_link`). */
  readonly linksMinted: string[]
  /** Every object a function tried to write to storage (never forwarded anywhere). */
  readonly storageWrites: { method: string; path: string; bytes: number }[]
  outage(on: boolean, onlyFunction?: string): void
}

export async function startEdge(o: EdgeOptions): Promise<Edge> {
  let handler: ((r: Request) => Promise<Response>) | null = null
  let down: boolean | string = false
  const refusedUrls: string[] = []
  const linksMinted: string[] = []
  const storageWrites: { method: string; path: string; bytes: number }[] = []
  const env: Record<string, string> = { SUPABASE_URL: DB_URL, ...o.env }
  ;(globalThis as unknown as { Deno: unknown }).Deno = {
    env: { get: (k: string) => env[k] },
    serve: (h: (r: Request) => Promise<Response>) => {
      handler = h
    },
  }
  const setReturning = new Set<string>(
    (
      await o.db.execute(
        `select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proretset`,
      )
    ).rows.map((r) => String((r as { proname: string }).proname)),
  )
  const realFetch = globalThis.fetch
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input)
    if (!url.startsWith(DB_URL)) {
      refusedUrls.push(url)
      throw new Error(`REFUSED: an isolated edge function may only reach the replica, not ${url}`)
    }
    const reply = (status: number, value: unknown) =>
      new Response(JSON.stringify(value), {
        status,
        headers: { 'content-type': 'application/json' },
      })
    const path = new URL(url).pathname
    if (path === '/auth/v1/user') {
      const headers = init?.headers as Record<string, string> | undefined
      const token = String(headers?.Authorization ?? '').replace(/^Bearer\s+/i, '')
      const email = o.authUsers?.[token]
      if (email === undefined) return reply(401, {})
      // The identity service also answers the auth user's id (P3: the office is resolved from the id, not the address).
      const found = await o.db
        .execute(
          `select id::text as id from auth.users where lower(email) = ${lit(email.toLowerCase())} limit 1`,
        )
        .catch(() => ({ rows: [] as Record<string, unknown>[] }))
      return reply(200, {
        id: (found.rows[0] as { id?: string } | undefined)?.id,
        email,
        email_confirmed_at: 'x',
      })
    }
    if (path === '/auth/v1/admin/generate_link') {
      const asked = JSON.parse(String(init?.body ?? '{}')) as { email?: string }
      linksMinted.push(String(asked.email ?? ''))
      return reply(200, { action_link: `${DB_URL}/auth/v1/verify?token=isolated&type=magiclink` })
    }
    if (down === true || (typeof down === 'string' && path.endsWith(`/rpc/${down}`))) {
      return reply(503, { message: 'the database is unavailable' })
    }
    if (
      (init?.method ?? 'GET') === 'GET' &&
      path.startsWith('/rest/v1/') &&
      !path.includes('/rpc/')
    ) {
      // A filtered read: `?select=a,b&col=eq.value&limit=n`, the only shape an edge function here uses.
      const q = new URL(url).searchParams
      const table = path.slice('/rest/v1/'.length)
      const cols = (q.get('select') ?? '*')
        .split(',')
        .filter((c) => /^[a-z_*]+$/.test(c))
        .join(', ')
      const where = [...q.entries()]
        .filter(([k, v]) => /^[a-z_]+$/.test(k) && v.startsWith('eq.'))
        .map(([k, v]) => `${k}::text = ${lit(v.slice(3))}`)
        .join(' and ')
      const limit = Number(q.get('limit') ?? '100')
      try {
        const { rows } = await o.db.execute(`${AS_POSTGREST}
          select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) as r
            from (select ${cols || '*'} from public.${table} ${where === '' ? '' : `where ${where}`} limit ${String(limit)}) t`)
        return reply(200, (rows[0] as { r: unknown }).r)
      } catch (e) {
        return reply(400, { message: String((e as Error).message) })
      }
    }
    if (path.startsWith('/storage/v1/')) {
      // Storage is not replicated: it is RECORDED, so a proof can count the objects a function tried to write.
      const method = init?.method ?? 'GET'
      const raw = init?.body
      const size = raw instanceof Uint8Array ? raw.byteLength : String(raw ?? '').length
      if (method === 'POST' && path.includes('/object/sign/')) {
        return reply(200, { signedURL: `${path.replace('/storage/v1', '')}?token=isolated` })
      }
      storageWrites.push({ method, path, bytes: size })
      return reply(200, { Key: path.replace('/storage/v1/object/', '') })
    }
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
    const prefer = String((init?.headers as Record<string, string> | undefined)?.Prefer ?? '')
    try {
      if (path.startsWith('/rest/v1/rpc/')) {
        const fn = path.slice('/rest/v1/rpc/'.length)
        // PostgREST converts a JSON array to the parameter's own type; the stand-in does the same for text[] parameters.
        const signature = (
          await o.db.execute(
            `select string_agg(pg_get_function_arguments(p.oid), ' | ') as a from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = ${lit(fn)}`,
          )
        ).rows[0] as { a?: string | null } | undefined
        const textArray = (k: string): boolean =>
          new RegExp(`\\b${k} text\\[\\]`).test(signature?.a ?? '')
        const args = Object.entries(body)
          .map(([k, v]) => {
            if (v === null) return `${k} => null`
            if (typeof v === 'boolean' || typeof v === 'number') return `${k} => ${String(v)}`
            if (Array.isArray(v) && textArray(k))
              return `${k} => array[${v.map((x) => lit(String(x))).join(', ')}]::text[]`
            return typeof v === 'object'
              ? `${k} => ${lit(JSON.stringify(v))}::jsonb`
              : `${k} => ${lit(String(v))}`
          })
          .join(', ')
        const sql = setReturning.has(fn)
          ? `${AS_POSTGREST} select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) as r from public.${fn}(${args}) t`
          : `${AS_POSTGREST} select to_jsonb(public.${fn}(${args})) as r`
        const { rows } = await o.db.execute(sql)
        return reply(200, (rows[0] as { r: unknown }).r)
      }
      const table = path.slice('/rest/v1/'.length)
      const cols = Object.keys(body)
        .filter((k) => /^[a-z_]+$/.test(k))
        .join(', ')
      const conflict = prefer.includes('ignore-duplicates') ? 'on conflict do nothing' : ''
      const { rows } = await o.db.execute(`${AS_POSTGREST}
        insert into public.${table} (${cols})
        select ${cols} from jsonb_populate_record(null::public.${table}, ${lit(JSON.stringify(body))}::jsonb)
        ${conflict}
        returning to_jsonb(${table}.*) as r`)
      return reply(
        201,
        rows.map((r) => (r as { r: unknown }).r),
      )
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

  /*
    Laid out the way the runtime sees it: unmodified copies in a scratch
    folder. A computed specifier, because the edge file is Deno code and tsc
    must not follow it.
  */
  const name = o.edgeFile.split('/').slice(-2, -1)[0] ?? 'edge'
  const dir = new URL(`../../.out/edge-${name}/`, import.meta.url)
  /*
    A function that imports shared code by its repository path (`../../../src/...`, as voice, voice-token and
    anything bundled the way the worker is) must run WHERE it lives, or the import points outside the checkout.
    One that imports nothing keeps the unmodified-copy arrangement it always had.
  */
  const sourceText = await readFile(new URL(`../../${o.edgeFile}`, import.meta.url), 'utf8')
  if (/from '\.\.\/\.\.\/\.\.\/src\//.test(sourceText)) {
    await import(new URL(`../../${o.edgeFile}?run=${Date.now()}`, import.meta.url).href)
  } else {
    await mkdir(dir, { recursive: true })
    await copyFile(new URL(`../../${o.edgeFile}`, import.meta.url), new URL('index.ts', dir))
    const laid = new Set<string>()
    for (const [src, as] of o.beside ?? []) {
      await copyFile(new URL(`../../${src}`, import.meta.url), new URL(as, dir))
      laid.add(as)
    }
    /*
      The deploy uploads every file the entry imports from its own folder (hq-api's `./file-text.ts` and `./oauth.ts` are
      symlinks to the one source in src/), so the emulator lays the same ones down: a proof that boots the real handler must
      not fail because a later import was added and nobody listed it. A file the proof named itself wins.
    */
    const folder = o.edgeFile.slice(0, o.edgeFile.lastIndexOf('/'))
    for (const m of sourceText.matchAll(/from '\.\/([A-Za-z0-9_-]+\.ts)'/g)) {
      const name = m[1]
      if (name === undefined || laid.has(name) || name === 'index.ts') continue
      await copyFile(new URL(`../../${folder}/${name}`, import.meta.url), new URL(name, dir)).catch(
        () => undefined,
      )
      laid.add(name)
    }
    await import(new URL(`index.ts?run=${Date.now()}`, dir).href)
  }
  if (handler === null) {
    globalThis.fetch = realFetch
    throw new Error(`${o.edgeFile} did not call Deno.serve`)
  }
  const h: (r: Request) => Promise<Response> = handler
  return {
    call: h,
    refusedUrls,
    linksMinted,
    storageWrites,
    outage: (on, onlyFunction) => {
      down = on ? (onlyFunction ?? true) : false
    },
  }
}
