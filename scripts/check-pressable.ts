/**
 * Every gateway action has a control (#72, one layer up).
 *
 *   npm run check:pressable
 *
 * `check:callers` asks whether anything CALLS a database function. This asks
 * the same question about the layer above it: whether anything PRESSES a
 * gateway action.
 *
 * ## Why the existing check cannot see this
 *
 * CLAUDE.md already records the shape: *"A gateway section no page reads is
 * the same defect as a capability no code calls, and `check:callers` cannot
 * see it. The check walks DATABASE functions; a section is a key in an
 * object."* Both #264's trigger framework and #265's connector inventory were
 * built, verified and completely invisible for exactly that reason.
 *
 * It happened again with `stop_job`. That action has existed since the browser
 * work and nothing had ever pressed it, so a job spending tokens on the wrong
 * thing could only be waited out — and the grep that should have found it
 * looked fine, because `data-stop` in `app.js` is an unrelated
 * click-propagation stopper. A name collision made an absence look like a
 * presence.
 *
 * ## What counts as pressed
 *
 * The page names the action as a string: `act('stop_job', …)`. That is how
 * every write in the studio is sent, so the test is whether the action's name
 * appears as a quoted string anywhere in `web/`. Crude, and right for the
 * question — a page that names an action has a path to it, and one that never
 * mentions it cannot possibly.
 *
 * Read sections are checked the same way, with `read('name')`.
 *
 * ## A baseline that may only shrink
 *
 * Seventeen actions were unpressed on the first run, which is too many to gate
 * today and exactly the number that makes somebody switch a gate off — the
 * same reasoning `check:callers` records at forty. So this fails on an action
 * that is NOT in the baseline, and it also fails when a baseline entry becomes
 * pressed and has not been removed. A baseline that cannot go stale is the
 * difference between a baseline and an allowlist.
 *
 * ## What is legitimately absent
 *
 * Some actions are for an AGENT holding the bearer token rather than for the
 * page — #13's point that everything the UI can do, an agent should be able to
 * do. Those belong in the baseline with that reason written next to them, not
 * wired to a button nobody wanted.
 */

import { execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'

const gateway = readFileSync('supabase/functions/hq-api/index.ts', 'utf8')

/** Everything in `web/`, read once. */
const page = execSync(
  "find web -type f \\( -name '*.js' -o -name '*.html' \\) -print0 | xargs -0 cat",
  { maxBuffer: 64 * 1024 * 1024 },
).toString()

/*
  A found-nothing check needs a control that must come back positive.

  If the find matched nothing, every action would look unpressed and this would
  report a catastrophe that is entirely its own. `npm run levels` reported 0
  once for exactly this reason, and the zero and the ten came from the same
  code.
*/
if (page.length < 100_000) {
  console.error(
    `check:pressable FAILED — read only ${String(page.length)} bytes of web/. ` +
      'The find is matching nothing, so this check is not looking at the product.',
  )
  process.exit(1)
}

const block = (name: string): string => {
  const at = gateway.indexOf(`const ${name}`)
  if (at === -1) return ''
  // To the first line that closes the object at column zero.
  const end = gateway.indexOf('\n}', at)
  return end === -1 ? gateway.slice(at) : gateway.slice(at, end)
}

const named = (source: string): string[] => [
  ...new Set([...source.matchAll(/^ {2}([a-z_]+):\s*\{/gm)].map((m) => m[1] as string)),
]

const actions = named(block('ACTIONS'))
const sections = named(block('SECTIONS'))

if (actions.length < 10 || sections.length < 10) {
  console.error(
    `check:pressable FAILED — found ${String(actions.length)} action(s) and ` +
      `${String(sections.length)} section(s) in the gateway. The parse is wrong, ` +
      'not the product.',
  )
  process.exit(1)
}

/*
  Named, in either of the two ways the product names a section.

  This was quoted-only — `'lately'`, `"lately"` — and `web/studio/data.js`
  fetches the studio's PRIMARY payload as
  `fetch(`${endpoint}?section=studio`)`, inside a template literal, with no
  quotes anywhere near the word. So `section:studio` was reported as named by
  nothing, went into the baseline, and was given the reason *"SUPERSEDED by the
  per-project reader the page actually calls"*.

  That reason is false. It is the single most-used section in the product, and
  a baseline entry with a false reason is worse than no entry at all: it is a
  documented excuse that stops the next person looking. `pulse`, `workspace`
  and `conversation` are fetched the same way and were only caught because
  they happen to be quoted somewhere else too.

  The URL form is matched with a boundary after the name so `section=cost` is
  not satisfied by `section=cost_per_outcome`.
*/
const pressed = (name: string): boolean =>
  page.includes(`'${name}'`) ||
  page.includes(`"${name}"`) ||
  new RegExp(`section=${name}(?![a-z_])`).test(page)

/*
  And the control for the line above.

  A found-nothing check needs something that must come back positive, and the
  byte-count control at the top only proves the find read some files. This
  proves the MATCHER works in both of its forms — and it is here rather than in
  a test because the thing it has to be right about is this run's copy of
  `web/`, not a fixture.
*/
for (const [form, probe] of [
  ['quoted', 'lately'],
  ['url', 'studio'],
] as const) {
  if (!pressed(probe)) {
    console.error(
      `check:pressable FAILED — the ${form} form stopped matching: nothing in web/ ` +
        `names \`${probe}\`, which cannot be true. The matcher is broken, not the product.`,
    )
    process.exit(1)
  }
}

const coldActions = actions.filter((a) => !pressed(a))
const coldSections = sections.filter((s) => !pressed(s))
const cold = [
  ...coldActions.map((a) => `action:${a}`),
  ...coldSections.map((s) => `section:${s}`),
].sort()

console.log(
  `check:pressable — ${String(actions.length)} action(s) and ${String(sections.length)} section(s); ` +
    `${String(cold.length)} that nothing in web/ names`,
)

const BASELINE = 'docs/testing/pressable-baseline.json'
const baseline: string[] = existsSync(BASELINE)
  ? (JSON.parse(readFileSync(BASELINE, 'utf8')) as { unpressed: string[] }).unpressed
  : []

const fresh = cold.filter((c) => !baseline.includes(c))
const now = baseline.filter((b) => !cold.includes(b))

for (const c of cold) console.log(`  ${fresh.includes(c) ? 'NEW ' : '    '}${c}`)

if (fresh.length > 0) {
  console.error(
    `\ncheck:pressable FAILED — ${String(fresh.length)} gateway ${
      fresh.length === 1 ? 'entry has' : 'entries have'
    } no control:`,
  )
  for (const f of fresh) console.error(`  ${f}`)
  console.error(
    '\nGive it a control, or record in the baseline WHY the page is not the ' +
      'thing that presses it — an action meant for an agent holding the bearer ' +
      'token is a real answer (#13); "we forgot" is not.',
  )
  process.exit(1)
}

if (now.length > 0) {
  console.error(
    `\ncheck:pressable FAILED — ${String(now.length)} baseline ${
      now.length === 1 ? 'entry is' : 'entries are'
    } now pressed. Remove them from ${BASELINE} so the number keeps going down:`,
  )
  for (const f of now) console.error(`  ${f}`)
  process.exit(1)
}

console.log(
  cold.length === 0
    ? 'every gateway action and section is named by the product.'
    : `${String(cold.length)} known, all in the baseline — and it may only shrink.`,
)
