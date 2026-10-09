/**
 * R-A (#457): the three narrowly authorised production checks, and nothing else.
 *
 *   A1  GET the project's PostgREST configuration: which schemas the public API exposes (schema names and limits only).
 *   A2  catalogue reads through the READ-ONLY endpoint: view owner, whether the owner bypasses row security, security_invoker,
 *       and whether anon / authenticated can select each view in public. No underlying table is read, no row is read.
 *   A3  ONE anonymous HEAD for zero rows of delivery_health with the public anon key. Status and non-sensitive headers only,
 *       no body, no retry, no other view, no elevated credential.
 *
 *   ALLOW_PRODUCTION_CHECKS=1 npx tsx scripts/release/ra-public-views.ts [--no-head]
 *
 * It never prints a key and never sends a second request to the public endpoint. A refusal is a result, not something to retry.
 */
import '../../src/safety/require-production-checks.ts'
import { isPlainSelect } from './plain-select.ts'

const EXPECTED_REF = 'baujwlzcziasnfhhkchg'
const REF = process.env.SUPABASE_PROJECT_REF ?? EXPECTED_REF
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN ?? ''
const API = 'https://api.supabase.com'
const noHead = process.argv.includes('--no-head')
if (REF !== EXPECTED_REF) {
  console.error(`refused: project ref is not the production project`)
  process.exit(2)
}
if (TOKEN === '') {
  console.error('SUPABASE_ACCESS_TOKEN is not set')
  process.exit(2)
}
const auth = { Authorization: `Bearer ${TOKEN}` }
const stamp = () => new Date().toISOString()

// ---- A1 ------------------------------------------------------------------------------------------------------------
console.log(`A1 ${stamp()} GET /v1/projects/<ref>/postgrest`)
const r1 = await fetch(`${API}/v1/projects/${REF}/postgrest`, { headers: auth })
const t1 = await r1.text()
let cfg: Record<string, unknown> = {}
try {
  cfg = JSON.parse(t1) as Record<string, unknown>
} catch {
  /* reported below */
}
console.log(
  `  status ${r1.status}; db_schema=${JSON.stringify(cfg.db_schema)} db_extra_search_path=${JSON.stringify(cfg.db_extra_search_path)} max_rows=${JSON.stringify(cfg.max_rows)}`,
)

// ---- A2 ------------------------------------------------------------------------------------------------------------
const A2 = `select c.relname as view, c.relkind as kind, r.rolname as owner, r.rolsuper as owner_super, r.rolbypassrls as owner_bypassrls,
  coalesce(c.reloptions::text like '%security_invoker=true%', false) as invoker,
  has_table_privilege('anon', c.oid, 'select') as anon_select,
  has_table_privilege('authenticated', c.oid, 'select') as auth_select
  from pg_class c join pg_namespace n on n.oid = c.relnamespace join pg_roles r on r.oid = c.relowner
  where n.nspname = 'public' and c.relkind in ('v','m') order by c.relname`
const A2b = `select rolname, rolbypassrls, rolsuper from pg_roles where rolname in ('postgres','anon','authenticated','authenticator','service_role','supabase_admin') order by rolname`
const A2c = `select (select rolconfig::text from pg_roles where rolname = 'authenticator') as authenticator_config`
for (const [id, sql] of [
  ['A2a views', A2],
  ['A2b roles', A2b],
  ['A2c authenticator config', A2c],
] as const) {
  if (!isPlainSelect(sql)) throw new Error(`${id}: not a plain select`)
  console.log(`${id} ${stamp()} read-only query`)
  const r = await fetch(`${API}/v1/projects/${REF}/database/query/read-only`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  })
  const body = await r.text()
  console.log(`  status ${r.status}`)
  try {
    const rows = JSON.parse(body) as Record<string, unknown>[]
    for (const row of rows) console.log(`  ${JSON.stringify(row)}`)
  } catch {
    console.log(`  (unparsed, ${body.length} bytes)`)
  }
}

// ---- A3 ------------------------------------------------------------------------------------------------------------
if (noHead) {
  console.log('A3 skipped (--no-head)')
} else {
  const keys = await fetch(`${API}/v1/projects/${REF}/api-keys`, { headers: auth })
  const list = keys.ok ? ((await keys.json()) as { name?: string; api_key?: string }[]) : []
  const anon = list.find((k) => k.name === 'anon')?.api_key ?? ''
  if (anon === '') {
    console.log('A3 BLOCKED: the public anon key could not be read; no request was sent')
  } else {
    const url = `https://${REF}.supabase.co/rest/v1/delivery_health?select=channel&limit=0`
    console.log(
      `A3 ${stamp()} HEAD /rest/v1/delivery_health?select=channel&limit=0 (anon key, one request)`,
    )
    const r = await fetch(url, {
      method: 'HEAD',
      headers: { apikey: anon, Authorization: `Bearer ${anon}` },
    })
    const keep = [
      'content-type',
      'content-range',
      'content-length',
      'sb-gateway-version',
      'x-sb-error-code',
    ]
    const h: Record<string, string> = {}
    for (const k of keep) {
      const v = r.headers.get(k)
      if (v !== null) h[k] = v
    }
    console.log(`  status ${r.status} ${r.statusText}; headers ${JSON.stringify(h)}`)
  }
}
