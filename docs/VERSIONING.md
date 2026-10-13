# Versioning

The project uses semantic versioning in the form `MAJOR.MINOR.PATCH`, written once, in `package.json` (`"version"`).

- **PATCH** (`0.1.0` to `0.1.1`): a fix that changes no behaviour a person relies on (a defect corrected, a layout restored).
- **MINOR** (`0.1.0` to `0.2.0`): a change a person would notice and can use: a new screen, control or capability. Still compatible.
- **MAJOR** (`0.x` to `1.0.0`, then `1.x` to `2.0.0`): a change that breaks what a person or another system depends on, or the
  point at which the product is declared ready for general use.

The current version is `0.1.0`: the Team HQ release line, before the 1.0 declaration.

## Where it is shown

- The Team HQ home screen (the board with no project open) shows `vX.Y.Z` in its top-right corner, muted and at the 12px type
  floor. It is not drawn inside a project.
- The page reads the number from `window.HQ_VERSION`, which `scripts/config-site.ts` writes into `web/studio/config.js` from
  `package.json` when the file is generated. `config.js` is generated, not committed, so the version a deployment shows is the one
  in `package.json` when that deployment's `config.js` was generated.

## How to bump it

1. Edit `"version"` in `package.json` by the rule above, in the commit that makes the change.
2. Regenerate the page config (`npm run config:site`) before deploying, so the deployed `config.js` carries the new number.
3. Record the version in the release record for the deployment (`docs/ux-overhaul/RELEASE-CANDIDATE.md` for Team HQ).

The check `scripts/verify/probe-version.ts` proves the number on the home screen matches `package.json`, and that nothing is drawn
when `config.js` carries no version.
