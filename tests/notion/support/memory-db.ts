/*
  A small in-memory stand-in for the three tables the Notion sync touches, speaking just the statements the sync issues.

  It exists so a test can ask "what is in the database AFTER the run" instead of "which SQL text went by": resumption,
  idempotence and isolation are properties of the rows. It models the one constraint that matters here, the unique key
  (office, connector, parent, ref), and nothing else; it is not a SQL engine, and a statement it does not recognise
  throws rather than answering empty, so a change to the sync's SQL fails the tests loudly instead of passing silently.
*/
import type { SqlExecutor } from '../../../src/db/executor.ts'

export interface MemDoc {
  office: string
  project: string
  parent: string
  ref: string
  title: string | null
  content: string | null
  fingerprint: string
  remoteMs: number | null
}

const unq = (s: string): string => s.replace(/''/g, "'")
const q = String.raw`'((?:[^']|'')*)'`

export interface MemoryDb {
  readonly db: SqlExecutor
  readonly docs: MemDoc[]
  /** Statements seen, in order. */
  readonly seen: string[]
  /** Make the next statements matching `when` throw `error()`; `times` limits how often (default: always). */
  fail(when: RegExp, error: () => Error, times?: number): void
}

export interface MemoryOptions {
  /** project id -> office id */
  readonly offices: Readonly<Record<string, string>>
  readonly docs?: readonly MemDoc[]
  /** Statements the handler issues around the sync (settings, attached projects). */
  readonly handler?: { readonly projects: readonly { id: string; name: string }[] }
}

export const memoryDb = (opts: MemoryOptions): MemoryDb => {
  const docs: MemDoc[] = [...(opts.docs ?? [])]
  const seen: string[] = []
  const failures: { when: RegExp; error: () => Error; left: number }[] = []
  const officeOf = (sql: string): string => {
    const m = new RegExp(String.raw`project_id = ${q}::uuid`).exec(sql)
    const office = m === null ? undefined : opts.offices[unq(m[1] ?? '')]
    if (office === undefined)
      throw new Error(`memory db: no project literal in: ${sql.slice(0, 120)}`)
    return office
  }
  const keyOf = (sql: string) => {
    const parent = new RegExp(String.raw`external_parent_ref = ${q}`).exec(sql)
    const ref = new RegExp(String.raw`external_ref = ${q}`).exec(sql)
    return { parent: unq(parent?.[1] ?? ''), ref: unq(ref?.[1] ?? '') }
  }
  const ms = (literal: string | undefined): number | null =>
    literal === undefined || literal === 'null'
      ? null
      : Date.parse(unq(literal.replace(/^'|'$/g, '')))

  const db = {
    kind: 'memory',
    execute: async (sql: string) => {
      seen.push(sql)
      for (const f of failures) {
        if (f.left > 0 && f.when.test(sql)) {
          f.left -= 1
          throw f.error()
        }
      }
      if (/knowledge_connectors/.test(sql))
        return { rows: [{ enabled: true, disabled_reason: null, token: 'ntn_test_token' }] }
      if (/project_attachments/.test(sql)) return { rows: [...(opts.handler?.projects ?? [])] }
      if (/app\.container_refs/.test(sql)) return { rows: [] }
      if (/inference_usage/.test(sql)) return { rows: [{ n: 0 }] }
      if (/extract\(epoch from remote_updated_at\)/.test(sql)) {
        const office = officeOf(sql)
        return {
          rows: docs
            .filter(
              (d) =>
                d.office === office &&
                d.parent === 'page' &&
                d.remoteMs !== null &&
                d.content !== null,
            )
            .map((d) => ({ external_ref: d.ref, ms: d.remoteMs })),
        }
      }
      if (/select external_ref from public\.documents/.test(sql)) {
        const office = officeOf(sql)
        return {
          rows: docs.filter((d) => d.office === office).map((d) => ({ external_ref: d.ref })),
        }
      }
      if (/select content_fingerprint, title from public\.documents/.test(sql)) {
        const office = officeOf(sql)
        const { parent, ref } = keyOf(sql)
        return {
          rows: docs
            .filter((d) => d.office === office && d.parent === parent && d.ref === ref)
            .map((d) => ({ content_fingerprint: d.fingerprint, title: d.title })),
        }
      }
      if (/insert into public\.documents/.test(sql) && /mirrors_document_id/.test(sql)) {
        const m = new RegExp(
          String.raw`values \(${q}::uuid, 'notion', '(page|database)', ${q},\s*(null|${q}), '(?:page|database)',\s*${q}, '([0-9a-f]{64})', \d+,\s*app\.now_utc\(\), (null|'[^']*')::timestamptz`,
          's',
        ).exec(sql)
        if (m === null) throw new Error(`memory db: cannot read this insert: ${sql.slice(0, 200)}`)
        const project = unq(m[1] ?? '')
        const office = opts.offices[project]
        if (office === undefined) throw new Error(`memory db: unknown project ${project}`)
        const row: MemDoc = {
          office,
          project,
          parent: m[2] ?? '',
          ref: unq(m[3] ?? ''),
          title: m[4] === 'null' ? null : unq(m[5] ?? ''),
          content: unq(m[6] ?? ''),
          fingerprint: m[7] ?? '',
          remoteMs: ms(m[8]),
        }
        const at = docs.findIndex(
          (d) => d.office === office && d.parent === row.parent && d.ref === row.ref,
        )
        if (at === -1) docs.push(row)
        else docs[at] = { ...row, project: row.project }
        return { rows: [{ document_id: `d${String(docs.length)}` }] }
      }
      if (/update public\.documents\s+set/.test(sql)) {
        const office = officeOf(sql)
        const { parent, ref } = keyOf(sql)
        const d = docs.find((x) => x.office === office && x.parent === parent && x.ref === ref)
        if (d === undefined) return { rows: [] }
        const title = new RegExp(String.raw`title = ${q},`).exec(sql)
        if (title !== null) d.title = unq(title[1] ?? '')
        const t = /coalesce\((null|'[^']*')::timestamptz, remote_updated_at\)/.exec(sql)
        const next = ms(t?.[1])
        if (next !== null) d.remoteMs = next
        return { rows: [] }
      }
      throw new Error(`memory db: unrecognised statement: ${sql.slice(0, 160)}`)
    },
  } as unknown as SqlExecutor
  return {
    db,
    docs,
    seen,
    fail: (when, error, times = Number.POSITIVE_INFINITY) => {
      failures.push({ when, error, left: times })
    },
  }
}

/* ---- a Notion that answers per path, with the real response shapes ---- */

/**
 * A response with no stream behind it. A real `Response` reads its body over event-loop turns the fake clock does not
 * control, and a test that advances a fake clock around those turns is a race (it timed requests out "after 20 s" while
 * the body was still being read). The client needs only `ok`, `status`, `headers.get` and `json()`.
 */
export const json = (
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response => {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]))
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => lower[name.toLowerCase()] ?? null },
    json: async () => JSON.parse(JSON.stringify(body)) as unknown,
  } as unknown as Response
}

export const pageObject = (id: string, title: string, edited = '2026-10-01T00:00:00.000Z') => ({
  object: 'page',
  id,
  last_edited_time: edited,
  url: `https://notion.so/${id}`,
  properties: { Name: { type: 'title', title: [{ plain_text: title }] } },
})

export const paragraph = (text: string, extra: Record<string, unknown> = {}) => ({
  object: 'block',
  id: `b-${text}`,
  type: 'paragraph',
  has_children: false,
  paragraph: { rich_text: [{ plain_text: text }] },
  ...extra,
})

export type Route = (url: URL, init: RequestInit) => Response | Promise<Response>

export interface FakeNotion {
  readonly fetchImpl: typeof fetch
  readonly requests: { path: string; url: URL; init: RequestInit }[]
  readonly blockReads: () => string[]
}

export const fakeNotion = (routes: Record<string, Route>): FakeNotion => {
  const requests: { path: string; url: URL; init: RequestInit }[] = []
  const fetchImpl = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input))
    const path = url.pathname.replace(/^\/v1/, '')
    requests.push({ path, url, init })
    const hit = Object.entries(routes).find(([p]) => path === p)
    if (hit === undefined) return json(404, { code: 'object_not_found' })
    return hit[1](url, init)
  }) as typeof fetch
  return {
    fetchImpl,
    requests,
    blockReads: () => requests.map((r) => r.path).filter((p) => p.startsWith('/blocks/')),
  }
}
