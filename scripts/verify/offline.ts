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
const studio = ((await db.execute('select app.hq_studio() as d')).rows[0] as { d: unknown }).d

const server = createServer(async (rq, rs) => {
  let f = join('web/studio', decodeURIComponent((rq.url ?? '/').split('?')[0] ?? '/'))
  if (existsSync(f) && statSync(f).isDirectory()) f = join(f, 'index.html')
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
): Promise<{
  label: string
  say: string
  tone: string
  retry: boolean
  press: () => Promise<{ label: string; gone: boolean }>
  close: () => Promise<void>
}> => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  await page.addInitScript(`
    window.__S = ${JSON.stringify({ studio })};
    window.__MODE = ${JSON.stringify(mode)};
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
  await page.goto(`http://127.0.0.1:${String(PORT)}/`, { waitUntil: 'domcontentloaded' })
  // Longer than the page's own ten-second timeout, so the hang case resolves.
  await page.waitForTimeout(mode === 'hang' ? 12_000 : 2_500)

  const read = async (): Promise<{ label: string; say: string; tone: string; retry: boolean }> =>
    (await page.evaluate(`(() => {
      const bar = document.querySelector('.mockbar');
      if (bar === null) return { label: '(no strip)', say: '', tone: '', retry: false };
      return {
        label: bar.querySelector('b')?.textContent ?? '',
        say: bar.querySelector('span')?.textContent ?? '',
        tone: bar.className,
        retry: bar.querySelector('[data-retry-office]') !== null,
      };
    })()`)) as { label: string; say: string; tone: string; retry: boolean }

  if (process.env.SHOT === '1') {
    await page.screenshot({ path: `.out/offline-${mode}.png`, clip: { x: 0, y: 0, width: 1440, height: 420 } })
  }
  const now = await read()
  return {
    ...now,
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

await browser.close()
server.close()

const passed = checks.filter(Boolean).length
console.log(`\n${String(passed)}/${String(checks.length)} checks passed`)
if (passed !== checks.length) process.exit(1)
