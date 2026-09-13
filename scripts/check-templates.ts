/*
  The backtick trap, caught by a machine instead of by a person (#73).

  `web/studio/app.js` is one long sequence of template literals with
  explanatory HTML comments inside them. A backtick anywhere in that text ends
  the string, the file becomes unparseable, and the page renders NOTHING —
  announcing itself as a capture run timing out on a selector that cannot
  exist.

  This is documented at the top of the traps list in CLAUDE.md. It still fired
  SIX times in one day, and one of the offending comments was itself a note
  saying "No backticks in this comment". That is the finding: the documentation
  is correct, prominent, and does not work, because it has to be remembered at
  the moment of typing a comment.

  So it is a check. Two of them, cheap and independent:

  1. Every file parses as an ES module. `node --check` in CommonJS mode is NOT
     enough — that is how a broken app.js got committed while a check passed.
  2. No backtick inside an HTML comment. This is the specific shape that keeps
     happening, and it is caught even when the file still parses by accident.

  The right long-term fix is to move the explanatory comments out of the
  template literals entirely, where they cannot terminate anything. Until then
  this fails in under a second instead of ten minutes into a capture run.
*/

import { execFileSync } from 'node:child_process'
import { globSync, readFileSync } from 'node:fs'

const FILES = globSync('web/**/*.js')

let bad = 0
const fail = (file: string, line: number, why: string) => {
  bad += 1
  console.log(`  ${file}:${line}  ${why}`)
}

for (const file of FILES) {
  const text = readFileSync(file, 'utf8')

  /*
    A backtick inside an HTML comment.

    Scanned line by line for single-line comments, and with a small state
    machine for the ones that span lines — the real offenders have all been
    multi-line explanatory blocks, which is exactly where a person stops
    thinking about the enclosing string.
  */
  let inComment = false
  text.split('\n').forEach((line, i) => {
    let rest = line
    while (rest.length > 0) {
      if (!inComment) {
        const open = rest.indexOf('<!--')
        if (open === -1) break
        rest = rest.slice(open + 4)
        inComment = true
      } else {
        const close = rest.indexOf('-->')
        const body = close === -1 ? rest : rest.slice(0, close)
        if (body.includes('`')) {
          fail(file, i + 1, 'backtick inside an HTML comment — this ends the template literal')
        }
        if (close === -1) return
        rest = rest.slice(close + 3)
        inComment = false
      }
    }
  })
}

/*
  And then the parse itself, as a MODULE.

  `node --check file.js` parses in script mode when the file has no .mjs
  extension, and script mode accepts things module mode does not. The studio
  loads with type="module", so script mode is the wrong question. Copying to a
  .mjs path is the cheapest way to ask the right one.
*/
for (const file of FILES) {
  const tmp = `/tmp/tplcheck-${file.replace(/[^a-z0-9]/gi, '-')}.mjs`
  try {
    execFileSync('cp', [file, tmp])
    execFileSync('node', ['--check', tmp], { stdio: 'pipe' })
  } catch (e) {
    const out = String((e as { stderr?: Buffer }).stderr ?? e)
    const where = /:(\d+)\n/.exec(out)
    fail(
      file,
      Number(where?.[1] ?? 0),
      'does not parse as an ES module — ' +
        (/SyntaxError: .*/.exec(out)?.[0] ?? 'see node --check'),
    )
  }
}

if (bad > 0) {
  console.log(`\ncheck:templates FAILED — ${bad} problem${bad === 1 ? '' : 's'}`)
  /*
    The advice, but only when it is the advice.

    This check does two jobs — it parses each file as a module, and it looks
    for a backtick inside an HTML comment — and it printed the backtick
    sentence for BOTH. A duplicate `const` sent somebody hunting for a backtick
    that was not there while the error above said, correctly, "Identifier
    already declared". A failure message that names the wrong cause is worse
    than a bare count: it points somewhere, and somewhere is wrong.
  */
  console.log('Each line above says what it found. A backtick inside an HTML comment inside a')
  console.log('template literal ends the string and the page then renders nothing — but any')
  console.log('other parse error is reported here too, and reads exactly as it says.')
  process.exit(1)
}
console.log(
  `check:templates clean — ${FILES.length} files parse as modules, no backticks in HTML comments`,
)
