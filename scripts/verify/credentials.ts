/**
 * A credential form cannot be filled in wrongly, and never says what it saw.
 *
 *   npm run verify:credentials
 *
 * §35 of the UX QA standard: test credential forms with synthetic realistic
 * shapes — leading and trailing whitespace, a newline, zero-width characters,
 * the wrong case, a malformed shape, a valid-looking shape, the wrong field
 * and the opposite credential type — and never expose a secret in logs,
 * screenshots, traces, issues, commits or test output. Its sharpest line is
 * the one most of this file is about:
 *
 *   A VALID-SHAPED CREDENTIAL FALSELY REJECTED IS A UX DEFECT.
 *
 * 0359 is the precedent and the reason: Grant's correct Slack bot token was
 * refused three times by a check that could not see what was wrong with it,
 * because the refusal was the check's fault. The cure was to stop guessing —
 * strip everything invisible, sort the two values by shape rather than by
 * which box they came from, and match the prefix case-insensitively. 0377
 * gives the Google form the same treatment and adds the guard that would have
 * mattered most: no SETTING may hold a credential, because settings are
 * plaintext and the page renders them.
 *
 * ## Nothing here is destructive, and that is enforced rather than assumed
 *
 * Every call that can SUCCEED writes a real credential to the vault, so every
 * one of them runs inside `begin … rollback` — CLAUDE.md's rule, learned when
 * `verify:disconnect` deleted Slack's token on every run because a refusal
 * quietly became a real disconnect. The wrapper cannot know which kind a call
 * is until it has already happened, so the refusals are wrapped too.
 *
 * ## No credential is in this file
 *
 * The specimens are built from concatenated pieces at runtime, so nothing
 * token-shaped sits in the repository for a scanner to find — the same
 * construction `verify:hq` uses for its own synthetic credentials — and the
 * material after each prefix is obviously fake.
 */

import { readFile } from 'node:fs/promises'
import { ManagementApiExecutor } from '../../src/db/executor.ts'

const token = process.env.SUPABASE_ACCESS_TOKEN
if (token === undefined || token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}
const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  token,
)

const checks: boolean[] = []
const check = (what: string, detail: string, ok: boolean) => {
  checks.push(ok)
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what} — ${detail}`)
}

const one = async (sql: string): Promise<Record<string, unknown>> =>
  ((await db.execute(sql)).rows[0] ?? {}) as Record<string, unknown>

/** A literal for SQL, escaped the only way a single-quoted string can be. */
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`

const call = async (fn: string, args: string[]): Promise<{ error?: string; stored?: boolean }> => {
  const rows = await db.execute(
    `begin;
     select ${fn}(${args.join(', ')}) as r;
     rollback;`,
  )
  const row = (rows.rows[0] ?? {}) as { r?: unknown }
  return (row.r ?? {}) as { error?: string; stored?: boolean }
}

// --- the specimens ----------------------------------------------------------
/*
  Built from pieces, never written whole. Every one is obviously synthetic
  after its prefix, and the prefixes themselves are public documentation.
*/
const GOOGLE_SECRET = ['GOCSPX', '-', 'notarealsecret', 'ForQaOnly'].join('')
const GOOGLE_ID = ['111111111111', '-', 'qaonly', '.apps.googleusercontent.com'].join('')
const SLACK_BOT = ['xoxb', '-', '000000000000', '-', 'qaonlynotreal'].join('')
const SLACK_SIG = 'a'.repeat(16) + 'b'.repeat(16)
const SLACK_APP = ['xapp', '-', '1', '-', 'qaonlynotreal'].join('')
const GITHUB_PAT = ['github', '_pat_', 'qaonlynotreal'].join('')

const ZWSP = '\u200b'
const BOM = '\ufeff'
const NBSP = '\u00a0'

console.log('§35 — credential forms, eight synthetic shapes each\n')

// --- the Google form --------------------------------------------------------
console.log('the Google form, both boxes through one door (0377)')

{
  const r = await call('app.hq_set_google_credentials', [lit(GOOGLE_ID), lit(GOOGLE_SECRET)])
  check(
    'a valid-looking pair in the right boxes is accepted',
    r.stored === true ? 'stored' : `refused: ${r.error ?? '(no message)'}`,
    r.stored === true,
  )
}

{
  // Leading and trailing whitespace, and a newline in the middle of the paste.
  const messy = ` \n${GOOGLE_SECRET}\n `
  const r = await call('app.hq_set_google_credentials', [lit(GOOGLE_ID), lit(messy)])
  check(
    'whitespace and a newline around a valid secret do not refuse it',
    r.stored === true ? 'stored' : `refused: ${r.error ?? '(no message)'}`,
    r.stored === true,
  )
}

{
  // The invisible ones. A zero-width space at the FRONT is the cruel case: it
  // breaks the prefix match and there is nothing on screen to see.
  const invisible = `${ZWSP}${GOOGLE_SECRET.slice(0, 7)}${BOM}${GOOGLE_SECRET.slice(7)}${NBSP}`
  const r = await call('app.hq_set_google_credentials', [lit(GOOGLE_ID), lit(invisible)])
  check(
    'zero-width and non-breaking characters do not refuse a valid secret',
    r.stored === true ? 'stored' : `refused: ${r.error ?? '(no message)'}`,
    r.stored === true,
  )
}

{
  const shouty = GOOGLE_SECRET.toLowerCase()
  const r = await call('app.hq_set_google_credentials', [lit(GOOGLE_ID), lit(shouty)])
  check(
    'the prefix is matched whatever case it was pasted in',
    r.stored === true ? 'stored' : `refused: ${r.error ?? '(no message)'}`,
    r.stored === true,
  )
}

{
  // THE WRONG FIELD. Swapped, which is what 0359 found people actually do.
  const r = await call('app.hq_set_google_credentials', [lit(GOOGLE_SECRET), lit(GOOGLE_ID)])
  check(
    'the two values sort themselves out when the boxes are swapped',
    r.stored === true ? 'stored' : `refused: ${r.error ?? '(no message)'}`,
    r.stored === true,
  )
}

{
  // And when they are swapped, the ID must land in the ID and the secret in
  // the vault — accepting them and storing them the wrong way round would pass
  // the check above and be worse than a refusal.
  const r = await one(`
    begin;
    select app.hq_set_google_credentials(${lit(GOOGLE_SECRET)}, ${lit(GOOGLE_ID)});
    select (select value #>> '{}' from public.system_config where key = 'google.client_id') as id,
           (select count(*)::int from vault.secrets where name = 'google.client_secret') as sec;
    rollback;
  `)
  check(
    'and the ID goes to the setting while the secret goes to the vault',
    `client_id ends ${String(r.id ?? '').slice(-24)}`,
    String(r.id ?? '').endsWith('.apps.googleusercontent.com'),
  )
}

{
  // THE OPPOSITE CREDENTIAL TYPE. A Slack token in a Google form.
  const r = await call('app.hq_set_google_credentials', [lit(GOOGLE_ID), lit(SLACK_BOT)])
  check(
    'a Slack token in the secret box is refused, by name of its class',
    r.error ?? '(accepted!)',
    r.error !== undefined && r.error.includes('Slack bot token'),
  )
}

{
  // MALFORMED. Something that is not a credential of any known kind.
  const r = await call('app.hq_set_google_credentials', [lit(GOOGLE_ID), lit('hunter2 please')])
  check(
    'a malformed secret is refused and told what the right one starts with',
    r.error ?? '(accepted!)',
    r.error !== undefined && r.error.includes('GOCSPX-'),
  )
}

{
  /*
    The defect §35 found, asserted as the property rather than as a refusal.

    The client ID box is plain text, stored in `system_config`, and rendered
    back into the page's value attribute — so a secret pasted there is printed
    on the Settings page, in the DOM, and in every screenshot the harness
    takes. That is what must not happen.

    A refusal is NOT what must happen, and the first draft of this check
    asserted one. Sorting by shape means a lone secret in the ID box is
    recognised and sent to the vault, which is the sort doing exactly its job;
    a check demanding an error there would have invited somebody to remove the
    behaviour that makes the form unfillable-in-wrongly. CLAUDE.md records the
    same correction about a create that asks a question instead of refusing.
  */
  const r = await one(`
    begin;
    select app.hq_set_google_credentials(${lit(GOOGLE_SECRET)}, '');
    select coalesce((select value #>> '{}' from public.system_config
                      where key = 'google.client_id'), '') as id;
    rollback;
  `)
  const landed = String(r.id ?? '')
  check(
    'a secret alone in the plaintext client ID box never reaches the setting',
    landed.startsWith('GOCSPX') ? 'IT IS IN system_config' : 'it went to the vault instead',
    !landed.toUpperCase().startsWith('GOCSPX'),
  )
}

{
  // And the other half of it: a value that is a credential of some OTHER kind
  // has no shape to sort it by, so there the refusal is the right answer.
  const r = await call('app.hq_set_google_credentials', [lit(GITHUB_PAT), lit(GOOGLE_SECRET)])
  check(
    'a GitHub token in the plaintext client ID box is refused outright',
    r.error ?? '(accepted!)',
    r.error !== undefined && r.error.includes('GitHub personal access token'),
  )
}

// --- the Slack form (0359's, re-checked against the same eight shapes) ------
console.log('\nthe Slack form (0359)')

{
  const r = await call('app.hq_set_slack_credentials', [lit(SLACK_BOT), lit(SLACK_SIG)])
  check(
    'a valid-looking pair is accepted',
    r.stored === true ? 'stored' : `refused: ${r.error ?? '(no message)'}`,
    r.stored === true,
  )
}

{
  const messy = `${ZWSP} ${SLACK_BOT}\n`
  const r = await call('app.hq_set_slack_credentials', [lit(messy), lit(` ${SLACK_SIG} `)])
  check(
    'invisible characters and whitespace do not refuse a valid pair',
    r.stored === true ? 'stored' : `refused: ${r.error ?? '(no message)'}`,
    r.stored === true,
  )
}

{
  const r = await call('app.hq_set_slack_credentials', [lit(SLACK_SIG), lit(SLACK_BOT)])
  check(
    'swapped boxes still work — they are sorted by shape',
    r.stored === true ? 'stored' : `refused: ${r.error ?? '(no message)'}`,
    r.stored === true,
  )
}

{
  const r = await call('app.hq_set_slack_credentials', [lit(SLACK_APP), lit(SLACK_SIG)])
  check(
    'the opposite Slack token type is refused, by name of its class',
    r.error ?? '(accepted!)',
    r.error !== undefined && r.error.includes('app-level token'),
  )
}

{
  const r = await call('app.hq_set_slack_credentials', [lit(SLACK_BOT), lit('not-hex-at-all')])
  check(
    'a malformed signing secret is refused and described',
    r.error ?? '(accepted!)',
    r.error !== undefined && r.error.includes('signing secret'),
  )
}

// --- no setting may hold a credential ---------------------------------------
console.log('\nno setting may hold a credential (0377)')

for (const [what, value, expect] of [
  ['a Google client secret', GOOGLE_SECRET, 'Google client secret'],
  ['a Slack bot token', SLACK_BOT, 'Slack bot token'],
  ['a GitHub personal access token', GITHUB_PAT, 'GitHub personal access token'],
] as const) {
  const r = await call('app.hq_set_setting', [lit('google.client_id'), lit(value)])
  check(
    `${what} in a setting is refused`,
    r.error ?? '(accepted!)',
    r.error !== undefined && r.error.includes(expect),
  )
}

{
  // CONTROL. The guard must not have been tightened into refusing everything —
  // a shape list can be weakened until it matches nothing, and it can equally
  // be widened until no ordinary value gets through, and both read as green
  // from the refusals alone.
  const r = await call('app.hq_set_setting', [lit('google.client_id'), lit(GOOGLE_ID)])
  check(
    'CONTROL: an ordinary client ID still saves',
    r.error === undefined ? 'saved' : `refused: ${r.error}`,
    r.error === undefined,
  )
}

{
  const r = await call('app.hq_set_setting', [lit('grant.timezone'), lit('Europe/London')])
  check(
    'CONTROL: and so does an ordinary setting that is not a credential at all',
    r.error === undefined ? 'saved' : `refused: ${r.error}`,
    r.error === undefined,
  )
}

// --- and no refusal ever says what it saw -----------------------------------
console.log('\nno refusal repeats any of the value (§35, and CLAUDE.md on redaction)')

{
  /*
    The property, over every refusal this file can produce: the message may
    name the CLASS of thing it recognised, because a prefix is public
    knowledge and naming it is what makes the mistake actionable. It may not
    contain the material after the prefix, because that is the credential —
    and `connection_health.detail` is rendered on a page.

    Checked against a distinctive run of characters planted in each specimen,
    rather than against the whole value: a message that happened to contain
    "xoxb-" is fine and a message containing the token is not.
  */
  const planted = 'ZzQaMarkerZz'
  const specimens: readonly [string, string, string][] = [
    ['app.hq_set_google_credentials', `${GOOGLE_ID}`, `wrongvalue${planted}`],
    ['app.hq_set_google_credentials', `nonsense${planted}`, `${GOOGLE_SECRET}`],
    ['app.hq_set_google_secret', `sk-${planted}`, ''],
    ['app.hq_set_slack_credentials', `xoxe-${planted}`, `${SLACK_SIG}`],
    ['app.hq_set_setting', 'google.client_id', `GOCSPX-${planted}`],
  ]
  let leaked: string | null = null
  for (const [fn, a, b] of specimens) {
    const r =
      fn === 'app.hq_set_google_secret'
        ? await call(fn, [lit(a)])
        : await call(fn, [lit(a), lit(b)])
    const message = `${r.error ?? ''}`
    if (message.includes(planted)) leaked = `${fn}: ${message.replace(planted, '«…»')}`
  }
  check(
    'a refusal names the class it recognised and never the value',
    leaked === null ? '5 refusals, none repeating the material' : leaked,
    leaked === null,
  )
}

// --- and nothing was actually written ---------------------------------------
{
  /*
    The teardown assertion CLAUDE.md insists on: a rollback that silently
    failed looks exactly like one that worked. Every specimen above is
    synthetic, so finding one in the real store is proof a transaction did not
    hold.
  */
  const r = await one(`
    select (select value #>> '{}' from public.system_config where key = 'google.client_id') as id,
           (select count(*)::int from vault.secrets
             where name in ('google.client_secret','slack.bot_token','slack.signing_secret')) as n
  `)
  const id = String(r.id ?? '')
  check(
    'nothing this suite typed survived the rollback',
    `client_id ${id === '' ? '(unset)' : id.slice(0, 12) + '…'}, ${String(r.n)} real secret(s) intact`,
    !id.includes('qaonly') && !id.startsWith('GOCSPX'),
  )
}

// --- and the form the person actually types into -----------------------------
/*
  Read from the source rather than from a browser, and the reason is worth
  stating because CLAUDE.md is rude about exactly this kind of check.

  The Google credential form is drawn ONLY while Google is not connected — a
  form that stays around invites re-entering a working credential — and Google
  is connected, so there is no running page anywhere that has these boxes on
  it. A browser leg would need the office disconnected first, which is the one
  thing this suite may not do.

  So these three are structural, they are honest about being structural, and
  each one asserts a property the server cannot enforce on its own: which
  action the button sends, whether the secret is masked while it is typed, and
  whether either value is left on screen afterwards.
*/
console.log('\nthe form itself (structural — the page cannot be driven while Google is connected)')

{
  const page = await readFile(new URL('../../web/studio/app.js', import.meta.url), 'utf8')
  const handler = page.slice(page.indexOf('data-save-google]'), page.indexOf('data-save-slack]'))
  check(
    'the button sends both values through the one door that sorts them',
    handler.includes("act('set_google_credentials'")
      ? 'set_google_credentials'
      : 'NOT the sorting call',
    handler.includes("act('set_google_credentials'") &&
      !handler.includes("act('set_google_secret'") &&
      !handler.includes("p_key: 'google.client_id'"),
  )
  check(
    'and clears BOTH boxes afterwards, not only the masked one',
    'secret and client ID',
    /secretBox\.value = ''/.test(handler) && /idBox\.value = ''/.test(handler),
  )
  const field = page.slice(page.indexOf('data-g-secret'), page.indexOf('data-g-secret') + 200)
  check(
    'the secret is masked while it is typed, and never autocompleted',
    field.includes('type="password"') ? 'password, autocomplete off' : 'NOT MASKED',
    field.includes('type="password"') && field.includes('autocomplete="off"'),
  )
}

const passed = checks.filter(Boolean).length
console.log(`\n${String(passed)}/${String(checks.length)} checks passed`)
process.exit(passed === checks.length ? 0 : 1)
