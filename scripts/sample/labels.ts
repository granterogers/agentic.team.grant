/**
 * No internal owner key reaches an ordinary screen (#418). Read-only, spends nothing.
 *   npm run sample:labels
 *
 * The person's own key (the string `app.office_actor` returns, for the Sample "p4-second-person") is provenance: it is
 * stored and it travels in the audit trail. It is not what a person should read. The property asserted, on the readers and
 * on the page: that key, and the way a screen would humanise it ("P4 second person"), appear nowhere; and where the person
 * did the thing, the screen says "you". The positive control matters as much as the negative: a reader that returned
 * nothing at all would also pass the negative.
 */
import { mkdirSync } from 'node:fs'
import { closeSettings, newPage, openSettings, settle, signIn, startStudio } from './browser.ts'
import { lit, rows, sampleOffice, session } from './lib.ts'

const out = '.out/labels'
mkdirSync(out, { recursive: true })
let failed = 0
const check = (what: string, ok: boolean, detail = ''): void => {
  if (!ok) failed += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail === '' ? '' : ` - ${detail}`}`)
}

const office = (await sampleOffice()).officeId
const key = String((await rows(`select app.office_actor(${lit(office)}::uuid) k`))[0]?.k ?? '')
if (key === '' || !key.includes('-')) throw new Error(`unexpected owner key "${key}"`)
const spoken = (() => {
  const t = key.replace(/[-_]+/g, ' ').trim()
  return t.charAt(0).toUpperCase() + t.slice(1)
})()
console.log(`owner key "${key}", as a screen would humanise it "${spoken}"`)

const mentions = (text: string): string[] =>
  [key, spoken].filter((k) => text.toLowerCase().includes(k.toLowerCase()))

// 1. The readers.
const projects = (
  await rows(
    `select project_id::text id from public.projects where office_id = ${lit(office)}::uuid and status = 'active' and not is_fixture and slug <> 'unnamed'`,
  )
).map((r) => String(r.id))
// The jsonb text itself, never re-encoded: a second JSON.stringify escapes the quotes the checks below look for.
const gov = String(
  (await rows(`select app.hq_governance(${lit(office)}::uuid, 60)::text d`))[0]?.d ?? '',
)
const lately = String(
  (await rows(`select app.hq_studio_lately(${lit(office)}::uuid, 60)::text d`))[0]?.d ?? '',
)
let projectActivity = ''
for (const id of projects)
  projectActivity += String(
    (await rows(`select app.studio_activity(${lit(id)}::uuid, 60)::text d`))[0]?.d ?? '',
  )
check('Governance carries no owner key', mentions(gov).length === 0, mentions(gov).join(','))
check(
  'home Latest activity carries no owner key',
  mentions(lately).length === 0,
  mentions(lately).join(','),
)
check(
  'project Latest activity carries no owner key',
  mentions(projectActivity).length === 0,
  mentions(projectActivity).join(','),
)
const whoYou = (s: string): boolean => /"who":\s*"you"/.test(s)
check(
  'positive control: the person is "you" where they did it (governance or activity)',
  whoYou(gov) || whoYou(lately) || whoYou(projectActivity),
  `gov ${whoYou(gov)}, lately ${whoYou(lately)}, project ${whoYou(projectActivity)}`,
)

// 2. The page.
const studio = await startStudio(4797)
const s = await session()
try {
  const { page, errors } = await newPage(studio, { width: 1440, height: 1000 }, false)
  await signIn(studio, page, s)
  const seen: string[] = []
  const scan = async (label: string): Promise<void> => {
    const text = String(await page.evaluate('document.body.innerText'))
    const hit = mentions(text)
    if (hit.length > 0) seen.push(`${label}: ${hit.join(',')}`)
  }
  for (const path of ['/', '/activity', '/tasks']) {
    await page.goto(`${studio.base}${path}`, { waitUntil: 'domcontentloaded' })
    await settle(page)
    await page.waitForTimeout(1500)
    await scan(path)
  }
  const slugs = (
    await rows(
      `select slug from public.projects where office_id = ${lit(office)}::uuid and status = 'active' and not is_fixture and slug <> 'unnamed'`,
    )
  ).map((r) => String(r.slug))
  for (const slug of slugs) {
    for (const tool of ['', '/activity', '/team']) {
      await page.goto(`${studio.base}/p/${slug}${tool}`, { waitUntil: 'domcontentloaded' })
      await settle(page)
      await page.waitForTimeout(1200)
      await scan(`/p/${slug}${tool}`)
    }
  }
  await page.goto(`${studio.base}/`, { waitUntil: 'domcontentloaded' })
  await settle(page)
  for (const tab of ['memory', 'requests', 'team']) {
    await openSettings(page, tab)
    await page.waitForTimeout(1200)
    await scan(`settings/${tab}`)
    if (tab === 'memory') {
      const text = String(
        await page.evaluate("document.querySelector('#settings')?.innerText ?? ''"),
      )
      check(
        'positive control: What it has learned says "Learned by you"',
        /Learned by you/i.test(text),
        '',
      )
      await page.screenshot({ path: `${out}/memory.png` })
    }
    await closeSettings(page)
  }
  check('no screen shows the owner key, or the key as a name', seen.length === 0, seen.join(' | '))
  check('no page errors', errors.length === 0, errors.slice(0, 2).join(' || '))
} finally {
  await studio.close()
}
console.log(failed === 0 ? '\nLABELS: PASS' : `\nLABELS: ${failed} FAILED`)
process.exitCode = failed === 0 ? 0 : 1
