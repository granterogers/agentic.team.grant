/*
 * REAL AUDIO, THE DEPLOYED ENDPOINT, REAL WORDS BACK.
 *
 * `verify:basecamp-voicenote` drives the whole browser path with the
 * transcription stubbed, because sending every run to the speech service would
 * spend Grant's quota and put this suite's noise in his conversation. This is
 * the other half: one real recording, posted to the endpoint that is actually
 * deployed, asserting the words that come back.
 *
 * WHAT MAKES IT REAL: `espeak-ng` synthesises speech into a WAV; the file goes
 * over the network to `https://<project>.supabase.co/functions/v1/voice/note`;
 * the office reads its own transcriber configuration and calls the service; the
 * words come back. Nothing here is mocked.
 *
 * WHAT IT IS NOT: a person speaking into a microphone. It is a synthesised
 * voice, and the report says so.
 *
 * The token comes from the vault and is never printed. The transcript IS
 * printed, because it is the evidence, and it is a sentence this file wrote.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync } from 'node:fs'
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
const managementToken = process.env.SUPABASE_ACCESS_TOKEN ?? ''
if (managementToken === '') {
  console.error('SUPABASE_ACCESS_TOKEN is not set, so the vault cannot be read')
  process.exit(1)
}
const db = new ManagementApiExecutor(ref, managementToken)

const token = String(
  (
    await db.execute(
      `select decrypted_secret as v from vault.decrypted_secrets where name = 'hq.api_token'`,
    )
  ).rows[0]?.v ?? '',
)
if (token === '') {
  console.error('no hq.api_token in the vault')
  process.exit(1)
}

/* Whether the office has a speech service at all, asked without reading the key. */
const configured = (
  await db.execute(
    `select (app.voice_transcriber()->>'mode') as mode,
            (length(coalesce(app.voice_transcriber()->>'key','')) > 20) as has_key`,
  )
).rows[0] as { mode?: string; has_key?: boolean } | undefined
check(
  'the office has a speech service configured',
  configured?.mode === 'api' && configured.has_key === true,
  `mode=${String(configured?.mode)} key present=${String(configured?.has_key)}`,
)

const endpoint = `https://${ref}.supabase.co/functions/v1/voice/note`
const SAID = 'What is late on the legacy coaching course, and what needs my attention today?'

mkdirSync('.out/voice', { recursive: true })
execFileSync('espeak-ng', ['-v', 'en-gb', '-s', '145', '-w', '.out/voice/live.wav', SAID])
const audio = readFileSync('.out/voice/live.wav')

const post = async (
  body: FormData,
  auth = token,
): Promise<{ status: number; json: Record<string, unknown> }> => {
  const r = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${auth}` },
    body,
  })
  return { status: r.status, json: (await r.json().catch(() => ({}))) as Record<string, unknown> }
}

const real = new FormData()
real.append('audio', new File([audio], 'note.wav', { type: 'audio/wav' }))
real.append('vocabulary', 'Legacy Coaching Course, NotebookLM, Innergy')
const heard = await post(real)
const words = String(heard.json.heard ?? '')
check(
  'the deployed endpoint transcribes real speech',
  heard.status === 200 && words !== '',
  JSON.stringify(heard.json).slice(0, 200),
)
console.log(`      it heard: "${words}"`)

/*
  ASSERT THE CONTENT, not a string.
  A transcript is not deterministic - punctuation and casing move between runs -
  so this asks whether the words that carry the MEANING came through. A literal
  comparison would be a wording lock on a speech model, which is the most
  fragile possible version of a trap this repository has recorded six times.
*/
const carries = ['late', 'coaching', 'attention'].filter((w) => words.toLowerCase().includes(w))
check(
  'and the words that carry the meaning are in it',
  carries.length === 3,
  `found ${carries.join(', ')} in "${words}"`,
)
check(
  'the vocabulary hint reached it, so a project name is spelled as the office spells it',
  /legacy coaching course/i.test(words),
  words,
)

const noAuth = new FormData()
noAuth.append('audio', new File([audio], 'note.wav', { type: 'audio/wav' }))
check(
  'it refuses an unauthenticated recording',
  (await post(noAuth, 'not-the-token')).status === 401,
)

const empty = new FormData()
empty.append('nothing', 'at all')
const emptied = await post(empty)
check(
  'it refuses a request with no recording, in a sentence',
  emptied.status === 400 && String(emptied.json.error ?? '').includes('no audio'),
  JSON.stringify(emptied.json),
)

const tiny = new FormData()
tiny.append('audio', new File([audio.subarray(0, 200)], 'note.wav', { type: 'audio/wav' }))
const tinied = await post(tiny)
check(
  'and a recording too short to hear',
  tinied.status === 400 && String(tinied.json.error ?? '').includes('too short'),
  JSON.stringify(tinied.json),
)

/* ====================================================================== *
 * AND THE OTHER MICROPHONE'S INFRASTRUCTURE, since it is deployed too.
 *
 * `voice-token` takes NO authentication, so its origin allowlist is the whole
 * of its security, and a live call from the experiment was impossible until
 * the experiment's origin was on it. Both facts are asked here, over the
 * network, against what is actually deployed.
 * ====================================================================== */
const MINT = `https://${ref}.supabase.co/functions/v1/voice-token`
const PREVIEW = 'https://agentic-team-hq-basecamp-agentic-team-grant.vercel.app'
const TEAM_HQ = 'https://ai-team-hq.vercel.app'

const preflight = async (origin: string): Promise<string> => {
  const r = await fetch(MINT, {
    method: 'OPTIONS',
    headers: { Origin: origin, 'Access-Control-Request-Method': 'POST' },
  })
  return r.headers.get('access-control-allow-origin') ?? ''
}
check('the experiment may mint a live credential', (await preflight(PREVIEW)) === PREVIEW)
check(
  'and so may Team HQ, which must not have been broken by that',
  (await preflight(TEAM_HQ)) === TEAM_HQ,
)
check(
  'and a page that is neither is refused',
  (await preflight('https://not-our-page.example.com')) !== 'https://not-our-page.example.com',
)

/*
  WHAT THE SESSION WAS GIVEN. The instructions are never echoed - the page must
  not be able to read or rewrite them - so the mint reports whether each brief
  was attached, which is what makes this checkable at all rather than assumed.
*/
const mint = async (body: unknown): Promise<Record<string, unknown>> => {
  const r = await fetch(MINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: PREVIEW },
    body: JSON.stringify(body),
  })
  const j = (await r.json()) as Record<string, unknown>
  /* The credential is never read, never logged and never returned from here. */
  return {
    ok: r.status === 200 && typeof j.client_secret === 'string',
    model: String(j.model ?? ''),
    context: (j.context ?? {}) as Record<string, unknown>,
    degraded: j.degraded === true,
  }
}
const withProject = await mint({ project: 'legacy-coaching-course' })
const withNone = await mint({})
check('a credential is minted', withProject.ok === true && withNone.ok === true)
check(
  'the office state of play is attached to every call',
  (withProject.context as Record<string, unknown>).state_of_play === true &&
    (withNone.context as Record<string, unknown>).state_of_play === true,
  JSON.stringify([withProject.context, withNone.context]),
)
check(
  'and the project in view is attached when the page says which one',
  (withProject.context as Record<string, unknown>).project_brief === true &&
    (withProject.context as Record<string, unknown>).project === 'legacy-coaching-course',
  JSON.stringify(withProject.context),
)
check(
  'while a call opened from nowhere in particular carries no project brief',
  (withNone.context as Record<string, unknown>).project_brief === false,
  JSON.stringify(withNone.context),
)
check(
  'the call is not degraded, so the team can actually be reached from it',
  withProject.degraded === false,
  JSON.stringify(withProject),
)

console.log(`\n${String(pass)}/${String(pass + fail)} passed`)
console.log(
  '\nREAL MEDIA, NOT A REAL PERSON: the speech is synthesised by espeak-ng and\n' +
    'posted over the network to the deployed function. A human speaking into a\n' +
    'handset is still the one thing no check in this repository can perform.\n' +
    '\nAND NOT PROVED HERE EITHER: that a minted credential completes a call with\n' +
    'OpenAI. This proves the office mints one, from the right origins, carrying\n' +
    'the right briefs.',
)
process.exit(fail === 0 ? 0 : 1)
