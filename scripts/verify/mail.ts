/**
 * The Gmail reader, against a fake Google and a real database.
 *
 *   npm run verify:mail
 *
 * Same split as `verify:calendar` and for the same reason: the interesting
 * behaviour is what gets STORED — the header parse, the upsert, the
 * disappearance sweep, and above all that a body never lands in a row — and
 * none of that can be checked against a stub database.
 *
 * Grant has registered the Google app but not pressed Connect, so a fixture
 * refresh token is borrowed for the run and removed afterwards only if it is
 * still the fixture. Every fetch here is faked; nothing reaches Google.
 */

import { ManagementApiExecutor } from '../../src/db/executor.ts'
import { parseFrom, refreshMail } from '../../src/google/mail.ts'

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
const run = Date.now().toString(36)

const supabase = process.env.SUPABASE_ACCESS_TOKEN ?? ''
if (supabase === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}
const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  supabase,
)
const one = async (sql: string): Promise<Record<string, unknown> | undefined> =>
  (await db.execute(sql)).rows[0] as Record<string, unknown> | undefined

const checks: { what: string; outcome: string; passed: boolean }[] = []
const record = (what: string, outcome: string, passed: boolean): void => {
  checks.push({ what, outcome, passed })
  console.log(`${passed ? '✅' : '❌'} ${what} — ${outcome}`)
}

/** Ids nothing real uses, so this cannot touch Grant's own cache. */
const ID = (n: number): string => `fixture-mail-${run}-${String(n)}`
const FIXTURE_REFRESH = `1//fixture-refresh-${run}`

const already = (await one(`
    select
      coalesce((select value #>> '{}' from public.system_config
                 where key = 'google.client_id'), '') <> '' as has_id,
      exists (select 1 from vault.secrets where name = 'google.client_secret') as has_secret,
      exists (select 1 from vault.secrets where name = 'google.refresh_token') as has_refresh
  `)) as { has_id: boolean; has_secret: boolean; has_refresh: boolean }

const state =
  already.has_id && already.has_secret && already.has_refresh
    ? 'connected'
    : already.has_id && already.has_secret
      ? 'registered'
      : !already.has_id && !already.has_secret && !already.has_refresh
        ? 'nothing'
        : 'incoherent'
if (state === 'incoherent') {
  console.error('Google is half-configured in a way that is not "not connected yet". Refusing.')
  process.exit(2)
}
console.log(`Google is: ${state}`)
const injected = state !== 'connected'
const injectedClient = state === 'nothing'

const wasEnabled = (
  await one(`select coalesce((select value::text::boolean from public.system_config
                               where key = 'gmail.enabled'), false) as on`)
)?.on

/** Restored at the end, whatever happens. */
const restore = async (): Promise<void> => {
  await db.execute(`
    update public.system_config set value = to_jsonb(${String(wasEnabled === true)})
     where key = 'gmail.enabled';
    delete from public.mail_messages where message_id like ${lit(`fixture-mail-${run}-%`)};
  `)
  if (!injected) return
  // Only if it is STILL the fixture: if Grant pressed Connect mid-run, the
  // vault now holds his real token and deleting it would undo a human's work.
  await db.execute(`
    delete from vault.secrets
     where name = 'google.refresh_token'
       and id in (select id from vault.decrypted_secrets
                   where name = 'google.refresh_token'
                     and decrypted_secret = ${lit(FIXTURE_REFRESH)});
  `)
  if (!injectedClient) return
  await db.execute(`
    update public.system_config set value = to_jsonb(''::text) where key = 'google.client_id';
    delete from vault.secrets where name = 'google.client_secret';
  `)
}

if (injectedClient) {
  await db.execute(`
    insert into public.system_config (key, value, description)
    values ('google.client_id', to_jsonb('fixture.apps.googleusercontent.com'::text), 'fixture')
    on conflict (key) do update set value = excluded.value;
    select app.store_secret('google.client_secret', 'GOCSPX-fixture',
      'verify:mail fixture; removed at the end of the run');
  `)
}
if (injected) {
  await db.execute(`
    select app.store_secret('google.refresh_token', ${lit(FIXTURE_REFRESH)},
      'verify:mail fixture; removed at the end of the run');
  `)
}

/** A Gmail that answers the token endpoint and both message endpoints. */
const fakeGoogle = (messages: Record<string, unknown>[]): typeof fetch =>
  (async (input: string | URL | Request) => {
    const url = String(input)
    if (url.includes('oauth2.googleapis.com/token')) {
      return new Response(
        JSON.stringify({
          access_token: 'fixture-access',
          expires_in: 3600,
          // The scopes matter: the reader refuses without a Gmail read scope,
          // and that refusal is one of the checks below.
          scope: 'https://www.googleapis.com/auth/gmail.readonly',
        }),
      )
    }
    if (url.includes('/messages?') || /\/messages\?/.test(url)) {
      return new Response(JSON.stringify({ messages: messages.map((m) => ({ id: m.id })) }))
    }
    const match = /\/messages\/([^?]+)/.exec(url)
    const found = messages.find((m) => m.id === match?.[1])
    return new Response(JSON.stringify(found ?? { error: { message: 'not found' } }))
  }) as unknown as typeof fetch

const message = (
  n: number,
  o: { from: string; subject: string; to?: string; labels?: string[]; snippet?: string },
): Record<string, unknown> => ({
  id: ID(n),
  threadId: ID(n),
  labelIds: o.labels ?? ['INBOX'],
  snippet: o.snippet ?? 'a short preview of the message',
  internalDate: String(Date.now() - 3_600_000),
  payload: {
    headers: [
      { name: 'From', value: o.from },
      { name: 'To', value: o.to ?? 'grant@example.invalid' },
      { name: 'Subject', value: o.subject },
    ],
  },
})

try {
  // --- the parse, before any I/O -------------------------------------------
  const angled = parseFrom('"Jane Smith" <Jane@Example.COM>')
  record(
    'a display name and address are separated, and the address is lowercased',
    `name=${String(angled.name)} address=${String(angled.address)}`,
    angled.name === 'Jane Smith' && angled.address === 'jane@example.com',
  )
  const bare = parseFrom('bob@example.com')
  record(
    'a bare address is stored as an address and NOT as a display name',
    `name=${String(bare.name)} address=${String(bare.address)}`,
    bare.name === null && bare.address === 'bob@example.com',
  )

  // --- switched off ---------------------------------------------------------
  await db.execute(
    `update public.system_config set value = to_jsonb(false) where key = 'gmail.enabled'`,
  )
  let asked = false
  const off = await refreshMail(db, {
    fetchImpl: (async () => {
      asked = true
      return new Response('{}')
    }) as unknown as typeof fetch,
  })
  record(
    '§17: switched off means Google is never called at all',
    `ok=${String(off.ok)} asked_google=${String(asked)} note=${off.note}`,
    off.ok && !asked && off.note.includes('switched off'),
  )

  await db.execute(
    `insert into public.system_config (key, value, description)
     values ('gmail.enabled', to_jsonb(true), 'verify:mail')
     on conflict (key) do update set value = to_jsonb(true)`,
  )

  // --- no scope -------------------------------------------------------------
  const noScope = await refreshMail(db, {
    fetchImpl: (async (input: string | URL | Request) => {
      if (String(input).includes('oauth2.googleapis.com/token')) {
        return new Response(
          JSON.stringify({
            access_token: 'x',
            expires_in: 3600,
            scope: 'https://www.googleapis.com/auth/calendar.readonly',
          }),
        )
      }
      return new Response('{}')
    }) as unknown as typeof fetch,
  })
  record(
    'a connection granted without the Gmail scope is named, not left to 403',
    `ok=${String(noScope.ok)} note=${noScope.note.slice(0, 60)}`,
    !noScope.ok && noScope.note.includes('no Gmail read scope'),
  )

  // --- storing --------------------------------------------------------------
  const two = [
    message(1, {
      from: '"Ada Lovelace" <ada@example.invalid>',
      subject: 'Invoice for August',
      to: 'grant@example.invalid, ops@example.invalid',
      labels: ['INBOX', 'UNREAD', 'HAS_ATTACHMENT'],
    }),
    message(2, { from: 'noreply@example.invalid', subject: 'Your receipt' }),
  ]
  const first = await refreshMail(db, { fetchImpl: fakeGoogle(two) })
  record(
    'messages are cached',
    `ok=${String(first.ok)} stored=${String(first.stored)} note=${first.note}`,
    first.ok && first.stored === 2,
  )

  const row = (await one(`
    select subject, from_name, from_address, to_count, unread, has_attachments,
           excerpt, cardinality(labels) as labels
      from public.mail_messages where message_id = ${lit(ID(1))}
  `)) as Record<string, unknown> | undefined
  record(
    'headers, a count of recipients and the flags are stored — never the recipients themselves',
    `from=${String(row?.from_name)} to_count=${String(row?.to_count)} unread=${String(row?.unread)} attach=${String(row?.has_attachments)}`,
    row?.from_name === 'Ada Lovelace' &&
      row?.from_address === 'ada@example.invalid' &&
      Number(row?.to_count) === 2 &&
      row?.unread === true &&
      row?.has_attachments === true,
  )

  // The point of `format=metadata`. A body cannot be stored because it is never
  // fetched — this asserts the column set has nowhere to put one.
  const bodyColumn = await db.execute(`
    select column_name from information_schema.columns
     where table_name = 'mail_messages' and column_name in ('body', 'html', 'text', 'payload')
  `)
  record(
    'there is no column a message body could be stored in',
    bodyColumn.rows.length === 0
      ? 'none'
      : `FOUND: ${bodyColumn.rows.map((r) => r.column_name).join(', ')}`,
    bodyColumn.rows.length === 0,
  )

  // --- upsert and sweep ------------------------------------------------------
  const again = await refreshMail(db, { fetchImpl: fakeGoogle(two) })
  const count = await db.execute(
    `select 1 from public.mail_messages where message_id like ${lit(`fixture-mail-${run}-%`)}`,
  )
  record(
    'refreshing again upserts rather than duplicating',
    `stored=${String(again.stored)} rows=${String(count.rows.length)}`,
    again.ok && count.rows.length === 2,
  )

  const oneLeft = await refreshMail(db, {
    fetchImpl: fakeGoogle([two[0] as Record<string, unknown>]),
  })
  const vanished = (await one(
    `select vanished_at is not null as gone from public.mail_messages
      where message_id = ${lit(ID(2))}`,
  )) as { gone: boolean } | undefined
  record(
    'a message that stopped coming back is marked gone, not deleted',
    `removed=${String(oneLeft.removed)} row_still_there=${String(vanished !== undefined)} gone=${String(vanished?.gone)}`,
    oneLeft.removed === 1 && vanished?.gone === true,
  )
  const survivor = (await one(
    `select vanished_at is null as here from public.mail_messages
      where message_id = ${lit(ID(1))}`,
  )) as { here: boolean } | undefined
  record(
    'CONTROL: and the one that DID come back survived, so the sweep is not just a wipe',
    `still here=${String(survivor?.here)}`,
    survivor?.here === true,
  )

  // --- reading it back -------------------------------------------------------
  const recent = (await one(`select app.mail_recent(48, 10) as j`)) as { j: unknown }
  const list = (typeof recent.j === 'string' ? JSON.parse(recent.j) : recent.j) as {
    from?: string
    from_address?: string
  }[]
  record(
    'the team can read it back, and a sender with no display name reads as an address',
    `${String(list.length)} message(s)`,
    list.length > 0 && list.every((m) => typeof m.from === 'string' && m.from !== ''),
  )
} finally {
  await restore()
  console.log('configuration restored.')
}

console.log('\n| check | outcome | |')
console.log('|---|---|---|')
for (const c of checks) console.log(`| ${c.what} | ${c.outcome} | ${c.passed ? '✅' : '❌'} |`)
const failed = checks.filter((c) => !c.passed)
console.log(`\n${String(checks.length - failed.length)}/${String(checks.length)} checks passed`)
if (failed.length > 0) process.exit(1)
