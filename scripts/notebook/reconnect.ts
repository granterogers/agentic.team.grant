/**
 * Reconnect NotebookLM for Team HQ, from the computer Grant runs it on.
 *
 *   npm run notebook:reconnect
 *
 * Use the file `scripts/notebook/Reconnect NotebookLM.command` (double-click on a Mac), which asks you to type YES
 * and then sets the two production flags for this one run. Running this script directly does the same thing.
 *
 * Two steps:
 *   1. The NotebookLM tool opens a browser. You sign in as the team's account and come back.
 *   2. The sign-in it saves is handed to `notebook:deploy`, which stores it in the office vault.
 *
 * The token is never printed, written to the repository, or pasted anywhere. It travels from the saved file to the
 * deploy script in this process's environment only.
 */
import '../../src/safety/require-production-writes.ts'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const ACCOUNT = 'agentic.team.grant@gmail.com'
const home = process.env.NOTEBOOKLM_HOME ?? join(homedir(), '.notebooklm')
const profile = process.env.NOTEBOOKLM_PROFILE ?? 'default'
const tokenPath = join(home, 'profiles', profile, 'master_token.json')

const installed = spawnSync('notebooklm', ['--help'], { stdio: 'ignore' })
if (installed.error !== undefined) {
  console.error(
    'The NotebookLM tool is not installed on this computer. Install it once, then run this again:',
  )
  console.error('  pip install "notebooklm-py[headless,browser]"')
  process.exit(1)
}

console.log(
  `Step 1 of 2: a browser window opens. Sign in as ${ACCOUNT}, then come back to this window.`,
)
const login = spawnSync('notebooklm', ['login', '--master-token', '--account', ACCOUNT], {
  stdio: 'inherit',
})
if (login.status !== 0 || !existsSync(tokenPath)) {
  console.error('The sign-in did not finish, so nothing in the office was changed. Run this again.')
  process.exit(1)
}

console.log('Step 2 of 2: saving the new sign-in to the office vault.')
const tokenJson = readFileSync(tokenPath, 'utf8')
const deploy = spawnSync('npm', ['run', '-s', 'notebook:deploy'], {
  stdio: 'inherit',
  env: { ...process.env, NOTEBOOK_MASTER_TOKEN_JSON: tokenJson },
})
if (deploy.status !== 0) {
  console.error(
    `The vault step failed. Your sign-in is still saved on this computer at ${tokenPath}. Run this again.`,
  )
  process.exit(1)
}
console.log('Done. NotebookLM is reconnected. Check Team HQ → Settings → Connections.')
