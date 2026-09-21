/*
 * Every surface this experience renders has a capture.
 *
 * A SCREEN WITH NO CAPTURE IS A SCREEN NOBODY IS WATCHING, and this run has
 * now paid for that twice: the task record was drawn, wired and checked
 * while appearing in no capture on any viewport, and Contacts — one of six
 * owned tools, with its own preview on the overview — had never been
 * photographed at all.
 *
 * Both were invisible to every other gate, because a gate asserts things
 * about screens somebody thought to point it at. This asserts the pointing.
 */
import { readdir, readFile } from 'node:fs/promises'

const SHELL = await readFile('web/studio/bc/shell.js', 'utf8')
const SHOTS = await readFile('scripts/verify/basecamp-shots.ts', 'utf8')

const owned = (() => {
  const from = SHELL.indexOf('export const TOOLS = [')
  const to = SHELL.indexOf('\n]', from)
  return [
    ...SHELL.slice(from, to).matchAll(/\{ id: '([a-z-]+)', name: '[^']+', own: true \}/g),
  ].map((m) => m[1] as string)
})()

/* The personal and cross-project surfaces, which are not in TOOLS. */
const GLOBAL = ['home', 'my-tasks', 'activity', 'search-empty', 'search-results', 'jump-open']

const captured = [...SHOTS.matchAll(/await shot\('([a-z-]+)'/g)].map((m) => m[1] as string)

if (owned.length < 5 || captured.length < 8) {
  console.error(
    `parsed ${String(owned.length)} owned tool(s) and ${String(captured.length)} capture(s) — a parser has gone blind, which reports a perfect score`,
  )
  process.exit(2)
}

const missing: string[] = []
for (const id of owned)
  if (!captured.includes(id)) missing.push(`tool "${id}" is rendered and never captured`)
for (const g of GLOBAL)
  if (!captured.includes(g)) missing.push(`surface "${g}" is reachable and never captured`)

/* And the captures must actually be on disk, not merely asked for. */
let onDisk: string[] = []
try {
  onDisk = await readdir('.out/basecamp')
} catch {
  onDisk = []
}
if (onDisk.length > 0) {
  for (const id of [...owned, ...GLOBAL]) {
    if (!captured.includes(id)) continue
    for (const v of ['desktop', 'compact', 'tablet', 'phone']) {
      if (!onDisk.includes(`${id}-${v}.png`)) missing.push(`"${id}" has no ${v} capture on disk`)
    }
  }
}

console.log(
  `${String(owned.length)} owned tool(s), ${String(GLOBAL.length)} global surface(s), ${String(captured.length)} capture(s) requested, ${String(onDisk.length)} file(s) on disk`,
)
if (missing.length === 0) {
  console.log('every surface this experience renders has a capture at every viewport')
  process.exit(0)
}
console.log(`\n${String(missing.length)} GAP(S):`)
for (const m of missing) console.log(`  - ${m}`)
process.exit(1)
