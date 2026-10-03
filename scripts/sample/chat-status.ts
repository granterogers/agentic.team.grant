/**
 * Team Chat carries a turn to its end: what the team is doing is shown while it works, and the answer arrives in the
 * conversation.   npm run sample:chat-status [label]     (no model is called, nothing is queued)
 *
 * Signed in as the Sample through the real page and the real gateway, with ONLY the chat's two moving parts replaced by a
 * scripted office: the `/turn` call (so no job is created and no model is spent) and the `turn_status` and `conversation`
 * reads. What is under test is the page: that each state the office reports is shown in words, that a state it did not
 * report is never invented, that a finished turn removes the status row and brings the answer into the thread, that a
 * failed one says so, and that a status read that fails shows nothing at all.
 *
 * The real reader (0874) is driven against real rows in `verify:sample-chat-status`'s SQL block below, so the page's
 * script is not the only evidence for the states: `app.turn_status` is asked about real jobs of the Sample office.
 */
import { mkdirSync } from 'node:fs'
import type { Page } from 'playwright'
import { newPage, signIn, startStudio } from './browser.ts'
import { rows, sampleOffice, session } from './lib.ts'

const label = process.argv[2] ?? 'now'
const out = `.out/chat-status-${label}`
mkdirSync(out, { recursive: true })
const O = (await sampleOffice()).officeId

const results: { what: string; ok: boolean; detail: string }[] = []
const check = (what: string, ok: boolean, detail = ''): void => {
  results.push({ what, ok, detail })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail === '' ? '' : ` — ${detail}`}`)
}
const sleep = (ms: number): Promise<void> => new Promise((ok) => setTimeout(ok, ms))
const eventually = async (cond: () => Promise<boolean>, ms = 30000): Promise<boolean> => {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await cond().catch(() => false)) return true
    await sleep(500)
  }
  return false
}

const studio = await startStudio(4795)
const s = await session()
const { page, errors } = await newPage(studio, { width: 1440, height: 1000 })

type Script = {
  /** the statuses the office reports, one per poll; the last repeats */
  statuses: (Record<string, unknown> | 'error')[]
  /** what the conversation holds once the work is done */
  answer: string
}
let script: Script = { statuses: [], answer: '' }
let polls = 0
let phase: 'working' | 'done' = 'working'

const JOB = '00000000-0000-4000-8000-0000000000aa'
await page.route('**/functions/v1/voice/turn', async (route) => {
  polls = 0
  phase = 'working'
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify({
      speak: 'Right — I have put that to the team. It takes a few minutes.',
      did: 'delegated',
      job_id: JOB,
    }),
  })
})
await page.route(/section=turn_status/, async (route) => {
  const step = script.statuses[Math.min(polls, script.statuses.length - 1)]
  polls += 1
  const cors = { 'access-control-allow-origin': '*' }
  if (step === 'error') {
    await route.fulfill({ status: 500, headers: cors, body: '{}' })
    return
  }
  if (step !== undefined && (step.state === 'done' || step.state === 'failed')) phase = 'done'
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: cors,
    body: JSON.stringify({
      data: { job_id: JOB, asked_at: new Date().toISOString(), outputs: [], ...step },
    }),
  })
})
// The office's record of the conversation: empty while the work goes on, the answer once it is done.
await page.route(/section=conversation/, async (route) => {
  const real = await route.fetch().catch(() => null)
  const body =
    real === null
      ? { data: [] }
      : ((await real.json().catch(() => ({ data: [] }))) as { data: unknown[] })
  const data = Array.isArray(body.data) ? body.data : []
  if (phase === 'done' && script.answer !== '') {
    data.push({
      message_id: 'scripted-answer',
      kind: 'answered',
      at: new Date().toISOString(),
      from: 'finance-director',
      name: 'Daniel',
      body: script.answer,
      job: JOB,
    })
  }
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify({ ...body, data }),
  })
})

const thread = async (p: Page): Promise<string> =>
  (
    await p
      .locator('[data-dockthread]')
      .innerText()
      .catch(() => '')
  ).replace(/\s+/g, ' ')

const ask = async (words: string): Promise<void> => {
  await page.goto(`${studio.base}/p/wellness-studio-launch`, { waitUntil: 'domcontentloaded' })
  await page.waitForLoadState('networkidle').catch(() => null)
  await sleep(3000)
  if (
    !(await page
      .locator('[data-docksay]')
      .isVisible()
      .catch(() => false))
  )
    await page.locator('[data-bc-dock]').first().click()
  await page.waitForSelector('[data-docksay]', { state: 'visible', timeout: 15000 })
  await page.fill('[data-docksay]', words)
  await page.locator('[data-dockform] button[type=submit]').click()
}

try {
  await signIn(studio, page, s)

  // ---- a turn that goes queued -> working -> waiting -> needs you -> done -------------------------------------------
  script = {
    statuses: [
      { state: 'queued', working: [] },
      { state: 'working', working: ['Daniel'] },
      { state: 'working', working: ['Daniel', 'Emma'] },
      { state: 'waiting', working: [], waiting_on: 'the venue to confirm the date' },
      { state: 'needs_you', working: [] },
      { state: 'done', working: [] },
    ],
    answer: 'The fit-out comes to 11,070 across six lines.',
  }
  await ask('What does the fit-out cost?')
  check(
    'the acknowledgement is shown at once',
    await eventually(async () => /put that to the team/i.test(await thread(page)), 20000),
  )
  const seen = new Set<string>()
  const watch = async (): Promise<void> => {
    const t = await thread(page)
    for (const [k, re] of [
      ['queued', /Waiting its turn/],
      ['one', /Daniel is working on it/],
      ['two', /Daniel and Emma are working on it/],
      ['waiting', /Waiting: the venue to confirm the date/],
      ['needs', /needs something from you/],
    ] as const)
      if (re.test(t)) seen.add(k)
  }
  const end = Date.now() + 60000
  while (Date.now() < end && !/11,070 across six lines/.test(await thread(page))) {
    await watch()
    await sleep(400)
  }
  await page.screenshot({ path: `${out}/answered.png` })
  check('"waiting its turn" was shown while queued', seen.has('queued'))
  check('one named specialist working was shown as "Daniel is working on it"', seen.has('one'))
  check('two named specialists were shown as "Daniel and Emma are working on it"', seen.has('two'))
  check('what it is waiting on was shown in the office’s own words', seen.has('waiting'))
  check('"needs something from you" was shown and points at Needs you', seen.has('needs'))
  const finalText = await thread(page)
  check(
    'the answer is IN the conversation when the work is done',
    /11,070 across six lines/.test(finalText),
  )
  check(
    'and the status row is gone (nothing says it is still working)',
    !/working on it|Waiting its turn|Waiting:|needs something from you/.test(finalText),
  )

  // ---- a turn that fails ----------------------------------------------------------------------------------------
  script = {
    statuses: [
      { state: 'working', working: ['Daniel'] },
      { state: 'failed', working: [] },
    ],
    answer: '',
  }
  await ask('Another question that will not work')
  check(
    'a failed turn says so, in words, and offers to ask again',
    await eventually(async () => /could not finish that/i.test(await thread(page)), 45000),
  )
  await page.screenshot({ path: `${out}/failed.png` })
  check('and the status row is gone', !/working on it/.test(await thread(page)))

  // ---- a status that cannot be read: nothing is invented ----------------------------------------------------------
  script = { statuses: ['error'], answer: '' }
  await ask('A question whose status cannot be read')
  await eventually(async () => /put that to the team/i.test(await thread(page)), 20000)
  await sleep(9000)
  const quiet = await thread(page)
  check(
    'a status read that fails shows NO status (it is neither working nor failed, so neither is said)',
    !/working on it|Waiting its turn|Waiting:|needs something from you|could not finish/.test(
      quiet.split('A question whose status cannot be read').at(-1) ?? '',
    ),
  )
  await page.screenshot({ path: `${out}/unreadable.png` })

  // ---- the real reader, against the Sample's real jobs -------------------------------------------------------------
  const real = (
    await rows(
      `select j.job_id::text id from public.jobs j where j.office_id = '${O}' and j.kind = 'office.instruction' and j.state = 'complete' and exists (select 1 from public.outputs o where o.job_id = j.job_id) order by j.created_at desc limit 1`,
    )
  )[0]?.id
  if (real !== undefined) {
    const st = (
      await rows(`select (app.turn_status('${O}'::uuid, '${String(real)}'::uuid))::text s`)
    )[0]?.s
    const parsed = JSON.parse(String(st)) as {
      state: string
      outputs: { body: string }[]
      live: number
    }
    check(
      'the real reader reports a finished Sample turn as done, with the words it wrote',
      parsed.state === 'done' &&
        parsed.live === 0 &&
        parsed.outputs.length > 0 &&
        parsed.outputs[0]?.body !== '',
      `${parsed.state}, ${parsed.outputs.length} output(s)`,
    )
  } else check('a finished Sample turn exists for the real reader to describe', false, 'none found')
  const foreign = (
    await rows(`select j.job_id::text id from public.jobs j where j.office_id <> '${O}' limit 1`)
  )[0]?.id
  const ours = (
    await rows(`select (app.turn_status('${O}'::uuid, '${String(foreign)}'::uuid)) is null as v`)
  )[0]?.v
  const missing = (
    await rows(
      `select (app.turn_status('${O}'::uuid, '00000000-0000-4000-8000-000000000000'::uuid)) is null as v`,
    )
  )[0]?.v
  check(
    'NEGATIVE: another office’s job and a job that does not exist answer the same way (null), so it is no oracle',
    foreign !== undefined && ours === true && missing === true,
  )
} finally {
  await studio.close()
}
const bad = errors.filter((e) => !/favicon|Failed to load resource|status of 500/i.test(e))
console.log(`\nerrors on the page: ${bad.length === 0 ? 'none' : bad.slice(0, 3).join(' || ')}`)
const failed = results.filter((r) => !r.ok)
console.log(
  `sample:chat-status ${label}: ${results.length - failed.length}/${results.length}   (images in ${out})`,
)
process.exitCode = failed.length === 0 && bad.length === 0 ? 0 : 1
