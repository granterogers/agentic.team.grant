/**
 * `npm run check:branding` — the product does not say "Basecamp" (#382).
 *
 * Basecamp was design inspiration while Team HQ was built. It is not the name
 * of this product, and Grant asked for it to leave every surface a person can
 * see. This reads every file the page deploy ships (`web/studio`, minus the
 * raw textures it skips) and fails on the word anywhere a person could meet
 * it: text, titles, labels, placeholders, URLs, messages.
 *
 * What it deliberately does NOT fail on, because a person never sees it:
 *
 *   - comments (JS, CSS and HTML), which are development history;
 *   - the internal identifiers listed in INTERNAL below, each an exact token
 *     with the reason it stays. `bc/` as a directory name contains no
 *     "basecamp" at all, so it needs no entry.
 *
 * An allow-list of exact tokens rather than a pattern: a pattern loose enough
 * to admit the internals would admit a sentence too. And it proves it can
 * fail: `--control` runs the same scan over synthetic user-facing copy and
 * exits non-zero if that copy is NOT caught.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = 'web/studio'
const SKIP_DIRS = new Set(['raw'])
const SCANNED = /\.(js|mjs|html|css|json|svg|txt|md)$/i

/* Exact internal tokens, and why each one stays. Nothing here is rendered. */
const INTERNAL: { token: RegExp; why: string }[] = [
  {
    token: /(experience\s*(===|!==|=)\s*|experience\s*=\s*bits\[0\][^\n]*?)'basecamp'/g,
    why: "the renderer flag's internal value (state.experience); never displayed",
  },
  {
    token: /data-experience=['"]basecamp['"]|dataset\.experience\s*(===|!==|=)\s*'basecamp'/g,
    why: 'the root element attribute the Team HQ stylesheet is scoped to',
  },
  {
    token: /p_surface:\s*'basecamp'/g,
    why: 'saved-layout storage key (dashboard_layouts.surface), a database value',
  },
  {
    token: /bits\[0\] === 'basecamp'/g,
    why: 'the retired /basecamp prefix, read so an old link redirects to its canonical address',
  },
  {
    token: /agentic-team-hq-basecamp|hq-api-basecamp|voice-basecamp/g,
    why: 'names of the separate review deployment and its functions (infrastructure)',
  },
]

const stripComments = (text: string, file: string): string => {
  const blank = (m: string) => m.replace(/[^\n]/g, ' ')
  let s = text.replace(/<!--[\s\S]*?-->/g, blank)
  if (/\.(js|mjs|css|html)$/i.test(file)) s = s.replace(/\/\*[\s\S]*?\*\//g, blank)
  if (/\.(js|mjs|html)$/i.test(file)) {
    // A line comment, but not the // inside a URL (preceded by a colon) or a string's own text.
    s = s.replace(
      /(^|[^:'"`\\\w])\/\/[^\n]*/g,
      (m, a: string) => a + ' '.repeat(m.length - a.length),
    )
  }
  return s
}

export const findings = (text: string, file: string): string[] => {
  let s = stripComments(text, file)
  for (const i of INTERNAL) s = s.replace(i.token, (m) => m.replace(/basecamp/gi, 'x'.repeat(8)))
  const out: string[] = []
  s.split('\n').forEach((line, n) => {
    if (/basecamp/i.test(line)) out.push(`${file}:${String(n + 1)}: ${line.trim().slice(0, 140)}`)
  })
  return out
}

const walk = (dir: string, into: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIRS.has(name)) walk(full, into)
    } else if (SCANNED.test(name)) into.push(full)
  }
  return into
}

if (process.argv.includes('--control')) {
  const specimens: [string, string][] = [
    [
      'x.js',
      "const title = 'Welcome to Base' + 'camp'.replace('', '') // not this one\nh1.textContent = 'Basecamp'",
    ],
    ['x.html', '<title>Team HQ — Basecamp</title>'],
    ['x.js', 'push("Go to", "Open in basecamp", "/basecamp/p/x")'],
    ['x.css', ".bcx::after { content: 'BASECAMP' }"],
  ]
  const missed = specimens.filter(([f, t]) => findings(t, f).length === 0)
  const internal = findings(
    "if (state.experience === 'basecamp') x()\n/* Basecamp-inspired */",
    'y.js',
  )
  if (missed.length > 0 || internal.length > 0) {
    console.error(
      `check:branding CONTROL FAILED: ${String(missed.length)} synthetic user-facing specimen(s) not caught, ${String(internal.length)} internal/comment false positive(s)`,
    )
    process.exit(1)
  }
  console.log(
    `check:branding control: ${String(specimens.length)}/${String(specimens.length)} user-facing specimens caught, internals and comments ignored`,
  )
  process.exit(0)
}

const files = walk(ROOT)
const found = files.flatMap((f) => findings(readFileSync(f, 'utf8'), relative('.', f)))
if (found.length > 0) {
  console.error(
    `check:branding — "Basecamp" can reach a person in ${String(found.length)} place(s):\n`,
  )
  for (const f of found) console.error(`  ${f}`)
  console.error(
    '\nTeam HQ is the name (#382). If this is an internal identifier, add the exact token to INTERNAL with the reason.',
  )
  process.exit(1)
}
console.log(
  `check:branding clean — ${String(files.length)} shipped web file(s), no user-facing "Basecamp"; ${String(INTERNAL.length)} internal token kind(s) allowed`,
)
