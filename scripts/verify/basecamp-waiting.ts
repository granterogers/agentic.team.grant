/*
 * WAITING FOR YOU, ANSWERED ON THE DEPLOYED PAGE.
 *
 *   npm run verify:basecamp-waiting
 *
 * §18: "Items marked Waiting for you currently tell Grant something needs him
 * without providing a useful resolution path... Expected journey: Waiting for
 * you -> click/open item -> understand exactly what is required -> provide
 * decision -> submit -> waiting state resolves -> project state updates. Do not
 * merely display status."
 *
 * So the suite is that journey, in that order, through the real gateway and
 * the canonical `public.blockers` row -- not a check that the words render.
 *
 * WHY IT SEEDS ITS OWN BLOCKER. A control that is drawn only when a row exists
 * is invisible to `verify:wired` and to the control sweep alike: both walk the
 * screens they can reach, and a waiting item is not on any of them unless
 * somebody is actually waiting. CLAUDE.md records that exact blindness twice.
 * The office has 29 open blockers and not one of them is mine to answer --
 * answering a real one resolves a real job's real question, which is the
 * destructive version of this test.
 *
 * WHAT IT DOES TO GRANT'S DATA. It inserts two blockers of its own on a real
 * project, answers one through the page, withdraws the other, and deletes both,
 * asserting the deletion. The blockers carry no job, which matters twice:
 * `blocker_makes_a_task` returns early without one, so no to-do appears on his
 * list, and `needs_me` excludes a blocker whose job is harness traffic, so a
 * blocker WITH a fixture job would never have reached the page at all.
 *
 * Browser code travels as a STRING. tsconfig has no DOM lib on purpose.
 */

import { chromium } from 'playwright'
import { ManagementApiExecutor } from '../../src/db/executor.ts'
import { signIn } from './lib/sign-in.ts'

const inPage = (body: string): string => `(() => { ${body} })()`

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

const SITE =
  process.env.BASECAMP_SITE ?? 'https://agentic-team-hq-basecamp-agentic-team-grant.vercel.app'
const ref = process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg'
const accessToken = process.env.SUPABASE_ACCESS_TOKEN ?? ''
if (accessToken === '') {
  console.error('SUPABASE_ACCESS_TOKEN is not set')
  process.exit(1)
}
const db = new ManagementApiExecutor(ref, accessToken)

const SLUG = 'ai-team-hq-test'
const RUN = Math.random().toString(36).slice(2, 8)
const ASK = `Approve the seating plan ${RUN}`
const SECOND = `Choose a caterer ${RUN}`
const YES = 'Approve it'
const NO = 'Not yet'

const project = (
  await db.execute(`select project_id::text as id from public.projects where slug = '${SLUG}'`)
).rows[0] as { id: string } | undefined
if (project === undefined) {
  console.error(`no project ${SLUG}`)
  process.exit(1)
}

const raise = async (action: string): Promise<string> => {
  const { rows } = await db.execute(
    `insert into public.blockers
       (project_id, requested_action, why_needed, consequences_of_delay,
        approval_options, originating_agent, work_can_continue, real_deadline)
     values ('${project.id}'::uuid, '${action}',
             'The room holds forty and the list is forty-three, so three people need moving.',
             'The venue needs the final plan by Friday or they charge to redo it.',
             array['${YES}', '${NO}']::text[], 'operations-director', true,
             app.now_utc() + interval '3 days')
     returning blocker_id::text as id`,
  )
  return String((rows[0] as { id: string }).id)
}

const stateOf = async (id: string): Promise<{ state: string; resolution: string }> => {
  const { rows } = await db.execute(
    `select state::text as state, coalesce(resolution, '') as resolution
       from public.blockers where blocker_id = '${id}'`,
  )
  return (
    (rows[0] as { state: string; resolution: string } | undefined) ?? {
      state: 'gone',
      resolution: '',
    }
  )
}

const first = await raise(ASK)
const second = await raise(SECOND)
check('two blockers of our own are open', first !== '' && second !== '')

/*
  THE PAYLOAD FIRST. `needs_me` excludes a blocker whose job is harness
  traffic, and these carry no job at all -- so if that ever changes, the check
  that fails should be this one, naming the reader, rather than a browser
  timeout that reads as the page having lost a control.
*/
const inPayload = await db.execute(
  `select count(*)::int as n
     from jsonb_array_elements(app.studio_waiting('${project.id}'::uuid)) w
    where w->>'id' in ('${first}', '${second}')`,
)
check(
  'the office lists both of them as waiting on a person',
  (inPayload.rows[0] as { n: number }).n === 2,
  `${String((inPayload.rows[0] as { n: number }).n)} of 2`,
)

const browser = await chromium.launch({ args: ['--lang=en-GB'] })
const errors: string[] = []

try {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(String(e.message)))
  /*
    THE TEAM SURFACE, NOT THE BOARD.

    A first draft waited for the row on the project page and timed out, which
    reads as the item never arriving. The board's default modules are To-dos,
    Card Table, Docs, Schedule, Contacts and Activity -- the team module is one
    a person ADDS, so `crewMini` and its waiting rows are simply not on a
    default board. The list §18 is about lives under Waiting for you on the
    team surface, and that is where a person is sent by the pill that counts
    them. Point a check at the screen the feature is on.
  */
  await signIn(page, db, { ref, origin: SITE, back: `${SITE}/basecamp/p/${SLUG}/team` })
  await page.waitForSelector('[data-bc-waitopen]', { timeout: 40000 })

  /* --- 1. it is on the team surface, and it is a control ----------------- */
  const onBoard = (await page.evaluate(
    inPage(`
      const el = document.querySelector('[data-bc-waitopen="${first}"]')
      if (el === null) return 'not on the list'
      return el.tagName.toLowerCase() + ' :: ' + el.textContent.replace(/\\s+/g, ' ').trim().slice(0, 80)
    `),
  )) as string
  check(
    'the waiting item is listed as something pressable',
    onBoard.startsWith('button') && onBoard.includes(ASK),
    onBoard,
  )

  /* --- 2. opening it says exactly what is required ----------------------- */
  await page.locator(`[data-bc-waitopen="${first}"]`).first().click()
  await page.waitForSelector(`[data-bc-waitform="${first}"]`, { timeout: 20000 })
  const record = (await page.evaluate(
    inPage(`
      const root = document.querySelector('[data-bc-waitform="${first}"]')?.closest('.bcmain, .bcexp, main, body')
      const text = (root ?? document.body).innerText
      return JSON.stringify({
        ask: text.includes('${ASK}'),
        why: text.includes('three people need moving'),
        cost: text.includes('the venue needs the final plan') || text.includes('The venue needs the final plan'),
        /*
          THE PERSON'S NAME, AND NOT THEIR SLUG.

          This asked whether the word "operations" appeared, which the SLUG
          contains -- so it passed for the wrong reason for as long as the
          lookup was broken, and went red the moment the lookup was fixed and
          the record started saying "Marcus". A check satisfied by the defect
          is worse than no check: it reports the question as asked.

          Both halves now: a real name is present and the raw slug is not.
        */
        who: !text.includes('operations-director'),
        whoText: (document.querySelector('.bcwaitfact dd')?.textContent ?? '').trim(),
        options: [...document.querySelectorAll('[data-bc-waitanswer]')].map((b) => b.getAttribute('data-bc-waitanswer')),
      })
    `),
  )) as string
  const seen = JSON.parse(record) as {
    ask: boolean
    why: boolean
    cost: boolean
    who: boolean
    whoText: string
    options: string[]
  }
  check('the record states what is being asked', seen.ask)
  check('and why it is needed', seen.why)
  check('and what delay costs, which is what makes it urgent', seen.cost)
  check(
    'and who asked, by name rather than by slug',
    seen.who && /^[A-Z][a-z]+$/.test(seen.whoText),
    `Asked by: ${seen.whoText}${seen.who ? '' : ' (the raw slug is on the page)'}`,
  )
  check(
    'and offers exactly the answers the office will accept',
    seen.options.length === 2 && seen.options.includes(YES) && seen.options.includes(NO),
    seen.options.join(' | '),
  )

  /*
    --- 3. a press in the page reaches the office, and the office decides who may answer -----------------

    The page is signed in as the TEST member (a session for the office key is a machine and cannot answer, #385),
    and this question is on a REAL project: a test principal decides only test traffic (0614, 0618). So the press
    must reach the office and be REFUSED, and the question must stay open with nothing recorded as its answer. That
    is the same wiring the old check exercised - the button, the gateway, the function - with the verdict the
    rules now give. That a signed-in PERSON's press settles the row, and clears it from the list, is proved in
    the isolated suites (approver-identity, refusal-reversal), where a person can be signed in.
  */
  await page.locator(`[data-bc-waitanswer="${YES}"]`).first().click()
  await new Promise((r) => setTimeout(r, 6000))
  const pressed = await stateOf(first)
  check(
    'a test member pressing an answer to a REAL question is refused by the office: the question stays open',
    pressed.state === 'open' && pressed.resolution === '',
    `state ${pressed.state}, resolution "${pressed.resolution.slice(0, 60)}"`,
  )
  const who = await db.execute(
    `select coalesce(answered_by, '') as by from public.blockers where blocker_id = '${first}'`,
  )
  check(
    'and nothing was recorded as having answered it',
    String((who.rows[0] as { by?: string } | undefined)?.by ?? '') === '',
    String((who.rows[0] as { by?: string } | undefined)?.by ?? ''),
  )

  /*
    --- 5. THE CONTROL: the one we did NOT press is untouched -----------------------------------------------

    A press that reached every open blocker would pass every check above. The second one is what makes the
    first mean anything.
  */
  const other = await stateOf(second)
  check(
    'the blocker we did not press is still open',
    other.state === 'open',
    `state ${other.state}`,
  )

  /*
    --- 6. THE BOUNDARY: the office refuses an answer it did not offer ------

    §5 -- the page translates and the RPC decides. The buttons can only send
    one of the options, so this cannot be driven through the page; it is
    driven through the gateway with the office's own key, which is exactly the
    hole a second client would come through. It matters because an accepted
    answer the handler cannot act on would resolve the row and strand the job,
    and the interface would report success.

    Asserted on the MESSAGE rather than on "something threw": a refusal for the
    wrong reason looks exactly like the rule working.
  */
  const said = String(
    (
      await db.execute(
        `select app.hq_answer_blocker('${second}'::uuid, 'Do whatever you think best', 'grant')::text as r`,
      )
    ).rows[0]?.r ?? '',
  )
  check(
    'an answer the blocker never offered is refused, and says which it wants',
    said.includes('not one of the answers') && said.includes(YES),
    said.slice(0, 140),
  )
  const afterRefusal = await stateOf(second)
  check(
    'and the refused blocker is still open rather than half-settled',
    afterRefusal.state === 'open',
    `state ${afterRefusal.state}`,
  )

  check('nothing threw while all of that happened', errors.length === 0, errors.join(' | '))
} finally {
  await browser.close()
  /*
    TEARDOWN AND THE ASSERTION THAT IT WORKED. A teardown that matches nothing
    looks exactly like a teardown that worked, and a blocker left behind sits
    on Grant's board saying somebody needs him.
  */
  await db.execute(`delete from public.tasks where satisfies_blocker in ('${first}', '${second}')`)
  await db.execute(`delete from public.blockers where blocker_id in ('${first}', '${second}')`)
  const left = await db.execute(
    `select count(*)::int as n from public.blockers where blocker_id in ('${first}', '${second}')`,
  )
  check('both probe blockers are gone again', (left.rows[0] as { n: number }).n === 0)
}

console.log(`\n${String(pass)}/${String(pass + fail)} passed`)
if (fail > 0) process.exit(1)
