/**
 * Answering a request for reach is an act of the office that raised it. Driven as the Sample Person against the REAL
 * gateway, with the cross-office negatives that make it safe.
 *   npm run verify:sample-tool-requests
 *
 * Positives (the Sample's own office): approve gives the grant in THIS office, decline records the reason and silences the
 * ask, revoke withdraws the grant, an answer for a request that is already answered is refused.
 * Negatives: the Sample cannot answer a request raised in another office (it is reported as "no such request" and the row
 * does not move), cannot revoke a grant another office holds, cannot name another office in the arguments, still cannot
 * make the deployment-wide changes (a 403), and the other direction holds too: the database refuses to answer a
 * Sample-office request in any other office, and refuses an answerer who is not the office's own person.
 *
 * Grant's office is never written. Its rows are READ (to find a foreign id) and fingerprinted before and after.
 * Each run uses (specialist, tool) pairs the Sample's office has never asked about, because a decline is durable by design.
 */
import { act, check, results } from '../p4/lib.ts'
import { gateway, lit, rows, sampleOffice, session } from './lib.ts'

const office = await sampleOffice()
const O = lit(office.officeId)
const s = await session()
const g = gateway(s)
const run = Math.random().toString(36).slice(2, 7)

const fingerprint = async (): Promise<string> =>
  JSON.stringify(
    (
      await rows(`
        select (select md5(coalesce(string_agg(request_id::text || state || coalesce(decided_by,''), ',' order by request_id), '')) from public.tool_requests where office_id <> ${O}::uuid) tr,
               (select md5(coalesce(string_agg(staff_slug || tool, ',' order by staff_slug, tool), '')) from public.staff_tools where office_id <> ${O}::uuid) st`)
    )[0],
  )
const before = await fingerprint()

// ---- find pairs this office has never asked about ---------------------------------------------------------------------
const free = (await rows(`
    select s.slug, t.tool from public.staff s
      cross join (select tool from public.tool_permissions where enabled and level <= 1
                   and tool in ('calendar.read','gmail.read','gmail.search','notebook.read')) t
     where s.active and s.permanent and not s.is_fixture
       and not exists (select 1 from public.tool_requests r where r.office_id = ${O}::uuid and r.asked_by = s.slug and r.tool = t.tool)
       and not exists (select 1 from public.staff_tools x where x.office_id = ${O}::uuid and x.staff_slug = s.slug and x.tool = t.tool)
     order by random() limit 3`)) as { slug: string; tool: string }[]
check(
  'three unused (specialist, tool) pairs exist for this run',
  free.length === 3,
  `${free.length}`,
)
const [yes, no, again] = free as [
  (typeof free)[number],
  (typeof free)[number],
  (typeof free)[number],
]

const ask = async (p: { slug: string; tool: string }): Promise<string> => {
  const r = await rows(
    `select app.request_tool(${O}::uuid, ${lit(p.tool)}, ${lit(p.slug)}, ${lit(`sample ${run}: needs ${p.tool}`)}, '{}'::jsonb, null)::text as r`,
  )
  const j = JSON.parse(String(r[0]?.r)) as { request_id?: string; id?: string }
  return String(j.request_id ?? j.id ?? '')
}
const held = async (p: { slug: string; tool: string }): Promise<number> =>
  Number(
    (
      await rows(
        `select count(*)::int n from public.staff_tools where office_id = ${O}::uuid and staff_slug = ${lit(p.slug)} and tool = ${lit(p.tool)}`,
      )
    )[0]?.n,
  )
const state = async (id: string): Promise<string> =>
  String(
    (await rows(`select state from public.tool_requests where request_id = ${lit(id)}::uuid`))[0]
      ?.state ?? '(none)',
  )
const said = (r: { json: unknown }): Record<string, unknown> =>
  ((r.json as { result?: Record<string, unknown> } | null)?.result ?? {}) as Record<string, unknown>

// ---- positives --------------------------------------------------------------------------------------------------------
const yesId = await ask(yes)
const noId = await ask(no)
const againId = await ask(again)
check(
  'the Sample’s three requests are open',
  [await state(yesId), await state(noId), await state(againId)].every((x) => x === 'open'),
)

const approved = await g.act('approve_tool', { p_request_id: yesId })
check(
  'the Sample approves a request in its own office',
  approved.status === 200 && said(approved).approved === true,
  JSON.stringify(said(approved)).slice(0, 100),
)
check('and the grant exists in the Sample’s office', (await held(yes)) === 1)
const twice = await g.act('approve_tool', { p_request_id: yesId })
check(
  'answering it a second time is refused, not repeated',
  String(said(twice).error ?? '').includes('already'),
  String(said(twice).error),
)

const short = await g.act('decline_tool', { p_request_id: noId, p_reason: 'no' })
check(
  'a decline without a real reason is refused',
  String(said(short).error ?? '').includes('reason'),
  String(said(short).error),
)
const declined = await g.act('decline_tool', {
  p_request_id: noId,
  p_reason: 'not something I want this person to do',
})
check(
  'a decline with a reason is recorded',
  said(declined).declined === true && (await state(noId)) === 'declined',
)
check('and grants nothing', (await held(no)) === 0)

const revoked = await g.act('revoke_tool', { p_slug: yes.slug, p_tool: yes.tool })
check(
  'the Sample takes the grant back',
  said(revoked).revoked === yes.tool && (await held(yes)) === 0,
  JSON.stringify(said(revoked)).slice(0, 100),
)
const revokedTwice = await g.act('revoke_tool', { p_slug: yes.slug, p_tool: yes.tool })
check(
  'taking back what is not held is refused',
  String(said(revokedTwice).error ?? '').includes('does not hold'),
)

// ---- cross-office negatives: the Sample reaches for Grant's rows --------------------------------------------------------
const grantReq = (
  await rows(
    `select request_id::text id, tool, asked_by from public.tool_requests where office_id <> ${O}::uuid order by raised_at desc limit 1`,
  )
)[0] as { id: string; tool: string; asked_by: string } | undefined
check('there is a request in another office to reach for', grantReq !== undefined)
if (grantReq !== undefined) {
  const stateBefore = await state(grantReq.id)
  const a = await g.act('approve_tool', { p_request_id: grantReq.id })
  check(
    'the Sample cannot approve a request raised in another office',
    String(said(a).error ?? '').includes('no such request'),
    String(said(a).error ?? JSON.stringify(said(a))).slice(0, 80),
  )
  const d = await g.act('decline_tool', {
    p_request_id: grantReq.id,
    p_reason: 'sample tries to decline for another office',
  })
  check(
    'nor decline it',
    String(said(d).error ?? '').includes('no such request'),
    String(said(d).error ?? '').slice(0, 80),
  )
  const spoof = await g.act('approve_tool', {
    p_request_id: grantReq.id,
    p_office: (await rows(`select app.operator_office()::text o`))[0]?.o,
  })
  check(
    'naming another office in the arguments changes nothing (the gateway writes the verified office)',
    String(said(spoof).error ?? '').includes('no such request') || spoof.status >= 400,
    String(said(spoof).error ?? spoof.status).slice(0, 80),
  )
  check(
    'and another office’s request has not moved',
    (await state(grantReq.id)) === stateBefore,
    stateBefore,
  )
}
const grantGrant = (
  await rows(`
    select x.staff_slug slug, x.tool from public.staff_tools x
     where x.office_id <> ${O}::uuid
       and not exists (select 1 from public.staff_tools y where y.office_id = ${O}::uuid and y.staff_slug = x.staff_slug and y.tool = x.tool)
     limit 1`)
)[0] as { slug: string; tool: string } | undefined
check('there is a grant in another office the Sample does not hold', grantGrant !== undefined)
if (grantGrant !== undefined) {
  const r = await g.act('revoke_tool', { p_slug: grantGrant.slug, p_tool: grantGrant.tool })
  check(
    'the Sample’s revoke of it removes nothing (it is not in the Sample’s office)',
    String(said(r).error ?? '').includes('does not hold'),
    String(said(r).error ?? '').slice(0, 80),
  )
}

// ---- what stays the operator's -------------------------------------------------------------------------------------------
for (const [action, args] of [
  ['staff_update', { p_slug: 'chief-of-staff', p_title: 'SAMPLE-WROTE-THIS' }],
  ['set_setting', { p_key: 'telegram.only_chief_speaks', p_value: 'false' }],
  ['staff_tool_set', { p_slug: yes.slug, p_tool: yes.tool, p_granted: true }],
] as const) {
  const r = await g.act(action, args)
  check(
    `${action} is still refused to a person who is not the operator`,
    r.status === 403,
    `http ${r.status}`,
  )
}

// ---- the other direction, at the database --------------------------------------------------------------------------------
const fresh = await ask({ slug: yes.slug, tool: 'calendar.read' }).catch(() => '')
void fresh
const sampleOpen = await ask(again).catch(() => againId)
const crossIn = await rows(
  `select app.approve_tool(app.operator_office(), ${lit(againId)}::uuid, app.office_actor(app.operator_office()))::text r`,
)
check(
  'another office cannot answer a Sample-office request',
  String(crossIn[0]?.r).includes('no such request'),
  String(crossIn[0]?.r).slice(0, 80),
)
const wrongPerson = await rows(
  `select app.approve_tool(${O}::uuid, ${lit(againId)}::uuid, 'grant')::text r`,
)
check(
  'an answerer who is not the office’s own person is refused',
  String(wrongPerson[0]?.r).includes('only the person this office belongs to'),
  String(wrongPerson[0]?.r).slice(0, 80),
)
check('and that request is still open', (await state(againId)) === 'open')
void sampleOpen

// ---- Grant's office, measured after -------------------------------------------------------------------------------------
check(
  'another office’s tool requests and grants are exactly as they were',
  (await fingerprint()) === before,
)
void act

const failed = results.filter((r) => !r.ok)
console.log(`\nverify:sample-tool-requests: ${results.length - failed.length}/${results.length}`)
if (failed.length > 0) {
  for (const f of failed) console.log(`  FAIL ${f.what} ${f.detail}`)
  process.exitCode = 1
}
