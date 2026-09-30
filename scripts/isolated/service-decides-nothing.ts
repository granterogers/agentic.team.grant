/**
 * The office key (a machine) may change data and the shape of a screen - it may not DECIDE (review F2).
 *
 *   npx tsx scripts/isolated/service-decides-nothing.ts <replica-db>
 *
 * The gateway's SERVICE_MAY is the allow-list of what the office key may do, and its own comment says none of it
 * "decides anything, speaks as anybody, widens what the office may reach or do ... or answers a question". The
 * architecture test that guards it forbids entries BY NAME, so `output_import` - whose function approves a document
 * into a project inline, the act `document_approve` refuses the key for - passed. This asks the property instead:
 * from the database's own catalog, follow every function a SERVICE_MAY action reaches (up to four calls deep) and
 * refuse any that reaches an act that decides: approving a document, approving or declining a tool, answering a
 * question, granting or revoking an authorization, setting the autonomy dial, deciding a proposal or a suggestion.
 * The detector is shown the pre-fix shape (a service entry whose function approves) and must report it.
 */
import { readFileSync } from 'node:fs'
import { isolated } from './guard.ts'

const db = await isolated(process.argv[2] ?? 'svc')
const results: { ok: boolean }[] = []
const check = (what: string, ok: boolean, detail: string) => {
  results.push({ ok })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what} - ${detail}`)
}
const src = readFileSync('supabase/functions/hq-api/index.ts', 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
)
const serviceMay = [
  ...(/const SERVICE_MAY[^=]*=\s*new Set\(\[([\s\S]*?)\]\)/.exec(src)?.[1] ?? '').matchAll(
    /'([a-z_0-9]+)'/g,
  ),
].map((m) => m[1] as string)
const actions = new Map<string, string>(
  [...src.matchAll(/^\s{2}([a-z_0-9]+):\s*\{\s*fn:\s*'([a-z_0-9]+)'/gm)].map((m) => [
    m[1] as string,
    m[2] as string,
  ]),
)
const SINKS = [
  'approve_document',
  'approve_tool',
  'decline_tool',
  'hq_answer_blocker',
  'answer_generation_approval',
  'grant_standing',
  'hq_grant_standing',
  'revoke_standing',
  'hq_revoke_standing',
  'hq_autonomy_set',
  'decide_suggestion',
  'decide_proposal',
  'withdraw_refusal',
  'answer_blocker',
  'voice_answer',
]
const bodies = new Map<string, string>()
for (const r of (
  await db.execute(
    `select p.proname::text as n, pg_get_functiondef(p.oid) as d from pg_proc p
      where p.prokind = 'f' and p.pronamespace in ('app'::regnamespace, 'public'::regnamespace)`,
  )
).rows as { n: string; d: string }[]) {
  bodies.set(
    r.n,
    `${bodies.get(r.n) ?? ''}\n${r.d.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--.*$/gm, '')}`,
  )
}
const reaches = (fn: string): string[] => {
  const seen = new Set<string>()
  const hit = new Set<string>()
  const walk = (name: string, depth: number) => {
    if (seen.has(name) || depth > 4) return
    seen.add(name)
    const body = bodies.get(name)
    if (body === undefined) return
    for (const m of body.matchAll(/\b(?:app|public)\.([a-z_0-9]+)\s*\(/g)) {
      const callee = m[1] as string
      if (SINKS.includes(callee)) hit.add(callee)
      walk(callee, depth + 1)
    }
  }
  walk(fn, 0)
  return [...hit].sort()
}
const offenders = (allow: string[]) =>
  allow
    .map((a) => ({ action: a, fn: actions.get(a) ?? '', sinks: reaches(actions.get(a) ?? '') }))
    .filter((o) => o.fn !== '' && o.sinks.length > 0)

check(
  'control: the parser found the allow-list and the action map',
  serviceMay.length > 20 &&
    actions.size > 100 &&
    serviceMay.every((a) => actions.has(a) || a === 'signin'),
  `${serviceMay.length} allowed of ${actions.size} actions`,
)
check(
  'control: the detector follows calls (document_approve reaches approve_document; answer_blocker reaches hq_answer_blocker)',
  reaches('approve_document').length >= 0 &&
    offenders(['document_approve', 'answer_blocker']).length === 2,
  JSON.stringify(
    offenders(['document_approve', 'answer_blocker']).map(
      (o) => `${o.action}->${o.sinks.join('+')}`,
    ),
  ),
)
const bad = offenders(serviceMay)
check(
  'no action the office key may take reaches an act that decides',
  bad.length === 0,
  JSON.stringify(bad.map((o) => `${o.action}->${o.sinks.join('+')}`)),
)
// The pre-fix shape: the same allow-list with output_import in it.
check(
  'control: the allow-list WITH output_import would be reported (import_output approves inline)',
  offenders([...serviceMay, 'output_import']).some((o) => o.action === 'output_import'),
  JSON.stringify(reaches('import_output')),
)
const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} passed`)
await db.end?.()
process.exitCode = failed === 0 ? 0 : 1
