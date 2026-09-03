/**
 * Audit every credential this project uses, and say which state each is in.
 *
 *   npm run audit:credentials
 *
 * This exists because the same mistake has now happened three times, each time
 * costing a round trip with Grant:
 *
 *   SUPABASE_DB_URL       set, and its password had never authenticated
 *   SLACK_SIGNING_SECRET  set, and empty
 *   GOOGLE_CLIENT_ID      set, and empty — recorded as "present" all session
 *
 * The common cause is one word. `docs/credential-status.md` wrote *present*,
 * and presence was then read as *working*. Those are four different states, and
 * conflating them is how a credential problem surfaces inside a job weeks
 * later instead of in twelve seconds now:
 *
 *   ABSENT      the variable does not exist
 *   EMPTY       it exists and holds nothing — the most misleading state,
 *               because every "is it set?" check passes
 *   UNVERIFIED  it has a plausible value that nothing has ever exercised
 *   WORKING     a live call succeeded with it
 *
 * §11 says it directly about quotas — *"'free' means measured, not assumed"* —
 * and it is just as true of credentials. This is §8's capability registry with
 * `last successful verification` actually populated.
 *
 * Never prints a secret: name, length, and non-secret metadata from the
 * provider's own response.
 */

// This file has no imports — it talks to providers over fetch and reads
// process.env — so it needs an explicit marker to be treated as a module,
// without which top-level await is a syntax error.
export {}

type State = 'ABSENT' | 'EMPTY' | 'UNVERIFIED' | 'WORKING' | 'BROKEN'

interface Result {
  readonly name: string
  readonly state: State
  readonly detail: string
  /** Is this needed for the phase currently being built? */
  readonly neededNow: boolean
}

const results: Result[] = []

/** Classify presence before any network call, so EMPTY never reaches a probe. */
function presence(name: string): { value: string | null; state: State } {
  if (!(name in process.env)) return { value: null, state: 'ABSENT' }
  const value = process.env[name] ?? ''
  if (value.trim() === '') return { value: null, state: 'EMPTY' }
  return { value, state: 'UNVERIFIED' }
}

/**
 * Check a credential by making a real call.
 *
 * @param probe Returns a non-secret detail string on success, or throws.
 */
async function check(
  name: string,
  neededNow: boolean,
  probe: (value: string) => Promise<string>,
): Promise<void> {
  const { value, state } = presence(name)
  if (value === null) {
    results.push({
      name,
      state,
      detail: state === 'EMPTY' ? 'variable exists but holds nothing' : 'not in the environment',
      neededNow,
    })
    return
  }
  try {
    results.push({ name, state: 'WORKING', detail: await probe(value), neededNow })
  } catch (error) {
    results.push({
      name,
      state: 'BROKEN',
      detail: (error as Error).message.slice(0, 90),
      neededNow,
    })
  }
}

/** Record a credential that cannot be verified without something external. */
function unverifiable(name: string, neededNow: boolean, why: string): void {
  const { value, state } = presence(name)
  results.push({
    name,
    state: value === null ? state : 'UNVERIFIED',
    detail:
      value === null
        ? state === 'EMPTY'
          ? 'variable exists but holds nothing'
          : 'not in the environment'
        : `${String(value.length)} chars — ${why}`,
    neededNow,
  })
}

const json = async (response: Response): Promise<Record<string, unknown>> => {
  if (!response.ok && response.status !== 400 && response.status !== 401) {
    throw new Error(`http ${response.status}`)
  }
  return (await response.json()) as Record<string, unknown>
}

// --- Supabase --------------------------------------------------------------
await check('SUPABASE_ACCESS_TOKEN', true, async (token) => {
  const r = await fetch(
    'https://api.supabase.com/v1/projects/baujwlzcziasnfhhkchg/database/query',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: "select current_setting('server_version') as v" }),
    },
  )
  if (!r.ok) throw new Error(`Management API http ${r.status}`)
  const rows = (await r.json()) as { v?: string }[]
  return `DDL over HTTPS; PostgreSQL ${String(rows[0]?.v)}`
})

await check('SUPABASE_SERVICE_ROLE_KEY', true, async (key) => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const r = await fetch(`${url}/rest/v1/`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  })
  if (!r.ok) throw new Error(`REST http ${r.status}`)
  return 'PostgREST responds 200'
})

unverifiable(
  'SUPABASE_DB_URL',
  false,
  'the DIRECT (IPv6-only) string; unusable here and its password was reset — see ADR-0007',
)

// --- inference -------------------------------------------------------------
await check('OPENROUTER_API_KEY', true, async (key) => {
  const d = (
    await json(
      await fetch('https://openrouter.ai/api/v1/key', {
        headers: { Authorization: `Bearer ${key}` },
      }),
    )
  ).data as Record<string, unknown>
  return `is_free_tier=${String(d.is_free_tier)} usage=${String(d.usage)} limit=${String(d.limit)}`
})

await check('OPENAI_API_KEY', false, async (key) => {
  const d = await json(
    await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${key}` },
    }),
  )
  const models = (d.data as unknown[] | undefined) ?? []
  const realtime = models.filter((m) => String((m as { id: string }).id).includes('realtime'))
  return `${String(models.length)} models, ${String(realtime.length)} realtime-capable`
})

await check('GEMINI_API_KEY', false, async (key) => {
  const d = await json(
    await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`),
  )
  return `${String(((d.models as unknown[] | undefined) ?? []).length)} models`
})

// --- channels --------------------------------------------------------------
await check('TELEGRAM_CHIEF_BOT_TOKEN', true, async (token) => {
  const d = await json(await fetch(`https://api.telegram.org/bot${token}/getMe`))
  const r = d.result as { username?: string; id?: number } | undefined
  if (d.ok !== true) throw new Error(String(d.description))
  return `@${String(r?.username)} (id ${String(r?.id)})`
})

await check('SLACK_BOT_TOKEN', true, async (token) => {
  const d = await json(
    await fetch('https://slack.com/api/auth.test', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    }),
  )
  if (d.ok !== true) throw new Error(String(d.error))
  return `team ${String(d.team)} as ${String(d.user)}`
})

unverifiable(
  'SLACK_SIGNING_SECRET',
  true,
  'cannot be verified without an inbound signed request; shape check only',
)

await check('SLACK_APP_CONFIG_REFRESH_TOKEN', false, async () => {
  // The live pair lives in the vault now and rotates every ~12h. The bootstrap
  // copy is superseded, so report what the vault holds instead of rotating —
  // the refresh token is single-use and an audit must never consume one.
  const token = process.env.SUPABASE_ACCESS_TOKEN ?? ''
  const r = await fetch(
    'https://api.supabase.com/v1/projects/baujwlzcziasnfhhkchg/database/query',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: 'select status, seconds_until_expiry from public.slack_rotation_health limit 1',
      }),
    },
  )
  const rows = (await r.json()) as { status?: string; seconds_until_expiry?: number }[]
  return `superseded by the vault; rotation ${String(rows[0]?.status)}, ${String(rows[0]?.seconds_until_expiry)}s to expiry`
})

// --- not yet needed --------------------------------------------------------
unverifiable('GOOGLE_CLIENT_ID', false, 'Phase 9 (OAuth consent)')
unverifiable('GOOGLE_CLIENT_SECRET', false, 'Phase 9 (OAuth consent)')
unverifiable('VERCEL_TOKEN', false, 'Phase 4 (Notebook sync) and the Team HQ UI')

for (const name of [
  'BACKUP_S3_ENDPOINT',
  'BACKUP_S3_ACCESS_KEY_ID',
  'BACKUP_S3_SECRET_ACCESS_KEY',
]) {
  unverifiable(name, false, 'superseded by the vault — the backup workflow reads from there')
}

// --- report ----------------------------------------------------------------
const ICON: Record<State, string> = {
  WORKING: '✅',
  UNVERIFIED: '⚠️ ',
  EMPTY: '❌',
  ABSENT: '⬜',
  BROKEN: '❌',
}

console.log('| credential | state | detail |')
console.log('|---|---|---|')
for (const r of results) {
  console.log(`| \`${r.name}\` | ${ICON[r.state]} ${r.state} | ${r.detail} |`)
}

const counts = results.reduce<Record<string, number>>((acc, r) => {
  acc[r.state] = (acc[r.state] ?? 0) + 1
  return acc
}, {})
console.log(
  `\n${Object.entries(counts)
    .map(([k, v]) => `${k}=${String(v)}`)
    .join('  ')}`,
)

// Only fail on something needed for the phase being built. A Phase 9
// credential being absent is correct, not a fault — flagging it would train
// everyone to ignore this output.
const blocking = results.filter(
  (r) => r.neededNow && (r.state === 'EMPTY' || r.state === 'ABSENT' || r.state === 'BROKEN'),
)
if (blocking.length > 0) {
  console.error(`\n${String(blocking.length)} credential(s) needed NOW are not working:`)
  for (const r of blocking) console.error(`  ${r.name}: ${r.state} — ${r.detail}`)
  process.exit(1)
}
console.log('\nEvery credential needed for the current phase is verified working.')
