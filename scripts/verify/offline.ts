/**
 * What the studio says when the office does not answer.
 *
 *   npm run verify:offline
 *
 * Issue #119. There was one strip and one wording, so **"you are not signed in"
 * and "the office is down" looked identical** — the first is normal and
 * expected, the second is an outage, and the more alarming state was wearing
 * the calmer label.
 *
 * ## Why this is a browser check and not a source one
 *
 * `verify:design` asserts the four states have words. That is worth having and
 * it is exactly the shape filed as #72 — a mechanism nobody calls. The question
 * this file answers is different and is the one that matters: **when a fetch
 * actually fails, does the page reach the state it has words for.**
 *
 * The failures are induced rather than waited for. The office is up; a check
 * that only reported the truth on a bad morning would never run on one.
 *
 * ## The retry has to work
 *
 * A "Try again" that does nothing is worse than no button, because it is
 * trusted — the same reasoning as #90's Disconnect. So the last case fails
 * once, presses it, succeeds, and requires the strip to be gone.
 */

import { existsSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join } from 'node:path'
import { chromium } from 'playwright'
import { ManagementApiExecutor } from '../../src/db/executor.ts'
import { namesAnOffice } from './lib/office-seam.ts'

const PORT = 4631
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.woff2': 'font/woff2',
  '.pdf': 'application/pdf',
}

const token = process.env.SUPABASE_ACCESS_TOKEN
if (token === undefined || token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}
const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  token,
)
// Real rows, so the good case is the real good case rather than a stub of one.
const studio = (
  (await db.execute('select app.hq_studio(app.operator_office()) as d')).rows[0] as {
    d: unknown
  }
).d

const server = createServer(async (rq, rs) => {
  let f = join('web/studio', decodeURIComponent((rq.url ?? '/').split('?')[0] ?? '/'))
  if (existsSync(f) && statSync(f).isDirectory()) f = join(f, 'index.html')
  // A dotless path is a route, as on the host (#382: the older studio is under /classic).
  if (!existsSync(f) && extname(f) === '') f = join('web/studio', 'index.html')
  if (!existsSync(f)) {
    rs.writeHead(404)
    rs.end('not here')
    return
  }
  rs.writeHead(200, { 'content-type': TYPES[extname(f)] ?? 'application/octet-stream' })
  rs.end(await readFile(f))
})
await new Promise<void>((r) => {
  server.listen(PORT, '127.0.0.1', () => {
    r()
  })
})

const checks: boolean[] = []
const check = (what: string, detail: string, ok: boolean): void => {
  checks.push(ok)
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what} — ${detail}`)
}

const browser = await chromium.launch()

/**
 * Open the studio with the office behaving in a chosen way.
 *
 * `mode` decides what every `hq-api` call does. Nothing reaches the network:
 * the shim answers, so an "outage" here is exact and instant rather than
 * simulated by unplugging something.
 */
const open = async (
  mode: 'live' | 'down' | 'refused' | 'hang' | 'recovers',
  hasToken: boolean,
  healthOverride: {
    stalled: number
    kinds: { kind: string; n: number; oldest_minutes: number }[]
  } | null = null,
  /*
    What `section=thinking` answers with (#240).

    Its own argument rather than part of the health override, because they
    arrive from different reads: the stalled queue rides on the studio payload
    and this is its own section, read again on every tick so an open breaker can
    close without a reload. Faking them together would test a path the product
    does not take.
  */
  cannotThink: { provider: string; said: string; next_probe_at?: string }[] = [],
): Promise<{
  label: string
  say: string
  tone: string
  retry: boolean
  page: import('playwright').Page
  press: () => Promise<{ label: string; gone: boolean }>
  close: () => Promise<void>
}> => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  // The page has to know which office it belongs to before its first line
  // runs, or the shim below never sees a URL with hq-api in it. ADR-0048.
  await page.addInitScript(namesAnOffice())

  await page.addInitScript(`
    window.__S = ${JSON.stringify({ studio })};
    window.__HEALTH = ${JSON.stringify(healthOverride)};
    if (window.__HEALTH !== null) window.__S.studio.health = window.__HEALTH;
    window.__MODE = ${JSON.stringify(mode)};
    window.__S.thinking = { cannot_think: ${JSON.stringify(cannotThink)} };
    try {
      ${hasToken ? "localStorage.setItem('hq.token', 'verify-offline')" : "localStorage.removeItem('hq.token')"};
    } catch (e) {}
    window.fetch = async (input, init) => {
      const url = String(input);
      if (!url.includes('hq-api')) {
        return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
      }
      const m = window.__MODE;
      if (m === 'down') throw new TypeError('Failed to fetch');
      if (m === 'refused') {
        return new Response('{"error":"unauthorized"}', { status: 401, headers: { 'content-type': 'application/json' } });
      }
      if (m === 'hang') {
        // Never settles unless the page's own AbortSignal fires, which is the
        // whole point: without a timeout the studio waits for the browser's
        // default and shows a blank page claiming nothing is wrong.
        return new Promise((_resolve, reject) => {
          const s = init && init.signal;
          if (s) s.addEventListener('abort', () => {
            const e = new Error('aborted'); e.name = 'TimeoutError'; reject(e);
          });
        });
      }
      // 'recovers' fails the first hq-api call and answers every one after it.
      if (m === 'recovers') { window.__MODE = 'live'; throw new TypeError('Failed to fetch'); }
      const section = /section=([a-z_]+)/.exec(url);
      return new Response(JSON.stringify({ data: section ? (window.__S[section[1]] ?? {}) : {} }),
        { status: 200, headers: { 'content-type': 'application/json' } });
    };
  `)
  await page.goto(`http://127.0.0.1:${String(PORT)}/classic/`, { waitUntil: 'domcontentloaded' })
  // Longer than the page's own ten-second timeout, so the hang case resolves.
  await page.waitForTimeout(mode === 'hang' ? 12_000 : 2_500)

  const read = async (): Promise<{ label: string; say: string; tone: string; retry: boolean }> =>
    (await page.evaluate(`(() => {
      const bar = document.querySelector('.mockbar:not(.stalledbar)');
      if (bar === null) return { label: '(no strip)', say: '', tone: '', retry: false };
      return {
        label: bar.querySelector('b')?.textContent ?? '',
        say: bar.querySelector('span')?.textContent ?? '',
        tone: bar.className,
        retry: bar.querySelector('[data-retry-office]') !== null,
      };
    })()`)) as { label: string; say: string; tone: string; retry: boolean }

  if (process.env.SHOT === '1') {
    await page.screenshot({
      path: `.out/offline-${mode}.png`,
      clip: { x: 0, y: 0, width: 1440, height: 420 },
    })
  }
  const now = await read()
  return {
    ...now,
    page,
    press: async () => {
      await page.evaluate(`document.querySelector('[data-retry-office]')?.click()`)
      await page.waitForTimeout(2_500)
      const after = await read()
      return { label: after.label, gone: after.label === '(no strip)' }
    },
    close: async () => {
      await context.close()
    },
  }
}

// --- 1. no token is normal, and reads as normal -----------------------------

const proto = await open('live', false)
check(
  'no token says it is the prototype, calmly',
  `${proto.label} — ${proto.say.slice(0, 56)}`,
  proto.label === 'Prototype data' && !proto.tone.includes('bad'),
)
check(
  'and offers no retry, because there is nothing to retry with',
  proto.retry ? 'a retry is offered' : 'no retry',
  !proto.retry,
)
await proto.close()

// --- 2. an outage does NOT read as normal -----------------------------------

const down = await open('down', true)
check(
  'a failed fetch says the office did not answer',
  `${down.label} — ${down.say.slice(0, 56)}`,
  down.label === 'The office did not answer',
)
/*
  The distinction this whole issue is about. Not "does it say something" — the
  old strip said something. Does it say something DIFFERENT from the calm case,
  and does it look different.
*/
check(
  'and it is not the same words as the prototype state',
  `"${down.label}" vs "${proto.label}"`,
  down.label !== proto.label && down.say !== proto.say,
)
check(
  'and it is not the same colour either',
  down.tone,
  down.tone.includes('bad') && !proto.tone.includes('bad'),
)
check('and it offers a retry', down.retry ? 'yes' : 'no', down.retry)
await down.close()

// --- 3. a fetch that never answers gives up ---------------------------------

const hung = await open('hang', true)
check(
  'a fetch that never answers gives up rather than hanging',
  `${hung.label} — ${hung.say.slice(0, 48)}`,
  hung.label === 'The office did not answer',
)
await hung.close()

// --- 4. a refused token is cleared, not retried forever ---------------------

const refused = await open('refused', true)
check(
  'a 401 says the token was refused, not that the office is down',
  `${refused.label} — ${refused.say.slice(0, 56)}`,
  refused.label === 'Signed out',
)
check(
  'and offers no retry, because retrying a dead token never recovers',
  refused.retry ? 'a retry is offered' : 'no retry',
  !refused.retry,
)
await refused.close()

// --- 5. the retry actually retries ------------------------------------------

/*
  The one that stops this being decoration. A "Try again" that does nothing is
  worse than no button, because it is trusted — the same reasoning as #90's
  Disconnect, and the same reason `verify:controls` measures a button rather
  than counting it.
*/
const recovers = await open('recovers', true)
check(
  'a first failure shows the outage strip',
  recovers.label,
  recovers.label === 'The office did not answer' && recovers.retry,
)
const after = await recovers.press()
check(
  'and pressing Try again brings the office back',
  after.gone ? 'the strip is gone' : `still showing "${after.label}"`,
  after.gone,
)
await recovers.close()

// --- 6. the office answering, and falling behind (#112) ---------------------

/*
  A DIFFERENT strip from every one above, and that is the point.

  Nine hourly jobs sat queued for eight hours with a green dashboard, because
  `office_health()` counted complete, failed and in-flight and a job nobody has
  taken is none of those. 0270 taught it to count them and 0271 put the number
  in the studio payload -- and a number in a payload that nothing draws is #72's
  shape, which is the failure this whole issue is a second instance of.

  So: the office answering perfectly, with a stalled queue behind it.
*/
const behind = await open('live', true, {
  stalled: 9,
  kinds: [{ kind: 'google.write_calendar_tasks', n: 9, oldest_minutes: 495 }],
})
const stalled = (await behind.page.evaluate(`(() => {
  const bar = document.querySelector('.stalledbar');
  if (bar === null) return { up: false, label: '', say: '', tone: '' };
  return {
    up: true,
    label: bar.querySelector('b')?.textContent ?? '',
    say: bar.querySelector('span')?.textContent ?? '',
    tone: bar.className,
  };
})()`)) as { up: boolean; label: string; say: string; tone: string }

check(
  'an office that is answering but falling behind says so',
  stalled.up ? `${stalled.label}` : 'NOTHING IS SHOWN',
  stalled.up && stalled.label === '9 jobs nobody has taken',
)
check(
  'and names the kind and the age, rather than only counting',
  stalled.say.slice(0, 72),
  stalled.say.includes('google.write_calendar_tasks') && stalled.say.includes('8 hours'),
)
/*
  Orange, not red. This is not an outage -- the office is right there -- and a
  strip that looks identical to the unreachable one teaches people to read both
  as the same thing, which is how the more alarming state ends up ignored.
*/
check(
  'and it does not wear the outage colour, because it is not an outage',
  stalled.tone,
  stalled.tone.includes('warnbar') && !stalled.tone.includes('bad'),
)
check(
  'and the calm prototype strip is not also up, so there is one message',
  behind.label,
  behind.label === '(no strip)',
)
await behind.close()

/*
  CONTROL. A healthy office must show nothing at all -- a check that only ever
  looks at the bad case cannot tell a working warning from one stuck on.
*/
const fine = await open('live', true, { stalled: 0, kinds: [] })
const quiet = (await fine.page.evaluate(
  `document.querySelector('.stalledbar') === null`,
)) as boolean
check('CONTROL: a healthy office shows no such strip', quiet ? 'nothing' : 'a strip is up', quiet)

/*
  And nothing about the model provider either, on the same healthy office.

  The issue is explicit that an empty list must add NOTHING: *"the common case
  is healthy and an always-present all-good pill is furniture."*
*/
const noThink = (await fine.page.evaluate(
  `document.querySelector('.thinkbar') === null`,
)) as boolean
check(
  'CONTROL: and nothing about the model provider when it is reachable',
  noThink ? 'nothing' : 'a strip is up',
  noThink,
)
await fine.close()

/* --- #240: the office cannot think --------------------------------------- */

/*
  The state that was invisible.

  `office_health()` has carried `cannot_think` since migration 0372 and nothing
  rendered it. While it was true, eighteen jobs failed in thirty minutes and the
  dashboard looked entirely normal - which is the worst shape a state can take,
  because a quiet office reads as an idle one. Idle means wait; this means
  investigate.
*/
const mute = await open('live', true, { stalled: 0, kinds: [] }, [
  {
    provider: 'openrouter',
    said: '429 Rate limit exceeded: free-models-per-day-high-balance.',
    next_probe_at: new Date(Date.now() + 40 * 60_000).toISOString(),
  },
])
await mute.page.waitForTimeout(700)
const cannot = (await mute.page.evaluate(`(() => {
  const bar = document.querySelector('.thinkbar')
  if (bar === null) return { up: false, label: '', say: '', tone: '', why: '', open: false }
  return {
    up: true,
    label: (bar.querySelector('b') || {}).textContent || '',
    say: (bar.querySelector('span') || {}).textContent || '',
    tone: bar.className,
    why: (bar.querySelector('.thinkwhy p') || {}).textContent || '',
    open: (bar.querySelector('details') || {}).open === true,
  }
})()`)) as { up: boolean; label: string; say: string; tone: string; why: string; open: boolean }

check(
  'a provider the office cannot reach is said so, on the page',
  cannot.up ? cannot.label : 'NOTHING IS SHOWN',
  cannot.up && cannot.label.includes('openrouter'),
)
check(
  'and it says what it means for the work, in a sentence',
  cannot.say.slice(0, 80),
  cannot.say.includes('Nothing it is asked can be answered'),
)
check(
  'and when it will try again, rather than leaving him to wonder',
  cannot.say.slice(-40),
  /tries again/.test(cannot.say),
)
/*
  Grant: *"The reason is operator detail - behind a disclosure, not in the
  headline."* Present, and shut.
*/
check(
  "and the provider's own words are behind a disclosure, not in the headline",
  cannot.open ? 'THE DISCLOSURE IS OPEN BY DEFAULT' : `shut, holding: ${cannot.why.slice(0, 44)}`,
  !cannot.open && cannot.why.includes('429') && !cannot.label.includes('429'),
)
check(
  'and it wears the outage colour, because it IS one',
  cannot.tone,
  cannot.tone.includes('badbar'),
)
await mute.close()

/*
  It clears itself. The issue requires this without a reload, and the strip is
  re-read on the same tick everything else is.
*/
const cleared = await open('live', true, { stalled: 0, kinds: [] }, [])
await cleared.page.waitForTimeout(700)
const gone = (await cleared.page.evaluate(
  `document.querySelector('.thinkbar') === null`,
)) as boolean
check(
  'and a provider that comes back takes the strip away with it',
  gone ? 'gone' : 'THE STRIP IS STUCK ON',
  gone,
)
await cleared.close()

await browser.close()
server.close()

const passed = checks.filter(Boolean).length
console.log(`\n${String(passed)}/${String(checks.length)} checks passed`)
if (passed !== checks.length) process.exit(1)
