/**
 * A person connects and disconnects their own Telegram from Settings > Messaging, as the Sample (#410).
 *   npm run sample:channel-link
 *
 * Real page (local files), real deployed gateway, real Sample session. Everything the PERSON does is done in the browser:
 * the Connect button, the link it produces, the waiting state, the Disconnect confirmation. The one step a person does in
 * the Telegram app - tapping Start - is the webhook calling `channel_link_redeem`, and that is done here with a made-up
 * numeric Telegram id, so NOTHING is sent to Telegram and no real chat exists: the Sample ends exactly as it began
 * (disconnected), asserted at the end, and Grant's identities are counted before and after.
 *
 * Also asserted at the gateway: the office key (the machine's bearer) cannot start or end a person's connection.
 */
import { mkdirSync } from 'node:fs'
import { closeSettings, newPage, openSettings, signIn, startStudio } from './browser.ts'
import { gateway, lit, rows, sampleOffice, session } from './lib.ts'

const out = '.out/channel-link'
mkdirSync(out, { recursive: true })
let failed = 0
const check = (what: string, ok: boolean, detail = ''): void => {
  if (!ok) failed += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail === '' ? '' : ` - ${detail}`}`)
}
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

const O = (await sampleOffice()).officeId
const s = await session()
const grantIdentities = async (): Promise<number> =>
  Number(
    (
      await rows(
        'select count(*) n from public.subject_identities where office_id = app.operator_office()',
      )
    )[0]?.n,
  )
const sampleIdentities = async (): Promise<number> =>
  Number(
    (
      await rows(
        `select count(*) n from public.subject_identities where office_id = ${lit(O)}::uuid and origin_channel = 'telegram'`,
      )
    )[0]?.n,
  )
// The Sample's own earlier challenges are fixtures. Clearing them keeps the five-an-hour ceiling (which is the product
// working) from refusing a re-run; no other office's rows are touched.
await rows(
  `delete from public.channel_link_challenges where office_id = ${lit(O)}::uuid returning 1`,
)
const grantBefore = await grantIdentities()
check('the Sample starts with no Telegram connected', (await sampleIdentities()) === 0)

// ---- the gateway: the machine key is refused, the person is not
{
  const hq = String(
    (
      await rows(
        `select decrypted_secret v from vault.decrypted_secrets where name = 'hq.api_token'`,
      )
    )[0]?.v ?? '',
  )
  const base = `https://${process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg'}.supabase.co/functions/v1/hq-api`
  for (const action of ['channel_link_begin', 'channel_link_disconnect']) {
    const r = await fetch(base, {
      method: 'POST',
      headers: { Authorization: `Bearer ${hq}`, 'content-type': 'application/json' },
      body: JSON.stringify({ action, args: { p_channel: 'telegram' } }),
    })
    const t = await r.text()
    check(
      `the office key cannot ${action} (a credential is not a person)`,
      r.status === 403 && t.includes('person_required'),
      `http ${String(r.status)}`,
    )
  }
  const g = gateway(s)
  const status = ((await g.read('channel_link')).json as { data?: Record<string, unknown> } | null)
    ?.data as { telegram?: { state?: string; can_connect?: boolean; bot?: string } }
  check(
    'the Sample reads its own status: none, can connect, a bot to open',
    status.telegram?.state === 'none' &&
      status.telegram?.can_connect === true &&
      typeof status.telegram?.bot === 'string',
    JSON.stringify(status.telegram ?? {}),
  )
}
check('and nothing was written by the refusals', (await sampleIdentities()) === 0)

// ---- the page, desktop then phone
const studio = await startStudio(4796)
try {
  for (const phone of [false, true]) {
    const leg = phone ? 'phone' : 'desktop'
    const { page, errors } = await newPage(
      studio,
      phone ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
      phone,
    )
    await signIn(studio, page, s)
    await page.goto(`${studio.base}/`, { waitUntil: 'domcontentloaded' })
    await page.waitForLoadState('networkidle').catch(() => null)
    await sleep(2500)
    const shut = page.locator('[data-dock-close]:visible').first()
    if (await shut.isVisible().catch(() => false)) {
      await shut.click({ force: true })
      await sleep(600)
    }
    await openSettings(page, 'channels')
    await page.waitForSelector('[data-link-begin]', { timeout: 25000 })
    const text = String(await page.evaluate("document.querySelector('#settings')?.innerText ?? ''"))
    check(
      `[${leg}] Messaging offers to connect your own Telegram, in plain words`,
      /Your Telegram/.test(text) &&
        /Connect Telegram/.test(text) &&
        /nothing to copy or type/i.test(text),
    )
    check(
      `[${leg}] and no longer says Telegram is not set up for the account`,
      !/Telegram and Slack are connected for the whole/.test(text),
    )
    const box = await page.locator('[data-link-begin]').first().boundingBox()
    check(
      phone
        ? `[${leg}] the button meets the 44px touch floor`
        : `[${leg}] the button is the size of Settings' other buttons (40px)`,
      box !== null && box.height >= (phone ? 44 : 36),
      JSON.stringify(box),
    )
    await page.screenshot({ path: `${out}/${leg}-1-offer.png` })

    await page.locator('[data-link-begin]').first().click({ force: true })
    await page.waitForSelector('a[href^="https://t.me/"]', { timeout: 20000 })
    const href = String(await page.locator('a[href^="https://t.me/"]').first().getAttribute('href'))
    const token = /link_([0-9a-f]{36})$/.exec(href)?.[1] ?? ''
    check(
      `[${leg}] it produces a Telegram link carrying a one-time token`,
      /^https:\/\/t\.me\/[A-Za-z0-9_]+\?start=link_[0-9a-f]{36}$/.test(href),
      href.replace(/link_.*/, 'link_(withheld)'),
    )
    check(
      `[${leg}] and says it is waiting for the tap`,
      /Waiting for you/.test(
        String(await page.evaluate("document.querySelector('#settings')?.innerText ?? ''")),
      ),
    )
    await page.screenshot({ path: `${out}/${leg}-2-waiting.png` })
    check(`[${leg}] nothing is connected yet`, (await sampleIdentities()) === 0)

    // The tap in Telegram, as the webhook performs it: the SENDER's id, not anything the page said.
    const actor = `7${String(Date.now()).slice(-8)}${phone ? '1' : '0'}`
    const redeemed = (
      await rows(
        `select public.channel_link_redeem('telegram', ${lit(token)}, ${lit(actor)}, ${lit(actor)}, null)::text r`,
      )
    )[0]?.r
    check(
      `[${leg}] the tap connects it (made-up Telegram id; nothing was sent)`,
      String(redeemed).includes('"ok": true') || String(redeemed).includes('"ok":true'),
      String(redeemed).slice(0, 80),
    )
    await page
      .waitForFunction(
        "/Connected/.test(document.querySelector('#settings')?.innerText ?? '') && !!document.querySelector('[data-link-disconnect]')",
        undefined,
        { timeout: 20000 },
      )
      .catch(() => null)
    const nowText = String(
      await page.evaluate("document.querySelector('#settings')?.innerText ?? ''"),
    )
    check(
      `[${leg}] the page notices by itself and says Connected`,
      /Connected/.test(nowText) && (await page.locator('[data-link-disconnect]').count()) === 1,
    )
    await page.screenshot({ path: `${out}/${leg}-3-connected.png` })
    const replay = (
      await rows(
        `select public.channel_link_redeem('telegram', ${lit(token)}, ${lit(actor)}, ${lit(actor)}, null)::text r`,
      )
    )[0]?.r
    check(`[${leg}] the same link cannot be used twice`, String(replay).includes('invalid'))

    await page.locator('[data-link-disconnect]').first().click({ force: true })
    await page.locator('.stg-confirm [data-yes]').click({ force: true, timeout: 8000 })
    await page
      .waitForSelector('[data-link-begin]', { timeout: 20000 })
      .catch(async (e: unknown) => {
        await page.screenshot({ path: `${out}/${leg}-disconnect-failed.png` })
        console.log(
          'identities left:',
          await sampleIdentities(),
          '| page said:',
          String(await page.evaluate("document.querySelector('#settings')?.innerText ?? ''")).slice(
            0,
            500,
          ),
        )
        throw e
      })
    check(
      `[${leg}] Disconnect (after a confirmation) returns to the offer`,
      (await sampleIdentities()) === 0,
    )
    await page.screenshot({ path: `${out}/${leg}-4-disconnected.png` })
    check(`[${leg}] no page errors`, errors.length === 0, errors.slice(0, 2).join(' || '))
    await closeSettings(page).catch(() => null)
    await page.context().close()
  }
} finally {
  await studio.close()
}

check('the Sample ends as it began: no Telegram connected', (await sampleIdentities()) === 0)
check(
  'no challenge is left live for the Sample',
  Number(
    (
      await rows(
        `select count(*) n from public.channel_link_challenges where office_id = ${lit(O)}::uuid and used_at is null and revoked_at is null and expires_at > now()`,
      )
    )[0]?.n,
  ) === 0,
)
check(
  'Grant’s identities are unchanged',
  (await grantIdentities()) === grantBefore,
  `${grantBefore} -> ${await grantIdentities()}`,
)
console.log(failed === 0 ? '\nCHANNEL-LINK-UI: PASS' : `\nCHANNEL-LINK-UI: ${failed} FAILED`)
process.exitCode = failed === 0 ? 0 : 1
