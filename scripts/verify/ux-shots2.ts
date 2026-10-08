import '../../src/safety/arm.ts'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import { serveStudio } from './serve-studio.ts'

const label = process.argv[2] ?? 'chat'
const [w, h] = (process.argv[3] ?? '1440x900').split('x').map(Number) as [number, number]
await mkdir('.out/ux', { recursive: true })
const server = await serveStudio(4654)
const b = await chromium.launch()
const ctx = await b.newContext({ viewport: { width: w, height: h } })
const page = await ctx.newPage()
const errs: string[] = []
page.on('pageerror', (e) => errs.push(e.message))
await page.goto('http://127.0.0.1:4654/', { waitUntil: 'domcontentloaded' })
await page.click('[data-bc-menu]')
await page.locator('.bcmenulist .bcmenuitem').first().click()
await page.waitForSelector('[data-bc-board]')
await page.waitForTimeout(600)
await page.click('[data-bc-dock]')
await page.waitForTimeout(700)
await page.screenshot({ path: `.out/ux/${label}-${w}x${h}.png` })
console.log(errs.join('|') || 'no errors')
await b.close()
server.close()
