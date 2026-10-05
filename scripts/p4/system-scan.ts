/**
 * P4 step 9c: what DEPLOYMENT-level information does a signed-in second person see? Every GET section, read as the second
 * person, scanned for things that identify Grant or his connections (not his office rows - first-login.ts covers those):
 * his address, his name, his Telegram chat id, his Slack workspace id, his Google connection. Anything found is listed
 * rather than failed: the result is the inventory the report has to give Grant, and a control proves the scan can find
 * each needle (the same scan over a payload of Grant's own).
 *   npx tsx scripts/p4/system-scan.ts
 */
import { check, db, grantSession, read, results, secondSession } from './lib.ts'

const rows = async (sql: string): Promise<Record<string, unknown>[]> =>
  (await db.execute(sql)).rows as Record<string, unknown>[]
const T = (await secondSession()).access_token
const G = (await grantSession()).access_token

const email = String(
  (await rows(`select email v from public.office_members where owner_key='grant' limit 1`))[0]?.v,
)
const chat = String(
  (
    await rows(
      `select target_ref v from public.deliveries where channel='telegram' and state='sent' order by created_at desc limit 1`,
    )
  )[0]?.v ?? '',
)
const team = String(
  (await rows(`select team_id v from public.slack_workspaces limit 1`))[0]?.v ?? '',
)
const needles: [string, string][] = [
  ['Grant email', email],
  ['"Grant Rogers"', 'Grant Rogers'],
  ['his GitHub handle', 'granterogers'],
  ['Telegram chat id', chat],
  ['Slack workspace id', team],
].filter(([, v]) => (v as string).length > 4) as [string, string][]
console.log(`needles: ${needles.map(([k]) => k).join(', ')}`)

const src = await (await import('node:fs/promises')).readFile(
  'supabase/functions/hq-api/index.ts',
  'utf8',
)
const body = src.slice(src.indexOf('const SECTIONS'))
const names = [...body.slice(0, body.indexOf('\n}\n')).matchAll(/^ {2}([a-z_0-9]+): \{/gm)].map(
  (m) => m[1] as string,
)
console.log(`${names.length} sections`)

const found: Record<string, string[]> = {}
let reachable = 0
let refused = 0
let needId = 0
for (const s of names) {
  const r = await read(T, s)
  if (r.status === 403) refused++
  else if (r.status === 400) needId++
  else if (r.status === 200) {
    reachable++
    const hit = needles.filter(([, v]) => r.text.includes(v)).map(([k]) => k)
    if (hit.length > 0) found[s] = hit
  }
}
console.log(`reachable (200): ${reachable}, refused (403): ${refused}, need an id (400): ${needId}`)
console.log(`sections that identify Grant or his connections: ${JSON.stringify(found)}`)

// control: the scan finds each needle in a payload that has it (Grant's own sections)
let controlHits = 0
for (const s of ['connections', 'studio_settings', 'google', 'overview', 'team', 'mcp']) {
  const r = await read(G, s)
  controlHits += needles.filter(([, v]) => r.text.includes(v)).length
}
check(
  "control: the scan finds identifying strings in Grant's own payloads",
  controlHits > 0,
  `${controlHits} hits`,
)
check(
  "no section the second person can read identifies Grant's address, Telegram chat or Slack workspace",
  Object.keys(found).length === 0,
  JSON.stringify(found),
)

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} ok`)
process.exitCode = failed.length === 0 ? 0 : 1
