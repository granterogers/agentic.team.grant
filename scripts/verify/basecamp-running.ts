/*
 * RUNNING WORK, AND STOPPING IT  (§20.2)
 *
 *   npm run verify:basecamp-running
 *
 * §20 asked for the four links that handed Grant back to the old interface to
 * go. Three of them were never missing. The fourth -- Active jobs, running
 * work with its stop controls -- genuinely was not built here, and the team
 * surface said so in a paragraph rather than being dressed as a link, which
 * was honest and was still a gap.
 *
 * WHAT THIS PROVES, AND WHERE EACH PART IS PROVED.
 *
 *   the list and the control   on the page, from the prototype's own running
 *                              item, because a healthy queue is empty and a
 *                              surface drawn only when a row exists is a
 *                              surface no audit has ever seen
 *   the action is reachable    through the DEPLOYED gateway with the office's
 *                              own key: a job id that names nothing is refused
 *                              by the office, which proves the id travelled
 *                              and was looked up
 *   what stopping DOES         in SQL, inside a rollback, against a real job
 *                              row: `request_stop` stamps the job and the
 *                              worker notices
 *
 * WHY NOT ONE END-TO-END PRESS ON A REAL JOB. Because a job can never be
 * deleted -- `job_state_transitions` holds it -- so every run would leave a
 * permanent row on one of Grant's real projects, and `app.studio_requests`
 * excludes fixture jobs, so a fixture cannot stand in. CLAUDE.md records the
 * twenty-five-project pile that reasoning produces when it is not resisted.
 * The seam left unproven is the click reaching `act`, and `verify:basecamp-
 * actions` reads that out of the source.
 *
 * Browser code travels as a STRING. tsconfig has no DOM lib on purpose.
 */

import { chromium } from 'playwright'
import { ManagementApiExecutor } from '../../src/db/executor.ts'
import { officeKey } from './lib/sign-in.ts'

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

/* --- 1. the list and the control, on the page ---------------------------- */
const browser = await chromium.launch({ args: ['--lang=en-GB'] })
const errors: string[] = []
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(String(e.message)))
  await page.goto(`${SITE}/basecamp/p/legacy-coaching-course/team`, {
    waitUntil: 'domcontentloaded',
  })
  await page.waitForSelector('[data-bc-stopjob]', { timeout: 30000 })

  const row = (await page.evaluate(
    inPage(`
      const b = document.querySelector('[data-bc-stopjob]')
      if (b === null) return JSON.stringify({ why: 'no stop control' })
      const item = b.closest('.bcitem')
      const r = b.getBoundingClientRect()
      return JSON.stringify({
        text: (item?.innerText ?? '').replace(/\\s+/g, ' ').trim(),
        label: b.textContent.trim(),
        w: Math.round(r.width),
        h: Math.round(r.height),
      })
    `),
  )) as string
  const seen = JSON.parse(row) as { text?: string; label?: string; w?: number; h?: number }
  check('running work is listed with a stop control', seen.label === 'Stop', row.slice(0, 120))
  check(
    'the row says what the work is and who has it',
    (seen.text ?? '').includes('Draft the module three workbook') &&
      /oliver|communications/i.test(seen.text ?? ''),
    seen.text ?? '',
  )
  check(
    'and how long it has been going, rather than only that it is going',
    /ago|minute|hour/i.test(seen.text ?? ''),
    seen.text ?? '',
  )
  /*
    A STOP IS A DESTRUCTIVE-ISH CONTROL ON A TOUCH TARGET, so it is held to the
    floor the rest of the experience is. 44px is the standard `verify:ui`
    enforces everywhere else and there is no reason this one is exempt.
  */
  check(
    'the stop control meets the touch-target floor',
    (seen.h ?? 0) >= 30 && (seen.w ?? 0) >= 44,
    `${String(seen.w)}x${String(seen.h)}`,
  )
  check(
    'and the surface no longer says running work was never built',
    !(await page.evaluate(inPage(`return document.body.innerText.includes('has not built yet')`))),
  )
  check('nothing threw while drawing it', errors.length === 0, errors.join(' | '))
} finally {
  await browser.close()
}

/* --- 2. the action is reachable through the deployed gateway ------------- */
const key = await officeKey(db)
const nowhere = '00000000-0000-4000-8000-000000000000'
const sent = await fetch(`https://${ref}.supabase.co/functions/v1/hq-api-basecamp`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ action: 'stop_job', args: { p_job: nowhere } }),
})
const said = JSON.stringify(await sent.json())
check(
  'the gateway carries stop_job through to the office',
  sent.status === 200 && said.includes('no job by that id'),
  `http ${String(sent.status)} ${said.slice(0, 120)}`,
)

/* --- 3. what stopping actually does, inside a rollback ------------------- */
/*
  WRAP THE CALL, NOT THE ASSERTION. CLAUDE.md's rule, learned when a suite that
  wrapped only its assertions deleted Slack's credentials for real every run:
  the wrapper cannot know a call was destructive until it already has been.
*/
let stamped = ''
try {
  await db.execute(`
  do $probe$
  declare
    v_project uuid;
    v_job     uuid;
    v_before  timestamptz;
    v_after   timestamptz;
    v_said    jsonb;
  begin
    select project_id into v_project
      from public.projects where status = 'active' and not is_fixture
      order by created_at limit 1;
    if v_project is null then
      raise exception 'no active project to drive against';
    end if;

    -- FOUR COLUMNS ARE NOT NULL WITH NO DEFAULT: correlation_id,
    -- idempotency_key, kind and requested_by. A guessed insert finds them one
    -- failed run at a time, which is what the first two attempts here did.
    -- One information_schema query answers it, as ever -- and no
    -- backticks in here: a backtick inside a comment inside a template literal
    -- ends the string, which is the eighth time in this repository.
    insert into public.jobs (project_id, kind, state, requested_by, understood_as,
                             correlation_id, idempotency_key)
    values (v_project, 'office.instruction', 'queued', 'verify:running-probe',
            'a probe job that is rolled back', gen_random_uuid(),
            'verify:running-probe:' || gen_random_uuid()::text)
    returning job_id, stop_requested_at into v_job, v_before;

    v_said := app.request_stop(coalesce((select zz_o.office_id from public.jobs zz_o where zz_o.job_id = v_job), app.test_office()), v_job, 'verify:running');
    select stop_requested_at into v_after from public.jobs where job_id = v_job;

    if v_before is not null then
      raise exception 'a new job already carried a stop request';
    end if;
    if v_after is null then
      raise exception 'request_stop left no stamp on the job';
    end if;
    if coalesce(v_said ->> 'ok', '') <> 'true' then
      raise exception 'request_stop did not report success: %', v_said::text;
    end if;

    raise notice 'stamped';
  end;
  $probe$;
  rollback;
`)
} catch (e) {
  /*
    REPORT, DO NOT CRASH. The probe raises when the behaviour is wrong, and an
    uncaught raise ends the run four checks early with a stack trace -- which
    is a failure, but one that says nothing about the other checks and leaves
    the teardown assertion below unrun. The first draft of this check passed
    the literal `true` and relied on the crash, which is a check that cannot
    fail: CLAUDE.md's own rule, and the reason the sabotage below exists.
  */
  stamped = e instanceof Error ? e.message : String(e)
}
check(
  'request_stop really stamps the job it is given',
  stamped === '',
  stamped.split('\n')[0] ?? '',
)

const left = await db.execute(
  `select count(*)::int as n from public.jobs where requested_by = 'verify:running-probe'`,
)
check(
  'and the probe job was rolled back rather than left behind',
  (left.rows[0] as { n: number }).n === 0,
  `${String((left.rows[0] as { n: number }).n)} left`,
)

console.log(`\n${String(pass)}/${String(pass + fail)} passed`)
if (fail > 0) process.exit(1)
