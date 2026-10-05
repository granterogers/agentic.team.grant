/**
 * Every `var(--token)` names a token some stylesheet actually defines.
 *
 * ## Why this exists
 *
 * CSS resolves an undefined custom property to nothing and carries on. There
 * is no error, no warning, and no visual signature that says "this rule was
 * ignored" — the element simply renders without the shadow, the radius or the
 * colour, which is a design somebody could have chosen. So a typo in a token
 * name is invisible to every check this repository has: it is not overflow,
 * not low contrast, not small type and not a dead control, and the captures
 * look plausible.
 *
 * It has already cost a full day, twice over:
 *
 * - #124's density commit opened a `:root[data-density='compact']` block above
 *   the base radius tokens; the brace swallowed them and **44 rules reading
 *   `var(--r-card)` computed to 0** in the default density. Every card and
 *   control in the product had square corners, deployed, for a day.
 * - Writing the browsing thumbnail, `var(--shadow-1)` was invented for a token
 *   family actually called `--lift-*`. It passed `check:templates`, `smoke`
 *   and the formatter, and would have shipped a flat thumbnail.
 *
 * The first one is the reason the check reads DEFINITIONS by brace depth
 * rather than by a regular expression over the file: a token defined inside an
 * unbalanced block is defined for that block only, and a grep would report it
 * as present.
 */
import { globSync, readFileSync } from 'node:fs'

/*
  Two things had to be true before any finding here was worth believing, and
  the first run of this check got both wrong — which is the rule this
  repository uses most: validate the test before believing the finding.

  **A token can be set from JavaScript.** `style.setProperty('--tilt', …)` and
  an inline `style="--dot: …"` in a template are how the studio drives its
  motion, so a stylesheet reading `var(--rest-tilt)` is correct and the
  stylesheets will never define it. Those are collected below and counted as
  definitions.

  **A fallback is a decision, not an accident.** `var(--r-field, 10px)` says
  "10px unless something overrides this", which is a perfectly good thing to
  write and renders exactly as intended when nothing does. Only a BARE `var()`
  on a missing token renders nothing at all, which is the failure this check
  exists for. Reporting the two together turned 17 real uses into 36 and would
  have sent somebody defining tokens that were deliberately optional.
*/
const files = globSync('web/**/*.css')
const scripts = globSync('web/**/*.js')

/** Every `--name:` that is a DECLARATION rather than a use. */
const defined = new Set<string>()
/*
  AND THE SECOND BASE: an EXPERIENCE.

  `web/studio/bc` declares its `--bc-*` tokens under
  `:root[data-experience='basecamp']`, which is not unconditional and is not a
  skin or a density either. It is a whole alternative experience, and every
  rule that reads those tokens is itself scoped to it -- so within basecamp
  they are as reliable as a `:root` token, and outside it they are correctly
  nothing.

  Modelled rather than exempted. A declaration counts as an experience base
  only when its selector is EXACTLY that experience: `[data-experience='x']`
  or `:root[data-experience='x']`, with nothing narrowing it further. A token
  declared on a component inside an experience is still component-scoped, so
  #124's defect -- a token declared under a narrower block and read by rules
  that apply more widely -- is still caught, one level in.

  And a use only counts as satisfied when the use is inside the SAME
  experience -- by its own selector, or by living in that experience's own
  stylesheets. The second half is not a loosening for convenience: `.bcskip` is
  a rule with no `[data-experience]` on it at all, and it is nonetheless
  basecamp-only, because the only thing that ever renders an element with that
  class is the basecamp shell. The directory is DERIVED rather than listed --
  it is wherever the file declaring that experience's base tokens lives -- so
  a second experience added tomorrow is covered tomorrow.

  A `--bc-*` read from the default studio's stylesheet computes to nothing, and
  this still says so.
*/
const experienceBase = new Map<string, Set<string>>()
/** Where each experience declares its base, so its own stylesheets are known. */
const experienceHome = new Map<string, Set<string>>()
const EXPERIENCE_BASE = /^(?::root)?\[data-experience='([a-z0-9-]+)'\]$/
const NAMES_EXPERIENCE = /\[data-experience='([a-z0-9-]+)'\]/

/** Every `var(--name)` with the file, line, and the experiences it sits in. */
const used: { token: string; file: string; line: number; within: Set<string> }[] = []

/**
 * The tokens a block declares, and whether that block always applies.
 *
 * A regular expression over lines cannot answer the second question, and the
 * second question is the expensive one. #124's density commit opened a
 * `:root[data-density='compact']` block immediately above the base radius
 * tokens; the brace swallowed them, so `--r-card` was declared ONLY for
 * compact density and 44 rules reading it computed to 0 in the default. A
 * line-wise grep sees `--r-card:` present and reports nothing — which is
 * exactly what the first version of this check did when that defect was
 * reproduced against it.
 *
 * So the file is scanned with a brace counter. A declaration counts as BASE
 * when the block it sits in applies unconditionally — `:root` or `html`, with
 * no attribute, class or pseudo-class narrowing it — and is not inside an
 * at-rule. Anything else is a skin, a density or a media query: real, and not
 * something a bare `var()` may rely on.
 */
const BASE_SELECTOR = /^(:root|html|\*)(\s*,\s*(:root|html|\*))*$/

/*
  A COMPONENT SCOPE: a token declared on a plain id or class list (`#settings, .stg-confirm { --st-panel: ... }`), with no
  attribute, pseudo-class, `:root` or descendant narrowing it. The settings sheet declares its 299 `--st-*` reads this way and
  reads them only inside its own stylesheet, so they are defined for that FILE and nowhere else. This is deliberately not a
  rule that any declaration in the same file counts: #124's defect was a base token swallowed by an attribute-narrowed
  `:root[data-density=...]` block, which this pattern does not match, so that defect is still caught.
*/
const COMPONENT_SCOPE = /^(#[a-z0-9_-]+|\.[a-z0-9_-]+)(\s*,\s*(#[a-z0-9_-]+|\.[a-z0-9_-]+))*$/i
const fileScope = new Map<string, Set<string>>()

for (const file of files) {
  const raw0 = readFileSync(file, 'utf8')
  /*
    Comments are removed FIRST, with the newlines kept so line numbers still
    line up. Without this the selector accumulated before a block's brace
    includes the explanatory comment above it, `:root` fails to look like
    `:root`, and the check reports every base token in the file as missing —
    which is what it did on its first run with the brace parser.
  */
  const text = raw0.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  /** The selector of each open block, outermost first. */
  const stack: string[] = []
  let token = ''
  let line = 1
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '{') {
      stack.push(token.trim().replace(/\s+/g, ' '))
      token = ''
      continue
    }
    if (c === '}') {
      stack.pop()
      token = ''
      continue
    }
    if (c === ';') {
      const decl = /^\s*(--[a-z0-9-]+)\s*:/i.exec(token)
      if (decl !== null && stack.length > 0) {
        const inAtRule = stack.some((sel) => sel.startsWith('@'))
        const here = stack[stack.length - 1] ?? ''
        const named = decl[1]
        if (!inAtRule && named !== undefined) {
          if (BASE_SELECTOR.test(here)) defined.add(named)
          else if (COMPONENT_SCOPE.test(here)) {
            const set = fileScope.get(file) ?? new Set<string>()
            set.add(named)
            fileScope.set(file, set)
          } else {
            const asExperience = EXPERIENCE_BASE.exec(here)
            const which = asExperience?.[1]
            if (which !== undefined) {
              const set = experienceBase.get(which) ?? new Set<string>()
              set.add(named)
              experienceBase.set(which, set)
              const home = experienceHome.get(which) ?? new Set<string>()
              home.add(file.slice(0, file.lastIndexOf('/')))
              experienceHome.set(which, home)
            }
          }
        }
      }
      token = ''
      continue
    }
    if (c === '\n') line += 1
    /*
      Uses are collected HERE rather than line-wise, because the enclosing
      selector is the thing that decides whether an experience token is
      legitimately in reach, and only the brace walk knows it.
    */
    if (c === ')') {
      const m = /var\(\s*(--[a-z0-9-]+)\s*$/i.exec(token)
      const named = m?.[1]
      if (named !== undefined) {
        const within = new Set<string>()
        for (const sel of stack) {
          for (const e of sel.matchAll(new RegExp(NAMES_EXPERIENCE, 'g'))) {
            if (e[1] !== undefined) within.add(e[1])
          }
        }
        used.push({ file, line, token: named, within })
      }
    }
    token += c
  }
}

// A token the page sets on an element at runtime is defined, just not here.
for (const file of scripts) {
  const text = readFileSync(file, 'utf8')
  for (const m of text.matchAll(/setProperty\(\s*['"`](--[a-z0-9-]+)/gi)) {
    if (m[1] !== undefined) defined.add(m[1])
  }
  for (const m of text.matchAll(/style\s*=\s*["'`][^"'`]*?(--[a-z0-9-]+)\s*:/gi)) {
    if (m[1] !== undefined) defined.add(m[1])
  }
}

/**
 * Tokens that are legitimately not declared at `:root`, each with its reason.
 *
 * A baseline with a reason rather than a looser rule, which is the convention
 * `check:pressable` already uses: an entry somebody has to justify in words is
 * one somebody will notice going stale, and a rule widened to accommodate two
 * cases stops catching the case it was written for.
 *
 * Both of these are declared by EVERY skin block in `skins.css`, and the root
 * always carries a skin, so they are always set — they are simply set one
 * level below `:root`.
 */
const BASELINE: Record<string, string> = {
  '--tex-ink': 'declared by every skin in skins.css; the root always carries a skin',
  '--tex-src': 'declared by every texture block in skins.css, beside --tex',
  '--stage':
    "declared per stage by [data-experience='basecamp'] [data-stage='…'] in compose.css and read by that element's own rules",
  '--stage-todo':
    'declared on .bcboard and .bcminiboard in compose.css; the stage rows that read it are descendants and inherit it',
  '--stage-doing': 'declared beside --stage-todo, on the same two boards',
  '--stage-blocked': 'declared beside --stage-todo, on the same two boards',
  '--stage-done': 'declared beside --stage-todo, on the same two boards',
  '--bc-mod':
    "declared on [data-experience='basecamp'] .bcmod in compose.css, per module kind, and read by that element and its own descendants",
  '--bc-mod-ink': 'declared beside --bc-mod on the same element, and re-declared on hover',
  '--bcfade':
    'declared in the SAME rule that reads it (compose.css, the scroll-fade pane) and registered with @property; it is the target of a scroll-driven animation, so it is a local variable and not a design token (#383)',
}

const inReach = (u: { token: string; within: Set<string>; file: string }): boolean => {
  if (defined.has(u.token)) return true
  if (fileScope.get(u.file)?.has(u.token) === true) return true
  for (const [experience, tokens] of experienceBase) {
    if (!tokens.has(u.token)) continue
    if (u.within.has(experience)) return true
    const home = experienceHome.get(experience)
    if (home !== undefined && [...home].some((dir) => u.file.startsWith(`${dir}/`))) return true
  }
  return false
}

const missing = used.filter((u) => !inReach(u) && BASELINE[u.token] === undefined)

/*
  A found-nothing check needs a control, because a check that has only ever
  reported zero is indistinguishable from one that cannot report anything.
  This one is cheap and exact: the parser must be able to see a token that is
  genuinely absent.
*/
const CONTROL = '--a-token-nothing-defines'
const controlWorks = !defined.has(CONTROL) && /var\(\s*--[a-z0-9-]+/.test('var(--x)')

console.log(
  `${String(defined.size)} base token(s) defined, ` +
    `${[...experienceBase].map(([e, t]) => `${String(t.size)} for ${e}`).join(', ')}, ` +
    `${String(used.length)} bare use(s) across ` +
    `${String(files.length)} stylesheet(s) and ${String(scripts.length)} script(s)`,
)

if (!controlWorks) {
  console.error(
    'the control failed: this check cannot detect an absent token, so its silence means nothing',
  )
  process.exit(1)
}

if (missing.length === 0) {
  console.log(
    `every bare var() names a token declared at :root (${String(Object.keys(BASELINE).length)} baselined, each with a reason)`,
  )
  process.exit(0)
}

console.error(`\n${String(missing.length)} use(s) of a token nothing defines:\n`)
for (const m of missing) console.error(`  ${m.file}:${String(m.line)}  ${m.token}`)
console.error(
  '\nCSS resolves an undefined custom property to nothing and carries on, so this\n' +
    'renders as a missing shadow, radius or colour rather than as an error.\n',
)
process.exit(1)
