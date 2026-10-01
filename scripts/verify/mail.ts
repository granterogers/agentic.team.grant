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

  /*
    This check used to assert the OPPOSITE, and its replacement is the point.

    Under ADR-0037 the office fetched `format=metadata` and this asserted that
    `mail_messages` had nowhere to put a body — a correct check for a correct
    posture. #172 and ADR-0038 reverse the posture on Grant's explicit written
    authorisation, so the old assertion went red over a change he asked for.

    Deleting it would leave the most personal corpus the office holds with one
    fewer invariant than it had before. The invariant that replaces it is not
    "there is no body" but **"a body never exists without the three facts that
    make it accountable"**: when it was taken, and — when there is none — which
    of the three reasons applies. Those are 0500's constraints, and this drives
    them rather than reading them, because a migration that applies cleanly is
    not a constraint that holds.
  */
  const held = await db.execute(`
    select column_name from information_schema.columns
     where table_name = 'mail_messages' and column_name in ('body', 'body_at', 'body_withheld')
  `)
  record(
    'the body columns exist, all three of them (ADR-0038)',
    held.rows
      .map((r) => String(r.column_name))
      .sort()
      .join(', '),
    held.rows.length === 3,
  )

  const refuse = async (what: string, sql: string, expect: string): Promise<void> => {
    let said = ''
    try {
      await db.execute(`begin; ${sql} rollback;`)
      said = '(accepted, which it must not be)'
    } catch (error) {
      said = String((error as Error).message)
    }
    record(what, said.slice(0, 68), said.includes(expect))
  }
  const draft = (cols: string, vals: string): string => `
    insert into public.mail_messages
      (message_id, thread_id, to_count, has_attachments, unread,
       first_seen_at, last_seen_at, labels, ${cols})
    values (${lit(`c-${run}`)}, ${lit(`c-${run}`)}, 1, false, false,
       app.now_utc(), app.now_utc(), array[]::text[], ${vals});`

  await refuse(
    'a body with no time on it is refused — provenance travels with the words',
    draft('body', `'the words'`),
    'mail_body_and_its_time',
  )
  await refuse(
    'a body AND a withheld reason together is refused — they contradict',
    draft('body, body_at, body_withheld', `'the words', app.now_utc(), 'bulk'`),
    'mail_withheld_or_held_never_both',
  )
  await refuse(
    'a withheld reason nobody has defined is refused, so the vocabulary cannot drift',
    draft('body_withheld', `'because I said so'`),
    'mail_withheld_says_which',
  )
  /*
    The control for the three above. A constraint set can be tightened until it
    refuses everything, and every refusal check goes on passing while the
    feature Grant authorised is unreachable — which would look exactly like
    ADR-0037 never having been reversed.
  */
  let accepted = false
  try {
    await db.execute(`begin; ${draft('body, body_at', `'the words', app.now_utc()`)} rollback;`)
    accepted = true
  } catch {
    accepted = false
  }
  record('CONTROL: a proper body with its time is accepted', String(accepted), accepted)

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

// ---------------------------------------------------------------------------
// The correspondence belongs to a project (#172, ADR-0037)
// ---------------------------------------------------------------------------

/*
  Driven inside one `begin ... rollback`, and it has to be.

  `app.mail_for_project` deliberately refuses a fixture project -- #45's rule,
  because the whole point is that a retired probe's alias may not claim a real
  message -- so the subjects here must be named like real projects, and a real
  project that gathers a job can never be deleted. A rollback is the only
  teardown that leaves nothing, and 0416 is the entry in CLAUDE.md that says
  why creating a real-looking project outside one is expensive.

  Every assertion below is about a PROPERTY rather than a count, except where a
  count is the property. The controls outnumber the happy cases on purpose:
  this reader decides which of Grant's personal messages an agent may see, and
  its expensive direction is showing one under the wrong project.

  No backticks in this comment: it lives inside a template literal.
*/
console.log('\nthe correspondence, and which project it belongs to (#172)')

{
  const A = `Mail proof ${run}`
  const B = `Mail proof rival ${run}`
  const slugA = `mail-proof-${run}`
  const slugB = `mail-proof-rival-${run}`
  const msg = (n: string): string => `fixture-172-${run}-${n}`

  const got = (await one(`
    begin;
    insert into public.projects (name, slug, status)
    values (${lit(A)}, ${lit(slugA)}, 'active'), (${lit(B)}, ${lit(slugB)}, 'active');

    insert into public.project_aliases (project_id, alias, source, confidence)
    values
      ((select project_id from public.projects where slug = ${lit(slugA)}),
       'Harbour Lighting Rebuild', 'name', 1.0),
      ((select project_id from public.projects where slug = ${lit(slugA)}),
       'HLR', 'grant', 1.0),
      ((select project_id from public.projects where slug = ${lit(slugB)}),
       'Tidewater Ferry Study', 'name', 1.0);

    insert into public.contacts (project_id, name, email)
    values ((select project_id from public.projects where slug = ${lit(slugA)}),
            'Priya Raman', 'priya@example.com');

    insert into public.mail_messages
      (message_id, thread_id, subject, from_name, from_address, to_count,
       sent_at, excerpt, labels, has_attachments, unread, first_seen_at, last_seen_at)
    values
      -- 1. a contact on the project, subject naming nothing
      (${lit(msg('contact'))}, ${lit(msg('contact'))}, 'Thursday', 'Priya Raman',
       'priya@example.com', 1, app.now_utc(), 'Can we move it', '{}', false, false,
       app.now_utc(), app.now_utc()),
      -- 2. a stranger, but the alias is in the subject
      (${lit(msg('named'))}, ${lit(msg('named'))}, 'Re: Harbour Lighting Rebuild costs',
       'A Stranger', 'stranger@example.com', 1, app.now_utc(), 'see attached', '{}',
       false, false, app.now_utc(), app.now_utc()),
      -- 3. the alias in the EXCERPT only. Narrowing 1 of ADR-0037.
      (${lit(msg('excerpt'))}, ${lit(msg('excerpt'))}, 'Fwd: your appointment',
       'A Clinic', 'clinic@example.com', 1, app.now_utc(),
       'nothing to do with the harbour lighting rebuild at all', '{}', false, false,
       app.now_utc(), app.now_utc()),
      -- 4. the short alias. Narrowing 2.
      (${lit(msg('short'))}, ${lit(msg('short'))}, 'hlr', 'A Stranger',
       'stranger@example.com', 1, app.now_utc(), 'x', '{}', false, false,
       app.now_utc(), app.now_utc()),
      -- 5. the alias inside a longer word, which is not the alias
      (${lit(msg('partial'))}, ${lit(msg('partial'))}, 'Re: preharbour lighting rebuilding',
       'A Stranger', 'stranger@example.com', 1, app.now_utc(), 'x', '{}', false, false,
       app.now_utc(), app.now_utc()),
      -- 6. the OTHER project's alias. The isolation case.
      (${lit(msg('rival'))}, ${lit(msg('rival'))}, 'Tidewater Ferry Study draft',
       'A Stranger', 'stranger@example.com', 1, app.now_utc(), 'x', '{}', false, false,
       app.now_utc(), app.now_utc()),
      -- 7. both tiers at once. Must appear once, as a contact.
      (${lit(msg('both'))}, ${lit(msg('both'))}, 'Harbour Lighting Rebuild — Thursday',
       'Priya Raman', 'priya@example.com', 1, app.now_utc(), 'x', '{}', false, false,
       app.now_utc(), app.now_utc()),
      -- 8. nothing at all
      (${lit(msg('none'))}, ${lit(msg('none'))}, 'Save 20 percent on a tour',
       'A Shop', 'shop@example.com', 1, app.now_utc(), 'x', '{}', false, false,
       app.now_utc(), app.now_utc());

    select
      (select jsonb_agg(x ->> 'message_id')
         from jsonb_array_elements(app.mail_for_project(app.test_office(), 
           (select project_id from public.projects where slug = ${lit(slugA)}), 50)) x) as mine,
      (select jsonb_agg(x ->> 'message_id')
         from jsonb_array_elements(app.mail_for_project(app.test_office(), 
           (select project_id from public.projects where slug = ${lit(slugB)}), 50)) x) as theirs,
      (select x ->> 'why'
         from jsonb_array_elements(app.mail_for_project(app.test_office(), 
           (select project_id from public.projects where slug = ${lit(slugA)}), 50)) x
        where x ->> 'message_id' = ${lit(msg('both'))}) as both_why,
      (select x ->> 'matched'
         from jsonb_array_elements(app.mail_for_project(app.test_office(), 
           (select project_id from public.projects where slug = ${lit(slugA)}), 50)) x
        where x ->> 'message_id' = ${lit(msg('named'))}) as named_matched,
      (select count(*)
         from jsonb_array_elements(app.mail_for_project(app.test_office(), 
           (select project_id from public.projects where slug = ${lit(slugA)}), 50)) x
        where x ->> 'message_id' = ${lit(msg('both'))}) as both_times,
      (select jsonb_agg(x ->> 'message_id')
         from jsonb_array_elements(app.mail_search(app.test_office(), 'Tidewater',
           (select project_id from public.projects where slug = ${lit(slugA)}), 50)) x) as leak,
      (select jsonb_array_length(app.mail_search(app.test_office(), 'Tidewater', null, 50))) as unscoped,
      (select app.forget_mail_before(app.test_office(), 7) ->> 'error') as too_short;
    rollback;
  `)) as Record<string, unknown> | undefined

  const ids = (v: unknown): string[] =>
    v === null || v === undefined ? [] : (v as string[]).map(String)
  const mine = ids(got?.mine)
  const theirs = ids(got?.theirs)
  const has = (n: string): boolean => mine.includes(msg(n))

  record(
    'a contact on the project makes their correspondence findable',
    has('contact') ? 'found' : `NOT FOUND — ${mine.join(', ')}`,
    has('contact'),
  )
  record(
    'and an alias phrase in the subject does too, from a sender nobody knows',
    `matched=${String(got?.named_matched)}`,
    has('named') && got?.named_matched === 'Harbour Lighting Rebuild',
  )
  record(
    'CONTROL: the same phrase in the EXCERPT claims nothing',
    has('excerpt') ? 'LEAKED an unrelated message' : 'not claimed',
    !has('excerpt'),
  )
  record(
    'CONTROL: an alias under four characters claims nothing',
    has('short') ? 'LEAKED on a three-letter alias' : 'not claimed',
    !has('short'),
  )
  record(
    'CONTROL: the phrase inside a longer word is not the phrase',
    has('partial') ? 'LEAKED on a substring' : 'not claimed',
    !has('partial'),
  )
  record(
    'CONTROL: one project cannot see another project’s correspondence',
    has('rival') ? 'LEAKED across projects' : 'not claimed',
    !has('rival') && theirs.includes(msg('rival')),
  )
  record(
    'CONTROL: a message matching nothing is claimed by nobody',
    has('none') ? 'LEAKED an unrelated message' : 'not claimed',
    !has('none'),
  )
  record(
    'a message matching both tiers appears once, as the stronger one',
    `${String(got?.both_times)}×, why=${String(got?.both_why)}`,
    Number(got?.both_times) === 1 && got?.both_why === 'contact',
  )
  record(
    'CONTROL: searching within a project cannot reach outside it',
    ids(got?.leak).length === 0
      ? `nothing, while the unscoped search finds ${String(got?.unscoped)}`
      : `LEAKED ${ids(got?.leak).join(', ')}`,
    ids(got?.leak).length === 0 && Number(got?.unscoped) > 0,
  )
  record(
    'a retention shorter than a month is refused, and says why',
    String(got?.too_short ?? '').slice(0, 48),
    String(got?.too_short ?? '').includes('30 days'),
  )
}

// ---------------------------------------------------------------------------
// And what the office may conclude when it cannot read the mail (#172, #257)
// ---------------------------------------------------------------------------

/*
  The gap 0433 closes, and why it is narrow.

  Google is refusing the stored refresh token as this is written, so the mail
  cache is 40 hours old -- and the duty runs hourly and SUCCEEDS as a job every
  time, because a refresh that cannot authenticate is a degradation and not a
  failure. Nothing anywhere was saying the office had stopped reading the mail,
  so "there is nothing in your email about that" was available to a model
  looking at a corpus that stopped two days ago.

  The narrowing is the interesting half and it needs both controls: mail counts
  as a domain only for a project that has a CONTACT with an address, because
  almost every project has a name of four characters or more and the wider rule
  would put a caveat on every answer the office gives whenever Gmail is down.

  No backticks in this comment: it lives inside a template literal.
*/
console.log('\nand what it may conclude when it cannot read the mail (#172)')

{
  const slug = `mail-blind-${run}`
  const K = (k: string): string => `
    insert into probe (k, v) select ${lit(k)}, app.project_knowledge(app.test_office(), 
      (select project_id from public.projects where slug = ${lit(slug)}))::text;`
  const cover = (await one(`
    begin;
    create temporary table probe (k text, v text) on commit drop;
    insert into public.projects (name, slug, status)
    values (${lit(`Mail blind ${run}`)}, ${lit(slug)}, 'active');

    -- Nothing here yet: a project with no correspondents at all.
    ${K('no_contact')}

    insert into public.contacts (project_id, name, email)
    values ((select project_id from public.projects where slug = ${lit(slug)}),
            'Priya Raman', 'priya@example.com');

    /*
      MADE stale, rather than assumed to be.

      This used to probe the cache "as it is, which is stale" — true for as
      long as Google's refresh token was dead, and false from the morning it
      was reconnected. The sync then ran, last seen moved to 30 minutes ago,
      and this check went red with its control green and both printing the
      IDENTICAL reading, which is the inert signature.

      A check that fails for a routine environmental reason is one people
      learn to ignore, and the real defect it is meant to catch hides behind
      it. So the condition is constructed: every row is backdated inside this
      transaction, which is rolled back. The mail_messages table carries no
      trigger that would undo it — checked, because CLAUDE.md records a
      backdate silently reverted by the projects touch trigger.

      No backticks in this comment: it lives inside a template literal, and
      the first draft of it broke the file exactly two comments below one
      saying so.
    */
    update public.mail_messages set last_seen_at = app.now_utc() - interval '90 days';
    ${K('stale')}

    -- And a cache that was read a minute ago.
    insert into public.mail_messages
      (message_id, thread_id, subject, from_name, from_address, to_count,
       sent_at, excerpt, labels, has_attachments, unread, first_seen_at, last_seen_at)
    values (${lit(`fixture-blind-${run}`)}, ${lit(`fixture-blind-${run}`)}, 'Anything',
            'Someone', 'someone@example.com', 1, app.now_utc(), 'x', '{}', false, false,
            app.now_utc(), app.now_utc());

    ${K('fresh')}

    /*
      Every reading in one row, because the helper returns the LAST
      statement's first row and three separate selects gave back only the
      third. A temp table dropped on commit is the cheapest way to hold a
      before and an after inside one rollback.

      No backticks in this comment: it lives inside a template literal.
    */
    select
      (select (v::jsonb) ->> 'blank' from probe where k = 'no_contact') as no_contact,
      (select (v::jsonb) ->> 'blank' from probe where k = 'stale') as stale,
      (select (v::jsonb) ->> 'complete' from probe where k = 'stale') as stale_complete,
      (select (v::jsonb) ->> 'blank' from probe where k = 'fresh') as fresh,
      (select (v::jsonb) ->> 'complete' from probe where k = 'fresh') as fresh_complete;
    rollback;
  `)) as Record<string, unknown> | undefined

  const has = (v: unknown): boolean => String(v ?? '').includes('mail')
  record(
    'a stale mail cache is named as a gap, so an absence cannot be reported from it',
    `blank=${String(cover?.stale)} complete=${String(cover?.stale_complete)}`,
    has(cover?.stale) && String(cover?.stale_complete) === 'false',
  )
  record(
    'CONTROL: and a cache read a minute ago is not a gap',
    `blank=${String(cover?.fresh)} complete=${String(cover?.fresh_complete)}`,
    !has(cover?.fresh) && String(cover?.fresh_complete) === 'true',
  )
  record(
    'CONTROL: a project with no correspondents is never told the mail is missing',
    `blank=${String(cover?.no_contact)}`,
    !has(cover?.no_contact),
  )
}

// ---------------------------------------------------------------------------
// What has gone quiet, and which way round (#172)
// ---------------------------------------------------------------------------
console.log('\nthreads nobody has spoken in (#172)')

{
  /*
    Four thread shapes in one rolled-back statement.

    Grant's hardest question is *"are there outstanding commitments I have
    forgotten?"*, and the honest half of it is thread SHAPE: who spoke last and
    how long ago. There are no message bodies in this system, so anything more
    would be a model guessing about his own business.

    The answers are gathered into a temp table and selected BEFORE the
    rollback, because the Management API runs the payload as one transaction
    and a select after the rollback finds neither the rows nor the table.
  */
  const q = `awaiting-${run}`
  const rows = ((
    await db.execute(`
    begin;
      create temp table await_res (k text, v jsonb) on commit drop;
      insert into public.projects (slug, name, status)
        values (${lit(q)}, 'Awaiting proof', 'active');
      insert into public.project_attachments
        (project_id, connector, external_ref, display_name, role)
      select project_id, 'upload', ${lit(`u-${run}`)}, 'Uploads', 'source'
        from public.projects where slug = ${lit(q)};
      insert into public.contacts (project_id, name, email)
      select project_id, 'Ada Reply', ${lit(`ada-${run}@awaiting.test`)}
        from public.projects where slug = ${lit(q)};
      insert into public.mail_messages
        (message_id, thread_id, subject, from_name, from_address, to_count, sent_at, excerpt, labels)
      values
        -- she asked, he answered, and nothing since: waiting on THEM
        (${lit(`a0-${run}`)}, ${lit(`tA-${run}`)}, 'Proposal for the pilot', 'Ada Reply',
         ${lit(`ada-${run}@awaiting.test`)}, 1, app.now_utc() - interval '25 days', '...', array['INBOX']),
        (${lit(`a1-${run}`)}, ${lit(`tA-${run}`)}, 'Re: Proposal for the pilot', 'Grant',
         ${lit(`grant-${run}@innergy.test`)}, 1, app.now_utc() - interval '20 days', '...', array['SENT']),
        -- she asked and he never answered: waiting on HIM
        (${lit(`b1-${run}`)}, ${lit(`tB-${run}`)}, 'Question about scope', 'Ada Reply',
         ${lit(`ada-${run}@awaiting.test`)}, 1, app.now_utc() - interval '15 days', '...', array['INBOX']),
        -- yesterday, so not quiet at all
        (${lit(`c1-${run}`)}, ${lit(`tC-${run}`)}, 'Yesterday', 'Ada Reply',
         ${lit(`ada-${run}@awaiting.test`)}, 1, app.now_utc() - interval '1 day', '...', array['INBOX']),
        -- old, from the same contact, and a promotion
        (${lit(`d1-${run}`)}, ${lit(`tD-${run}`)}, '50 percent off everything', 'Ada Reply',
         ${lit(`ada-${run}@awaiting.test`)}, 1, app.now_utc() - interval '30 days', '...',
         array['CATEGORY_PROMOTIONS']);
      insert into await_res
      select 'mine', app.mail_awaiting(app.test_office(), (select project_id from public.projects where slug = ${lit(q)}), 7, 10);
      insert into await_res select 'elsewhere', app.mail_awaiting(app.test_office(), gen_random_uuid(), 7, 10);
      select k, v from await_res;
    rollback;
  `)
  ).rows ?? []) as Record<string, unknown>[]
  const got = (k: string): Record<string, unknown>[] => {
    const raw = rows.find((r: Record<string, unknown>) => String(r.k) === k)?.v
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw
    return Array.isArray(v) ? (v as Record<string, unknown>[]) : []
  }
  const mine = got('mine')
  const find = (waiting: string): Record<string, unknown> | undefined =>
    mine.find((x) => String(x.waiting) === waiting)

  record(
    'a thread he answered and nobody came back on is waiting on THEM',
    find('no reply to you') === undefined
      ? 'not reported'
      : `${String(find('no reply to you')?.days)} days, with ${String(find('no reply to you')?.with)}`,
    find('no reply to you') !== undefined && Number(find('no reply to you')?.days) === 20,
  )
  record(
    'a thread he never answered is waiting on HIM, and the two are never merged',
    find('you have not replied') === undefined
      ? 'not reported'
      : `${String(find('you have not replied')?.days)} days`,
    find('you have not replied') !== undefined,
  )
  /*
    Who it is WITH is never Grant, even on a thread he spoke last in. The first
    draft took the name off the last message and would have said "waiting on
    Grant Rogers" on exactly the threads he is waiting on somebody else.
  */
  record(
    'and it names the other person, not him, on a thread he spoke last in',
    String(find('no reply to you')?.with ?? '(none)'),
    String(find('no reply to you')?.with ?? '') === 'Ada Reply',
  )
  record(
    'CONTROL: a thread from yesterday is not quiet',
    `${String(mine.length)} reported`,
    !mine.some((x) => String(x.subject) === 'Yesterday'),
  )
  /*
    A newsletter nobody replied to is not a forgotten commitment, and an office
    that said so every morning is one Grant stops reading. Gmail's own
    CATEGORY_PROMOTIONS is the filter rather than a word list this repository
    would have to maintain.
  */
  record(
    'CONTROL: an old promotion from the same contact is not something he owes',
    `${String(mine.length)} reported`,
    !mine.some((x) => String(x.subject).includes('50 percent')),
  )
  record(
    'CONTROL: another project is waiting on none of it',
    `${String(got('elsewhere').length)} from elsewhere`,
    got('elsewhere').length === 0,
  )
}

/*
  ---------------------------------------------------------------- the bodies

  #172 and ADR-0038. Grant authorised the office to cache message bodies, so
  0500 added `body`, `body_at` and `body_withheld` and both readers carry them.
  The parsing half is proved in `tests/google/body.test.ts` without a network;
  what CANNOT be proved there is the part that lives in the database — the
  paired-nullability constraints, whether the body actually reaches a reader,
  whether it reaches the WRONG project, and whether the retention forgets it.

  One rolled-back statement, results gathered into a temp table and selected
  before the rollback, the same shape as the section above and for the same
  reason.
*/
{
  const b = `bodies-${run}`
  const rows = ((
    await db.execute(`
    begin;
      create temp table body_res (k text, v jsonb) on commit drop;
      insert into public.projects (slug, name, status)
        values (${lit(b)}, 'Body proof', 'active');
      insert into public.project_attachments
        (project_id, connector, external_ref, display_name, role)
      select project_id, 'upload', ${lit(`ub-${run}`)}, 'Uploads', 'source'
        from public.projects where slug = ${lit(b)};
      insert into public.contacts (project_id, name, email)
      select project_id, 'Elena Marchetti', ${lit(`elena-${run}@bodies.test`)}
        from public.projects where slug = ${lit(b)};
      insert into public.mail_messages
        (message_id, thread_id, subject, from_name, from_address, to_count, sent_at,
         excerpt, labels, body, body_at, body_withheld)
      values
        -- a letter the office holds the words of
        (${lit(`h1-${run}`)}, ${lit(`th1-${run}`)}, 'Module four schedule', 'Elena Marchetti',
         ${lit(`elena-${run}@bodies.test`)}, 1, app.now_utc() - interval '2 days',
         'Confirming the recording slot', array['INBOX'],
         'Confirming the recording slot for module four on the 24th, and we agreed the fee stays at 2,400.',
         app.now_utc(), null),
        -- bulk: the fact it arrived, and deliberately not the marketing
        (${lit(`h2-${run}`)}, ${lit(`th2-${run}`)}, 'Module four offers', 'Elena Marchetti',
         ${lit(`elena-${run}@bodies.test`)}, 1, app.now_utc() - interval '3 days',
         'Fifty percent off', array['CATEGORY_PROMOTIONS'], null, null, 'bulk'),
        -- a body old enough for the 90-day sweep to forget
        (${lit(`h3-${run}`)}, ${lit(`th3-${run}`)}, 'Module four last year', 'Elena Marchetti',
         ${lit(`elena-${run}@bodies.test`)}, 1, app.now_utc() - interval '120 days',
         'Last year', array['INBOX'], 'The words of a very old letter.',
         app.now_utc() - interval '120 days', null);
      insert into body_res
      select 'mine', app.mail_for_project(app.test_office(), (select project_id from public.projects where slug = ${lit(b)}), 20);
      insert into body_res select 'elsewhere', app.mail_for_project(app.test_office(), gen_random_uuid(), 20);
      insert into body_res
      select 'found', app.mail_search(app.test_office(), 'what did we agree about the fee',
               (select project_id from public.projects where slug = ${lit(b)}), 10);
      insert into body_res select 'swept', jsonb_build_array(app.forget_mail_bodies_before(app.test_office(), 90));
      insert into body_res select 'floor', jsonb_build_array(app.forget_mail_bodies_before(app.test_office(), 1));
      insert into body_res
      select 'after', app.mail_for_project(app.test_office(), (select project_id from public.projects where slug = ${lit(b)}), 20);
      select k, v from body_res;
    rollback;
  `)
  ).rows ?? []) as Record<string, unknown>[]
  const got = (k: string): Record<string, unknown>[] => {
    const raw = rows.find((r: Record<string, unknown>) => String(r.k) === k)?.v
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw
    return Array.isArray(v) ? (v as Record<string, unknown>[]) : []
  }
  const mine = got('mine')
  const one = (id: string, from = mine): Record<string, unknown> | undefined =>
    from.find((x) => String(x.message_id) === `${id}-${run}`)

  record(
    'the reader carries the words of a message it holds',
    String(one('h1')?.body ?? '(none)').slice(0, 44),
    String(one('h1')?.body ?? '').includes('we agreed the fee stays at 2,400'),
  )
  record(
    'and says nothing was withheld about it',
    String(one('h1')?.body_withheld ?? 'null'),
    one('h1')?.body_withheld === null,
  )
  /*
    Bulk is the narrowing that makes the permission proportionate, and the
    reader has to say WHY rather than returning a null a caller reads as "not
    fetched yet". 0304's asymmetry: absence is not one fact.
  */
  record(
    'bulk mail is held without its words, and says so',
    `body ${String(one('h2')?.body ?? 'null')}, withheld ${String(one('h2')?.body_withheld)}`,
    one('h2')?.body === null && one('h2')?.body_withheld === 'bulk',
  )
  record(
    'a body makes a message findable by what it SAID, not only its subject',
    `${String(got('found').length)} found`,
    got('found').some((x) => String(x.message_id) === `h1-${run}`),
  )
  /*
    The control that matters most. ADR-0037's isolation is the whole reason a
    body is safe to hold at all: a retrieval bug here leaks something between
    contexts rather than merely being wrong, and a body is thirty times more of
    it than a snippet was.
  */
  record(
    'CONTROL: another project sees none of it, bodies included',
    `${String(got('elsewhere').length)} from elsewhere`,
    got('elsewhere').length === 0,
  )
  record(
    'the 90-day sweep forgets an old body and reports the number',
    JSON.stringify(got('swept')[0] ?? {}).slice(0, 70),
    Number((got('swept')[0] as { forgotten?: unknown })?.forgotten ?? 0) >= 1,
  )
  record(
    'and the message itself survives it — the office remembers the conversation happened',
    `${String(got('after').length)} still associated`,
    one('h3', got('after')) !== undefined && one('h3', got('after'))?.body === null,
  )
  record(
    'CONTROL: the recent body is NOT swept by the same call',
    String(one('h1', got('after'))?.body ?? '(gone)').slice(0, 40),
    String(one('h1', got('after'))?.body ?? '').includes('module four on the 24th'),
  )
  /*
    A floor that refuses, asserted on the MESSAGE. A refusal for the wrong
    reason looks exactly like the rule working, which this repository has paid
    for more than once.
  */
  record(
    'a retention under seven days is refused, and says why',
    String((got('floor')[0] as { error?: unknown })?.error ?? '(no error)').slice(0, 60),
    (got('floor')[0] as { ok?: unknown })?.ok === false &&
      String((got('floor')[0] as { error?: unknown })?.error ?? '').includes('mid-conversation'),
  )
}

console.log('\n| check | outcome | |')
console.log('|---|---|---|')
for (const c of checks) console.log(`| ${c.what} | ${c.outcome} | ${c.passed ? '✅' : '❌'} |`)
const failed = checks.filter((c) => !c.passed)
console.log(`\n${String(checks.length - failed.length)}/${String(checks.length)} checks passed`)
if (failed.length > 0) process.exit(1)
