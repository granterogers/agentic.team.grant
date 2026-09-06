/**
 * Install the Python side of the stack.
 *
 *   npm run setup:python
 *
 * There is exactly one Python dependency: `notebooklm-py`, the NotebookLM
 * adapter. §7 keeps it behind an adapter boundary and ADR-0003 makes it
 * replaceable, but while it is in service it has to be installed, and nothing
 * installed it.
 *
 * That was not a theoretical gap. The library was present in one container,
 * that container was reclaimed, and the next session's probe reported
 * `unavailable` with `No module named 'notebooklm'` — which from the outside is
 * indistinguishable from an expired credential, and on an integration whose
 * account had genuinely been suspended a week earlier, that is the worst
 * possible ambiguity to leave lying around.
 *
 * `npm ci` does not run this: it takes a network round trip and most work in
 * this repository never touches the notebook. It is named in the startup
 * runbook instead, and `npm run inventory` reports whether the module imports,
 * so a missing install shows up as itself rather than as a dead credential.
 */

import { spawnSync } from 'node:child_process'

const PACKAGES = ['notebooklm-py']

console.log(`installing: ${PACKAGES.join(', ')}`)

const result = spawnSync('pip', ['install', '--quiet', ...PACKAGES], {
  stdio: ['ignore', 'inherit', 'inherit'],
})

if (result.error !== undefined) {
  console.error(`pip could not be run: ${result.error.message}`)
  process.exit(1)
}
if (result.status !== 0) {
  console.error(`pip exited ${String(result.status)}`)
  process.exit(1)
}

// Importing is the check, not "pip said ok". A package can install and still
// fail to import — a wrong Python on the PATH, a partial wheel — and the
// failure mode this script exists to remove is exactly "it looked fine".
const check = spawnSync('python3', ['-c', 'import notebooklm; print(notebooklm.__name__)'], {
  encoding: 'utf8',
})
if (check.status !== 0) {
  console.error(`installed, but the module does not import:\n${String(check.stderr).slice(0, 300)}`)
  process.exit(1)
}

console.log(
  `✅ ${String(check.stdout).trim()} imports. \`npm run notebook:probe\` will now reach Google.`,
)
