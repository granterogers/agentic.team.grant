/**
 * Prove the router against the live database and the live provider.
 *
 *   npm run verify:router
 *
 * The unit tests drive a fake executor and a fake fetch, which is right for
 * branch coverage but proves nothing about the real registry, the real breaker
 * functions or the real provider. This closes that gap.
 *
 * Every path here is guarded, so it cannot spend money. Spend is checked before
 * and after and must be unchanged.
 */
import { ManagementApiExecutor } from '../../src/db/executor.ts'
import { PaidCallPreventedError } from '../../src/providers/guards.ts'
import { NoUsableModelError, ProviderRouter } from '../../src/providers/router.ts'

const token = process.env.SUPABASE_ACCESS_TOKEN
const orKey = process.env.OPENROUTER_API_KEY
if (token === undefined || token === '' || orKey === undefined || orKey === '') {
  console.error('SUPABASE_ACCESS_TOKEN and OPENROUTER_API_KEY are required')
  process.exit(2)
}

const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  token,
)
const router = new ProviderRouter(db, orKey)

const checks: { what: string; outcome: string; passed: boolean }[] = []
const add = (what: string, outcome: string, passed: boolean): void => {
  checks.push({ what, outcome, passed })
}

const spend = async (): Promise<{ usage: number; limit: number }> => {
  const r = await fetch('https://openrouter.ai/api/v1/key', {
    headers: { Authorization: `Bearer ${orKey}` },
  })
  const d = (await r.json()) as { data: { usage: number; limit: number } }
  return d.data
}

const before = await spend()
console.log(`spend before: usage=${before.usage} limit=${before.limit}\n`)

// --- a real completion through every layer ---------------------------------
try {
  // 512, not 8. Every free model on this tier is a reasoning model and
  // reasoning tokens come out of the completion budget — max_tokens 8 spent all
  // eight on hidden reasoning and returned content: null. A realistic budget is
  // part of the finding, not a workaround for it.
  const result = await router.complete({
    messages: [{ role: 'user', content: 'Reply with the single word: ready' }],
    maxTokens: 512,
  })
  add(
    'a real completion through all four layers',
    `model=${result.model} cost=${result.cost} tokens=${result.promptTokens}+${result.completionTokens} content=${JSON.stringify(result.content.slice(0, 30))}`,
    result.cost === 0 && result.content.length > 0,
  )
} catch (error) {
  add(
    'a real completion through all four layers',
    `FAILED: ${(error as Error).message.slice(0, 120)}`,
    false,
  )
}

// --- a paid model cannot be reached (Gate 5's core requirement) ------------
for (const model of ['openai/gpt-4o-mini', 'anthropic/claude-3.5-sonnet', 'openrouter/auto']) {
  try {
    await router.complete({ messages: [{ role: 'user', content: 'hi' }], model, maxTokens: 1 })
    add(`a paid model is refused: ${model}`, 'EXECUTED — it must not have', false)
  } catch (error) {
    const prevented = error instanceof PaidCallPreventedError
    add(
      `a paid model is refused: ${model}`,
      prevented
        ? `refused before any request: ${(error as Error).message.slice(0, 70)}`
        : `wrong error: ${(error as Error).message.slice(0, 70)}`,
      prevented,
    )
  }
}

// --- the registry is measured, not configured -----------------------------
const registry = await db.execute(`
  select status::text as status, count(*)::int as n
  from public.provider_models where provider = 'openrouter' group by status
`)
const byStatus = Object.fromEntries(registry.rows.map((r) => [String(r.status), Number(r.n)]))
add(
  'the registry records why each candidate is unusable, not just that it is',
  Object.entries(byStatus)
    .map(([k, v]) => `${k}=${String(v)}`)
    .join(' '),
  (byStatus.data_policy ?? 0) > 0 && (byStatus.usable ?? 0) > 0,
)

const forged = await db.execute(`
  select count(*)::int as n from public.provider_models
  where status = 'usable' and last_success_at is null
`)
add(
  'no model is marked usable without a recorded successful probe',
  `${String(forged.rows[0]?.n)} such rows (the CHECK constraint makes this impossible)`,
  forged.rows[0]?.n === 0,
)

// --- the kill-switch empties the allow-list without touching models -------
const usableBefore = (await db.execute('select count(*)::int as n from public.usable_models'))
  .rows[0]
await db.execute(`
  update public.providers set enabled = false, disabled_reason = 'verification probe'
  where provider = 'openrouter'
`)
const usableDisabled = (await db.execute('select count(*)::int as n from public.usable_models'))
  .rows[0]

let refusedWhileDisabled = false
try {
  await router.complete({ messages: [{ role: 'user', content: 'hi' }], maxTokens: 1 })
} catch (error) {
  refusedWhileDisabled = error instanceof NoUsableModelError
}

await db.execute(`
  update public.providers set enabled = true, disabled_reason = null
  where provider = 'openrouter'
`)
const usableAfter = (await db.execute('select count(*)::int as n from public.usable_models'))
  .rows[0]

add(
  'disabling a provider empties its allow-list without touching a model row (§8)',
  `usable: ${String(usableBefore?.n)} -> ${String(usableDisabled?.n)} -> ${String(usableAfter?.n)}`,
  usableDisabled?.n === 0 && usableAfter?.n === usableBefore?.n,
)
add(
  'and the router refuses while it is disabled',
  refusedWhileDisabled ? 'NoUsableModelError' : 'did not refuse correctly',
  refusedWhileDisabled,
)

// --- spend must be unchanged ----------------------------------------------
const after = await spend()
add(
  'no money was spent by any of the above',
  `usage ${before.usage} -> ${after.usage}`,
  after.usage === before.usage,
)

console.log('| check | outcome | |')
console.log('|---|---|---|')
for (const c of checks) console.log(`| ${c.what} | ${c.outcome} | ${c.passed ? '✅' : '❌'} |`)
const failed = checks.filter((c) => !c.passed)
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`)
if (failed.length > 0) process.exit(1)
