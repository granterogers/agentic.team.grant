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
