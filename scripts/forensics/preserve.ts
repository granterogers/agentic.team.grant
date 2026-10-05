/**
 * Preserve the forensic evidence past the life of the build container (Supabase degradation forensics, 5 October 2026).
 *
 *   npm run forensics:preserve -- --to=docs/ops/evidence/2026-10-05
 *
 * `.out/forensics/` is gitignored and the container that holds it is reclaimed, and the provider's log stream expires after 24
 * hours, so what was captured must be committed or it is lost. This copies every capture file into the target directory, with
 * three kinds of value masked first because they have no diagnostic worth and should not live in a repository: email addresses,
 * IPv4 addresses and IPv6 addresses. Everything else is kept verbatim: timestamps, counts, statuses, durations, statement text
 * already clipped and redacted by the collectors.
 *
 * It then re-reads what it wrote and FAILS if any masked class is still present or if a token-shaped string appears, so the check
 * can fail (the specimen test in tests/forensics/preserve.test.ts proves it does). Raw metrics samples (.prom.gz) are unzipped,
 * masked and re-zipped. Nothing is deleted from `.out/`.
 */
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g
const IPV6 = /\b(?:[0-9a-fA-F]{1,4}:){3,7}[0-9a-fA-F]{0,4}\b/g
/** Shapes that must never be committed, whatever the source. A hit anywhere fails the run. */
export const FORBIDDEN = [
  /eyJ[A-Za-z0-9_-]{10,}/,
  /sb_(?:secret|publishable)_[A-Za-z0-9]/,
  /sbp_[A-Za-z0-9]{10,}/,
  /xox[abp]-/,
  /gh[pousr]_[A-Za-z0-9]{10,}/,
  /AKIA[0-9A-Z]{8}/,
  /Bearer [A-Za-z0-9]{10,}/,
]

export interface Masked {
  readonly text: string
  readonly emails: number
  readonly ips: number
}

export const mask = (text: string): Masked => {
  let emails = 0
  let ips = 0
  const t = text
    .replace(EMAIL, () => {
      emails += 1
      return '[email]'
    })
    .replace(IPV6, (m) => {
      // A timestamp such as 12:34:56 has two colons and never reaches three groups; a run of three or more is an address.
      ips += 1
      return m.includes('::') || m.split(':').length >= 4 ? '[ip]' : m
    })
    .replace(IPV4, () => {
      ips += 1
      return '[ip]'
    })
  return { text: t, emails, ips }
}

export const forbiddenIn = (text: string): string[] =>
  FORBIDDEN.filter((re) => re.test(text)).map((re) => re.source)

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })

const main = (): void => {
  const to = process.argv.find((a) => a.startsWith('--to='))?.slice(5)
  if (to === undefined || to === '') {
    console.error('Give a target directory: --to=docs/ops/evidence/<date>')
    process.exit(2)
  }
  const from = '.out/forensics'
  let files: string[] = []
  try {
    files = walk(from)
  } catch {
    console.error(`${from} does not exist: nothing to preserve`)
    process.exit(1)
  }
  let emails = 0
  let ips = 0
  let written = 0
  const bad: string[] = []
  for (const f of files) {
    const rel = relative(from, f)
    const out = join(to, rel)
    const raw = readFileSync(f)
    const gz = f.endsWith('.gz')
    const text = (gz ? gunzipSync(raw) : raw).toString('utf8')
    const m = mask(text)
    emails += m.emails
    ips += m.ips
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, gz ? gzipSync(Buffer.from(m.text, 'utf8')) : m.text)
    written += 1
    // Re-read what was written: the check looks at the artefact, not at the intention.
    const back = readFileSync(out)
    const backText = (gz ? gunzipSync(back) : back).toString('utf8')
    if (backText.match(EMAIL) !== null) bad.push(`${rel}: an email address survived`)
    if (backText.match(IPV4) !== null) bad.push(`${rel}: an IPv4 address survived`)
    for (const s of forbiddenIn(backText)) bad.push(`${rel}: token-shaped string /${s}/`)
  }
  console.log(
    `preserved ${String(written)} file(s) to ${to}; masked ${String(emails)} email(s) and ${String(ips)} address(es)`,
  )
  if (bad.length > 0) {
    console.log(`REFUSED: ${String(bad.length)} problem(s). The target must not be committed:`)
    for (const b of bad) console.log(`  ${b}`)
    process.exit(1)
  }
  console.log('re-scan of the written copy: clean')
}

if (process.argv[1]?.endsWith('preserve.ts')) main()
