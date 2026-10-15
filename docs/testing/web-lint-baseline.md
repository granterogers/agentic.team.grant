# Web JavaScript and CSS lint baseline (verification gap)

**Measured:** 14 October 2026, on branch feature/auth-storage-portability-ui at ada8ccd.
**Status:** measurement only. Nothing in the gate enforces it yet.

## The gap

`biome.json` includes only `**/*.ts` and `**/*.json`. Running Biome on the web studio files reports "no files were processed", so every "biome clean" statement in earlier notes covered TypeScript only. The web studio (`web/studio`) is plain JavaScript and CSS, which `npm run check:templates` parses but does not lint.

## How it was measured

A scratch config outside the repository, in `.out/biome-web/biome.json`, includes `web/studio/**/*.js` and `**/*.css` with the recommended linter rules and the formatter off. The repository config was not changed.

    npx biome lint --config-path=.out/biome-web web/studio

## Result

| | Count |
|---|---|
| Files | 72 JavaScript, 17 CSS |
| Errors | 22 |
| Warnings | 257 |
| Infos | 21 |

Of the 22 errors, a grep of the Biome output matched 20 by rule name:

| Rule | Matched count |
|---|---|
| lint/suspicious/noAssignInExpressions (JavaScript) | 9 |
| lint/style/noDescendingSpecificity (CSS) | 8 |
| lint/complexity/noImportantStyles (CSS) | 2 |
| lint/suspicious/noDuplicateProperties (CSS) | 1 |

The other two errors did not parse into a rule name with that grep, and the warnings and infos were not broken down by rule. Their rule names are not stated here; the next step is to read the full Biome output with its escape sequences handled. The file names for the matched errors were not recorded separately, so they are not listed.

## What this means

## Comparison with main (partly reconciled)

Lint of an exported copy of origin/main's web/studio, same scratch config, JSON reporter:

| | Errors | Warnings | Infos | Diagnostics |
|---|---|---|---|---|
| origin/main | 22 | 251 | 21 | 294 |
| this branch (ada8ccd) | 22 | 257 | 21 | 300 |

- Errors are identical.
- The warning difference is +6 on the branch, made up of +6 noFocusedTests in app.js, +3 in bc/stage.js and -3 in bc/refine.css (noDescendingSpecificity, 11 to 8). Those per-file figures come from the JSON reporter, not from text parsing.
- The noFocusedTests findings are false positives. They flag calls to a function named fit() (zoom-to-fit on the canvas), which the rule reads as the Jasmine focused-test helper. No test is focused.
- **Not reconciled:** app.js differs from main by two lines (the branch is missing two lines main has), and bc/stage.js is byte-identical on both sides, yet its three findings appear only in the branch run. A single-file lint of the exported main copy printed nothing, so the harness is not yet reliable enough to say why stage.js differs. Until that is settled, the attribution of the +6 is provisional.

What this means: the branch adds no new errors against main. The warnings rise by six, and the likely cause is the fit() name, not a defect; this is not yet proven. Making the comparison trustworthy needs the scratch config run against both trees under the same path layout, with the single-file case explained.
- The CSS errors are the kind a browser tolerates and a reader can miss, which is why they are recorded rather than assumed harmless.
- The JavaScript assignment-in-expression findings are the only JavaScript rule matched. Each needs reading before a change, because an assignment inside a condition can be intentional.

## What would close the gap

1. Decide, per rule, whether to fix the 22 errors or to suppress with a reason. Suppressions need a comment that says why.
2. Add the web files to the Biome include list (or a separate config), with the rules above, and make the baseline a ceiling: the count may not rise.
3. Keep `check:templates` as the parse gate. Biome does not replace it.

Not done here: the fixes, the config change and the ceiling. Each changes files outside this branch's feature work, so they are recorded as the next step rather than folded in.
