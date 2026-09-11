/**
 * Does the deployed frontend actually carry the design system?
 *
 *   npm run verify:design
 *
 * Issue #68. Grant, opening the deployed dashboard after a week of visual work:
 *
 *     "excuse me but where all the nice graphics that we spent so long trying
 *      to perfect?"
 *
 * Nothing was lost and nothing failed. `npm run shots` renders `web/studio` and
 * `verify:ui` drives `web/hq/index.html`, both correctly, and **the gap between
 * them was invisible** — a week of motion, depth and transparency went into a
 * file the deploy does not ship.
 *
 * ## This has to FAIL, not inform
 *
 * A report saying "the live page has 1 transition and the studio has 52" is a
 * report nobody reads twice. The whole reason the divergence lasted a week is
 * that every check was green. So there are floors, and falling below one is a
 * failing exit code.
 *
 * ## Counting primitives is a crude measure and it is the right one here
 *
 * It cannot tell you whether the motion is *good* — §14A is explicit that only
 * looking at it can, and that stays a human judgement. What it can tell you is
 * whether the motion language is PRESENT, and the failure this exists to catch
 * was not subtle: zero designed easings and zero inset shadows on the page
 * Grant actually opens.
 *
 * A floor is a floor. Passing it is not a compliment.
 */

import { readFileSync } from 'node:fs'

let pass = 0
let fail = 0
const ok = (what: string, good: boolean, note = '') => {
  if (good) {
    pass++
    console.log(`  ok   ${what}`)
  } else {
    fail++
    console.error(`  FAIL ${what}${note === '' ? '' : ` — ${note}`}`)
  }
}

const read = (path: string): string => readFileSync(path, 'utf8')
const count = (text: string, pattern: RegExp): number => (text.match(pattern) ?? []).length

/*
  The design system, as things that are either there or not.

  Each names the specification it comes from, because a floor with no source is
  a number somebody will lower when it is inconvenient.
*/
const PRIMITIVES: readonly {
  what: string
  pattern: RegExp
  floor: number
  why: string
}[] = [
  {
    what: 'transitions',
    pattern: /transition\s*:/g,
    floor: 30,
    why: '§18 — a coherent motion language, not motion added per component',
  },
  {
    what: 'designed easings',
    pattern: /cubic-bezier\(/g,
    floor: 10,
    why: '§18 — duration ranges and easing are defined, not defaulted',
  },
  {
    what: 'keyframed motion',
    pattern: /@keyframes/g,
    floor: 4,
    why: '§17 — entrance, exit and status changes are animated',
  },
  {
    what: 'depth',
    pattern: /box-shadow\s*:/g,
    floor: 40,
    why: 'direction.md — one hairline and one very soft shadow, on every surface',
  },
  {
    what: 'inset shadows, the embossing',
    pattern: /box-shadow[^;]*inset|inset\s+0/g,
    floor: 8,
    why: 'direction.md — the light on the top edge is what makes a page look printed',
  },
  {
    what: 'transparency',
    pattern: /backdrop-filter\s*:/g,
    floor: 8,
    why: '§17 — layering and depth',
  },
  {
    what: 'transforms',
    pattern: /transform\s*:/g,
    floor: 25,
    why: '§17 — physicality; objects move rather than reappear',
  },
  {
    what: 'a reduced-motion path',
    pattern: /prefers-reduced-motion/g,
    floor: 1,
    why: '§18 and §23 — reduced-motion alternatives are part of the system',
  },
]

console.log('design —')

/*
  What is SERVED. Not what is on disk, and not what the deploy script appears to
  say.

  The first version of this grepped `scripts/deploy/hq.ts` for the line that
  ships the studio — and passed when that line was commented out, because the
  string was still in the file. A check that reads source to guess at behaviour
  is a check with the same blind spot as the one it replaces. So it asks the
  URL.

  Falling back to disk when the network is unavailable, loudly: an offline run
  should still catch a stylesheet that lost its motion, and should not be able
  to claim anything about what is deployed.
*/
const LIVE = process.env.HQ_URL ?? 'https://ai-team-hq.vercel.app'
const STYLED = ['studio.css', 'tokens.css', 'skins.css']

let css = ''
let served = false
try {
  const parts = await Promise.all(
    STYLED.map(async (f) => {
      const r = await fetch(`${LIVE}/studio/${f}`)
      if (!r.ok) throw new Error(`${f}: http ${String(r.status)}`)
      const text = await r.text()
      // A 200 that is the SPA's index.html rather than the stylesheet is the
      // failure mode of a host that rewrites unknown paths, and it would count
      // zero primitives and read as a design regression. Check what came back.
      if (text.trimStart().startsWith('<')) throw new Error(`${f}: served HTML, not CSS`)
      return text
    }),
  )
  css = parts.join('\n')
  served = true
} catch (error) {
  css = STYLED.map((f) => read(`web/studio/${f}`)).join('\n')
  console.log(
    `  note  the deployed page could not be read (${
      error instanceof Error ? error.message : String(error)
    }); counting the files on disk instead`,
  )
}

ok(
  'the deployed page serves the designed frontend',
  served,
  'nothing at ' + LIVE + '/studio/ — the design is on disk and not shipped, which is #68 exactly',
)

for (const p of PRIMITIVES) {
  const n = count(css, p.pattern)
  ok(`${p.what}: ${String(n)} (floor ${String(p.floor)})`, n >= p.floor, p.why)
}

/*
  Both colour schemes, because Grant asked for two.

  "Don't use the corporate colors. Use a different color scheme." — and then two
  of them, light and dark. A single-scheme page passes every other check here.
*/
{
  const skins = read('web/studio/skins.css')
  ok(
    'both colour schemes exist',
    /prefers-color-scheme:\s*dark/.test(css) || /\[data-skin/.test(skins),
    'no dark scheme and no skin selector',
  )
}

/*
  The old page is not growing.

  ADR-0019 puts `web/hq/index.html` in run-out: it keeps its URL until its write
  actions exist in the studio, and nothing new goes into it. A file in run-out
  that gains a hundred lines is a file that is not in run-out, and the decision
  has quietly been reversed by nobody in particular.

  A line count rather than a diff, because this has to work in a fresh clone
  with no git history to compare against.
*/
{
  const RUNOUT_CEILING = 3900
  const lines = read('web/hq/index.html').split('\n').length
  ok(
    `the retiring page is not growing: ${String(lines)} lines (ceiling ${String(RUNOUT_CEILING)})`,
    lines <= RUNOUT_CEILING,
    'ADR-0019 — features go in the studio. Move the work rather than raising this.',
  )
}

/*
  And the studio can still be looked at without a backend.

  §14A's loop is render → capture → critique, and a design that only renders
  against a live API is a design nobody critiques on the morning the API is
  down. The fallback data is not laziness left over from M0; it is what keeps
  the loop possible.
*/
{
  const data = read('web/studio/data.js')
  ok(
    'the studio still renders with no backend',
    data.includes('FALLBACK_PROJECTS') && data.includes('export const PROJECTS'),
  )
  ok(
    'and says so when what you are seeing is invented',
    read('web/studio/app.js').includes('Prototype data'),
    'a mock that does not announce itself is how a design gets judged as a product',
  )
}

console.log(`\n${String(pass)}/${String(pass + fail)} checks passed`)
process.exit(fail === 0 ? 0 : 1)
