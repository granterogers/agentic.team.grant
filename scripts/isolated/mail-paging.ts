/**
 * REG-024 / REG-025 — the Gmail reader follows every page of a thread listing, and a message that appears on two
 * pages is stored once.
 *
 *   npx tsx scripts/isolated/mail-paging.ts <replica-db>
 *
 * The real `refreshMail` runs against the replica with a FAKE Google: the token endpoint, the message listing and the
 * message reads are answered by a stand-in that records every call. Nothing leaves the process. The Grant office's
 * Google connection and the Gmail switch are set up inside one transaction that is rolled back at the end.
 *
 * Asserts:
 *   1. Page two is requested with the token the first page returned (the reader follows the token).
 *   2. Every message on either page is stored (m1, m2, m3).
 *   3. A message that appears on both pages (m2) is stored exactly once.
 *   4. CONTROL: a listing with no next-page token is read once, so the second page is requested only because the
 *      token asked for it.
 *
 * Observed, not asserted: the reader fetches a message appearing on two pages twice. Storage is correct; the extra
 * read is cost, recorded on REG-025.
 *
 * Replica only; the guard refuses anything else.
 */
import { refreshMail } from '../../src/google/mail.ts'
import { isolated } from './guard.ts'

const db = await isolated(process.argv[2] ?? 'post')
const results: { what: string; ok: boolean; detail: string }[] = []
const check = (what: string, ok: boolean, detail: string) => {
  results.push({ what, ok, detail })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what} — ${detail}`)
}
const one = async (sql: string) => (await db.execute(sql)).rows[0] as Record<string, unknown>
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`

const tag = Date.now().toString(36)
const BARE = 'google.refresh_token'

// A fake Google. `pages` maps a listing's page token ('' for the first page) to what it returns.
function fakeGoogle(pages: Record<string, { ids: string[]; next?: string }>) {
  const calls: { url: string; pageToken: string | null }[] = []
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input)
    if (url.startsWith('https://oauth2.googleapis.com/token'))
      return Response.json({
        access_token: `at-${tag}`,
        expires_in: 3600,
        scope: 'https://www.googleapis.com/auth/gmail.readonly',
      })
    const u = new URL(url)
    if (u.pathname === '/gmail/v1/users/me/messages') {
      const token = u.searchParams.get('pageToken')
      calls.push({ url, pageToken: token })
      const page = pages[token ?? ''] ?? { ids: [] }
      return Response.json({
        messages: page.ids.map((id) => ({ id })),
        ...(page.next === undefined ? {} : { nextPageToken: page.next }),
      })
    }
    const id = u.pathname.split('/').pop() ?? ''
    return Response.json({
      id,
      threadId: `t-${id}`,
      snippet: `snippet ${id}`,
      labelIds: [],
      internalDate: String(Date.now()),
      payload: {
        mimeType: 'text/plain',
        headers: [
          { name: 'Subject', value: `Subject ${id} ${tag}` },
          { name: 'From', value: 'Supplier <supplier@example.com>' },
          { name: 'To', value: 'grant@example.com' },
        ],
        body: { size: 0 },
      },
    })
  }) as typeof fetch
  return { fetchImpl, calls }
}

await db.execute('begin')
try {
  const op = String((await one(`select app.operator_office()::text as o`)).o)
  await db.execute(`delete from vault.secrets where name in ('google.client_secret', ${lit(BARE)})`)
  await db.execute(
    `insert into vault.secrets (name, secret) values ('google.client_secret', ${lit(`cs-${tag}`)})`,
  )
  await db.execute(
    `insert into vault.secrets (name, secret) values (${lit(BARE)}, ${lit(`rt-${tag}`)})`,
  )
  await db.execute(`insert into public.system_config (key, value, description)
    values ('google.client_id', to_jsonb(${lit(`cid-${tag}`)}::text), 'mail-paging proof'),
           ('gmail.enabled', 'true'::jsonb, 'mail-paging proof')
    on conflict (key) do update set value = excluded.value`)

  // The listing has two pages, and m2 appears on both.
  const paged = fakeGoogle({
    '': { ids: ['m1', 'm2'], next: 'p2' },
    p2: { ids: ['m2', 'm3'] },
  })
  const outcome = await refreshMail(db, {
    hours: 48,
    max: 50,
    fetchImpl: paged.fetchImpl,
    officeId: op as never,
  })
  const listed = paged.calls.map((c) => c.pageToken)
  check(
    'page two is requested with the token the first page returned',
    listed.length === 2 && listed[0] === null && listed[1] === 'p2',
    `listing requests, in order: ${listed.map((t) => t ?? '(first)').join(', ')}; outcome ok=${String(outcome.ok)}`,
  )
  const stored = (
    await db.execute(
      `select message_id, count(*)::int as n from public.mail_messages where message_id in ('m1','m2','m3') group by message_id`,
    )
  ).rows as { message_id: string; n: number }[]
  const countOf = (id: string) => stored.find((r) => r.message_id === id)?.n ?? 0
  check(
    'every message on either page is stored',
    countOf('m1') === 1 && countOf('m2') === 1 && countOf('m3') === 1,
    `stored rows: m1=${String(countOf('m1'))} m2=${String(countOf('m2'))} m3=${String(countOf('m3'))}`,
  )
  check(
    'a message that appears on both pages is stored exactly once',
    countOf('m2') === 1,
    `m2 rows: ${String(countOf('m2'))}`,
  )

  // Control: one page, no token. The second page must not be requested.
  await db.execute(`delete from public.mail_messages where message_id in ('m1','m2','m3')`)
  const single = fakeGoogle({ '': { ids: ['m1'] } })
  await refreshMail(db, { hours: 48, max: 50, fetchImpl: single.fetchImpl, officeId: op as never })
  check(
    'CONTROL: with no next-page token the listing is read once',
    single.calls.length === 1,
    `listing requests: ${String(single.calls.length)}`,
  )
} finally {
  await db.execute('rollback')
  await db.end()
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${String(results.length - failed.length)}/${String(results.length)} ok`)
process.exitCode = failed.length === 0 ? 0 : 1
