/*
 * NOTHING BUT THE PAGE TALKS TO THE LIVE VOICE DOOR UNDER A REAL-LOOKING NAME.
 *
 *   npm run check:voice-sessions
 *
 * WHY THIS EXISTS (behavioural remediation ledger R37).
 *
 * `/voice/turn` is a production door: a turn posted to it is enqueued as
 * `voice:grant`, `synthetic` is false (it IS a production request), and the
 * only thing that can mark it as a harness is the SESSION id, which lands in
 * the dedupe key as `voice:turn:<session>.<n>`. `app.harness_label` recognises
 * `verify-` there (0583) and nothing else — so every script that posted with a
 * session named anything else had its answers delivered to Grant's real
 * Telegram and Slack:
 *
 *     scenario-a-<run>   (verify:scenario-a)   36 deliveries, 8 Sep - 24 Sep
 *     deploy<ms>         (deploy:voice probes) 18
 *     probe<ms>, uxfix1  (hand probes)          6
 *
 * and `check:leaks` reported "0 new" throughout, because it asks the same
 * predicate the guard does. 0598 adds the database half (a voice session that
 * is not the page's own shape is harness); this is the repository half, and it
 * checks the premise 0598 rests on as well:
 *
 *   1. every page that posts to `/turn` mints its session as
 *      `'s' + Math.random().toString(36).slice(2, 12)` — the ONLY shape 0598
 *      treats as real, so changing it here without changing 0598 would
 *      silence Grant's own page;
 *   2. every script that posts to the live door and does not intercept it
 *      names its session `verify-…`.
 *
 * Static on purpose: it must be able to fail before anything is sent.
 */
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

const PAGE_SHAPE =
  /(?:`s\$\{Math\.random\(\)\.toString\(36\)\.slice\(2, 12\)\}`|'s' \+ Math\.random\(\)\.toString\(36\)\.slice\(2, 12\))/
const POSTS_TO_TURN = /(?:voice\/turn|\+ '\/turn'|\/turn`)/
const INTERCEPTS = /page\.route\(\s*'\*\*\/turn'/

/** The session literals a script sends, and whether each names itself. */
export const sessionsIn = (src: string): { literal: string; ok: boolean }[] => {
  const found: string[] = []
  for (const m of src.matchAll(/\bsession\s*[:=]\s*(`[^`]*`|'[^']*'|"[^"]*")/g)) {
    found.push(String(m[1]))
  }
  return found.map((literal) => ({ literal, ok: /^[`'"]verify-/.test(literal) }))
}

/**
 * The ONE intentional exception (#395's rule: an exception is encoded explicitly and narrowly, never by suppressing the
 * check). The voice door refuses the office key for any session that is not a declared test session (403), and the
 * only way to prove that refusal is to post a REAL-LOOKING session with the key. A script may do so when it says
 * so in a marker comment AND asserts the 403 in the same file: then a turn that got through is a failed check in that
 * suite, and the marker without the assertion is no exemption.
 */
const REFUSAL_PROBE_MARKER = /check:voice-sessions-exempt: office-key refusal probe/
const ASSERTS_403 = /\.status\s*===\s*403/

/** A script's verdict: null when it is fine, else the reason. */
export const verdict = (src: string): string | null => {
  if (!POSTS_TO_TURN.test(src) || INTERCEPTS.test(src)) return null
  if (REFUSAL_PROBE_MARKER.test(src) && ASSERTS_403.test(src)) return null
  const sessions = sessionsIn(src)
  // Posts to the door with no session literal: the door refuses a missing
  // session (400), so a script like that is a refusal probe, not a turn.
  const bad = sessions.filter((s) => !s.ok)
  return bad.length === 0 ? null : `sends session ${bad.map((s) => s.literal).join(', ')}`
}

/* The control: the detector must fail on the shapes that escaped. */
const control = [
  'fetch(`${base}/voice/turn`, { body: JSON.stringify({ said, session: `deploy${Date.now()}` }) })',
  'const session = `scenario-a-${run}`\nfetch(`https://x/functions/v1/voice/turn`)',
]
const passes = ["fetch(`${b}/voice/turn`, { body: JSON.stringify({ said, session: 'verify-x' }) })"]
// the exemption needs BOTH halves: the marker alone, or the assertion alone, is still an escape
const probe =
  '// check:voice-sessions-exempt: office-key refusal probe\nconst r = await fetch(`${b}/voice/turn`, { body: JSON.stringify({ session: `page${run}xyz` }) })\ncheck(r.status === 403)'
control.push(probe.replace('// check:voice-sessions-exempt: office-key refusal probe\n', ''))
control.push(probe.replace('check(r.status === 403)', 'check(r.ok)'))
passes.push(probe)
if (control.some((c) => verdict(c) === null) || passes.some((p) => verdict(p) !== null)) {
  console.error(
    'check:voice-sessions CANNOT RUN — its detector does not tell an escape from a name.',
  )
  process.exit(2)
}

const walk = async (dir: string): Promise<string[]> => {
  const out: string[] = []
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...(await walk(p)))
    else if (/\.(ts|mjs|js)$/.test(e.name)) out.push(p)
  }
  return out
}

const problems: string[] = []
let scripts = 0
for (const file of await walk('scripts')) {
  if (file.endsWith('check-voice-sessions.ts')) continue
  const src = await readFile(file, 'utf8')
  if (!POSTS_TO_TURN.test(src)) continue
  scripts++
  const why = verdict(src)
  if (why !== null) problems.push(`${file}: ${why}`)
}

let pages = 0
for (const file of await walk('web')) {
  const src = await readFile(file, 'utf8')
  if (!/\/turn['`]/.test(src) || !/session/.test(src)) continue
  if (!/fetch\([^\n]*\/turn/.test(src)) continue
  pages++
  if (!PAGE_SHAPE.test(src))
    problems.push(
      `${file}: posts to /turn without minting the page session shape 0598 treats as real`,
    )
}

if (pages === 0) {
  console.error(
    'check:voice-sessions found no page posting to /turn — it cannot have looked at the right files',
  )
  process.exit(2)
}
if (problems.length > 0) {
  console.error('check:voice-sessions FAILED — a harness would reach Grant as a real voice turn:')
  for (const p of problems) console.error(`  ${p}`)
  process.exit(1)
}
console.log(
  `check:voice-sessions clean — ${String(scripts)} script(s) post to the live voice door and each names its session verify-…; ${String(pages)} page(s) mint the real shape`,
)
