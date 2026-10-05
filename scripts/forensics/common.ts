/**
 * Shared plumbing for the forensic collectors (Supabase degradation forensics, 5 October 2026). READ ONLY.
 *
 * One place for: the Management API call (status, duration and error are ALWAYS returned, never thrown away, because a failed
 * call is evidence and not an absence of activity), the append-only evidence file, and redaction of anything a log line or an
 * error body might carry. The access token is read from SUPABASE_ACCESS_TOKEN and is never printed or written.
 */
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { redactSecrets } from '../../src/text/secrets.ts'

export const REF = process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg'
export const API = 'https://api.supabase.com'
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN ?? ''

export interface Reply {
  readonly status: number
  readonly ms: number
  readonly text: string
  /** Set when the call never produced an HTTP status (our abort, a reset, a DNS failure). */
  readonly error: string | null
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export const requireToken = (): void => {
  if (TOKEN === '') {
    console.error(
      'SUPABASE_ACCESS_TOKEN is not set (read it from the vault or your shell; it is never printed).',
    )
    process.exit(2)
  }
}

/** One Management API request. Never throws: a transport failure comes back as status 0 with the error name. */
export const mgmt = async (
  path: string,
  ms: number,
  init: { method?: string; body?: unknown } = {},
): Promise<Reply> => {
  const t = Date.now()
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), ms)
  try {
    const r = await fetch(`${API}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      signal: ctl.signal,
    })
    return { status: r.status, ms: Date.now() - t, text: await r.text(), error: null }
  } catch (e) {
    const name = e instanceof Error ? e.name : String(e)
    return { status: 0, ms: Date.now() - t, text: '', error: name }
  } finally {
    clearTimeout(timer)
  }
}

export const day = (): string => new Date().toISOString().slice(0, 10)

export const evidenceDir = '.out/forensics'

/** Append one record to today's evidence file, the same file `host-capture.ts` writes. */
export const record = (kind: string, body: unknown): void => {
  mkdirSync(evidenceDir, { recursive: true })
  appendFileSync(
    `${evidenceDir}/capture-${day()}.jsonl`,
    `${JSON.stringify({ at: new Date().toISOString(), kind, body })}\n`,
  )
}

/** Write a raw artefact (a whole query result, a scrape) under `.out/forensics/<sub>/`. Returns the path. */
export const saveRaw = (sub: string, name: string, content: string | Buffer): string => {
  const dir = `${evidenceDir}/${sub}`
  mkdirSync(dir, { recursive: true })
  const path = `${dir}/${name}`
  writeFileSync(path, content)
  return path
}

/** A string that may have come from a log line or an error body: redacted, then clipped. */
export const clean = (s: string, max = 300): string => redactSecrets(s).slice(0, max)

/** Redact and clip every string value in a row, so a statement carried inside a log line is not stored in full. */
export const cleanRow = (row: unknown, max = 300): unknown => {
  if (typeof row === 'string') return clean(row, max)
  if (Array.isArray(row)) return row.map((x) => cleanRow(x, max))
  if (row !== null && typeof row === 'object') {
    const o: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(row)) o[k] = cleanRow(v, max)
    return o
  }
  return row
}
