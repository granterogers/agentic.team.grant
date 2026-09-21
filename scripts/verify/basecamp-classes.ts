/*
 * Every class the experience names is a class the stylesheet defines.
 *
 * A CLASS NAME THAT DOES NOT EXIST IS NOT AN ERROR. It renders, it validates,
 * every check stays green, and the element simply has none of the appearance
 * it was written to have. This repository has shipped it twice — a sheet with
 * no surface whose fields sat loose on the page, and, in this run, a `.bcprose`
 * measure written against an anchor an earlier edit had already renamed, so
 * the rule was never added while five call sites went on naming it.
 *
 * Both were found by opening a capture. This finds them in a second, and
 * unlike a capture it cannot miss the one screen nobody looked at.
 */
import { readdir, readFile } from 'node:fs/promises'

const DIR = 'web/studio/bc'

/*
  EVERY stylesheet in the directory, not a list of the ones that existed when
  this was written. The list was `bc.css` and `tokens.css`; adding
  `compose.css` reported 40 perfectly good classes as undefined, which is the
  audit pointed somewhere other than where the product is - the failure this
  repository has paid for in three separate suites. A directory read cannot go
  stale when a file is added.
*/
let styles = ''
const sheets: string[] = []
for (const f of (await readdir(DIR)).filter((x) => x.endsWith('.css')).sort()) {
  sheets.push(f)
  styles += await readFile(`${DIR}/${f}`, 'utf8')
}
if (sheets.length < 2) {
  console.error(
    `only ${String(sheets.length)} stylesheet(s) found in ${DIR} — the read has gone blind`,
  )
  process.exit(2)
}

/* Every class the stylesheet defines, plus the ones the studio already owns. */
const defined = new Set([...styles.matchAll(/\.([a-z][a-z0-9-]*)/g)].map((m) => m[1] as string))

/*
  Classes the experience deliberately borrows from the studio's own sheets
  rather than redefining. Named here so that borrowing is a decision rather
  than an accident, and so a typo in one of them is still caught.
*/
const BORROWED = new Set(['shell', 'shut'])

let used: { cls: string; file: string }[] = []
for (const f of await readdir(DIR)) {
  if (!f.endsWith('.js')) continue
  const src = await readFile(`${DIR}/${f}`, 'utf8')
  for (const m of src.matchAll(/class="([^"${}]+)"/g)) {
    for (const c of (m[1] ?? '').split(/\s+/).filter((x) => x !== ''))
      used.push({ cls: c, file: f })
  }
  // `class="${...}"` built from a variable, where the literal part still counts.
  for (const m of src.matchAll(/class="([a-z0-9 -]*)\$\{/g)) {
    for (const c of (m[1] ?? '').split(/\s+/).filter((x) => x !== ''))
      used.push({ cls: c, file: f })
  }
}
used = used.filter((u) => u.cls.startsWith('bc') || BORROWED.has(u.cls))

if (used.length < 20) {
  console.error(
    `only ${String(used.length)} class use(s) found in ${DIR} — the parser has gone blind, which reports a perfect score`,
  )
  process.exit(2)
}
if (defined.size < 30) {
  console.error(
    `only ${String(defined.size)} class(es) parsed out of the stylesheets — the parser has gone blind`,
  )
  process.exit(2)
}

/*
  A class built by interpolation - `bcface--${size}` - reaches this audit as
  the literal fragment `bcface--`, which is not a name any stylesheet can
  define. Asserting it by name would report a working modifier as missing; and
  simply dropping it would give up the coverage. So a fragment ending in a
  hyphen is satisfied by any DEFINED class beginning with it, which still
  fails if the base is renamed and still fails if the whole family is deleted.
*/
const prefixes = [...defined]
const covers = (frag: string): boolean => prefixes.some((d) => d.startsWith(frag) && d !== frag)

const missing = [
  ...new Set(
    used
      .filter((u) => !defined.has(u.cls) && !BORROWED.has(u.cls))
      .filter((u) => !(u.cls.endsWith('-') && covers(u.cls)))
      .map((u) => `${u.cls} (${u.file})`),
  ),
]

console.log(
  `${String(defined.size)} class(es) defined; ${String(new Set(used.map((u) => u.cls)).size)} distinct class(es) used`,
)
if (missing.length === 0) {
  console.log('every class the experience names is defined')
  process.exit(0)
}
console.log(`\n${String(missing.length)} CLASS(ES) NAMED BUT NEVER DEFINED:`)
for (const m of missing) console.log(`  - ${m}`)
process.exit(1)
