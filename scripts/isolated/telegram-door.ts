/**
 * The REAL Telegram webhook, run in Node against the isolated replica.
 *
 * `supabase/functions/telegram-webhook/index.ts` touches the runtime in
 * `Deno.env.get`, `Deno.serve` and `fetch`. This supplies a stand-in `Deno`,
 * captures the handler, and answers the door's `fetch` calls to the database
 * with a minimal PostgREST emulator over the marked local replica - the same
 * technique as `voice-door.ts`, for the same reason: the code that runs is the
 * code that is deployed, unmodified.
 *
 * THE EMULATOR'S ASSUMPTIONS, stated because a test is only as honest as its
 * stand-ins. It reproduces the PostgREST behaviours the door depends on:
 *   - `POST /rest/v1/rpc/<fn>` calls `public.<fn>` with named arguments and
 *     returns its JSON; a set-returning function returns a JSON array;
 *   - `POST /rest/v1/<table>` inserts one row and returns it (201, array);
 *     `Prefer: resolution=ignore-duplicates` on a duplicate returns 201 [];
 *   - every request runs in a session whose application_name is PostgREST,
 *     which is what the ingress trigger reads (0541);
 *   - a constraint violation returns 409, anything else 400.
 * Any URL that is not the replica (Telegram, the worker, GitHub) is REFUSED,
 * and the refusal is recorded so a test can assert nothing tried to leave.
 */
import { copyFile, mkdir } from 'node:fs/promises'
import type { PgExecutor } from '../../src/db/pg-executor.ts'

const DB_URL = 'http://replica.invalid'
export const WEBHOOK_SECRET = 'isolated-webhook-secret'

type Handler = (request: Request) => Promise<Response>
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
const AS_POSTGREST = "set local application_name = 'PostgREST 14.5';"

export interface Door {
  post(
    update: Record<string, unknown>,
    bot?: string,
  ): Promise<{ status: number; body: Record<string, unknown> }>
  /** Every URL the door tried to reach that was not the replica. */
  readonly refusedUrls: string[]
  /** Make database calls fail, as an outage would - all of them, or only the named function. */
  outage(on: boolean, onlyFunction?: string): void
}

export async function startTelegramDoor(db: PgExecutor, botId: string): Promise<Door> {
  let handler: Handler | null = null
  let down: boolean | string = false
  const refusedUrls: string[] = []
  const env: Record<string, string> = {
    TELEGRAM_WEBHOOK_SECRET: WEBHOOK_SECRET,
    TELEGRAM_BOT_ID: botId,
    SUPABASE_URL: DB_URL,
    SUPABASE_SERVICE_ROLE_KEY: 'isolated-service-key',
  }
  ;(globalThis as unknown as { Deno: unknown }).Deno = {
    env: { get: (k: string) => env[k] },
    serve: (h: Handler) => {
      handler = h
    },
  }
  const setReturning = new Set<string>(
    (
      await db.execute(
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
      throw new Error(`REFUSED: the isolated door may only reach the replica, not ${url}`)
    }
    const reply = (status: number, value: unknown) =>
      new Response(JSON.stringify(value), {
        status,
        headers: { 'content-type': 'application/json' },
      })
    const path = new URL(url).pathname
    if (down === true || (typeof down === 'string' && path.endsWith(`/rpc/${down}`))) {
      return reply(503, { message: 'the database is unavailable' })
    }
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
    const prefer = String((init?.headers as Record<string, string> | undefined)?.Prefer ?? '')
    try {
      if (path.startsWith('/rest/v1/rpc/')) {
        const fn = path.slice('/rest/v1/rpc/'.length)
        const args = Object.entries(body)
          .map(
            ([k, v]) =>
              `${k} => ${v === null ? 'null' : typeof v === 'boolean' || typeof v === 'number' ? String(v) : lit(String(v))}`,
          )
          .join(', ')
        const sql = setReturning.has(fn)
          ? `${AS_POSTGREST} select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) as r from public.${fn}(${args}) t`
          : `${AS_POSTGREST} select to_jsonb(public.${fn}(${args})) as r`
        const { rows } = await db.execute(sql)
        return reply(200, (rows[0] as { r: unknown }).r)
      }
      const table = path.slice('/rest/v1/'.length)
      const cols = Object.keys(body)
        .filter((k) => /^[a-z_]+$/.test(k))
        .join(', ')
      const conflict = prefer.includes('ignore-duplicates') ? 'on conflict do nothing' : ''
      const { rows } = await db.execute(`${AS_POSTGREST}
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
    The deploy uploads src/channels/telegram.ts AS `./telegram.ts` beside
    index.ts (scripts/deploy/edge-function.ts), so the two files are laid out
    the way the runtime sees them: unmodified copies in a scratch folder.
    A variable specifier, and a computed one: the edge file is Deno code and
    tsc must not follow it.
  */
  const dir = new URL('../../.out/telegram-door/', import.meta.url)
  await mkdir(dir, { recursive: true })
  await copyFile(
    new URL('../../supabase/functions/telegram-webhook/index.ts', import.meta.url),
    new URL('index.ts', dir),
  )
  await copyFile(
    new URL('../../src/channels/telegram.ts', import.meta.url),
    new URL('telegram.ts', dir),
  )
  const EDGE = new URL(`index.ts?run=${Date.now()}`, dir).href
  await import(EDGE)
  if (handler === null) {
    globalThis.fetch = realFetch
    throw new Error('the telegram door did not call Deno.serve')
  }
  const h: Handler = handler
  return {
    refusedUrls,
    outage: (on, onlyFunction) => {
      down = on ? (onlyFunction ?? true) : false
    },
    post: async (update, bot) => {
      const r = await h(
        new Request(
          `https://door.invalid/functions/v1/telegram-webhook${bot ? `?bot=${bot}` : ''}`,
          {
            method: 'POST',
            headers: {
              'X-Telegram-Bot-Api-Secret-Token': WEBHOOK_SECRET,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(update),
          },
        ),
      )
      const text = await r.text()
      let parsed: Record<string, unknown> = {}
      try {
        parsed = JSON.parse(text) as Record<string, unknown>
      } catch {
        parsed = { raw: text }
      }
      return { status: r.status, body: parsed }
    },
  }
}
