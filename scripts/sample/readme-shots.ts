/**
 * Captures the README gallery from the Sample Office (read only). Every name in it is fictional test data.
 *
 *   PLAYWRIGHT_BROWSERS_PATH=<scratch>/pw ALLOW_PRODUCTION_CHECKS=1 npx tsx scripts/sample/readme-shots.ts
 *
 * Writes docs/readme/shots/*.png at device scale 2 for the desktop and 2 for the phone, the way a person sees them.
 */
import { newPage, settle, signIn, startStudio } from './browser.ts'
import { session } from './lib.ts'

const OUT = 'docs/readme/shots'
const studio = await startStudio(4815)
const s = await session()

const shot = async (
  label: string,
  opts: { width: number; height: number; scheme?: 'light' | 'dark'; path: string; dock?: boolean; scale?: number },
) => {
  const { ctx, page, errors } = await newPage(studio, { width: opts.width, height: opts.height })
  await signIn(studio, page, s)
  await page.goto(`${studio.base}${opts.path}`, { waitUntil: 'domcontentloaded' })
  await settle(page)
  if (opts.scheme !== undefined) {
    await page.evaluate(`document.documentElement.dataset.scheme = '${opts.scheme}'`)
    await settle(page)
  }
  if (opts.dock === true) {
    await page.getByRole('button', { name: 'Chat with Team' }).first().click().catch(() => {})
    await settle(page)
  }
  await page.waitForTimeout(800)
  await page.screenshot({ path: `${OUT}/${label}.png` })
  await ctx.close()
  console.log(label, 'errors', errors.length)
}

await shot('project-desktop-light', { width: 1440, height: 900, scheme: 'light', path: '/p/wellness-studio-launch' })
await shot('project-desktop-dark', { width: 1440, height: 900, scheme: 'dark', path: '/p/wellness-studio-launch' })
await shot('chat-with-team', { width: 1440, height: 900, scheme: 'dark', path: '/p/wellness-studio-launch', dock: true })
await shot('my-tasks', { width: 1440, height: 900, scheme: 'dark', path: '/tasks' })
await shot('activity', { width: 1440, height: 900, scheme: 'dark', path: '/activity' })
await shot('services', { width: 1440, height: 900, scheme: 'dark', path: '/settings/connections' })
await shot('project-phone', { width: 390, height: 844, scheme: 'dark', path: '/p/wellness-studio-launch' })
await studio.close()
