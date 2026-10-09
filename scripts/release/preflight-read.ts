/**
 * The authorised production PREFLIGHT reads (docs/audit/V1-RELEASE-PREFLIGHT-QUERIES-2026-10-09.sql, P01 to P19), run through the
 * Management API's READ-ONLY query endpoint, which executes as `supabase_read_only_user`: the database refuses any write whatever the
 * statement says. It reads and prints; it never retries (a retry on a sick host is more load, and a refusal is itself a finding).
 *
 *   ALLOW_PRODUCTION_CHECKS=1 npx tsx scripts/release/preflight-read.ts [--only=P01,P02] [--no-health]
 *
 * Needs Grant's explicit authorisation for the READ (CLAUDE.md, "Production access is forbidden by default"). It selects no secret value,
 * no secret reference and no message text; every statement is checked to be a single `select` before it is sent.
 */
import '../../src/safety/require-production-checks.ts'
import { readFileSync } from 'node:fs'
import { isPlainSelect, parsePreflight } from './plain-select.ts'

const REF = process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg'
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN ?? ''
const API = 'https://api.supabase.com'
if (TOKEN === '') {
  console.error('SUPABASE_ACCESS_TOKEN is not set')
  process.exit(2)
}

const args = process.argv.slice(2)
const only = (args.find((a) => a.startsWith('--only=')) ?? '').slice(7).split(',').filter(Boolean)
const noHealth = args.includes('--no-health')

const load = (): { id: string; sql: string }[] =>
  parsePreflight(readFileSync('docs/audit/V1-RELEASE-PREFLIGHT-QUERIES-2026-10-09.sql', 'utf8'))

const post = async (
  sql: string,
  ms: number,
): Promise<{ status: number; ms: number; text: string }> => {
  const t = Date.now()
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), ms)
  try {
    const r = await fetch(`${API}/v1/projects/${REF}/database/query/read-only`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: sql }),
      signal: ctl.signal,
    })
    return { status: r.status, ms: Date.now() - t, text: await r.text() }
  } catch (e) {
    return { status: 0, ms: Date.now() - t, text: String(e instanceof Error ? e.name : e) }
  } finally {
    clearTimeout(timer)
  }
}

const health = async (): Promise<string> => {
  const url = `${API}/v1/projects/${REF}/health?services=auth&services=db&services=rest&services=storage`
  try {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } })
    const j = (await r.json()) as { name: string; status: string }[]
    return j.map((x) => `${x.name}=${x.status}`).join(' ')
  } catch (e) {
    return `unreadable (${String(e instanceof Error ? e.name : e)})`
  }
}

if (!noHealth) {
  const h = await health()
  console.log(`health: ${h} at ${new Date().toISOString()}`)
  if (!/db=ACTIVE_HEALTHY/.test(h)) {
    console.log('REFUSED: the platform does not report the database healthy. No query was sent.')
    process.exit(3)
  }
}
const queries = load().filter((q) => only.length === 0 || only.includes(q.id))
console.log(`${String(queries.length)} statement(s); project ref ${REF}`)
for (const q of queries) {
  if (!isPlainSelect(q.sql)) {
    console.log(`\n${q.id} BLOCKED: not a single plain select (not sent)`)
    continue
  }
  const r = await post(q.sql, 20000)
  const body = r.text.length > 3500 ? `${r.text.slice(0, 3500)} ...[clipped]` : r.text
  console.log(
    `\n${q.id} http ${String(r.status)} ${String(r.ms)} ms at ${new Date().toISOString()}\n${body}`,
  )
}
