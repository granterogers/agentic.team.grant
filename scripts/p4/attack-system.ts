/**
 * P4 step 9b: a signed-in PERSON must not reach the deployment's own things (#401's E13 and E14), tried for real.
 *   npx tsx scripts/p4/attack-system.ts
 * E13: Grant's Google Drive is read through a fixed-name credential. E14: `person` once meant "may run everything", which
 * includes rewriting every office's team, the routing, the bots and the connections. The second person tries each. Every
 * write names a target that does not exist, so that even a boundary that failed would change nothing - and the refusal is
 * asserted on its SENTENCE, because "no such staff member" is what a leak would look like and a refusal would not say it.
 * `forget_google` (an irreversible revoke at Google) is deliberately NOT attempted against production.
 */
import { act, check, db, read, results, secondSession } from './lib.ts'

const T = (await secondSession()).access_token
const rows = async (sql: string): Promise<Record<string, unknown>[]> =>
  (await db.execute(sql)).rows as Record<string, unknown>[]

// ---- E13: Grant's Drive and Google through the signed-in session
for (const [section, extra] of [
  ['drive', ''],
  ['drive', '&folder=root&q=a'],
  ['google', ''],
  ['bots', ''],
  ['build', ''],
] as const) {
  const r = await read(T, section, extra)
  const looksLikeGrantsDrive =
    /"files"\s*:\s*\[\s*\{|"mimeType"|"webViewLink"|refresh_token|client_secret/i.test(r.text)
  check(
    `section ${section}${extra === '' ? '' : ' (with parameters)'} gives the second person nothing of Grant's Google`,
    !looksLikeGrantsDrive,
    `http ${r.status} ${r.text.slice(0, 110)}`,
  )
}

// ---- E14: system-wide actions, each aimed at nothing
const settingBefore = (
  await rows(`select count(*)::int n from public.system_config where key like 'p4.%'`)
)[0]?.n
const attempts: [string, Record<string, unknown>][] = [
  ['set_setting', { p_key: 'p4.attack.noop', p_value: 'x' }],
  ['routing_set', { p_what: 'p4-noop', p_value: 'x' }],
  ['bot_assign', { p_username: 'p4_noop_bot' }],
  ['staff_update', { p_slug: 'p4-no-such-person', p_name: 'p4 takeover' }],
  ['staff_retire', { p_slug: 'p4-no-such-person', p_active: false }],
  ['disconnect', { p_service: 'p4-noop' }],
  ['set_slack_credentials', { p_bot_token: 'p4-noop', p_signing_secret: 'p4-noop' }],
  ['staff_tool_set', { p_slug: 'p4-no-such-person', p_tool: 'web.read', p_granted: true }],
]
for (const [action, args] of attempts) {
  const r = await act(T, action, args)
  const refused = r.status === 403 || r.status === 400 || r.status === 404 || r.status === 401
  const leakShape =
    /no such (staff|person|service)|no staff|unknown service|not a connected|saved|set to/i.test(
      r.text,
    )
  check(
    `a person session cannot run ${action}, and the refusal is a permission refusal (not "no such target")`,
    refused && !leakShape,
    `http ${r.status} ${r.text.slice(0, 110)}`,
  )
}
const settingAfter = (
  await rows(`select count(*)::int n from public.system_config where key like 'p4.%'`)
)[0]?.n
check(
  'no system setting appeared',
  settingBefore === settingAfter,
  `${String(settingBefore)} -> ${String(settingAfter)}`,
)
const staff = await rows(`select count(*)::int n from public.staff where slug like 'p4-%'`)
check('no staff member appeared or changed', Number(staff[0]?.n) === 0)

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} ok`)
process.exitCode = failed.length === 0 ? 0 : 1
