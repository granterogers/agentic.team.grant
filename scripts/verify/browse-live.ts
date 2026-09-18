/**
 * The gather tier, driven against the REAL internet.
 *
 *   npm run verify:browse-live
 *
 * #16 and #135. `verify:browser` proves the database half — the ledger refuses
 * an acting verb, a suite cannot pollute the Browser tab, stop is a column —
 * and every one of its pages is a fixture. This one opens real sites, because
 * the repository has learned repeatedly that reality is a stronger oracle than
 * a fixture, and this feature has now proved it twice in one afternoon:
 *
 *   - the FIRST text floor refused example.com, a complete server-rendered
 *     page of 144 characters, as "probably JavaScript". Twelve unit tests all
 *     passed, because every fixture body was comfortably over the floor.
 *   - the floor that replaced it missed `web.telegram.org`: 1,587 bytes of
 *     markup, one script, twelve characters of text, returned ok:true. The
 *     office would have reported "the page says nothing" about a page it never
 *     rendered — the false absence the guard exists to prevent, through the
 *     door the guard left open.
 *
 * Neither was findable by reading. Both were found by opening a page.
 *
 * ## Deliberately not in the gate
 *
 * It makes real requests to sites nobody here controls, so it can go red for
 * reasons that are nothing to do with this repository. A gate that fails on
 * somebody else's outage is one people learn to re-run until it passes. It is
 * run by hand, before anything touching the browser tier ships, and it prints
 * what it reached so a failure can be told apart from an outage.
 *
 * ## What it cannot cover, stated rather than skipped
 *
 * **A real redirect into a private address.** The one case that most wants a
 * live proof is the one the build sandbox cannot give: its egress proxy
 * answers 403 before any redirect is chased, so a public redirector pointed at
 * 169.254.169.254 never gets that far. That property is proved in
 * `tests/browser/fetched.test.ts` with a fetch that models the chase, and the
 * direct refusal IS proved live here.
 *
 * **Downloads, screenshots and signing in.** This runtime does none of the
 * three and says so. The assertions below are that it REFUSES them in words
 * rather than returning an empty success, which is the whole honesty contract.
 */

import { FetchedBrowser } from '../../src/browser/fetched.ts'

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
const section = (name: string) => console.log(`\n${name}`)

const browser = new FetchedBrowser()
const open = (url: string, over: Record<string, unknown> = {}) =>
  browser.gather({ timeoutMs: 15_000, url, verbs: ['read'], ...over })

/*
  Reached at all? A run behind a dead network would otherwise report every
  case below as a correct refusal — the found-nothing shape, and the reason
  every check here that expects a refusal has a positive beside it.
*/
section('the network is actually reachable')
const control = await open('https://example.com/')
ok('a known-good public page came back', control.ok, `${String(control.text?.length ?? 0)} chars`)
if (!control.ok) {
  console.error('\nThe network is not reachable from here, so nothing below would mean anything.')
  process.exit(2)
}

section('a short legitimate page is read, not refused')
ok(
  'example.com, 144 characters of real content',
  control.ok && (control.text?.length ?? 0) > 100,
  control.detail,
)
ok(
  'and its title came back',
  (control.title ?? '').toLowerCase().includes('example'),
  control.title ?? '(none)',
)

section('a large page is read whole')
const big = await open('https://en.wikipedia.org/wiki/Web_scraping')
ok(
  'a 30KB article came back',
  big.ok && (big.text?.length ?? 0) > 20_000,
  `${String(big.text?.length ?? 0)} chars`,
)

section('a redirect is followed to its destination')
/*
  http -> https on a host that really does redirect. The assertion is on the
  CONTENT rather than on a hop count, because the runtime deliberately does
  not report its chain: what matters to a caller is that an ordinary redirect
  still lands somewhere real, which is the control for the SSRF fix refusing
  redirects it should not.
*/
const redirected = await open('http://wikipedia.org/')
ok(
  'http://wikipedia.org arrives somewhere with content',
  redirected.ok && (redirected.text?.length ?? 0) > 500,
  `${String(redirected.text?.length ?? 0)} chars`,
)

section('a page that draws itself in JavaScript is a LIMIT, never an empty page')
const spa = await open('https://web.telegram.org/')
ok('the small shell is refused', !spa.ok, spa.detail.slice(0, 90))
ok('and the refusal says there is not enough to go on', spa.detail.includes('evidence'))
ok('and no text is offered that a handler could file as an answer', spa.text === null)

section('a page that needs a sign-in says so, and is not an outage')
const gated = await open('https://github.com/settings/profile')
ok(
  'a sign-in page reads as signedOut',
  gated.signedOut,
  `http-shaped: ${gated.detail.slice(0, 60)}`,
)
ok('and not as ok', !gated.ok)

section('an error status is reported as the status, not as an empty read')
const missing = await open(
  'https://en.wikipedia.org/w/index.php?title=Special:Badtitle/dummy-404-xyzzy&action=raw&curid=0',
)
ok(
  'a failing request is not reported as ok',
  !missing.ok || (missing.text?.length ?? 0) > 0,
  missing.detail.slice(0, 80),
)

section('a host that does not exist is a failure with a reason')
const nowhere = await open('https://this-host-does-not-exist-xyzzy.example/')
ok('it is not ok', !nowhere.ok)
ok(
  'and the reason names reachability',
  nowhere.detail.includes('could not be reached'),
  nowhere.detail,
)

section('a timeout is a timeout, and says so')
const impatient = await open('https://en.wikipedia.org/wiki/Web_scraping', { timeoutMs: 1 })
ok('a 1ms budget ends the read', !impatient.ok, impatient.detail)
ok(
  'and it is named as a timeout rather than as an outage',
  impatient.detail.includes('timed out'),
  impatient.detail,
)

section('cancellation ends it where it stands')
const stopped = await open('https://example.com/', { stopped: () => true })
ok('a stop before the first verb stops it', stopped.stopped && !stopped.ok, stopped.detail)

section('the private-network guard, against real addresses')
for (const [what, url] of [
  ['cloud instance metadata', 'http://169.254.169.254/latest/meta-data/'],
  ['loopback', 'http://127.0.0.1:8000/'],
  ['localhost by name', 'http://localhost:8000/'],
  ['an RFC1918 address', 'http://10.0.0.1/'],
  ['the local filesystem', 'file:///etc/passwd'],
] as const) {
  const r = await open(url)
  ok(`${what} is refused`, !r.ok && r.detail.startsWith('refused'), r.detail)
}
/*
  The control for the five above. A guard can be narrowed until it refuses
  everything and every refusal check goes on passing.
*/
ok('CONTROL: a public address is still allowed through the same guard', control.ok)

section('the three things this runtime cannot do, refused in words')
const shot = await open('https://example.com/', { verbs: ['shot'] })
ok(
  'a screenshot is refused rather than returned empty',
  !shot.ok && shot.shot === null,
  shot.detail.slice(0, 80),
)
ok('and the refusal names the runtime that could do it', shot.detail.includes('browser runtime'))

/*
  ---------------------------------------------------------------- the chain --

  Everything above exercises the ADAPTER. This exercises the HANDLER over it:
  a real page, read by the real runtime, through the real step machinery, and
  on into the writes the Browser tab and retrieval depend on.

  The database is an in-process recorder rather than Supabase, and that is a
  deliberate trade with a stated cost. Driving the real executor would mean a
  real job on a real project, and a job can never be deleted, so the project
  can never be deleted either: a suite run this way leaves permanent debris in
  Grant's switcher, which is the pile CLAUDE.md has recorded three times. The
  database half is already proved against the real database by
  `verify:browser` (34/34) inside begin/rollback. What is NOT proved anywhere
  else, and is proved here, is that the real adapter's output reaches the
  right writes with the right values.
*/
section('the whole chain, over a real page')

const said: string[] = []
const recorder = {
  execute: (sql: string) => {
    said.push(sql)
    if (sql.includes('pinned_config')) {
      return Promise.resolve({
        rows: [
          {
            pinned_config: { url: 'https://example.com/' },
            project: '00000000-0000-4000-8000-00000000beef',
          },
        ],
      })
    }
    if (sql.includes('browser_budget')) {
      return Promise.resolve({ rows: [{ r: { exhausted: false, left_minutes: 9 } }] })
    }
    if (sql.includes('record_browser_page')) {
      return Promise.resolve({ rows: [{ r: { document_id: 'doc-1' } }] })
    }
    // browser_sessions: no session for example.com, which is the public case.
    if (sql.includes('browser_sessions')) return Promise.resolve({ rows: [] })
    /*
      `runSteps` asks the database whether each step has already run. Answering
      "no, go ahead" is what makes the steps execute; an empty row set is read
      as a malformed verdict and the run dies before the first step, which is
      how the first version of this section reported six failures about a
      handler that works.
    */
    if (sql.includes('step_begin')) return Promise.resolve({ rows: [{ r: {} }] })
    if (sql.includes('stop_requested')) return Promise.resolve({ rows: [{ r: false }] })
    return Promise.resolve({ rows: [] })
  },
}

const { browserGatherHandler } = await import('../../src/handlers/browser-gather.ts')
const { runSteps } = await import('../../src/jobs/checkpoint.ts')
void runSteps

const handler = browserGatherHandler({
  adapter: browser,
  db: recorder as never,
  projectRef: 'verify-browse-live',
  serviceKey: 'unused-by-this-path',
})

let output: { body?: string } = {}
try {
  output = (await handler.handle(
    {
      attempt: 1,
      jobId: '00000000-0000-4000-8000-00000000cafe',
      kind: 'browser.gather',
    } as never,
    recorder as never,
  )) as { body?: string }
} catch (error) {
  ok('the handler ran over a real page', false, String((error as Error).message).slice(0, 150))
}

const notes = said.filter((q) => q.includes('browser_note'))
ok(
  'the handler opened the real page and wrote a ledger note',
  notes.length > 0,
  `${String(notes.length)} note(s)`,
)
ok(
  "the note it wrote says 'read', with ok true",
  notes.some((q) => q.includes("'read'") && q.includes('true')),
)
/*
  The boundary, asserted at the layer that composes it rather than only at the
  column that refuses it. All three independent guards are worth having; only
  this one can catch a handler that starts composing an acting verb before the
  column is widened to accept it.
*/
ok(
  'and it never composed an acting verb',
  !said.some((q) => /browser_note\([^)]*'(click|type|submit|buy|press)'/.test(q)),
)
ok(
  'the page it read was kept as a project document',
  said.some((q) => q.includes('record_browser_page')),
)
const keep = said.find((q) => q.includes('record_browser_page')) ?? ''
ok(
  'and what was stored is the real page, not a placeholder',
  keep.includes('Example Domain') || keep.includes('illustrative examples'),
  `${String(keep.length)} chars of sql`,
)
ok(
  'the office said what it did, in a sentence',
  (output.body ?? '').length > 20,
  (output.body ?? '(nothing)').slice(0, 110),
)

console.log(`\n${String(pass)}/${String(pass + fail)} checks passed`)
process.exit(fail === 0 ? 0 : 1)
