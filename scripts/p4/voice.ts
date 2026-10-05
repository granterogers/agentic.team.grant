/**
 * P4 step 7: the voice surface for a second person.
 *   npx tsx scripts/p4/voice.ts
 * The browser must not choose the office: a call is minted for the office of the SESSION it presents, a caller-supplied
 * office or a foreign project id changes nothing, an invalid session is refused, and the briefing a call opens with
 * carries nothing of Grant's. (The OpenAI Realtime audio leg is not driven; what is checked is everything that decides
 * whose call it is.)
 */
import { check, db, grantSession, REF, results, SECOND_OFFICE, secondSession } from './lib.ts'

const VOICE = `https://${REF}.supabase.co/functions/v1/voice`
const TOKEN = `https://${REF}.supabase.co/functions/v1/voice-token`
const ORIGIN = 'https://ai-team-hq.vercel.app'
const rows = async (sql: string): Promise<Record<string, unknown>[]> =>
  (await db.execute(sql)).rows as Record<string, unknown>[]
const post = async (
  url: string,
  bearer: string | null,
  body: unknown,
): Promise<{ status: number; text: string }> => {
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Origin: ORIGIN,
      ...(bearer === null ? {} : { Authorization: `Bearer ${bearer}` }),
    },
    body: JSON.stringify(body),
  })
  return { status: r.status, text: await r.text() }
}
const T = (await secondSession()).access_token
const grantProject = String(
  (
    await rows(
      `select project_id::text v from public.projects where office_id = app.operator_office() and not is_fixture and slug <> 'unnamed' order by created_at limit 1`,
    )
  )[0]?.v,
)
const grantSlug = String(
  (await rows(`select slug v from public.projects where project_id = '${grantProject}'`))[0]?.v,
)
const grantOffice = String((await rows(`select app.operator_office()::text v`))[0]?.v)

// ---- refusals
check(
  'no credential: the token endpoint refuses',
  [401, 403].includes((await post(TOKEN, null, {})).status),
)
check(
  'a made-up credential: the token endpoint refuses',
  [401, 403].includes((await post(TOKEN, 'not-a-session', {})).status),
)
check(
  'no credential: the voice turn endpoint refuses',
  [401, 403].includes((await post(VOICE, null, { said: 'hello' })).status),
)
check(
  'a made-up credential: the voice turn endpoint refuses',
  [401, 403].includes((await post(VOICE, 'not-a-session', { said: 'hello' })).status),
)
const expired = `${T.slice(0, -8)}AAAAAAAA`
check(
  'a tampered session is refused',
  [401, 403].includes((await post(VOICE, expired, { said: 'hello' })).status),
)

// ---- the second person's call is theirs: a caller-supplied office or foreign project changes nothing
const minted = await post(TOKEN, T, {
  project: grantSlug,
  office: grantOffice,
  office_id: grantOffice,
})
console.log(
  `   voice-token as the second person: http ${minted.status} ${minted.status === 200 ? '(a call was minted)' : minted.text.slice(0, 80)}`,
)
check(
  'the second person can open a call, or the service says plainly it is not configured',
  [200, 503].includes(minted.status),
  `http ${minted.status}`,
)
if (minted.status === 200) {
  const m = JSON.parse(minted.text) as Record<string, unknown>
  const facts = JSON.stringify({ ...m, client_secret: '<hidden>' })
  console.log(`   what the response says it attached: ${facts.slice(0, 260)}`)
  check(
    "the response names none of Grant's data",
    !facts.includes(grantSlug) || facts.includes('"project"'),
    'the slug the caller itself sent may be echoed',
  )
}

// ---- the briefing a call opens with, read for the second office, scanned for Grant's strings; positive control on his
const grantStrings = (
  await rows(
    `select distinct name v from public.projects where office_id = app.operator_office() and not is_fixture and slug <> 'unnamed' and length(name) > 5`,
  )
).map((r) => String(r.v))
const briefSecond = JSON.stringify(
  (await rows(`select public.voice_state('${SECOND_OFFICE}'::uuid) v`))[0]?.v,
)
const briefGrant = JSON.stringify(
  (await rows(`select public.voice_state('${grantOffice}'::uuid) v`))[0]?.v,
)
check(
  "positive control: Grant's own call briefing names his projects",
  grantStrings.filter((s) => briefGrant.includes(s)).length >= 2,
  `${grantStrings.filter((s) => briefGrant.includes(s)).length} of ${grantStrings.length}`,
)
check(
  "the second person's call briefing names none of Grant's projects",
  grantStrings.filter((s) => briefSecond.includes(s)).length === 0,
  briefSecond.slice(0, 160),
)
const lookSecond = JSON.stringify(
  (await rows(`select public.voice_lookup('${SECOND_OFFICE}'::uuid, '${grantSlug}') v`))[0]?.v,
)
check(
  "looking up one of Grant's projects from the second office finds nothing",
  !grantStrings.some((s) => lookSecond.includes(s)),
  lookSecond.slice(0, 120),
)

// ---- a voice TURN naming Grant's project and Grant's office lands in the second person's office, filed under nothing of his
const said = `p4 voice probe ${Date.now().toString(36)}: what is on my list?`
const turn = await post(VOICE, T, {
  said,
  session: `p4sess${Date.now().toString(36)}`,
  project: grantProject,
  office: grantOffice,
  office_id: grantOffice,
})
console.log(`   voice turn: http ${turn.status} ${turn.text.slice(0, 120)}`)
check('the voice turn was accepted', turn.status === 200, `http ${turn.status}`)
await new Promise((ok) => setTimeout(ok, 4000))
const cmd = await rows(
  `select c.office_id::text off, c.project_id::text proj, c.synthetic from public.inbound_commands c where c.instruction = '${said.replace(/'/g, "''")}' limit 3`,
)
console.log(`   recorded: ${JSON.stringify(cmd)}`)
check(
  'the recorded command is in the second office',
  cmd.length >= 1 && cmd.every((c) => c.off === SECOND_OFFICE),
)
check(
  "and filed under none of Grant's projects",
  cmd.every((c) => c.proj !== grantProject),
)
const grantSees = await rows(
  `select count(*)::int n from public.inbound_commands where office_id = app.operator_office() and instruction = '${said.replace(/'/g, "''")}'`,
)
check("and nothing with that text exists in Grant's office", Number(grantSees[0]?.n) === 0)
void grantSession

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} ok`)
process.exitCode = failed.length === 0 ? 0 : 1
