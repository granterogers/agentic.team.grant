/**
 * Discover and probe OpenRouter models, recording what is MEASURED usable.
 *
 *   npm run providers:discover
 *   npm run providers:discover -- --candidates-only   (refresh pricing, no probes)
 *
 * ADR-0009: pricing is a pre-filter, not the criterion. Of 21 zero-priced
 * models only 5 were callable under our privacy policy; the other 16 failed for
 * reasons no pricing field expresses. So a model becomes `usable` only after a
 * probe executed it at zero cost, and the database constraint
 * `provider_models_usable_was_probed` makes a configured allow-list impossible.
 *
 * Every probe carries the full production guard set, so this cannot spend money
 * even if the registry is wrong.
 */

import type { SqlExecutor } from '../../src/db/executor.ts'
import { ManagementApiExecutor } from '../../src/db/executor.ts'
import { FORCED_PROVIDER_OPTIONS, isZeroPriced, NEVER_CALL } from '../../src/providers/guards.ts'

const token = process.env.SUPABASE_ACCESS_TOKEN
const orKey = process.env.OPENROUTER_API_KEY
if (token === undefined || token === '' || orKey === undefined || orKey === '') {
  console.error('SUPABASE_ACCESS_TOKEN and OPENROUTER_API_KEY are required')
  process.exit(2)
}
const db: SqlExecutor = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  token,
)

const lit = (v: string | null): string => (v === null ? 'null' : `'${v.replace(/'/g, "''")}'`)

interface ModelRow {
  id: string
  pricing?: { prompt?: string; completion?: string }
}

const listing = await fetch('https://openrouter.ai/api/v1/models', {
  headers: { Authorization: `Bearer ${orKey}` },
})
if (!listing.ok) {
  console.error(`model listing failed: ${listing.status}`)
  process.exit(1)
}
const all = ((await listing.json()) as { data: ModelRow[] }).data
const candidates = all.filter((m) =>
  isZeroPriced(m.pricing?.prompt ?? null, m.pricing?.completion ?? null),
)
console.log(`${all.length} models offered, ${candidates.length} zero-priced candidates`)

// Record every candidate first. A model that later fails a probe stays visible
// with a reason, rather than being silently absent — which looks identical to
// "never discovered".
for (const m of candidates) {
  const status = NEVER_CALL.has(m.id) ? 'paid' : 'unprobed'
  await db.execute(`
    insert into public.provider_models
      (provider, model_id, status, pricing_prompt, pricing_completion)
    values ('openrouter', ${lit(m.id)}, '${status}',
            ${lit(m.pricing?.prompt ?? null)}, ${lit(m.pricing?.completion ?? null)})
    on conflict (provider, model_id) do update
      set pricing_prompt = excluded.pricing_prompt,
          pricing_completion = excluded.pricing_completion
  `)
}

// No longer offered means withdrawn, never deleted: the ledger and past jobs
// reference model ids forever.
await db.execute(`
  update public.provider_models
  set status = 'withdrawn', last_error = 'no longer present in provider discovery'
  where provider = 'openrouter' and status <> 'withdrawn'
    and model_id not in (${candidates.map((m) => lit(m.id)).join(',') || "''"})
`)

if (process.argv.includes('--candidates-only')) {
  console.log('candidates recorded; probing skipped')
  process.exit(0)
}

/** Map a failure to one of ADR-0009's classes, so the reason survives. */
function classify(code: number, message: string): string {
  const m = message.toLowerCase()
  if (m.includes('data policy')) return 'data_policy'
  if (m.includes('agentic harness')) return 'harness_gated'
  if (m.includes('max price')) return 'paid'
  if (code === 429) return 'rate_limited'
  return 'provider_error'
}

async function probe(id: string): Promise<{ id: string; status: string; detail: string }> {
  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${orKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: id,
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 1,
        provider: FORCED_PROVIDER_OPTIONS,
      }),
    })
    const payload = (await response.json()) as {
      error?: { code?: number; message?: string }
      usage?: { cost?: number | null }
    }
    if (payload.error !== undefined) {
      const code = payload.error.code ?? response.status
      const message = payload.error.message ?? ''
      return { id, status: classify(code, message), detail: `${code} ${message.slice(0, 110)}` }
    }
    const cost = payload.usage?.cost
    if (cost === undefined || cost === null) {
      return { id, status: 'provider_error', detail: 'no usage.cost reported; unverifiable' }
    }
    // Layer 4 at discovery time: a model that charges is paid, whatever the
    // listing claimed.
    if (cost > 0) return { id, status: 'paid', detail: `probe reported cost ${String(cost)}` }
    return { id, status: 'usable', detail: 'executed at cost 0' }
  } catch (error) {
    return { id, status: 'provider_error', detail: (error as Error).message.slice(0, 110) }
  }
}

const toProbe = candidates.map((m) => m.id).filter((id) => !NEVER_CALL.has(id))
const results: { id: string; status: string; detail: string }[] = []
for (let i = 0; i < toProbe.length; i += 5) {
  results.push(...(await Promise.all(toProbe.slice(i, i + 5).map(probe))))
}

for (const r of results) {
  if (r.status === 'usable') {
    await db.execute(`
      update public.provider_models
      set status = 'usable', last_probed_at = now(), last_success_at = now(),
          consecutive_failures = 0, last_error = null
      where provider = 'openrouter' and model_id = ${lit(r.id)}
    `)
  } else {
    // One failure does not evict. openrouter/free returned 429 then succeeded,
    // so a single probe is authoritative in neither direction (ADR-0009).
    await db.execute(`
      update public.provider_models
      set last_probed_at = now(),
          consecutive_failures = consecutive_failures + 1,
          last_error = ${lit(r.detail)},
          status = case
            when status = 'usable' and consecutive_failures + 1 < 3 then 'usable'
            else '${r.status}'::public.model_status
          end
      where provider = 'openrouter' and model_id = ${lit(r.id)}
    `)
  }
}

const summary = await db.execute(`
  select status::text as status, count(*)::int as n
  from public.provider_models where provider = 'openrouter'
  group by status order by n desc
`)
console.log('\nregistry by status:')
for (const row of summary.rows) console.log(`  ${String(row.status).padEnd(16)} ${String(row.n)}`)

const usable = await db.execute('select model_id from public.usable_models order by model_id')
console.log(`\nusable_models view (${usable.rows.length}):`)
for (const row of usable.rows) console.log(`  ${String(row.model_id)}`)
