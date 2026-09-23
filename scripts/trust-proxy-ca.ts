/*
 * TEACH THE TEST BROWSER THE SANDBOX'S OWN CA.
 *
 *   npm run trust:proxy-ca
 *
 * WHAT THIS IS FOR. Outbound HTTPS from a Claude Code session goes through an
 * agent proxy that re-terminates TLS, so everything must trust the proxy's CA.
 * Node, curl and git are already pointed at it by the environment - the path
 * is in SSL_CERT_FILE and a dozen siblings, and is deliberately NOT written
 * out here, because `npm run check:secrets` flags any environment value that
 * appears verbatim in the repository and it is right to. CHROMIUM IS NOT, in this image: it reads the NSS database at
 * $HOME/.pki/nssdb, which exists and is EMPTY - `nssPublic` held zero rows -
 * so every browser request to a public origin died with
 * ERR_CERT_AUTHORITY_INVALID while the same request from Node succeeded.
 *
 * That is why a whole class of verification was being reported as "cannot be
 * checked here": avatars, edge functions, a signed-in deployed page. It was
 * never a policy boundary. It was an empty trust store.
 *
 * WHAT IT DOES NOT DO, and this matters more than what it does. It does not
 * pass --ignore-certificate-errors, it does not set `ignoreHTTPSErrors`, it
 * does not touch application code and it adds nothing but the certificates the
 * sandbox itself installed at /usr/local/share/ca-certificates. Verification
 * stays ON: after this runs, expired.badssl.com, self-signed.badssl.com and
 * wrong.host.badssl.com are all still refused, because the proxy validates
 * upstream and the browser validates the proxy. A browser that accepts
 * anything is not evidence of anything.
 *
 * It is idempotent, and on a machine with no agent proxy it does nothing and
 * says so.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/*
  The interception CA, taken from the environment rather than written down.
  SSL_CERT_FILE is the bundle every other tool here was given; the standalone
  CA sits beside it under the same name the proxy's own README uses.
*/
const bundle = process.env.SSL_CERT_FILE ?? process.env.NODE_EXTRA_CA_CERTS ?? ''
const CA = process.env.CCR_CA ?? (bundle === '' ? '' : join(bundle, '..', 'agent-proxy-ca.crt'))
const DB = `sql:${process.env.HOME ?? '/root'}/.pki/nssdb`

if (!existsSync(CA)) {
  console.log(
    `no agent-proxy CA at ${CA} — nothing to do, the browser can reach the network as it is`,
  )
  process.exit(0)
}

const has = (cmd: string): boolean => {
  try {
    execFileSync('which', [cmd], { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}
if (!has('certutil')) {
  console.error('certutil is missing, and it is the only way to write the NSS store.')
  console.error('Install it, then run this again:')
  console.error('')
  console.error('    apt-get install -y --no-install-recommends libnss3-tools')
  console.error('')
  process.exit(2)
}

/* The bundle is a chain: every certificate in it has to go in, not just the first. */
const chain = readFileSync(CA, 'utf8')
const pems = chain
  .split(/(?=-----BEGIN CERTIFICATE-----)/)
  .map((p) => p.trim())
  .filter((p) => p.startsWith('-----BEGIN CERTIFICATE-----'))
if (pems.length === 0) {
  console.error(`${CA} holds no certificates`)
  process.exit(2)
}

/*
  EVERY EARLIER ENTRY GOES FIRST, so running this twice cannot leave two
  copies under two nicknames - which is what a hand-added one looked like.
  `-D` on a nickname that is not there exits non-zero, and absence is the
  ordinary case rather than an error.
*/
const forget = (nick: string): void => {
  try {
    execFileSync('certutil', ['-d', DB, '-D', '-n', nick], { stdio: 'ignore' })
  } catch {
    /* it was not there */
  }
}
for (const line of execFileSync('certutil', ['-d', DB, '-L'], { encoding: 'utf8' }).split('\n')) {
  const nick = line.trim().split(/\s{2,}/)[0] ?? ''
  if (nick.startsWith('ccr-agent-proxy')) forget(nick)
}

const dir = mkdtempSync(join(tmpdir(), 'ccrca-'))
let added = 0
for (const [i, pem] of pems.entries()) {
  const file = join(dir, `ca-${String(i)}.pem`)
  writeFileSync(file, `${pem}\n`)
  const nick = `ccr-agent-proxy-${String(i)}`
  /*
    `C,,` is "trusted to issue server certificates", which is the whole of what
    is wanted: it says nothing about email or code signing.
  */
  execFileSync('certutil', ['-d', DB, '-A', '-t', 'C,,', '-n', nick, '-i', file], { stdio: 'pipe' })
  const subject = execFileSync('openssl', ['x509', '-in', file, '-noout', '-subject'], {
    encoding: 'utf8',
  })
    .replace(/^subject=\s*/, '')
    .trim()
  console.log(`trusted: ${subject}`)
  added += 1
}

const listed = execFileSync('certutil', ['-d', DB, '-L'], { encoding: 'utf8' })
const held = listed.split('\n').filter((l) => l.includes('ccr-agent-proxy-')).length
console.log(`${String(added)} certificate(s) written, ${String(held)} in the store at ${DB}`)
console.log('TLS verification is unchanged: a bad certificate is still refused.')
process.exit(held === added ? 0 : 1)
