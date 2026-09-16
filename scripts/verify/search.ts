/**
 * Find the document that MENTIONS the thing, not just the one named after it.
 *
 *   npm run verify:search
 *
 * Issue #37, migration 0308.
 *
 * ## What was already there, and what was not
 *
 * The studio's command bar has searched projects, documents, tasks, contacts,
 * sections and people since it was built — instantly, client-side, over the
 * payload the page already holds. That is most of #37's entity list and it is
 * fast in the way the specification asks for.
 *
 * It searches TITLES. `app.search_documents` has done full text over
 * `documents.content` since it was written and **had no public wrapper**, so
 * PostgREST — which exposes only `public` — could never call it. The
 * capability existed and was unreachable, which is the trap CLAUDE.md records
 * about every `app.*` RPC.
 *
 * ## What this drives
 *
 * The real chain, not a reimplementation of it:
 *
 *     app.studio_search -> public.studio_search -> hq-api ?section=search&q=
 *
 * including the HTTP layer, because the bug this Issue is fixing lived exactly
 * there — in a function that worked and could not be reached.
 */

import { ManagementApiExecutor } from '../../src/db/executor.ts'

const token = process.env.SUPABASE_ACCESS_TOKEN
if (token === undefined || token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}
const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  token,
)

const checks: boolean[] = []
const check = (what: string, said: string, ok: boolean): void => {
  checks.push(ok)
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what} — ${said}`)
}
const one = async (sql: string): Promise<Record<string, unknown>> =>
  ((await db.execute(sql)).rows[0] ?? {}) as Record<string, unknown>
const all = async (sql: string): Promise<Record<string, unknown>[]> =>
  (await db.execute(sql)).rows as Record<string, unknown>[]
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

const run = Math.random().toString(36).slice(2, 10)
/*
  A word that appears in the BODY and nowhere in the title, which is the whole
  point: a title search cannot find this document and a content search must.
  Nonsense on purpose, so a real document cannot match it by accident.
*/
const BURIED = `zarquon${run}`
const TITLE = `Probe search subject ${run}`

console.log(`\nverify:search — ${run}\n`)

let docId = ''
let projectId = ''
const alsoMade: string[] = []

try {
  projectId = String(
    (
      await one(`
        select project_id::text as id from public.projects
         where status = 'active' and not is_fixture order by slug limit 1
      `)
    ).id,
  )

  docId = String(
    (
      await one(`
        insert into public.documents
          (project_id, connector, external_ref, title, doc_type, content,
           content_fingerprint, content_chars, fetched_at, origin)
        values (${lit(projectId)}::uuid, 'upload', ${lit(`probe-search-${run}`)},
                ${lit(TITLE)}, 'note',
                ${lit(`A paragraph about nothing much, which happens to mention ${BURIED} in the middle of it, and then carries on.`)},
                encode(extensions.digest(${lit(BURIED)}, 'sha256'), 'hex'),
                100, app.now_utc(), 'source')
        returning document_id::text as id
      `)
    ).id,
  )

  // =========================================================================
  console.log('the words inside, not only the title')

  const hits = await all(`select * from public.studio_search(${lit(BURIED)}, null, 12)`)
  const mine = hits.find((h) => String(h.title) === TITLE)
  check(
    'a word that appears only in the body is found',
    mine === undefined ? 'NOT FOUND' : `${String(mine.kind)} · ${String(mine.title)}`,
    mine !== undefined,
  )
  check(
    'and the match comes back with the words around it',
    mine === undefined ? '—' : String(mine.snippet).slice(0, 70),
    mine !== undefined && String(mine.snippet).toLowerCase().includes(BURIED.toLowerCase()),
  )
  check(
    'and it says which project it belongs to',
    mine === undefined ? '—' : String(mine.place),
    mine !== undefined && String(mine.place ?? '') !== '' && String(mine.place) !== 'No project',
  )

  /*
    A title match must outrank a passing mention, which is the single most
    important thing a ranking gets right — and the reason 0309 exists. 0308
    recomputed the tsvector flat, ignoring the GENERATED `documents.search`
    column whose title is setweight 'A' and body 'B', so the two tied.
  */
  const inTitle = await one(`
    insert into public.documents
      (project_id, connector, external_ref, title, doc_type, content,
       content_fingerprint, content_chars, fetched_at, origin)
    values (${lit(projectId)}::uuid, 'upload', ${lit(`probe-search-${run}-t`)},
            ${lit(`${BURIED} in the title`)}, 'note', 'A body about something else entirely.',
            encode(extensions.digest(${lit(`${BURIED}t`)}, 'sha256'), 'hex'),
            60, app.now_utc(), 'source')
    returning document_id::text as id
  `)
  alsoMade.push(String(inTitle.id))
  const ranked = await all(`select * from public.studio_search(${lit(BURIED)}, null, 12)`)
  check(
    'a title match outranks a passing mention, because the column is weighted',
    ranked
      .map((r) => String(r.title))
      .slice(0, 2)
      .join(' > '),
    String(ranked[0]?.title ?? '').includes('in the title'),
  )

  /*
    CONTROL. Every check above would also pass if the function returned the
    whole corpus for any query at all — which is exactly what a broken
    `websearch_to_tsquery` would do if the `@@` were dropped.
  */
  const nonsense = await all(
    `select * from public.studio_search(${lit(`absolutelynothingmatches${run}`)}, null, 12)`,
  )
  check(
    'CONTROL: a query that matches nothing returns nothing',
    `${String(nonsense.length)} row(s)`,
    nonsense.length === 0,
  )

  // =========================================================================
  console.log('\nscoped, and widenable')

  const elsewhere = String(
    (
      await one(`
        select project_id::text as id from public.projects
         where status = 'active' and not is_fixture and project_id <> ${lit(projectId)}::uuid
         order by slug limit 1
      `)
    ).id ?? '',
  )
  if (elsewhere !== '') {
    const wrong = await all(
      `select * from public.studio_search(${lit(BURIED)}, ${lit(elsewhere)}::uuid, 12)`,
    )
    check(
      'a search scoped to another project does not find it',
      `${String(wrong.length)} row(s) in the other project`,
      !wrong.some((h) => String(h.title) === TITLE),
    )
    const right = await all(
      `select * from public.studio_search(${lit(BURIED)}, ${lit(projectId)}::uuid, 12)`,
    )
    check(
      'and scoped to its own project it does',
      `${String(right.length)} row(s)`,
      right.some((h) => String(h.title) === TITLE),
    )
  } else {
    check('a search scoped to another project does not find it', 'only one project exists', true)
  }

  // =========================================================================
  console.log('\na phrase is a phrase')

  /*
    `websearch_to_tsquery`, not `to_tsquery`. Quoting a phrase or typing "or"
    then does what a person expects rather than raising a syntax error the
    caller has to report as "no results" — which is indistinguishable from an
    empty corpus.
  */
  const punctuated = await all(
    `select * from public.studio_search(${lit('"and then" or')}, null, 3)`,
  )
  check(
    'quotes and the word "or" are searched, not parsed as syntax and refused',
    `${String(punctuated.length)} row(s), no error`,
    Array.isArray(punctuated),
  )

  // =========================================================================
  console.log('\nreachable from a browser, which is the half that was missing')

  const wrappers = await all(`
    select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('studio_search', 'search_documents')
     order by p.proname
  `)
  check(
    'both search functions are exposed on public, where PostgREST can see them',
    wrappers.map((w) => String(w.proname)).join(', '),
    wrappers.length === 2,
  )

  /*
    From the vault, the way `verify:hq` does it.

    An earlier draft read HQ_API_TOKEN from the environment and skipped when it
    was unset — which meant the one layer this Issue is actually about would
    have been "NOT CHECKED" on every run. #41: an unrunnable check is where the
    next defect hides, and this defect WAS the HTTP layer.

    Nothing is printed. The token is a secret and this file's output goes into
    a terminal and sometimes into an Issue.
  */
  const base = `https://${process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg'}.supabase.co/functions/v1/hq-api`
  const hqToken = String(
    (
      await one(
        `select decrypted_secret as v from vault.decrypted_secrets where name = 'hq.api_token'`,
      )
    ).v ?? '',
  )
  if (hqToken !== '') {
    const url = `${base}?section=search&q=${encodeURIComponent(BURIED)}`
    const r = await fetch(url, { headers: { Authorization: `Bearer ${hqToken}` } })
    const body = (await r.json().catch(() => ({}))) as { data?: unknown[] }
    check(
      'and the page can actually ask for them over HTTP',
      `http ${String(r.status)}, ${String((body.data ?? []).length)} row(s)`,
      r.ok && Array.isArray(body.data) && body.data.length > 0,
    )
    const empty = await fetch(`${base}?section=search&q=`, {
      headers: { Authorization: `Bearer ${hqToken}` },
    })
    check(
      'an empty query is refused rather than answered with everything',
      `http ${String(empty.status)}`,
      empty.status === 400,
    )
  } else {
    // Said rather than skipped silently, and FAILED rather than passed: with no
    // token this suite cannot check the layer it exists for.
    check(
      'and the page can actually ask for them over HTTP',
      'NOT CHECKED — no hq.api_token in the vault; run npm run deploy:hq',
      false,
    )
  }
  // =========================================================================
  /*
    #37's last two acceptance criteria (0397).

    Every check below drives the real function against rows this run made, and
    every one has its OPPOSITE asserted beside it — a filter that returns
    nothing looks exactly like a filter that excluded everything, and half of
    the filters here would "pass" if they simply never matched. So each is a
    pair: the thing is found when the filter should admit it, and not found
    when it should not.
  */
  console.log('\nnarrowed by the graph, not only by the words')

  const tagged = String(
    (
      await one(`
        insert into public.documents
          (project_id, connector, external_ref, title, doc_type, content,
           content_fingerprint, content_chars, fetched_at, origin, tags, produced_by)
        values (${lit(projectId)}::uuid, 'upload', ${lit(`probe-search-tag-${run}`)},
                ${lit(`Probe tagged subject ${run}`)}, 'note',
                ${lit(`Another paragraph mentioning ${BURIED} once, tagged and attributed.`)},
                encode(extensions.digest(${lit(`${BURIED}tag`)}, 'sha256'), 'hex'),
                100, app.now_utc(), 'made',
                array[${lit(`probe-tag-${run}`)}], 'research-director')
        returning document_id::text as id
      `)
    ).id,
  )
  alsoMade.push(tagged)

  const found = async (filters: string): Promise<string[]> =>
    (
      await all(
        `select * from public.studio_search(${lit(BURIED)}, null, 20, ${lit(filters)}::jsonb)`,
      )
    ).map((h) => String(h.title))

  const tagName = `probe-tag-${run}`
  check(
    'a tag filter keeps the tagged document and drops the untagged one',
    `tagged=${JSON.stringify(await found(JSON.stringify({ tag: tagName })))}`,
    (await found(JSON.stringify({ tag: tagName }))).includes(`Probe tagged subject ${run}`) &&
      !(await found(JSON.stringify({ tag: tagName }))).includes(TITLE),
  )
  check(
    'and a tag nothing carries returns nothing rather than everything',
    'tag=probe-tag-nobody',
    (await found(JSON.stringify({ tag: `probe-tag-nobody-${run}` }))).length === 0,
  )

  /*
    The kind filter, in both directions. `kinds: ['answer']` must exclude a
    document that plainly matches — which is the direction that catches a
    filter wired to nothing.
  */
  check(
    'asking only for documents finds them',
    'kinds=[document]',
    (await found(JSON.stringify({ kinds: ['document'] }))).includes(TITLE),
  )
  check(
    'and asking only for answers excludes every document',
    'kinds=[answer]',
    (await found(JSON.stringify({ kinds: ['answer'] }))).length === 0,
  )

  /*
    Dates. The probe was written seconds ago, so "since tomorrow" must be empty
    and "since last week" must contain it.
  */
  check(
    'a date window that has not started yet finds nothing',
    'since = tomorrow',
    (await found(JSON.stringify({ since: new Date(Date.now() + 86_400_000).toISOString() })))
      .length === 0,
  )
  check(
    'and one that has finds it',
    'since = a week ago',
    (
      await found(JSON.stringify({ since: new Date(Date.now() - 7 * 86_400_000).toISOString() }))
    ).includes(TITLE),
  )

  /*
    The relation filter, which is the criterion this issue was actually held
    open for: *"Relation queries: by producing agent, by related contact, by
    source"*.

    Asked through `app.relations_of`, so this is also the check that the search
    and the graph agree. The tagged document above was written with
    `produced_by = 'research-director'`, which `relations_of` derives as an edge
    from that agent — no `relations` row was inserted, deliberately, because a
    derived edge is the half a second copy of the graph would have missed.
  */
  const emma = String(
    (await one(`select staff_id::text as id from public.staff where slug = 'research-director'`))
      .id ?? '',
  )
  if (emma === '') {
    check('the research lead is on the roster', 'not found', false)
  } else {
    const byAgent = await found(JSON.stringify({ related_to: { kind: 'agent', id: emma } }))
    check(
      'everything the research lead produced, found through the graph',
      `by agent=${JSON.stringify(byAgent)}`,
      byAgent.includes(`Probe tagged subject ${run}`),
    )
    check(
      'and a document nobody attributed to her is not in it',
      `${String(byAgent.length)} row(s), none of them the unattributed probe`,
      !byAgent.includes(TITLE),
    )
    /*
      CONTROL. A relation filter naming something with no edges at all must
      return nothing — otherwise every check above would pass just as well if
      the filter were being ignored, which is exactly how an unknown key
      behaves by design.
    */
    check(
      'CONTROL: a relation filter naming nothing connected returns nothing',
      'related_to a random uuid',
      (
        await found(
          JSON.stringify({
            related_to: { kind: 'agent', id: '00000000-0000-0000-0000-000000000000' },
          }),
        )
      ).length === 0,
    )
  }

  /*
    And an unknown key is ignored rather than refused. Stated in the migration
    and worth a check, because the alternative — refusing it — turns a typo in
    a caller into a search that reads as "there is nothing there".
  */
  check(
    'an unknown filter key is ignored, not treated as matching nothing',
    'filters={"nonsense": "x"}',
    (await found(JSON.stringify({ nonsense: 'x' }))).includes(TITLE),
  )

  /*
    And the filters over HTTP, which is the layer this Issue has already been
    caught skipping once.

    `app.search_documents` worked perfectly and had no public wrapper, so
    nothing with a browser could call it, and the suite that should have found
    that read a token from the environment and reported "NOT CHECKED". The
    adapter is also the only place that can get the translation wrong — the SQL
    above proves the filters WORK and says nothing about whether a query string
    reaches them.
  */
  if (hqToken !== '') {
    const ask = async (extra: string): Promise<{ status: number; rows: number }> => {
      const r = await fetch(`${base}?section=search&q=${encodeURIComponent(BURIED)}${extra}`, {
        headers: { Authorization: `Bearer ${hqToken}` },
      })
      const body = (await r.json().catch(() => ({}))) as { data?: unknown[] }
      return { status: r.status, rows: (body.data ?? []).length }
    }

    const all = await ask('')
    const tagged2 = await ask(`&tag=${encodeURIComponent(tagName)}`)
    check(
      'a tag filter reaches the function through the query string',
      `no filter ${String(all.rows)} row(s), tagged ${String(tagged2.rows)}`,
      tagged2.status === 200 && tagged2.rows > 0 && tagged2.rows < all.rows,
    )
    check(
      'the relation filter reaches it too',
      `related=agent:<research director> → ${String((await ask(`&related=agent:${emma}`)).rows)} row(s)`,
      emma !== '' && (await ask(`&related=agent:${emma}`)).rows > 0,
    )
    /*
      A malformed value is refused with a sentence rather than passed through
      to become a 502 the caller cannot act on. The opposite of how the RPC
      treats an unknown KEY, and the migration says why.
    */
    check(
      'a malformed relation is refused by the adapter, not by Postgres',
      `http ${String((await ask('&related=agent:not-a-uuid')).status)}`,
      (await ask('&related=agent:not-a-uuid')).status === 400,
    )
    check(
      'and a date that is not a date is refused the same way',
      `http ${String((await ask('&since=the%20other%20day')).status)}`,
      (await ask('&since=the other day')).status === 400,
    )
  } else {
    check('the filters can be reached over HTTP', 'NOT CHECKED — no hq.api_token', false)
  }
} finally {
  console.log('\nteardown')
  for (const id of [docId, ...alsoMade].filter((x) => x !== '')) {
    await db.execute(`delete from public.documents where document_id = ${lit(id)}::uuid`)
  }
  const left = Number(
    (
      await one(`
        select count(*)::int as n from public.documents
         where external_ref = ${lit(`probe-search-${run}`)} or content ilike ${lit(`%${BURIED}%`)}
      `)
    ).n,
  )
  check(
    'teardown — the probe document is gone and its word with it',
    `${String(left)} left`,
    left === 0 && docId !== '',
  )
}

const failed = checks.filter((c) => !c).length
console.log(`\n${String(checks.length - failed)}/${String(checks.length)} checks passed`)
process.exit(failed === 0 ? 0 : 1)
