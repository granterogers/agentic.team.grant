/*
 * A REAL MESSAGE TO THE REAL OFFICE.
 *
 * Grant, 23 September: "Verify a real message can be sent to the office and a
 * real response returned... For Chat and Voice, a visually correct interface is
 * not acceptance. Exercise the real backend/API path."
 *
 * So this is the endpoint the page posts to, over the network, with the token
 * from the vault - and the same endpoint with a wrong token and with none, so
 * that "it works" is distinguished from "it accepts anything".
 *
 * The office is asked something it can answer from its own state, so the reply
 * is real and no job is created: §5's `voice_answer` path. Nothing here starts
 * work, and the session id is a harness one.
 */
import { ManagementApiExecutor } from '../../src/db/executor.ts'

let pass = 0
let fail = 0
const check = (what: string, ok: boolean, detail = ''): void => {
  if (ok) {
    pass += 1
    console.log(`ok    ${what}`)
  } else {
    fail += 1
    console.log(`FAIL  ${what}${detail === '' ? '' : `\n        ${detail}`}`)
  }
}

const ref = process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg'
const accessToken = process.env.SUPABASE_ACCESS_TOKEN ?? ''
if (accessToken === '') {
  console.error('SUPABASE_ACCESS_TOKEN is not set')
  process.exit(1)
}
const db = new ManagementApiExecutor(ref, accessToken)
const token = String(
  (
    await db.execute(
      `select decrypted_secret as v from vault.decrypted_secrets where name = 'hq.api_token'`,
    )
  ).rows[0]?.v ?? '',
)
check('the office has a token in the vault', token !== '')

const TURN = `https://${ref}.supabase.co/functions/v1/voice/turn`
const say = async (
  said: string,
  bearer: string | null,
): Promise<{ status: number; body: Record<string, unknown> }> => {
  const r = await fetch(TURN, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(bearer === null ? {} : { Authorization: `Bearer ${bearer}` }),
    },
    body: JSON.stringify({ said, session: `verify-chat-${Date.now()}` }),
  })
  return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, unknown> }
}

const answered = await say('what projects have we got', token)
check(
  'a real message reaches the office',
  answered.status === 200,
  `http ${String(answered.status)}`,
)
const spoke = String(answered.body.speak ?? '')
check('and a real answer comes back', spoke.length > 20, spoke.slice(0, 120))
console.log(`      it said: "${spoke.slice(0, 110)}${spoke.length > 110 ? '…' : ''}"`)
check(
  'answered from the office own state rather than by starting work',
  answered.body.did === 'answered',
  String(answered.body.did),
)
/*
  IT IS REALLY HIS OFFICE. A canned string would satisfy everything above, so
  this asks whether the answer names something only the database knows.
*/
const names = (
  await db.execute(
    `select name from public.projects
      where coalesce(status,'') <> 'archived' and not is_fixture order by created_at limit 8`,
  )
).rows.map((r) => String((r as { name?: string }).name ?? ''))
check(
  'and it names a project that is really in the database',
  names.some((n) => n !== '' && spoke.includes(n)),
  `answer did not mention any of: ${names.join(', ')}`,
)

const wrong = await say('hello', 'not-the-token')
check('a wrong token is refused', wrong.status === 401, `http ${String(wrong.status)}`)
const none = await say('hello', null)
check('and so is no token at all', none.status === 401, `http ${String(none.status)}`)

console.log(
  `\n${String(pass)}/${String(pass + fail)} passed — against the deployed conversation endpoint`,
)
process.exit(fail === 0 ? 0 : 1)
