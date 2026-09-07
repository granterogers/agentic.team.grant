import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { ManagementApiExecutor } from './src/db/executor.ts'

const run = promisify(execFile)
const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  process.env.SUPABASE_ACCESS_TOKEN ?? '',
)
const state = String(
  (
    await db.execute(
      "select decrypted_secret as s from vault.decrypted_secrets where name='notebook.storage_state'",
    )
  ).rows[0]?.s,
)
const r = await run('python3', [process.argv[2] ?? '/tmp/nb.py'], {
  env: { ...process.env, NOTEBOOK_STORAGE_STATE: state },
  maxBuffer: 16e6,
})
console.log(r.stdout)
