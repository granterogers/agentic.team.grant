/**
 * Make the NotebookLM token file on this computer, for upload in Team HQ (issue #502).
 *
 *   npm run notebook:make-token
 *
 * Or double-click `scripts/notebook/Make NotebookLM Token.command` on a Mac.
 *
 * A browser opens. Sign in as the team's account and come back to this window. The script then checks the file the
 * sign-in made, and copies it to your Desktop as notebook-master-token.json. Then go to Team HQ → Settings →
 * Connections → NotebookLM and choose that file with "Upload token".
 *
 * This script contacts nothing except Google's sign-in, and writes nothing to the office. The file it leaves on your
 * Desktop is a full-account credential: upload it, then delete it.
 */
import { spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const ACCOUNT = 'agentic.team.grant@gmail.com'
const home = process.env.NOTEBOOKLM_HOME ?? join(homedir(), '.notebooklm')
const profile = process.env.NOTEBOOKLM_PROFILE ?? 'default'
const madeBy = join(home, 'profiles', profile, 'master_token.json')
const desktop = existsSync(join(homedir(), 'Desktop')) ? join(homedir(), 'Desktop') : homedir()
const out = join(desktop, 'notebook-master-token.json')

const installed = spawnSync('notebooklm', ['--help'], { stdio: 'ignore' })
if (installed.error !== undefined) {
  console.error(
    'The NotebookLM tool is not installed on this computer. Install it once, then run this again:',
  )
  console.error('  pip install "notebooklm-py[headless,browser]"')
  process.exit(1)
}

console.log(`A browser window opens. Sign in as ${ACCOUNT}, then come back to this window.`)
const login = spawnSync('notebooklm', ['login', '--master-token', '--account', ACCOUNT], {
  stdio: 'inherit',
})
if (login.status !== 0 || !existsSync(madeBy)) {
  console.error('The sign-in did not finish. Nothing was saved. Run this again.')
  process.exit(1)
}

// The same check the office makes, so a wrong file is caught here and not after the upload.
let token: unknown
try {
  token = JSON.parse(readFileSync(madeBy, 'utf8'))
} catch {
  console.error('The sign-in made a file that is not JSON. Nothing was saved. Run this again.')
  process.exit(1)
}
const master = (token as { master_token?: unknown }).master_token
if (typeof master !== 'string' || !master.startsWith('aas_et/')) {
  console.error(
    'The sign-in made a file, but not the master token file. Nothing was saved. Run this again.',
  )
  process.exit(1)
}

copyFileSync(madeBy, out)
chmodSync(out, 0o600)
console.log(`Saved: ${out}`)
console.log(
  'Next: Team HQ → Settings → Connections → NotebookLM → Upload token, and choose that file.',
)
console.log('Then delete the file from your Desktop. It is a full-account credential.')
