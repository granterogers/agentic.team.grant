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
import { mkdir, writeFile } from 'node:fs/promises'
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
const u = (p: string): string => `http://127.0.0.1:${String(PORT)}${p}`

const DEVICES: Record<string, { w: number; h: number; touch: boolean }> = {
  phone360: { w: 360, h: 740, touch: true },
  phone390: { w: 390, h: 844, touch: true },
  phone430: { w: 430, h: 932, touch: true },
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
const want = (g: string): boolean => only.size === 0 || only.has(g)

type Row = { surface: string; context: string; verdict: 'verified' | 'defect' | 'blocked'; findings: string[]; shot: string }
const rows: Row[] = []

const settle = (p: Page, ms = 500): Promise<void> => p.waitForTimeout(ms)

async function newPage(dev: string, scheme: string, palette: string, look: string, errors: string[]) {
  const d = DEVICES[dev] ?? { w: 1440, h: 900, touch: false }
  const ctx = await browser.newContext({ viewport: { width: d.w, height: d.h }, deviceScaleFactor: 1, hasTouch: d.touch, isMobile: d.touch, colorScheme: 'dark' })
  await ctx.addInitScript(`try { localStorage.setItem('studio.appearance', JSON.stringify({ palette: '${palette}', texture: 'concrete', own: null, ownName: '', scheme: '${scheme}', density: 'comfortable', look: '${look}', glass: '${glass}', depth: '${depth}' })) } catch {}`)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(e.message))
  return { ctx, page }
}

async function record(page: Page, surface: string, context: string, errors: string[], expect = '', extra: string[] = []): Promise<void> {
  const slug = `${surface}__${context}`.replace(/[^a-z0-9_.-]+/gi, '-').toLowerCase()
  const shot = `${OUT}/${slug}.png`
  await settle(page, 350)
  const opened = expect.startsWith('url:') ? new URL(page.url()).pathname.includes(expect.slice(4)) : expect === '' || (await page.locator(expect).first().isVisible().catch(() => false))
  if (!opened) { blocked(surface, context, `did not open (no visible ${expect})`); return }
  const a = (await page.evaluate(auditScript())) as { out: string[] }
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
      const go = async (p: string): Promise<void> => { await page.goto(u(p), { waitUntil: 'domcontentloaded' }); await settle(page, 700) }
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

      if (want('menus')) {
        await go(slug)
        if (await tryPress(page, '[data-bc-menu]')) { await record(page, 'burger-menu', context, errors, '.bcmenupanel:not([hidden])'); await page.keyboard.press('Escape'); await settle(page, 300) } else blocked('burger-menu', context, 'no [data-bc-menu] control')
        await go(slug)
        if (await tryPress(page, '[data-bc-menu]') && (await tryPress(page, '[data-bc-menu-new], .bcmenucreate'))) { await record(page, 'new-project-form', context, errors, '.bcnewproject'); await page.keyboard.press('Escape') } else blocked('new-project-form', context, 'no create control in the menu')
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
            if (DEVICES[dev]?.touch) await tryPress(page, '#settings [data-stg-back]')
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
