/**
 * Does the model's clause reading keep "Make that urgent" away from the
 * deterministic change recogniser?
 *
 * `firstOfHis` only offers a clause to `personalTaskChange` when `understand`
 * labelled it task_create, task_change or other. The recogniser itself is
 * deterministic; the GATE in front of it is a model call. This asks the gate
 * the same question several times and prints what came back, because a single
 * reading says nothing about a stochastic step.
 */

import { personalTaskChange } from '../../src/agents/mine.ts'
import { understand } from '../../src/agents/understand.ts'
import { ManagementApiExecutor, type SqlExecutor } from '../../src/db/executor.ts'
import { buildPass } from '../../src/office/pass.ts'
import { ProviderRouter } from '../../src/providers/router.ts'

const db: SqlExecutor = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  process.env.SUPABASE_ACCESS_TOKEN ?? '',
)
await buildPass(db, 'poc-urgent', { max: 1, canTranscribe: false, canSubprocess: false })
const orKey = String(
  (
    (
      await db.execute(`select coalesce(app.resolve_secret(secret_ref), '') as v
                          from public.providers
                         where provider = 'openrouter' and secret_ref is not null limit 1`)
    ).rows[0] as { v?: string }
  )?.v ?? '',
)
const router = new ProviderRouter(db, orKey)

const SAY = ['Make that urgent', 'Actually make that Monday', 'Make that high priority']
for (const text of SAY) {
  const direct = personalTaskChange(text)
  console.log(`\n"${text}"`)
  console.log(`  recogniser alone : ${direct === null ? 'DECLINED' : JSON.stringify(direct)}`)
  const seen = new Map<string, number>()
  for (let i = 0; i < 10; i += 1) {
    const got = await understand(text, router, {
      correlationId: crypto.randomUUID(),
    })
    const kinds = got.surviving.map((r) => r.kind).join(', ')
    const reaches = got.surviving.some((r) =>
      ['task_create', 'task_change', 'other'].includes(r.kind),
    )
    const texts = got.surviving.map((r) => r.text).join(' | ')
    const survives = got.surviving.some(
      (r) =>
        ['task_create', 'task_change', 'other'].includes(r.kind) &&
        personalTaskChange(r.text) !== null,
    )
    const key =
      `[${kinds}] "${texts}" -> ` +
      `${reaches ? 'reaches it' : 'NEVER REACHES IT'}, ` +
      `${survives ? 'recognised' : 'RECOGNISER DECLINES THE CLAUSE'}`
    seen.set(key, (seen.get(key) ?? 0) + 1)
  }
  for (const [key, n] of [...seen.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n)}/10 readings   : ${key}`)
  }
}
