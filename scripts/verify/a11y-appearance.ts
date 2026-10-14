/**
 * Accessibility of the appearance: axe-core (WCAG 2.0/2.1/2.2 A and AA) on each surface, in each scheme and width, from the
 * local build. Prints every violation with its rule, impact and the first affected element, so a contrast failure is named.
 *
 *   npx tsx scripts/verify/a11y-appearance.ts
 *
 * Reads only the local web/studio; contacts nothing outside this machine.
 */
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join } from 'node:path'
import { chromium } from 'playwright'

const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.woff2': 'font/woff2', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp' }
const server = createServer(async (req, res) => {
  const path = (req.url ?? '/').split('?')[0] ?? '/'
  const file = join('web/studio', extname(path) === '' ? 'index.html' : path.replace(/^\//, ''))
  try { res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }); res.end(await readFile(file)) } catch { res.writeHead(404); res.end() }
})
await new Promise<void>((r) => server.listen(4883, '127.0.0.1', () => r()))
const AXE = await readFile(join('node_modules', 'axe-core', 'axe.min.js'), 'utf8')
const browser = await chromium.launch()
const BASE = 'http://127.0.0.1:4883'
const SCREENS: [string, string][] = [
  ['entry', '/?welcome'],
  ['home', '/'],
  ['overview', '/p/legacy-coaching-course'],
  ['tasks', '/p/legacy-coaching-course/tasks'],
  ['documents', '/p/legacy-coaching-course/documents'],
  ['chat', '/p/legacy-coaching-course/chat'],
  ['schedule', '/p/legacy-coaching-course/schedule'],
  ['team', '/p/legacy-coaching-course/team'],
  ['activity', '/p/legacy-coaching-course/activity'],
]
const SCHEMES = [['light', 'light'], ['dark', 'dark']] as const
const WIDTHS = [['desktop', { width: 1440, height: 900 }], ['phone', { width: 390, height: 844 }]] as const
const total: Record<string, number> = {}
const rows: string[] = []
for (const [sname, scheme] of SCHEMES)
  for (const [wname, vp] of WIDTHS)
    for (const [name, path] of SCREENS) {
      const ctx = await browser.newContext({ viewport: vp, colorScheme: scheme })
      await ctx.addInitScript(`localStorage.setItem('studio.appearance', JSON.stringify({ v: 3, scheme: '${scheme}', palette: 'slate', look: 'porcelain' }))`)
      const page = await ctx.newPage()
      await page.goto(BASE + path, { waitUntil: 'load' })
      await page.waitForTimeout(1500)
      await page.addScriptTag({ content: AXE })
      const result = (await page.evaluate(`(async () => { const r = await axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] }); return r.violations.map(v => ({ id: v.id, impact: v.impact, n: v.nodes.length, target: (v.nodes[0] && v.nodes[0].target.join(' ')) || '', help: v.help })) })()`)) as { id: string; impact: string; n: number; target: string; help: string }[]
      for (const v of result) {
        total[v.impact ?? 'none'] = (total[v.impact ?? 'none'] ?? 0) + v.n
        rows.push(`${sname} ${wname} ${name}: ${v.impact} ${v.id} x${v.n} (${v.help}) at ${v.target.slice(0, 90)}`)
      }
      if (result.length === 0) rows.push(`${sname} ${wname} ${name}: clean`)
      await ctx.close()
    }
console.log(rows.join('\n'))
console.log('TOTAL affected nodes by impact:', JSON.stringify(total))
await browser.close()
server.close()
process.exit(0)
