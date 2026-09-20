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

/*
  THE SAME TRAP OUTSIDE web/, WHICH IS WHERE IT NOW KEEPS HAPPENING (#282).

  The HTML-comment scan above covers `web/**`. CLAUDE.md records the identical
  defect five more times elsewhere — an SQL comment inside a migration heredoc,
  one inside a template literal in `scripts/verify/import.ts`, one in a
  handler, one in `scripts/verify/ui.ts`, and one in `src/slack/narrate.ts`
  written while adding the very feature this check was extended for.

  Outside `web/` it is not silent: tsc refuses the file. What it costs is the
  DIAGNOSIS. The message is

      src/slack/narrate.ts(539,60): error TS1005: ',' expected.

  which points at a line sixty characters in, names a comma, and says nothing
  about backticks — the "report line that names the wrong cause" defect this
  repository has paid for twice already.

  ## How this finds it exactly, rather than heuristically

  A SQL template literal in this repository never contains a legitimate
  backtick. So: from each `execute(` opener, scan forward to the next backtick.
  In a CORRECT file that backtick closes the literal and sits on a line like
  `  \`)` or at the end of the SQL. In a BROKEN one it is the offending
  character itself, and the line it sits on is a comment.

  That asymmetry is the whole check, and it means a false positive requires a
  SQL literal legitimately closed on a comment line, which is not a thing.
*/
/**
 * Is the character at `at` inside a SQL comment that began after `from`?
 *
 * Walked rather than pattern-matched, because the first version of this check
 * asked whether the offending backtick's LINE STARTS with a comment marker —
 * and inside a multi-line block comment the continuation lines have no marker
 * at all. The sabotage that restored the exact defect this was written for
 * left it GREEN, which is the whole argument for breaking a detector on
 * purpose before believing it.
 */
const insideSqlComment = (text: string, from: number, at: number): boolean => {
  let block = false
  let line = false
  for (let i = from; i < at; i += 1) {
    const two = text.slice(i, i + 2)
    if (line) {
      if (text[i] === '\n') line = false
      continue
    }
    if (block) {
      if (two === '*/') {
        block = false
        i += 1
      }
      continue
    }
    if (two === '/*') {
      block = true
      i += 1
    } else if (two === '--') {
      line = true
      i += 1
    }
  }
  return block || line
}

let SQL_SCANNED = 0
for (const file of globSync('{src,scripts,tests,supabase}/**/*.ts')) {
  const text = readFileSync(file, 'utf8')
  const lineOf = (index: number): number => text.slice(0, index).split('\n').length
  for (const opener of text.matchAll(/\bexecute\(\s*`/g)) {
    const from = (opener.index ?? 0) + opener[0].length
    const close = text.indexOf('`', from)
    if (close === -1) continue
    SQL_SCANNED += 1
    if (insideSqlComment(text, from, close)) {
      fail(
        file,
        lineOf(close),
        'backtick inside a comment inside a SQL template literal — this ends the string, ' +
          'and tsc will report it as a missing comma somewhere else',
      )
    }
  }
}

/*
  The invisible-character trap (#231).

  A regex written into a file by a non-raw Python heredoc turns every `\b`
  into U+0008, the BACKSPACE control character. `String.raw` then preserves it,
  so the pattern asks for a backspace where a word boundary was meant and
  matches nothing, for ever.

  What makes it worth a check rather than a note is that nothing shows it. The
  editor renders nothing, `sed` prints nothing, `git diff` prints nothing,
  biome and tsc are both happy, and `JSON.stringify(re.source)` prints the
  character back as the two characters `\b` — so the one piece of debugging
  output a person would reach for CONFIRMS the pattern is correct. It cost a
  detour through four hypotheses and one wrongly-suspected module cache.

  Repo-wide rather than `web/**`, because the fault is in the writing tool and
  not in the file: it lands wherever a script last wrote. Tabs, newlines and
  carriage returns are the three controls that belong in source.
*/
const ALLOWED_CONTROLS: ReadonlySet<number> = new Set([0x09, 0x0a, 0x0d])
for (const file of globSync('{src,scripts,tests,supabase,migrations}/**/*.{ts,js,sql}')) {
  const text = readFileSync(file, 'utf8')
  let line = 1
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0
    if (ch === '\n') line += 1
    if (code < 0x20 && !ALLOWED_CONTROLS.has(code)) {
      fail(
        file,
        line,
        `control character U+${code.toString(16).padStart(4, '0').toUpperCase()} in the source. ` +
          'A non-raw Python heredoc turns a regex \\b into this and nothing renders it.',
      )
      break
    }
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
  /*
    NAMING WHAT WAS CHECKED, because a count that does not is a count nobody
    can tell from a check that looked at nothing. `npm run space` printed a
    perfect 0px over a selector that matched nothing, and the fix there was the
    same: say what you measured to.
  */
  `check:templates clean — ${FILES.length} web file(s) parse as modules with no backticks in ` +
    `HTML comments, ${String(SQL_SCANNED)} SQL template literal(s) across src, scripts, tests ` +
    'and supabase carry no backtick inside a comment, and no source file carries a stray ' +
    'control character',
)
