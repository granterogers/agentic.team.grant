/**
 * PUT A CREDENTIAL IN YOUR OFFICE'S VAULT.
 *
 *   npm run fresh:secret -- openrouter.api_key
 *   npm run fresh:secret -- telegram.chief.bot_token
 *
 * It prompts. The value is not echoed as you type it, not printed back, not
 * written to a file, and not put in your shell history — which is the whole
 * reason this exists rather than a line of SQL in the setup document.
 *
 * ## Why it never takes the value as an argument
 *
 * `npm run fresh:secret -- openrouter.api_key sk-or-v1-...` would be the
 * obvious convenience and it is refused. An argument is in `ps` output while it
 * runs, in `~/.bash_history` afterwards, and in the terminal scrollback for
 * anybody who walks past. Grant's standing instruction is the shorter version:
 * *"Do not ask me to paste secrets into chat. Use the project's established
 * secret-management mechanism."*
 *
 * A pipe is allowed, because a pipe is how a password manager hands a value to
 * a command without a human or a file in the middle.
 */
import { createInterface } from 'node:readline'
import { ManagementApiExecutor, type SqlExecutor } from '../../src/db/executor.ts'
import { PostgresExecutor } from '../../src/db/postgres-executor.ts'
import { isHarnessDb, localUrl } from '../../src/fresh/local-db.ts'

/**
 * Names the office understands, with what each is for.
 *
 * A list rather than free text because a credential stored under a name nothing
 * reads is a credential that does nothing, and the failure is silent: setup
 * looks complete and the feature never works. `vault.naming` in the office's
 * own config states the convention these follow.
 */
const KNOWN: Record<string, string> = {
  'openrouter.api_key': 'the office’s ability to think — required',
  'telegram.chief.bot_token': 'the Chief of Staff’s Telegram bot',
  'slack.bot_token': 'Slack, the bot user token (starts xoxb-)',
  'slack.signing_secret': 'Slack, for verifying that requests really came from Slack',
  'notion.integration_token': 'Notion, the internal integration secret',
  'openai.api_key': 'spoken conversation — the one paid feature',
  'google.refresh_token': 'Google, normally written by the Connect button rather than by hand',
  'notion.integration_token ': 'Notion',
}

function connect(): { db: SqlExecutor; where: string } {
  const ref = process.env.SUPABASE_PROJECT_REF
  const token = process.env.SUPABASE_ACCESS_TOKEN
  if (ref !== undefined && ref !== '' && token !== undefined && token !== '') {
    return { db: new ManagementApiExecutor(ref, token), where: `Supabase project ${ref}` }
  }
  const local = process.env.FRESH_DB
  if (isHarnessDb(local)) {
    return { db: new PostgresExecutor(localUrl(local)), where: `local database ${local}` }
  }
  throw new Error(
    'No office to store this in. Set SUPABASE_PROJECT_REF and SUPABASE_ACCESS_TOKEN first — ' +
      'run npm run fresh:doctor and it will tell you how.',
  )
}

/** Read a value without echoing it, from a terminal or from a pipe. */
async function readSecret(prompt: string): Promise<string> {
  if (!process.stdin.isTTY) {
    // Piped: read it all, and take only the first line so a trailing newline
    // from `echo` does not become part of the credential.
    const chunks: Buffer[] = []
    for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk))
    return Buffer.concat(chunks).toString('utf8').split('\n')[0] ?? ''
  }
  process.stdout.write(prompt)
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true })
  // Suppress the echo by writing nothing for each keypress.
  const asMutable = rl as unknown as { output: { write: (s: string) => void } }
  const realWrite = asMutable.output.write.bind(asMutable.output)
  asMutable.output.write = (s: string) => {
    if (!s.includes('\n')) return
    realWrite('\n')
  }
  return await new Promise<string>((resolve) => {
    rl.question('', (answer) => {
      asMutable.output.write = realWrite
      rl.close()
      resolve(answer)
    })
  })
}

function quote(v: string): string {
  return `'${v.replace(/'/g, "''")}'`
}

async function main(): Promise<void> {
  const name = process.argv[2]
  const stray = process.argv[3]

  if (name === undefined) {
    console.log('\nWhich credential? Give its name:\n')
    for (const [key, what] of Object.entries(KNOWN)) console.log(`  ${key.padEnd(30)} ${what}`)
    console.log('\n  npm run fresh:secret -- openrouter.api_key\n')
    process.exit(2)
  }

  if (stray !== undefined) {
    // Say nothing about what the extra argument WAS.
    console.error(
      '\nRefusing: it looks like you passed the value on the command line.\n\n' +
        'A value in an argument is in your shell history, in `ps` output while this runs,\n' +
        'and in your terminal scrollback. Run it with just the name and it will prompt you,\n' +
        'without echoing what you type:\n\n' +
        `    npm run fresh:secret -- ${name}\n\n` +
        'If that credential is now in your history, treat it as exposed and rotate it.\n',
    )
    process.exit(2)
  }

  if (KNOWN[name] === undefined) {
    console.error(
      `\n"${name}" is not a name this office reads.\n\n` +
        'Storing a credential under a name nothing looks for is the worst kind of\n' +
        'mistake here: setup looks finished and the feature never works, silently.\n\n' +
        `Known names:\n${Object.keys(KNOWN)
          .map((k) => `    ${k}`)
          .join('\n')}\n`,
    )
    process.exit(2)
  }

  const { db, where } = connect()
  const value = (await readSecret(`Paste the value for ${name} (it will not be shown): `)).trim()

  if (value === '') {
    console.error('\nNothing was entered. Nothing stored.')
    process.exit(2)
  }

  /*
    Refuse an invisible character before refusing anything else.

    CLAUDE.md records this costing three refusals of a correct token: a
    zero-width space at the front of a pasted secret breaks every prefix match
    and there is nothing on screen to see. `trim` does not remove what is
    invisible. Stripped rather than refused, because the person pasted the right
    thing and the character is their clipboard's fault, not theirs.
  */
  const cleaned = value.replace(/[​-‍﻿ ]/g, '')

  await db.execute(
    `select app.store_secret(${quote(name)}, ${quote(cleaned)}, ` +
      `${quote(KNOWN[name] ?? 'stored during setup')}) as ref`,
  )

  // Say what was stored and where. NEVER what it was, and never how long it
  // was — a length is a fact about a credential.
  console.log(`\nStored ${name} in the vault of ${where}.`)
  console.log('The value was not printed, not logged and not written to disk.')
  console.log('\nNext: npm run fresh:doctor')
}

await main()
