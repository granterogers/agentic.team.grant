/**
 * The application-conversion inventory (multi-user P3, Wave 0).
 *
 *   npx tsx scripts/p3/inventory.ts                 # print the summary, read-only against production
 *   npx tsx scripts/p3/inventory.ts --json out.json # also write every entry
 *
 * One entry per database function in `app` and `public`, derived from the catalogue and the repository - never listed
 * by hand: which owned tables its body names (directly and through what it calls), what parameters it takes, who can
 * reach it from outside the database (the gateway, an edge function, the worker's own SQL), and what ambient person it
 * defaults to. `scripts/check-office-conversion.ts` turns the same derivation into a gate.
 *
 * Classes (the P3 brief's words):
 *   OFFICE_EXPLICIT          takes a required p_office (no default) and its body uses it
 *   OFFICE_TRUSTED_DERIVED   touches owned data, is not itself an external door, and derives its office from a trusted
 *                            internal object (a claimed job, a trigger row, its caller) - stated, with a reason
 *   GLOBAL                   touches no owned table (catalogue, pure helper)
 *   SYSTEM                   touches only deployment infrastructure
 *   LEGACY_UNSCOPED          touches owned data, can be reached from outside, and names no office - THE DEBT
 */
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { ManagementApiExecutor } from '../../src/db/executor.ts'

export type Entry = {
  fn: string
  args: string
  argNames: string[]
  secdef: boolean
  trigger: boolean
  owned: string[]
  ownedViaCalls: string[]
  external: string[]
  ambient: string[]
  officeParam: 'required' | 'defaulted' | 'none'
  idParams: string[]
  class: string
  derivedClass: string
}

const OWNED = 'OFFICE_CARRIER|OFFICE_DERIVED'
const manifest = JSON.parse(readFileSync('docs/multi-user/ownership-manifest.json', 'utf8')).tables as Record<
  string,
  { class: string }
>
const ownedTables = new Set(Object.entries(manifest).filter(([, v]) => OWNED.includes(v.class)).map(([k]) => k))
const systemTables = new Set(Object.entries(manifest).filter(([, v]) => v.class === 'SYSTEM').map(([k]) => k))

const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  process.env.SUPABASE_ACCESS_TOKEN ?? '',
)

const rows = (
  await db.execute(`
    select n.nspname as schema, p.proname as name, pg_get_function_identity_arguments(p.oid) as ident,
           pg_get_function_arguments(p.oid) as args, p.prosecdef as secdef,
           coalesce(p.proargnames, '{}'::text[]) as argnames,
           exists (select 1 from pg_trigger t where t.tgfoid = p.oid and not t.tgisinternal) as is_trigger,
           regexp_replace(regexp_replace(coalesce(p.prosrc, ''), '/[*].*?[*]/', ' ', 'gs'), '--[^' || chr(10) || ']*', ' ', 'g') as body
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('app', 'public') and p.prokind = 'f'
     order by 1, 2, 3`)
).rows as {
  schema: string
  name: string
  ident: string
  args: string
  secdef: boolean
  argnames: string[]
  is_trigger: boolean
  body: string
}[]

const fnId = (r: { schema: string; name: string; ident: string }) => `${r.schema}.${r.name}(${r.ident})`
const byName = new Map<string, typeof rows>()
for (const r of rows) byName.set(r.name, [...(byName.get(r.name) ?? []), r])

// ---- who can reach a function from outside the database --------------------------------------------------------------
const strip = (t: string): string =>
  t.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ').replace(/--[^\n]*/g, ' ')
const read = (cmd: string): string => strip(execSync(cmd, { maxBuffer: 256 * 1024 * 1024 }).toString())

const gatewaySrc = strip(readFileSync('supabase/functions/hq-api/index.ts', 'utf8'))
const gatewayFns = new Set([...gatewaySrc.matchAll(/\bfn:\s*'([a-z0-9_]+)'/g)].map((m) => m[1] as string))
const gatewayInline = new Set([...gatewaySrc.matchAll(/rpc\/([a-z0-9_]+)/g)].map((m) => m[1] as string))

const edgeRoot = (dir: string): Set<string> => {
  const code = read(`find supabase/functions/${dir} -type f -name '*.ts' -print0 | xargs -0 cat`)
  return new Set(
    [...code.matchAll(/(?:rpc\/|rpcOne\(\s*'|rpc\(\s*'|rpcJson\(\s*'|call\(\s*')([a-z0-9_]+)/g)].map((m) => m[1] as string),
  )
}
const edge: Record<string, Set<string>> = {}
for (const d of ['mcp', 'slack-events', 'telegram-webhook', 'voice', 'voice-token', 'google-oauth', 'signin', 'worker'])
  edge[d] = edgeRoot(d)

const srcCode = read(
  "find src -type f -name '*.ts' ! -name '*.test.ts' -print0 | xargs -0 cat",
)
const srcCalls = (name: string): boolean =>
  new RegExp(`(?:\\bapp|\\bpublic)\\.${name}\\s*\\(|\\.rpc\\(\\s*['"]${name}['"]`).test(srcCode)

// ---- what each body touches ------------------------------------------------------------------------------------------
const touches = (body: string, set: Set<string>): string[] => {
  const hit = new Set<string>()
  for (const t of set) {
    const re = new RegExp(`(?:\\bpublic\\.${t}\\b|\\b(?:from|join|into|update)\\s+${t}\\b)`, 'i')
    if (re.test(body)) hit.add(t)
  }
  return [...hit].sort()
}

const qn = (r: { schema: string; name: string }): string => `${r.schema}.${r.name}`
const calls = new Map<string, string[]>()
const names = new Set(rows.map(qn))
for (const r of rows) {
  const out = new Set<string>([...(calls.get(qn(r)) ?? [])])
  for (const m of r.body.matchAll(/\b(app|public)\.([a-z_0-9]+)\s*\(/g)) {
    const callee = `${m[1] as string}.${m[2] as string}`
    if (names.has(callee) && callee !== qn(r)) out.add(callee)
  }
  calls.set(qn(r), [...out])
}

const direct = new Map<string, string[]>()
for (const r of rows) direct.set(qn(r), [...new Set([...(direct.get(qn(r)) ?? []), ...touches(r.body, ownedTables)])].sort())
const viaCalls = new Map<string, Set<string>>()
const reach = (name: string, seen: Set<string>): Set<string> => {
  const hit = new Set<string>(direct.get(name) ?? [])
  for (const c of calls.get(name) ?? []) {
    if (seen.has(c)) continue
    seen.add(c)
    for (const t of reach(c, seen)) hit.add(t)
  }
  return hit
}
for (const r of rows) viaCalls.set(qn(r), reach(qn(r), new Set([qn(r)])))

// ---- classify --------------------------------------------------------------------------------------------------------
const idRe = /^p_(?:project|job|task|document|doc|blocker|command|contact|delivery|action|collection|attachment|request|skill|lesson|trigger|signal|source|output|parent|root|from_job|origin)(?:_id)?$/
const entries: Entry[] = []
for (const r of rows) {
  const argNames = r.argnames
  const hasOffice = argNames.some((a) => /^p_office(_id)?$/.test(a))
  const officeDefaulted = hasOffice && /p_office(?:_id)?\s+uuid\s+DEFAULT/i.test(r.args)
  const ambient = [...r.args.matchAll(/(\w+)\s+text\s+DEFAULT\s+'(grant|chief-of-staff)'/gi)].map((m) => `${m[1]}=${m[2]}`)
  const ownedAll = [...(viaCalls.get(qn(r)) ?? [])].sort()
  const ownedDirect = direct.get(qn(r)) ?? []
  const external: string[] = []
  if (gatewayFns.has(r.name)) external.push('gateway')
  if (gatewayInline.has(r.name)) external.push('gateway-inline')
  for (const [d, s] of Object.entries(edge)) if (s.has(r.name)) external.push(d)
  if (srcCalls(r.name)) external.push('worker-src')
  const sysOnly = ownedAll.length === 0 && touches(r.body, systemTables).length > 0
  let derivedClass: string
  if (hasOffice && !officeDefaulted) derivedClass = 'OFFICE_EXPLICIT'
  else if (ownedAll.length === 0) derivedClass = sysOnly ? 'SYSTEM' : 'GLOBAL'
  else if (external.length > 0 || ambient.length > 0) derivedClass = 'LEGACY_UNSCOPED'
  else derivedClass = 'OFFICE_TRUSTED_DERIVED'
  entries.push({
    fn: fnId(r),
    args: r.args,
    argNames,
    secdef: r.secdef,
    trigger: r.is_trigger,
    owned: ownedDirect,
    ownedViaCalls: ownedAll.filter((t) => !ownedDirect.includes(t)),
    external,
    ambient,
    officeParam: hasOffice ? (officeDefaulted ? 'defaulted' : 'required') : 'none',
    idParams: argNames.filter((a) => idRe.test(a)),
    class: derivedClass,
    derivedClass,
  })
}

const tally = (key: (e: Entry) => string) => {
  const t = new Map<string, number>()
  for (const e of entries) t.set(key(e), (t.get(key(e)) ?? 0) + 1)
  return [...t.entries()].sort((a, b) => b[1] - a[1])
}
console.log(`functions: ${entries.length}  (app ${entries.filter((e) => e.fn.startsWith('app.')).length}, public ${entries.filter((e) => e.fn.startsWith('public.')).length})`)
console.log('by class:', tally((e) => e.class).map(([k, v]) => `${k}=${v}`).join('  '))
console.log('ambient-person defaults:', entries.filter((e) => e.ambient.length > 0).length)
console.log(
  'LEGACY_UNSCOPED by door:',
  tally((e) => (e.class === 'LEGACY_UNSCOPED' ? e.external.join('+') || 'ambient-only' : '')).filter(([k]) => k !== '').map(([k, v]) => `${k}=${v}`).join('  '),
)
console.log('triggers:', entries.filter((e) => e.trigger).length, ' gateway fns:', gatewayFns.size, ' inline:', gatewayInline.size)
console.log('edge doors:', Object.entries(edge).map(([k, v]) => `${k}=${v.size}`).join(' '))
const jsonOut = process.argv.indexOf('--json')
if (jsonOut > -1) writeFileSync(process.argv[jsonOut + 1] as string, JSON.stringify(entries, null, 1))
