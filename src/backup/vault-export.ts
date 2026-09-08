/**
 * The credentials half of §16, in a form that runs anywhere.
 *
 * The database backup (`portable.ts`) deliberately excludes the vault: a
 * portable file full of decryptable secrets is a worse problem than the one it
 * solves. So a restore gives a working database with an empty vault, and this
 * is the file that refills it.
 *
 * `scripts/vault/export.ts` has done this since 2026-09-06 and does it well.
 * It also shells out to `openssl` and writes to `os.tmpdir()`, so it cannot run
 * in the worker — which is why `vault-export` has been a seeded, disabled duty
 * and the export has run "when someone remembers".
 *
 * ## Why this reproduces openssl's format rather than choosing a better one
 *
 * AES-GCM would be the obvious choice for new code and it is the wrong one
 * here. This file exists for the morning when the Supabase project is gone,
 * and on that morning the only thing that should stand between Grant and his
 * credentials is a command he can find in a message:
 *
 *     openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -salt \
 *       -in ai-team-hq-vault-….json.enc -out vault.json -pass pass:THE-PASSPHRASE
 *
 * A bespoke format needs a bespoke decrypter, and a bespoke decrypter lives in
 * the repository that may also be gone. So: the `Salted__` container, PBKDF2
 * over SHA-256 at 600,000 iterations, AES-256-CBC — byte for byte what
 * `openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -salt` produces, built out of
 * `crypto.subtle`, which Deno and Node both have.
 *
 * `tests/backup/vault-export.test.ts` decrypts its output with the real
 * `openssl` binary. Claiming compatibility without that test would be claiming
 * the one property the file exists for.
 */

/** openssl's magic prefix, then eight bytes of salt. */
const SALTED = new TextEncoder().encode('Salted__')

/** What openssl's `-pbkdf2` defaults to when `-md` is not given. */
const ITERATIONS = 600_000

export interface SealedVault {
  readonly filename: string
  readonly bytes: Uint8Array
  readonly passphrase: string
  readonly items: number
}

/**
 * Derive the key and IV exactly as openssl does.
 *
 * One PBKDF2 call for 48 bytes, split 32/16 — not two calls, which is the
 * mistake that produces a file openssl accepts the password for and then
 * garbles.
 */
const deriveKeyAndIv = async (
  passphrase: string,
  salt: Uint8Array,
  // `Awaited<ReturnType<…>>` rather than `CryptoKey`: the DOM lib is not in
  // this tsconfig, and adding it to name one type would pull in a thousand
  // globals that do not exist in the worker either.
): Promise<{ key: Awaited<ReturnType<typeof crypto.subtle.importKey>>; iv: Uint8Array }> => {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase) as Uint8Array<ArrayBuffer>,
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const bits = new Uint8Array(
    await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: salt as Uint8Array<ArrayBuffer>,
        iterations: ITERATIONS,
        hash: 'SHA-256',
      },
      material,
      48 * 8,
    ),
  )
  const key = await crypto.subtle.importKey(
    'raw',
    bits.slice(0, 32) as Uint8Array<ArrayBuffer>,
    'AES-CBC',
    false,
    ['encrypt'],
  )
  return { key, iv: bits.slice(32, 48) }
}

/** `openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -salt`, in Web Crypto. */
export async function sealWithOpenSslFormat(
  plaintext: string,
  passphrase: string,
  salt: Uint8Array = crypto.getRandomValues(new Uint8Array(8)),
): Promise<Uint8Array> {
  const { key, iv } = await deriveKeyAndIv(passphrase, salt)
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-CBC', iv: iv as Uint8Array<ArrayBuffer> },
      key,
      new TextEncoder().encode(plaintext) as Uint8Array<ArrayBuffer>,
    ),
  )
  const out = new Uint8Array(SALTED.length + salt.length + ciphertext.length)
  out.set(SALTED, 0)
  out.set(salt, SALTED.length)
  out.set(ciphertext, SALTED.length + salt.length)
  return out
}

/**
 * A passphrase long enough not to be the weak link and short enough to paste
 * from a phone. 24 bytes of urandom as base64url — 32 characters.
 */
export const newPassphrase = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(24))
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '')
}

/**
 * Build the encrypted export.
 *
 * The plaintext shape is Bitwarden's import format, unchanged from the script:
 * one secure note per secret, in a folder. Grant can drop it into a password
 * manager rather than reading JSON at the worst possible moment.
 */
export async function buildVaultExport(
  rows: readonly { name: string; value: string; description: string }[],
): Promise<SealedVault> {
  if (rows.length === 0) throw new Error('the vault is empty; nothing to export')

  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')
  const payload = {
    encrypted: false,
    folders: [{ id: 'ai-team-hq', name: 'AI Team HQ' }],
    items: rows.map((s) => ({
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

  const passphrase = newPassphrase()
  return {
    filename: `ai-team-hq-vault-${stamp}.json.enc`,
    bytes: await sealWithOpenSslFormat(JSON.stringify(payload, null, 1), passphrase),
    passphrase,
    items: rows.length,
  }
}

/**
 * Send it, as two messages.
 *
 * Grant's instruction, and it is not decoration: the file and the passphrase
 * travel separately so that one forwarded message, one screenshot or one
 * shoulder is not the whole vault. Neither is ever printed.
 *
 * The file goes first. If the passphrase arrived first and the upload then
 * failed, he would be holding a key to nothing and would have to be told to
 * ignore it.
 */
export async function sendSealedVault(
  botToken: string,
  chatId: string,
  sealed: SealedVault,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const form = new FormData()
  form.append('chat_id', chatId)
  form.append(
    'caption',
    `${String(sealed.items)} credentials, encrypted. The passphrase follows separately.`,
  )
  form.append(
    'document',
    new Blob([sealed.bytes as Uint8Array<ArrayBuffer>], { type: 'application/octet-stream' }),
    sealed.filename,
  )

  const sent = (await (
    await fetchImpl(`https://api.telegram.org/bot${botToken}/sendDocument`, {
      method: 'POST',
      body: form,
    })
  ).json()) as { ok?: boolean; description?: string }
  if (sent.ok !== true) {
    throw new Error(`the vault file did not send: ${String(sent.description)}`)
  }

  const openssl =
    `openssl enc -d -aes-256-cbc -pbkdf2 -iter ${String(ITERATIONS)} -salt ` +
    `-in ${sealed.filename} -out vault.json -pass pass:${sealed.passphrase}`

  // The passphrase and the command that uses it, in one message, because a
  // passphrase with no instructions is a string he will not recognise in six
  // months.
  const second = (await (
    await fetchImpl(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text:
          'Passphrase for the file above. To open it:\n\n' +
          `${openssl}\n\n` +
          'That gives a Bitwarden import file. Keep both, in different places.',
        disable_notification: true,
      }),
    })
  ).json()) as { ok?: boolean; description?: string }
  if (second.ok !== true) {
    throw new Error(`the passphrase did not send: ${String(second.description)}`)
  }
}
