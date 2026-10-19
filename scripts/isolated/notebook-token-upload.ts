/**
 * Issue #502 — an uploaded NotebookLM master token is checked, then stored, and nothing else is accepted.
 *
 *   npx tsx scripts/isolated/notebook-token-upload.ts <replica-db>
 *
 * Drives the REAL `app.hq_set_notebook_token` (migration 1085) and the vault it writes, inside a rolled-back
 * transaction. Replica only; the guard refuses anything else. The token used here is a fixture with the right shape,
 * never a real credential.
 *
 * Asserts:
 *   1. an empty file, a file that is not JSON, and a storage_state.json are each refused with a sentence, and none
 *      of them stores anything;
 *   2. a master token that starts aas_et/ is stored under notebook.master_token_json and answered with the account only;
 *   3. CONTROL: a master token whose prefix is not aas_et/ is refused, so the shape check is what does the refusing.
 */
import { isolated } from './guard.ts'

const db = await isolated(process.argv[2] ?? 'post')
const results: { what: string; ok: boolean; detail: string }[] = []
const check = (what: string, ok: boolean, detail: string) => {
  results.push({ what, ok, detail })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what} — ${detail}`)
}
const one = async (sql: string) => (await db.execute(sql)).rows[0] as Record<string, unknown>
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`
const stored = async () =>
  Number(
    (
      await one(
        `select count(*)::int as n from vault.secrets where name = 'notebook.master_token_json'`,
      )
    ).n,
  )
const call = async (token: string) =>
  String((await one(`select app.hq_set_notebook_token(${lit(token)})::text as r`)).r)

await db.execute('begin')
try {
  const empty = await call('')
  check(
    'an empty file is refused with a sentence, and nothing is stored',
    /file was empty/.test(empty) && (await stored()) === 0,
    empty.slice(0, 90),
  )

  const notJson = await call('not a token file')
  check(
    'a file that is not JSON is refused, and nothing is stored',
    /not a JSON file/.test(notJson) && (await stored()) === 0,
    notJson.slice(0, 90),
  )

  const storageState = await call('{"cookies":[{"name":"SID","value":"fixture"}]}')
  check(
    'a storage_state.json (the cookie jar) is refused, and nothing is stored',
    /storage_state\.json is the wrong file/.test(storageState) && (await stored()) === 0,
    storageState.slice(0, 90),
  )

  const good = await call(
    JSON.stringify({
      master_token: 'aas_et/FIXTURE-NOT-A-CREDENTIAL',
      email: 'agentic.team.grant@gmail.com',
    }),
  )
  const accepted = JSON.parse(good) as { ok?: boolean; account?: string }
  check(
    'a master token that starts aas_et/ is stored under notebook.master_token_json and answered with the account only',
    accepted.ok === true &&
      accepted.account === 'agentic.team.grant@gmail.com' &&
      (await stored()) === 1,
    `ok=${String(accepted.ok)} account=${String(accepted.account)} stored=${String(await stored())}`,
  )
  check(
    'the answer does not contain the token value',
    !good.includes('FIXTURE-NOT-A-CREDENTIAL'),
    'the reply names the account, not the secret',
  )

  // CONTROL: the same shape with the wrong prefix must be refused, so the prefix check is what refuses it.
  await db.execute(`delete from vault.secrets where name = 'notebook.master_token_json'`)
  const wrongPrefix = await call(JSON.stringify({ master_token: 'xx_et/FIXTURE', email: 'a@b.c' }))
  check(
    'CONTROL: a master_token that does not start aas_et/ is refused, and nothing is stored',
    /master token file/.test(wrongPrefix) && (await stored()) === 0,
    wrongPrefix.slice(0, 90),
  )
} finally {
  await db.execute('rollback')
  await db.end()
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${String(results.length - failed.length)}/${String(results.length)} ok`)
process.exitCode = failed.length === 0 ? 0 : 1
