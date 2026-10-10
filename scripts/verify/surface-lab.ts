// biome-ignore-all lint/suspicious/noExplicitAny: browser objects inside page.evaluate
// biome-ignore-all format: a surface table, one surface per line reads better than the formatter's wrapping
/**
 * The surface lab (10-hour aesthetic sprint, 9 October 2026). Opens every reachable surface of Team HQ in real Chromium against
 * the local prototype office (no network, no production), captures it, and runs the programmatic checks a person would make by eye:
 *
 *   npx tsx scripts/verify/surface-lab.ts
 *   DEVICES=desktop,phone SCHEMES=dark,light PALETTES=slate,clay ONLY=settings,menus npx tsx scripts/verify/surface-lab.ts
 *
 * Per surface and context it records: horizontal overflow of the page, text clipped by its own box, elements that spill outside
 * their surface, touch targets under 44px (phone), type under 12px, hues of unrelated blue (a surface painted with a colour that
 * is neither the person's accent nor a state role), and page errors. It writes .out/surface-lab/matrix.json and matrix.md with a
 * verdict per surface: verified | defect | blocked, never a claimed 100%. A surface that could not be reached is `blocked` with
 * the reason, so an unreachable screen is named rather than omitted.
 */
import '../../src/safety/arm.ts'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { chromium, type Page } from 'playwright'
import { auditScript } from './lib/surface-audit.ts'
import { serveStudio } from './serve-studio.ts'

declare const document: any
declare const window: any
declare const getComputedStyle: any

const PORT = 4711
const OUT = process.env.OUT ?? '.out/surface-lab'
await mkdir(OUT, { recursive: true })
const server = await serveStudio(PORT)
const browser = await chromium.launch()

/*
  A signed-in person, without a real office: WRITER=1 starts a stand-in gateway (the contract canvas-devices uses) and the
  page is given a token, so controls drawn only for a writer (the new-project form, the first-run screen) can be opened.
*/
const AXE_ON = process.env.AXE === '1'
const AXE_SRC = AXE_ON ? await readFile('node_modules/axe-core/axe.min.js', 'utf8') : ''
const WRITER = process.env.WRITER === '1'
const API_PORT = 4717
let writerProjects = 1
let officeMode: 'ok' | 'no_office' | 'refused' = 'ok'
const office = WRITER
  ? createServer((req, res) => {
      const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,content-type', 'content-type': 'application/json' }
      req.resume()
      req.on('end', () => {
        if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return }
        const url = new URL(req.url ?? '/', 'http://x')
        const wantedSection = url.searchParams.get('section')
        if (req.method === 'GET' && wantedSection === 'studio' && officeMode !== 'ok') {
          res.writeHead(officeMode === 'refused' ? 401 : 403, cors)
          res.end(JSON.stringify(officeMode === 'refused' ? { error: 'refused' } : { error: 'no_office', can_create: true }))
          return
        }
        res.writeHead(200, cors)
        if (req.method === 'GET') {
          const section = url.searchParams.get('section')
          if (section === 'layout') { res.end(JSON.stringify({ data: { panels: null, rev: 0, now: Date.now() } })); return }
          if (section === 'studio') {
            const project = { slug: 'riverside', name: 'Riverside', purpose: 'A made-up project for the lab.', tasks: [], documents: [], contacts: [], sources: [], activity: [], waiting: [], modules: [], requests: [], layout_board: null }
            res.end(JSON.stringify({ data: { generated_at: new Date().toISOString(), crew: [{ slug: 'chief-of-staff', name: 'Claire', role: 'Chief of Staff', state: 'idle' }], projects: writerProjects === 0 ? [] : [project] } }))
            return
          }
          res.end(JSON.stringify({ data: [] }))
          return
        }
        res.end(JSON.stringify({ result: { ok: true } }))
      })
    })
  : null
if (office !== null) await new Promise<void>((r) => office.listen(API_PORT, '127.0.0.1', () => r()))
/* BASE points the whole lab at a HOSTED copy of the page (an isolated preview). Unset in every gate: the lab then serves the working tree. */
const u = (p: string): string => `${process.env.BASE ?? `http://127.0.0.1:${String(PORT)}`}${p}`

const DEVICES: Record<string, { w: number; h: number; touch: boolean }> = {
  phone360: { w: 360, h: 740, touch: true },
  phone390: { w: 390, h: 844, touch: true },
  phone430: { w: 430, h: 932, touch: true },
  phone390land: { w: 844, h: 390, touch: true },
  tablet768: { w: 768, h: 1024, touch: true },
  tablet1024: { w: 1024, h: 768, touch: false },
  laptop1280: { w: 1280, h: 800, touch: false },
  desktop1440: { w: 1440, h: 900, touch: false },
  wide1920: { w: 1920, h: 1080, touch: false },
}
const GROUPS: Record<string, string[]> = { phone: ['phone390'], desktop: ['desktop1440'], all: Object.keys(DEVICES) }
const pick = (v: string | undefined, d: string): string[] => (v ?? d).split(',').filter((s) => s !== '')
const devices = pick(process.env.DEVICES, 'phone390,desktop1440').flatMap((d) => GROUPS[d] ?? [d])
const schemes = pick(process.env.SCHEMES, 'dark,light')
const palettes = pick(process.env.PALETTES, 'slate')
const looks = pick(process.env.LOOKS, 'original')
const glass = process.env.GLASS ?? 'soft'
const depth = process.env.DEPTH ?? 'soft'
const only = new Set(pick(process.env.ONLY, ''))
const want = (g: string): boolean => (only.size === 0 && g !== 'writer' && g !== 'empty' && g !== 'auth') || only.has(g)

type Row = { surface: string; context: string; verdict: 'verified' | 'defect' | 'blocked'; findings: string[]; shot: string }
const rows: Row[] = []

/* SLOW multiplies every settle: a hosted copy answers slower than a local server, and a control looked for too early reads as absent. */
const SLOW = Number(process.env.SLOW ?? '1')
const settle = (p: Page, ms = 500): Promise<void> => p.waitForTimeout(ms * SLOW)

async function newPage(dev: string, scheme: string, palette: string, look: string, errors: string[], withToken = true) {
  const d = DEVICES[dev] ?? { w: 1440, h: 900, touch: false }
  const ctx = await browser.newContext({ viewport: { width: d.w, height: d.h }, deviceScaleFactor: 1, hasTouch: d.touch, isMobile: d.touch, colorScheme: 'dark' })
  await ctx.addInitScript(`try { localStorage.setItem('studio.appearance', JSON.stringify({ palette: '${palette}', texture: 'concrete', own: null, ownName: '', scheme: '${scheme}', density: 'comfortable', look: '${look}', glass: '${glass}', depth: '${depth}' })) } catch {}`)
  if (WRITER && withToken) await ctx.addInitScript(`window.HQ_API = 'http://127.0.0.1:${String(API_PORT)}/hq-api'; try { localStorage.setItem('hq.token', 'lab-writer') } catch {}`)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(e.message))
  return { ctx, page }
}

async function record(page: Page, surface: string, context: string, errors: string[], expect = '', extra: string[] = []): Promise<void> {
  const slug = `${surface}__${context}`.replace(/[^a-z0-9_.-]+/gi, '-').toLowerCase()
  const shot = `${OUT}/${slug}.png`
  await settle(page, 350)
  /* A colour measured half-way through a transition is a colour nobody sees at rest (a hosted page, which paints later, showed one): wait for every finite animation and transition to finish. */
  await page
    .waitForFunction(
      "document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getComputedTiming().iterations === Infinity)",
      undefined,
      { timeout: 900 },
    )
    .catch(() => null)
  const opened = expect.startsWith('url:') ? new URL(page.url()).pathname.includes(expect.slice(4)) : expect === '' || (await page.locator(expect).first().isVisible().catch(() => false))
  if (!opened) { blocked(surface, context, `did not open (no visible ${expect})`); return }
  const a = (await page.evaluate(auditScript())) as { out: string[] }
  if (AXE_ON) {
    await page.evaluate(AXE_SRC)
    const v = (await page.evaluate(`axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] } }).then((r) => r.violations.map((x) => x.id + ' (' + x.nodes.length + '): ' + x.nodes[0].target.join(' ').slice(0, 70)))`)) as string[]
    for (const x of v) a.out.push(`axe ${x}`)
  }
  await page.screenshot({ path: shot })
  const findings = [...a.out, ...extra, ...errors.splice(0).map((e) => `page error: ${e}`)]
  rows.push({ surface, context, verdict: findings.length === 0 ? 'verified' : 'defect', findings, shot })
  if (process.env.LIVE === '1') console.log(`${findings.length === 0 ? 'ok  ' : 'DEF '} ${surface} @ ${context}${findings.length ? ` - ${findings[0]}` : ''}`)
}
const blocked = (surface: string, context: string, why: string): void => {
  rows.push({ surface, context, verdict: 'blocked', findings: [why], shot: '' })
  if (process.env.LIVE === '1') console.log(`BLK  ${surface} @ ${context} - ${why}`)
}
const tryPress = async (page: Page, sel: string): Promise<boolean> => {
  const l = page.locator(sel).first()
  /* Give a control that is drawn after the board's first paint a moment to exist (a hosted page paints later); one that never comes is still absent. */
  if (SLOW > 1) await l.waitFor({ state: 'attached', timeout: 3000 }).catch(() => null)
  if ((await l.count()) === 0) return false
  await l.click({ force: true, timeout: 4000 }).catch(() => null)
  await settle(page, 350)
  return true
}

for (const dev of devices) {
  for (const scheme of schemes) {
    for (const palette of palettes) for (const look of looks) {
      const context = `${dev}-${scheme}-${palette}${look === 'original' ? '' : `-${look}`}`
      const errors: string[] = []
      const { ctx, page } = await newPage(dev, scheme, palette, look, errors)
      /* A page that redirects itself (a route with no project) can supersede the navigation: that is ERR_ABORTED, not a failure, and only a hosted copy is slow enough to show it. */
      const go = async (p: string): Promise<void> => { await page.goto(u(p), { waitUntil: 'domcontentloaded' }).catch((e: Error) => { if (!String(e.message).includes('ERR_ABORTED')) throw e }); await settle(page, 700) }
      await go('/basecamp')
      const slug = ((await page.evaluate(`document.querySelector('[data-bc-go^="/p/"]')?.dataset.bcGo ?? ''`)) as string) || '/p/riverside'

      if (want('pages')) {
        await go('/'); await record(page, 'home', context, errors)
        await go(slug); await record(page, 'project-board', context, errors)
        await go('/search'); await record(page, 'search', context, errors)
        await go('/tasks'); await record(page, 'my-tasks', context, errors)
        await go('/activity'); await record(page, 'activity', context, errors)
        await go(`${slug}/settings`); await record(page, 'project-settings', context, errors)
      }

      if (want('writer') && WRITER) {
        writerProjects = 1
        await go('/'); await record(page, 'home-writer', context, errors)
        if ((await tryPress(page, '[data-bc-menu]')) && (await tryPress(page, '[data-bc-menu-new]'))) await record(page, 'new-project-form', context, errors, '.bcnewproject:not([hidden])'); else blocked('new-project-form', context, 'writer mode but the project menu has no [data-bc-menu-new]')
        writerProjects = 0
        await go('/'); await record(page, 'first-run', context, errors, '.bcfirst')
        writerProjects = 1
      }

      if (want('menus')) {
        await go(slug)
        if (await tryPress(page, '[data-bc-menu]')) { await record(page, 'burger-menu', context, errors, '.bcmenupanel:not([hidden])'); await page.keyboard.press('Escape'); await settle(page, 300) } else blocked('burger-menu', context, 'no [data-bc-menu] control')
        await go('/')
        if (WRITER) { /* covered by the writer group */ } else if (await tryPress(page, '[data-bc-newproject-open]')) { await record(page, 'new-project-form', context, errors, '.bcnewproject:not([hidden])') } else blocked('new-project-form', context, 'the portfolio has no [data-bc-menu-new] in the prototype (needs a signed-in office)')
        await go(slug)
        await page.keyboard.press('Control+k'); await settle(page, 450)
        if ((await page.locator('#bcjump:not([hidden]) .bcjumphead').count()) > 0) { await record(page, 'jump-overlay', context, errors, '#bcjump .bcjumphead'); await page.keyboard.press('Escape') } else blocked('jump-overlay', context, 'Ctrl+K opened nothing')
        await go(slug)
        if ((await tryPress(page, '[data-bc-pagemenu]')) && (await tryPress(page, '[data-bc-look]'))) { await page.waitForSelector('.bdgrid', { timeout: 4000 }).catch(() => null); await record(page, 'background-picker', context, errors, '.bdgrid'); await page.keyboard.press('Escape') } else blocked('background-picker', context, 'no page menu or look control')
      }

      if (want('settings')) {
        await go(slug)
        if (await tryPress(page, '[data-bc-settings]')) {
          await page.waitForSelector('#settings .stg', { timeout: 6000 }).catch(() => null)
          await record(page, 'settings-index', context, errors, '#settings .stg')
          const tabs = (await page.evaluate(`[...document.querySelectorAll('#settings [data-setting]')].map((e) => e.dataset.setting)`)) as string[]
          for (const t of tabs) {
            if (await tryPress(page, `#settings [data-setting="${t}"]`)) await record(page, `settings-${t}`, context, errors, '#settings .stg')
            else blocked(`settings-${t}`, context, 'tab not pressable')
            /* Master and detail (a phone portrait) needs Back to the list; a two-pane layout (a landscape phone) keeps the list on screen, and its Back leaves Settings altogether. */
            if (DEVICES[dev]?.touch && !(await page.locator('#settings [data-setting]').first().isVisible().catch(() => false))) await tryPress(page, '#settings [data-stg-back]')
          }
        } else blocked('settings', context, 'no [data-bc-settings] control')
      }

      if (want('records')) {
        await go(slug); if (await tryPress(page, '.bcstage [data-cal-new]')) { await record(page, 'event-editor', context, errors, '.bccal2form'); await page.keyboard.press('Escape') } else blocked('event-editor', context, 'no new-event control')
        await go(slug); if (await tryPress(page, '.bcstage [data-bc-contact]')) { await record(page, 'contact-record', context, errors, 'url:/x/'); await page.keyboard.press('Escape') } else blocked('contact-record', context, 'no contact in the prototype')
        await go(slug); if (await tryPress(page, '.bcstage [data-bc-doc]')) { await record(page, 'document-viewer', context, errors, 'url:/x/'); await page.keyboard.press('Escape') } else blocked('document-viewer', context, 'no document in the prototype')
        await go(slug); if (await tryPress(page, '.bcstage [data-bc-task-open]')) { await record(page, 'task-record', context, errors, 'url:/x/'); await page.keyboard.press('Escape') } else blocked('task-record', context, 'no task in the prototype')
      }

      if (want('modules')) {
        await go(slug)
        const mods = (await page.evaluate(`[...document.querySelectorAll('.bcstage [data-mod]')].map((e) => e.dataset.mod)`)) as string[]
        for (const m of mods) {
          await go(slug)
          const btn = `.bcstage [data-mod="${m}"] [data-bc-expand], .bcstage [data-mod="${m}"] [data-expand]`
          if (await tryPress(page, btn)) { await record(page, `module-maximised-${m}`, context, errors, '.bcexp .bcexpbox'); await page.keyboard.press('Escape') } else blocked(`module-maximised-${m}`, context, 'no expand control')
        }
      }

      if (want('popovers')) {
        await go(slug)
        if (await tryPress(page, '[data-bc-pagemenu]')) { await record(page, 'page-menu', context, errors, '[data-bc-pagemenu-panel]:not([hidden])'); await page.keyboard.press('Escape') } else blocked('page-menu', context, 'no page menu control')
        await go(slug)
        if (await tryPress(page, '.bcstage [data-bc-tint]')) { await record(page, 'module-tint-popover', context, errors, '.bcpop'); await page.keyboard.press('Escape') } else blocked('module-tint-popover', context, DEVICES[dev]?.touch ? 'not offered on a phone: the arrangement controls are off there by design' : 'no tint control')
        await go(slug)
        if (await tryPress(page, '[data-bc-layouts]')) { await record(page, 'layouts-popover', context, errors, '.bcpop--layouts'); await page.keyboard.press('Escape') } else blocked('layouts-popover', context, DEVICES[dev]?.touch ? 'not offered on a phone: the arrangement controls are off there by design' : 'no layouts control')
        await go(slug)
        if (await tryPress(page, '[data-bc-attention]')) await record(page, 'attention', context, errors, 'url:/team'); else blocked('attention', context, 'no attention control')
        await go(slug)
        if (await tryPress(page, '.bcpostit')) await record(page, 'note-focused', context, errors, '.bcpostit'); else blocked('note-focused', context, DEVICES[dev]?.touch ? 'notes are not on the phone board' : 'no note')
      }

      if (want('empty') && WRITER) {
        writerProjects = 1
        await go('/p/riverside'); await record(page, 'empty-project-board', context, errors, '[data-bc-board]')
        if (await tryPress(page, '.bcstage [data-mod="tasks"] [data-bc-expand], .bcstage [data-mod="tasks"] [data-expand]')) await record(page, 'empty-tasks-maximised', context, errors, '.bcexp .bcexpbox'); else blocked('empty-tasks-maximised', context, 'no expand control on the empty project')
        await go('/p/riverside'); if (await tryPress(page, '.bcstage [data-mod="schedule"] [data-bc-expand], .bcstage [data-mod="schedule"] [data-expand]')) await record(page, 'empty-schedule-maximised', context, errors, '.bcexp .bcexpbox'); else blocked('empty-schedule-maximised', context, 'no expand control')
      }

      if (want('dialogs')) {
        const dialog = async (name: string, call: string): Promise<void> => {
          await go(slug)
          await page.evaluate(`import('/settings-ui.js').then((m) => { window.__dlg = ${call} })`)
          await page.waitForSelector('.stg-confirmbox', { timeout: 4000 }).catch(() => null)
          await record(page, name, context, errors, '.stg-confirmbox')
          await page.keyboard.press('Escape'); await settle(page, 300)
        }
        await dialog('confirm-dialog', `m.confirmDialog({ title: 'Move this document?', body: 'Move "WS01 - Legacy Opening Assessment" out of Legacy Coaching Course and into Wellness?', confirmLabel: 'Move it' })`)
        await dialog('confirm-dialog-danger', `m.confirmDialog({ title: 'Remove this automation?', body: '"Summarise anything new in the transcripts and say what changed." will be removed. Pausing it keeps it.', confirmLabel: 'Remove it', danger: true })`)
        await dialog('ask-dialog', `m.askDialog({ title: 'Why not?', body: 'The team is shown your reason, and so are you if it asks again.', label: 'Your reason (a sentence of at least eight characters)', confirmLabel: 'Decline' })`)
      }

      if (want('toasts')) {
        const toast = async (name: string, note: string): Promise<void> => {
          await go(slug)
          await page.evaluate(`import('/undo.js').then((m) => m.offer({ undo: 'lab-undo', note: ${JSON.stringify(note)} }, () => {}))`)
          await page.waitForSelector('#undobar:not([hidden]) .undoword', { timeout: 4000 }).catch(() => null)
          await record(page, name, context, errors, '#undobar:not([hidden])')
        }
        await toast('undo-bar', 'Renamed to Legacy Coaching Course')
        await toast('undo-bar-message', 'Could not undo that: the project was changed in the meantime')
        await page.evaluate(`document.getElementById('undobar').classList.add('bad')`)
        await record(page, 'undo-bar-error', context, errors, '#undobar.bad')
        await toast('undo-bar-long', 'Moved "WS01 - Legacy Opening Assessment" out of Legacy Coaching Course and into the Wellness project, with its three tags')
      }

      if (want('auth')) {
        /* The screens a person meets before they are in: each in a context of its own, because a token would take them past it. */
        const bare = async (name: string, path: string, mode: 'ok' | 'no_office' | 'refused', after?: () => Promise<void>, expect = '.bcentry'): Promise<void> => {
          officeMode = mode
          const fresh = await newPage(dev, scheme, palette, look, errors, mode !== 'ok')
          await fresh.page.goto(u(path), { waitUntil: 'domcontentloaded' })
          await settle(fresh.page, 900)
          if (after !== undefined) await after()
          await record(fresh.page, name, context, errors, expect)
          await fresh.ctx.close()
          officeMode = 'ok'
        }
        await bare('entry-sign-in', '/?welcome', 'ok')
        {
          officeMode = 'ok'
          const f = await newPage(dev, scheme, palette, look, errors, false)
          await f.page.goto(u('/?welcome'), { waitUntil: 'domcontentloaded' }); await settle(f.page, 900)
          await f.page.locator('[data-bc-entry-tab="create"]').click({ force: true }).catch(() => null); await settle(f.page, 400)
          await record(f.page, 'entry-create-account', context, errors, '[data-bc-entry-form="create"]')
          await f.ctx.close()
        }
        if (WRITER) {
          await bare('entry-signed-out-notice', '/?welcome', 'refused', undefined, '.bcentry')
          await bare('setup-office', '/', 'no_office', undefined, '[data-bc-setup-form]')
        }
      }

      if (want('chat')) {
        await go(slug)
        if (await tryPress(page, '[data-bc-chat], [data-bc-dock], .bcdocktoggle')) await record(page, 'chat-dock', context, errors, '.dock')
        else blocked('chat-dock', context, 'no dock toggle')
      }
      await ctx.close()
    }
  }
}
await browser.close()
server.close()
office?.close()

const by = (v: Row['verdict']): number => rows.filter((r) => r.verdict === v).length
await writeFile(`${OUT}/matrix.json`, JSON.stringify(rows, null, 1))
const md = [
  `# Surface lab matrix`, ``, `verified ${by('verified')} - defect ${by('defect')} - blocked ${by('blocked')} - of ${rows.length} (surface x context)`, ``,
  `| surface | context | verdict | first finding |`, `|---|---|---|---|`,
  ...rows.map((r) => `| ${r.surface} | ${r.context} | ${r.verdict} | ${(r.findings[0] ?? '').replace(/\|/g, '/').slice(0, 110)} |`),
].join('\n')
await writeFile(`${OUT}/matrix.md`, md)
console.log(`surface lab: verified ${by('verified')}, defect ${by('defect')}, blocked ${by('blocked')} of ${rows.length}`)
for (const r of rows.filter((x) => x.verdict !== 'verified')) console.log(`${r.verdict === 'defect' ? 'DEFECT ' : 'BLOCKED'} ${r.surface} @ ${r.context}: ${r.findings.slice(0, 3).join(' ; ')}`)
process.exit(0)
