/**
 * NotebookLM claims eleven things. Are any of them true?
 *
 *   npm run verify:notebook
 *
 * Issue #227. The backend readiness report of 14 September put this domain at
 * **None** — the only one of thirty with no suite at all.
 *
 * ## What this suite is NOT
 *
 * It is not an attempt to test the NotebookLM API, because there is not one.
 * ADR-0013 decided that deliberately: an unattended client would have to
 * impersonate a browser session, which is exactly what the ban named. Nothing
 * here logs in, drives a browser, or revives the sync.
 *
 * Grant's backend acceptance specification asks for the other thing, and the
 * distinction is its own sentence:
 *
 *   > Browser-only functionality is not programmatic capability.
 *
 * ## What it IS, and why it matters more than an API test would
 *
 * `public.connector_capabilities` already holds eleven NotebookLM rows, each
 * with a `reach` (`api` / `unofficial` / `browser_only` / `none`) and a
 * `verified_by` (`probe` / `suite` / `declared`). The data model the
 * specification asks for exists.
 *
 * **Nine of those rows say `verified_by = 'probe'`, and no probe runs.**
 *
 * That is `web.search` again, and CLAUDE.md records what it cost: a registry
 * row claimed a capability, `capabilityBrief` builds every agent's prompt from
 * that table, and all eight agents were told they could search the web with
 * nothing behind it. Being told YES about something impossible costs the work,
 * silently, and Grant finds out when nothing arrives.
 *
 * So the subject here is the CLAIM, not the connector. A claim that nothing
 * re-checks is a claim that rots, and this is the thing that re-checks it.
 */

import type { SqlExecutor } from '../../src/db/executor.ts'
import { ManagementApiExecutor } from '../../src/db/executor.ts'
import {
  type Capability,
  fingerprint,
  type NotebookAdapter,
  NotebookUnavailableError,
  UnavailableNotebookAdapter,
} from '../../src/notebook/adapter.ts'
import { LiveNotebookAdapter } from '../../src/notebook/live-adapter.ts'

const token = process.env.SUPABASE_ACCESS_TOKEN
if (token === undefined || token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is not set')
  process.exit(2)
}
const db: SqlExecutor = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  token,
)

let pass = 0
let fail = 0
const ok = (what: string, good: boolean, note = '') => {
  if (good) {
    pass++
    console.log(`  ok   ${what}${note === '' ? '' : ` — ${note}`}`)
  } else {
    fail++
    console.error(`  FAIL ${what}${note === '' ? '' : ` — ${note}`}`)
  }
}
const rows = async (sql: string): Promise<Record<string, unknown>[]> =>
  (await db.execute(sql)).rows as Record<string, unknown>[]
const one = async (sql: string): Promise<Record<string, unknown>> => (await rows(sql))[0] ?? {}
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
const run = Math.random().toString(36).slice(2, 10)

console.log('\nverify:notebook — what NotebookLM claims, and whether anything stands behind it\n')

// ---------------------------------------------------------------------------
console.log('the claims themselves')
// ---------------------------------------------------------------------------

const claims = await rows(`
  select verb, reach, verified_by,
         coalesce(to_char(last_verified,'YYYY-MM-DD'),'never') as last_verified,
         case when last_verified is null then null
              else (extract(epoch from (app.now_utc() - last_verified)) / 86400)::int end as age_days,
         coalesce(used_by,'') as used_by
    from public.connector_capabilities
   where connector = 'notebooklm'
   order by verb`)

ok(
  'the connector has capability rows at all, so agents are told something specific',
  claims.length > 0,
  `${String(claims.length)} claim(s)`,
)

for (const c of claims) {
  console.log(
    `       ${String(c.reach).padEnd(13)} ${String(c.verified_by).padEnd(9)} ${String(c.last_verified).padEnd(11)} ${String(c.verb)}`,
  )
}

/*
  A claim is either DECLARED — somebody wrote down a fact about the world, like
  "you cannot read another account's notebook" — or it was checked, and then it
  has to say when. The table already enforces this with a check constraint; what
  is asserted here is that the constraint is actually doing something, because a
  constraint nobody exercises is a comment.
*/
const undated = claims.filter((c) => c.verified_by !== 'declared' && c.last_verified === 'never')
ok(
  'every claim is either DECLARED, or checked and dated',
  undated.length === 0,
  undated.length === 0
    ? 'no undated probe claims'
    : `UNDATED: ${undated.map((c) => String(c.verb)).join(', ')}`,
)

/*
  Staleness, reported as a PROPERTY rather than a threshold nobody agreed.

  A count or a fixed number of days would go red on a correct change — CLAUDE.md
  has that correction four times. What matters is that the OLDEST checked claim
  is named, so a claim quietly rotting for a month is visible to a person
  reading the output rather than hidden inside an average.
*/
const checked = claims.filter((c) => c.verified_by !== 'declared' && c.age_days !== null)
const oldest = checked.reduce(
  (worst, c) => (Number(c.age_days) > Number(worst?.age_days ?? -1) ? c : worst),
  checked[0],
)
ok(
  'the oldest checked claim is named, so a claim that rots is visible',
  checked.length > 0,
  oldest === undefined
    ? 'nothing is checked — every claim is declared'
    : `oldest is ${String(oldest.age_days)} day(s): "${String(oldest.verb)}"`,
)

// ---------------------------------------------------------------------------
console.log('\nthe adapter, asked rather than assumed')
// ---------------------------------------------------------------------------

/*
  The probe, run for real. This is the check whose absence made this Issue.

  The adapter is RESOLVED the way `handlers/sync.ts` resolves it — from the
  vault, falling back to the unavailable one — rather than constructed here.
  That distinction is the whole difference between a suite and a tautology: a
  first draft of this file instantiated `UnavailableNotebookAdapter` directly
  and then asserted that it was unavailable, which is true by construction and
  says nothing about the office. It is also CLAUDE.md's most repeated trap — a
  verification that looks somewhere other than where the caller looks passes for
  the wrong reason, four instances on record.

  And resolving it properly immediately changed the answer, which is the whole
  argument in one run. It does NOT fall back — `LiveNotebookAdapter.fromVault`
  returns an adapter, so a credential exists. What that adapter then reports is

      Notebook is unavailable: Command failed: python3 scripts/notebook/...

  because the live path shells out to Python tooling that this environment has
  not been given (`npm run setup:python`, which `connection_health` already
  names as the action). Two of the four writes refuse with `degraded` and a
  better sentence still — *"addSource is not available on the read adapter"*.

  None of that is a defect in the adapter; it is the degradation path working
  exactly as §7 requires, and the reason it is worth writing down is that the
  hard-coded draft would have reported `auth_required` and been wrong about the
  state of the office in a way nobody would ever have checked.
*/
const live = await LiveNotebookAdapter.fromVault(db)
const adapter: NotebookAdapter = live ?? new UnavailableNotebookAdapter()
console.log(
  `       adapter resolved from the vault: ${live === null ? 'none — unavailable' : 'LIVE'}`,
)
let probed: Capability | null = null
let probeError = ''
try {
  probed = await adapter.probe()
} catch (error) {
  probeError = error instanceof Error ? error.message : String(error)
}

ok(
  'the adapter answers a probe rather than throwing',
  probed !== null,
  probed === null ? probeError.slice(0, 80) : `state=${probed.state} adapter=${probed.adapter}`,
)

/*
  §7: the adapter must report AUTH_REQUIRED rather than fail obscurely at a call
  site. "Obscurely" is the operative word — a thrown TypeError three frames deep
  is a defect even when the outcome is the same.
*/
ok(
  'and its state is one the office has a word for',
  probed !== null &&
    ['available', 'available_unofficial', 'degraded', 'unavailable', 'auth_required'].includes(
      probed.state,
    ),
  `state=${String(probed?.state)}`,
)

/*
  §11: never hard-code a quota. A null tier must stay null — replacing it with a
  documented default is the hard-coding the rule forbids, wearing a fallback's
  clothes. Asserted because a plausible default is exactly the change somebody
  makes to tidy a null away.
*/
ok(
  'an unread tier is NULL, not a plausible default',
  probed !== null && (probed.detectedTier === null || typeof probed.detectedTier === 'number'),
  `tier=${String(probed?.detectedTier)} notebookLimit=${String(probed?.notebookLimit)}`,
)

ok(
  'the probe detail carries no credential',
  probed !== null && !/xox|sb_secret|eyJ|AIza|Bearer /i.test(probed.detail),
  `detail="${String(probed?.detail).slice(0, 70)}"`,
)

// ---------------------------------------------------------------------------
console.log('\nrefusing, which is the behaviour that actually ships')
// ---------------------------------------------------------------------------

/*
  Every write refuses, and refuses NAMEABLY. This is not testing a stub: with no
  credential, refusing IS the correct behaviour, and shipping it as the default
  means the degradation path is exercised continuously rather than first
  discovered during an outage.

  A refusal for the wrong reason looks exactly like the rule working, so the
  error TYPE is asserted, not merely that something threw. CLAUDE.md records a
  check that passed twice while throwing for two entirely unrelated reasons.
*/
const writes: Array<[string, () => Promise<unknown>]> = [
  ['listSources', () => adapter.listSources('nb')],
  ['fetchSourceText', () => adapter.fetchSourceText('nb', 'src')],
  ['addSource', () => adapter.addSource('nb', 'https://example.com')],
  ['addNote', () => adapter.addNote('nb', 'title', 'body')],
]
for (const [name, call] of writes) {
  let kind = 'DID NOT THROW'
  let detail = ''
  try {
    await call()
  } catch (error) {
    kind = error instanceof NotebookUnavailableError ? 'NotebookUnavailableError' : 'wrong type'
    detail = error instanceof Error ? error.message : String(error)
  }
  ok(
    `${name} refuses with the office's own error, not an obscure throw`,
    kind === 'NotebookUnavailableError' && detail.length > 0,
    `${kind}${detail === '' ? '' : `: ${detail.slice(0, 60)}`}`,
  )
}

// ---------------------------------------------------------------------------
console.log('\nthe fingerprint, which is what stops a queued write happening twice')
// ---------------------------------------------------------------------------

const a1 = await fingerprint('addNote', { title: 'x', body: 'y' })
const a2 = await fingerprint('addNote', { title: 'x', body: 'y' })
const b = await fingerprint('addSource', { title: 'x', body: 'y' })
const c = await fingerprint('addNote', { title: 'x', body: 'z' })

ok('the same write twice fingerprints identically, so it collides rather than repeats', a1 === a2)
ok(
  'a DIFFERENT operation on identical content fingerprints differently',
  a1 !== b,
  'adding a note and adding a source are different intentions; one must not suppress the other',
)
ok('different content fingerprints differently', a1 !== c)

// ---------------------------------------------------------------------------
console.log('\nand nobody is told they can do the impossible')
// ---------------------------------------------------------------------------

/*
  The #64 direction, which is the expensive one.

  A row with reach `none` or `browser_only` describes something the office
  CANNOT do programmatically. If such a row were ever presented to an agent as a
  usable capability, the agent would promise Grant a thing that cannot happen —
  and he would find out when nothing arrived. `used_by` is the column that says
  something actually calls it, so a reach of none with a caller is the
  contradiction to hunt for.
*/
const impossible = claims.filter(
  (c) => (c.reach === 'none' || c.reach === 'browser_only') && String(c.used_by).trim() !== '',
)
ok(
  'nothing with reach none or browser_only claims a caller',
  impossible.length === 0,
  impossible.length === 0
    ? `${String(claims.filter((c) => c.reach === 'none' || c.reach === 'browser_only').length)} impossible claim(s), none wired`
    : `WIRED TO THE IMPOSSIBLE: ${impossible.map((c) => `${String(c.verb)} (${String(c.used_by)})`).join(', ')}`,
)

/*
  CONTROL, and the half that makes the check above worth having.

  A filter that finds nothing passes whether the rule holds or whether the rows
  simply are not there. So: the office must actually HAVE some impossible claims
  written down. ADR-0013 says sharing a notebook is browser-only and reading
  another account's notebook is flatly impossible — if those rows vanish, this
  suite has stopped testing anything and should say so rather than go green.
*/
const impossibleTotal = claims.filter(
  (c) => c.reach === 'none' || c.reach === 'browser_only',
).length
ok(
  'CONTROL: the impossible things are still written down, so the check above has subjects',
  impossibleTotal > 0,
  `${String(impossibleTotal)} claim(s) marked none or browser_only`,
)

/*
  And the honesty rule that generalises past this connector: no NotebookLM claim
  may say `api`, because there is no API. If one ever does, either ADR-0013 has
  been reversed — which is a decision, not a row edit — or somebody has
  mislabelled a browser capability as a programmatic one, which is precisely the
  sentence Grant's specification warns about.
*/
const pretendsApi = claims.filter((c) => c.reach === 'api')
ok(
  'no NotebookLM claim says api, because ADR-0013 says there is no API',
  pretendsApi.length === 0,
  pretendsApi.length === 0
    ? 'all unofficial, browser_only or none'
    : `CLAIMS AN API: ${pretendsApi.map((c) => String(c.verb)).join(', ')}`,
)

/*
  Nothing was written, so there is nothing to tear down — and saying so is the
  assertion. A suite that creates nothing cannot leave debris, which is worth
  stating for a connector whose ambiguity once produced three notebooks for one
  intention.
*/
const debris = await one(`
  select (select count(*)::int from public.projects
           where slug like 'untitled-notebook-%' and status <> 'archived') as loose`)
ok(
  'this suite writes nothing, and no loose notebook project appeared',
  Number(debris.loose) === 0,
  `${String(debris.loose)} unarchived untitled-notebook project(s)`,
)

// ---------------------------------------------------------------------------
// What the notebook HAS, including what Grant made himself (#260)
// ---------------------------------------------------------------------------

/*
  The gap this closes, and why it is not the API.

  `NotebookActions.artifacts()` has enumerated a notebook's generated outputs
  through the supported library all along, and `poll()` returns a URL for a
  finished one. What the office could not do is ADOPT: every row in
  `public.artifacts` was written by a job that generated one, so an audio
  overview Grant made himself in NotebookLM's own interface was invisible —
  and "give me all the audio overviews" is mostly a question about those.

  Driven at the database, inside a rollback, because the live path spends a
  NotebookLM quota and the properties worth asserting are all here: adoption,
  the no-fabricated-link rule, the kind filter, and the refusal to un-finish
  something already finished.
*/
console.log('\nadopting what the notebook made (#260)')

{
  const got = await one(`
    begin;
    insert into public.projects (name, slug, status)
    values (${lit(`Fixture artifacts ${run}`)}, ${lit(`fixture-artifacts-${run}`)}, 'paused');

    -- One Grant made, finished, with a link. One finished with NO link, which
    -- is the case NotebookLM produces for types it exposes no URL for.
    select app.record_notebook_artifact(
      (select project_id from public.projects where slug = ${lit(`fixture-artifacts-${run}`)}),
      ${lit(`nb-${run}`)}, 'a1', 'audio', 'An overview he made himself',
      'https://notebooklm.google.com/notebook/x', 'ready', null);
    select app.record_notebook_artifact(
      (select project_id from public.projects where slug = ${lit(`fixture-artifacts-${run}`)}),
      ${lit(`nb-${run}`)}, 'a2', 'mindmap', 'A mind map', null, 'ready', null);
    select app.record_notebook_artifact(
      (select project_id from public.projects where slug = ${lit(`fixture-artifacts-${run}`)}),
      ${lit(`nb-${run}`)}, 'a3', 'slides', 'A deck', null, 'generating', null);

    -- The listing later reports the finished one as pending, which a notebook
    -- does. It must not un-finish it: the CHECK would then strip the URL.
    select app.record_notebook_artifact(
      (select project_id from public.projects where slug = ${lit(`fixture-artifacts-${run}`)}),
      ${lit(`nb-${run}`)}, 'a1', 'audio', 'An overview he made himself', null, 'generating', null);

    select
      jsonb_array_length(app.artifacts_in(
        (select project_id from public.projects where slug = ${lit(`fixture-artifacts-${run}`)}))) as all_kinds,
      jsonb_array_length(app.artifacts_in(
        (select project_id from public.projects where slug = ${lit(`fixture-artifacts-${run}`)}),
        array['audio'])) as just_audio,
      (select state from public.artifacts where notebook_ref = ${lit(`nb-${run}`)} and external_ref = 'a1') as a1_state,
      (select url is not null from public.artifacts where notebook_ref = ${lit(`nb-${run}`)} and external_ref = 'a1') as a1_link,
      (select state from public.artifacts where notebook_ref = ${lit(`nb-${run}`)} and external_ref = 'a2') as a2_state,
      (select detail from public.artifacts where notebook_ref = ${lit(`nb-${run}`)} and external_ref = 'a2') as a2_detail,
      (select count(*) from public.artifacts
        where notebook_ref = ${lit(`nb-${run}`)} and requested_by_job is not null) as claimed_as_ours,
      (app.artifacts_in(
        (select project_id from public.projects where slug = ${lit(`fixture-artifacts-${run}`)}),
        array['mindmap']) -> 0 ->> 'openable') as mindmap_openable;
    rollback;
  `)

  ok(
    'an artifact the office never generated is adopted',
    Number(got.all_kinds) === 3,
    `${String(got.all_kinds)} artifact(s) in the project`,
  )
  ok(
    'and is not claimed as the office’s own work',
    Number(got.claimed_as_ours) === 0,
    `${String(got.claimed_as_ours)} row(s) with a job behind them`,
  )
  ok(
    'filtering by kind returns only that kind',
    Number(got.just_audio) === 1,
    `${String(got.just_audio)} audio of ${String(got.all_kinds)}`,
  )
  /*
    The Issue's own line: missing link capability is reported accurately rather
    than producing a fabricated link. A finished artifact with no URL is
    demoted and says why, because `artifacts_ready_has_a_link` would otherwise
    refuse the row outright and the whole listing would fail on one type.
  */
  ok(
    'a finished artifact with no link is not called ready, and says why',
    got.a2_state === 'generating' && String(got.a2_detail).includes('no link'),
    `${String(got.a2_state)} — ${String(got.a2_detail).slice(0, 60)}`,
  )
  ok(
    'and the reader says plainly that it cannot be opened',
    got.mindmap_openable === false || got.mindmap_openable === 'false',
    `openable: ${String(got.mindmap_openable)}`,
  )
  /*
    CONTROL. A later listing that reports a finished artifact as pending must
    not un-finish it — the CHECK would strip the URL and the office would lose
    a link it already had.
  */
  ok(
    'CONTROL: a later listing cannot un-finish something already finished',
    got.a1_state === 'ready' && (got.a1_link === true || got.a1_link === 't'),
    `${String(got.a1_state)}, link: ${String(got.a1_link)}`,
  )
}

console.log(`\n${String(pass)}/${String(pass + fail)} checks passed`)
if (fail > 0) process.exit(1)
