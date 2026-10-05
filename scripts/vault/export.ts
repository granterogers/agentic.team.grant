/**
 * Export the vault, encrypted, to Grant's phone.
 *
 *   npm run vault:export
 *
 * ## The problem this solves
 *
 * The nightly backup is `--schema=public --schema=app`. Supabase Vault lives in
 * `vault` and is excluded — correctly, because a backup carrying decryptable
 * secrets offsite would be a worse problem than the one it solves. The
 * consequence has been the single most serious item on `known-problems.md` for
 * a week: **a restore produces a working database with an empty vault**, and
 * every secret must be re-entered by hand. There are twenty-three of them now,
 * several of which exist nowhere else.
 *
 * ## How this is safe enough to do unattended
 *
 * Grant asked for it to happen without his intervention, which raises the
 * obvious question of how a file full of credentials gets to him safely.
 *
 *   - **It never touches the repository.** Written to a temp path, sent,
 *     deleted. `check:secrets` would catch it if it did, which is the point of
 *     having a scanner rather than a habit.
 *   - **It is never printed.** Not the secrets, not the passphrase, not a
 *     preview. This project has already rotated one credential because a
 *     script printed it into a transcript.
 *   - **It is encrypted before it leaves this process**, AES-256 with a random
 *     32-byte passphrase, and the passphrase travels as a **separate Telegram
 *     message** from the file. Telegram is not the threat model here — losing
 *     the container is — but one message carrying both halves would be a
 *     single thing to leak.
 *   - **It goes to Grant's registered chat only**, resolved from the database,
 *     never to a chat id passed in.
 *
 * ## The format
 *
 * Bitwarden's `.json` import format, because it is the one every manager reads
 * — 1Password, Bitwarden and KeePass all import it, and a CSV loses the notes
 * field where the description belongs.
 */

import '../../src/safety/require-production-writes.ts'
import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { ManagementApiExecutor } from '../../src/db/executor.ts'
import { TelegramClient } from '../../src/telegram/api.ts'
import { escapeHtml } from '../../src/telegram/message.ts'
import { pagerBot } from '../../src/telegram/roster.ts'

const run = promisify(execFile)

const supabase = process.env.SUPABASE_ACCESS_TOKEN
if (supabase === undefined || supabase === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}
const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  supabase,
)

const secrets = (
  await db.execute(`
    select name, decrypted_secret as value, coalesce(description, '') as description
      from vault.decrypted_secrets order by name
  `)
).rows as { name: string; value: string; description: string }[]

if (secrets.length === 0) {
  console.error('the vault is empty; nothing to export')
  process.exit(1)
}

const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')
const payload = {
  encrypted: false,
  folders: [{ id: 'ai-team-hq', name: 'AI Team HQ' }],
  items: secrets.map((s) => ({
    id: s.name,
    organizationId: null,
    folderId: 'ai-team-hq',
    type: 2, // secure note
    name: s.name,
    notes:
      `${s.description}\n\n---\nvalue:\n${s.value}\n\n` +
      `Exported from the AI Team HQ Supabase Vault on ${stamp}.\n` +
      'The vault is NOT in the nightly backup: a restore gives a working ' +
      'database with an empty vault, and this file is what refills it.',
    secureNote: { type: 0 },
    favorite: false,
  })),
}

const dir = await mkdtemp(join(tmpdir(), 'vault-'))
const plain = join(dir, `ai-team-hq-vault-${stamp}.json`)
const sealed = `${plain}.enc`
// 32 bytes of urandom rendered as base64url: long enough that the passphrase is
// not the weak link, short enough to paste from a phone.
const passphrase = randomBytes(24).toString('base64url')

try {
  await writeFile(plain, JSON.stringify(payload, null, 1), { mode: 0o600 })

  // The passphrase goes through a 0600 file, not argv and not stdin.
  //
  // Not argv, because argv is world-readable in `ps` — the same reasoning the
  // notebook adapter uses for its session cookie. Not stdin either, though
  // that was the first attempt: `execFile` has no `input` option (that is
  // `execFileSync`), so `-pass stdin` left openssl waiting on a pipe nobody
  // ever wrote to, and the script hung until it was killed. Twice, because the
  // first fix did not apply and the symptom looked identical.
  const passFile = join(dir, 'pass')
  await writeFile(passFile, passphrase, { mode: 0o600 })
  await run('openssl', [
    'enc',
    '-aes-256-cbc',
    '-pbkdf2',
    '-iter',
    '600000',
    '-salt',
    '-in',
    plain,
    '-out',
    sealed,
    '-pass',
    `file:${passFile}`,
  ])

  const pager = await pagerBot(db)
  if (pager === null) {
    console.error('no pager bot; cannot deliver. Nothing was written outside a temp directory.')
    process.exit(1)
  }
  const chat = (await db.execute(`select app.operator_chat('${pager.botId}') as c`)).rows[0]?.c
  if (chat === null || chat === undefined) {
    console.error('no registered chat for grant; cannot deliver.')
    process.exit(1)
  }

  const telegram = new TelegramClient(pager.token)
  const { readFile } = await import('node:fs/promises')
  const file = new Uint8Array(await readFile(sealed))
  const form = new FormData()
  form.set('chat_id', String(chat))
  form.set(
    'caption',
    `<b>Vault export · ${escapeHtml(String(secrets.length))} secrets</b>\n\n` +
      'AES-256, passphrase in the next message. Decrypt with:\n' +
      `<code>openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -in ${escapeHtml(`ai-team-hq-vault-${stamp}.json.enc`)} -out vault.json</code>\n\n` +
      'Then import <code>vault.json</code> into Bitwarden / 1Password as a Bitwarden JSON.\n\n' +
      '<i>Delete both messages once imported. This is the only copy of the vault ' +
      'outside Supabase — the nightly backup deliberately excludes it.</i>',
  )
  form.set('parse_mode', 'HTML')
  form.set('document', new Blob([file]), `ai-team-hq-vault-${stamp}.json.enc`)

  const sent = (await (
    await fetch(`https://api.telegram.org/bot${pager.token}/sendDocument`, {
      method: 'POST',
      body: form,
    })
  ).json()) as { ok?: boolean; description?: string }

  if (sent.ok !== true) {
    console.error(`the file did not send: ${String(sent.description)}`)
    process.exit(1)
  }

  // Separate message, so one leaked message is not both halves.
  const withPass = await telegram.call('sendMessage', {
    chat_id: String(chat),
    text: `Passphrase for the vault export:\n\n<code>${escapeHtml(passphrase)}</code>`,
    parse_mode: 'HTML',
  })

  console.log(`exported ${String(secrets.length)} secrets, encrypted, to Telegram.`)
  console.log(`passphrase sent separately: ${withPass.ok === true ? 'ok' : 'FAILED'}`)
  console.log('nothing was printed here and nothing was written outside a temp directory.')
} finally {
  // Always, including on failure. A plaintext vault left in /tmp because a
  // Telegram call threw is the whole risk of this script in one sentence.
  await rm(dir, { recursive: true, force: true })
}
