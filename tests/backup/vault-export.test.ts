/**
 * The one property this file exists for: real `openssl` can open it.
 *
 * `src/backup/vault-export.ts` reproduces `openssl enc -aes-256-cbc -pbkdf2
 * -iter 600000 -salt` out of Web Crypto so the export can run in the worker,
 * where there is no openssl binary. That claim is worthless asserted against
 * my own decrypter: the whole point is the morning when the repository is gone
 * and the only tool available is the one command in a Telegram message.
 *
 * So this shells out to the real binary. If openssl is not installed the test
 * SKIPS rather than passing — a green tick for a check that did not run is the
 * shape of defect this codebase keeps finding.
 */

import { execFile } from 'node:child_process'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import {
  buildVaultExport,
  newPassphrase,
  sealWithOpenSslFormat,
} from '../../src/backup/vault-export.ts'

const run = promisify(execFile)

const haveOpenssl = await run('openssl', ['version'])
  .then(() => true)
  .catch(() => false)

describe('the sealed vault', () => {
  it('starts with openssl’s Salted__ container', async () => {
    const bytes = await sealWithOpenSslFormat('hello', 'pass')
    expect(new TextDecoder().decode(bytes.slice(0, 8))).toBe('Salted__')
    // 8 magic + 8 salt + at least one AES block.
    expect(bytes.length).toBeGreaterThanOrEqual(32)
  })

  it('uses a fresh salt each time, so two seals of one input differ', async () => {
    const a = await sealWithOpenSslFormat('hello', 'pass')
    const b = await sealWithOpenSslFormat('hello', 'pass')
    expect(Buffer.from(a).toString('hex')).not.toBe(Buffer.from(b).toString('hex'))
  })

  it('makes a passphrase that survives being pasted from a phone', () => {
    const p = newPassphrase()
    expect(p).toMatch(/^[A-Za-z0-9_-]{32}$/)
    expect(newPassphrase()).not.toBe(p)
  })

  it('puts one secure note per secret, in a folder', async () => {
    const sealed = await buildVaultExport([
      { name: 'a.key', value: 'AAA', description: 'the first' },
      { name: 'b.key', value: 'BBB', description: 'the second' },
    ])
    expect(sealed.items).toBe(2)
    expect(sealed.filename).toMatch(/^ai-team-hq-vault-.*\.json\.enc$/)
  })

  it('refuses an empty vault rather than sending an empty file', async () => {
    await expect(buildVaultExport([])).rejects.toThrow(/empty/)
  })

  it.skipIf(!haveOpenssl)('is decrypted by the real openssl binary', async () => {
    const secrets = [
      { name: 'slack.bot_token', value: 'xoxb-not-a-real-token', description: 'the office' },
      { name: 'awkward', value: "quotes ' and \\ and \n newline", description: '' },
    ]
    const sealed = await buildVaultExport(secrets)

    const dir = await mkdtemp(join(tmpdir(), 'vault-test-'))
    const enc = join(dir, sealed.filename)
    const out = join(dir, 'vault.json')
    await writeFile(enc, sealed.bytes)

    // The exact command the passphrase message tells Grant to run.
    await run('openssl', [
      'enc',
      '-d',
      '-aes-256-cbc',
      '-pbkdf2',
      '-iter',
      '600000',
      '-salt',
      '-in',
      enc,
      '-out',
      out,
      '-pass',
      `pass:${sealed.passphrase}`,
    ])

    const payload = JSON.parse(await readFile(out, 'utf8')) as {
      items: { name: string; notes: string }[]
    }
    expect(payload.items).toHaveLength(2)
    expect(payload.items[0]?.name).toBe('slack.bot_token')
    expect(payload.items[0]?.notes).toContain('xoxb-not-a-real-token')
    // The value that would break a naive quoting scheme, round-tripped.
    expect(payload.items[1]?.notes).toContain("quotes ' and \\ and \n newline")
  })

  it.skipIf(!haveOpenssl)(
    'refuses the wrong passphrase, rather than producing rubbish',
    async () => {
      const sealed = await buildVaultExport([{ name: 'x', value: 'y', description: '' }])
      const dir = await mkdtemp(join(tmpdir(), 'vault-test-'))
      const enc = join(dir, sealed.filename)
      await writeFile(enc, sealed.bytes)
      await expect(
        run('openssl', [
          'enc',
          '-d',
          '-aes-256-cbc',
          '-pbkdf2',
          '-iter',
          '600000',
          '-salt',
          '-in',
          enc,
          '-out',
          join(dir, 'nope.json'),
          '-pass',
          'pass:definitely-not-it',
        ]),
      ).rejects.toThrow()
    },
  )
})
