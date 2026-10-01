/**
 * A project may point at anything, not only at things we can log into.
 *
 *   npm run verify:references
 *
 * Issue #35, migrations 0306 and 0307. The half of Sources that did not exist:
 * `project_attachments.connector` references `knowledge_connectors`, so a
 * project could point at a Notion database and could not point at a website,
 * an API, or an application — which is most of what Grant's projects actually
 * point at.
 *
 * ## The property that matters most
 *
 * **A reference is not a degenerate connector.** It has no health, no
 * last-synced time and no contribution count, and those three are null on
 * purpose rather than unfilled. The cheap implementation — `connector =
 * 'link'` — would have made every reader that joins `knowledge_connectors`
 * ask a question of a row with no answers and get a fabricated one back.
 * 0177 refused that shape once already; the last section here asserts it did
 * not come back.
 *
 * ## Real subjects, and why
 *
 * `add_project_reference` takes a SLUG and refuses an archived project, so it
 * cannot be driven against a fixture name that no longer resolves. The
 * subjects are a real project and a `probe-` URL that is torn down — and the
 * teardown is asserted rather than assumed, because one that matches nothing
 * looks exactly like one that worked.
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
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

const run = Math.random().toString(36).slice(2, 10)
const HOST = `probe-${run}.example`
type Source = {
  kind?: string
  id?: string
  name?: string
  via?: string
  url?: string
  what?: string | null
  health?: string | null
  last?: string | null
  gave?: number | null
}

console.log(`\nverify:references — ${run}\n`)

let slug = ''
const made: string[] = []

try {
  slug = String(
    (
      await one(`
        select slug from public.projects
         where status = 'active' and not is_fixture order by slug limit 1
      `)
    ).slug,
  )

  const sources = async (): Promise<Source[]> =>
    ((
      await one(`
        select app.studio_sources(
                 (select project_id from public.projects where slug = ${lit(slug)})) as s
      `)
    ).s ?? []) as Source[]

  const before = await sources()

  // =========================================================================
  console.log('a website, with no integration behind it')

  const added = (
    await one(`
      select public.add_project_reference(app.test_office(), ${lit(slug)}, ${lit(`${HOST}/pricing`)},
        null, null, 'What the competition charges') as r
    `)
  ).r as { ok?: boolean; reference?: string; kind?: string; title?: string }
  if (typeof added.reference === 'string') made.push(added.reference)
  check(
    'it is accepted without a connector existing for it',
    JSON.stringify(added),
    added.ok === true && typeof added.reference === 'string',
  )

  /*
    The kind and the title are inferred, and that is #35's §31 clause: an
    avoidable request for manual configuration is a design failure, and the URL
    already answers both questions.
  */
  check(
    'and it works out what it is and what to call it, without being told',
    `${String(added.kind)} · ${String(added.title)}`,
    added.kind === 'website' && String(added.title).startsWith(`probe-${run}`),
  )

  /*
    A bare host is a link. Grant pastes "stripe.com/docs" as often as the full
    thing, and an interface that refuses it is being pedantic about a detail it
    can fix itself.
  */
  const bare = (
    await one(
      `select public.add_project_reference(app.test_office(), ${lit(slug)}, ${lit(`${HOST}/docs`)}) as r`,
    )
  ).r as { ok?: boolean; reference?: string }
  if (typeof bare.reference === 'string') made.push(bare.reference)
  const stored = await one(
    `select url from public.project_references where reference_id = ${lit(String(bare.reference))}::uuid`,
  )
  check(
    'a bare host is stored as a real URL rather than refused',
    String(stored.url),
    bare.ok === true && String(stored.url) === `https://${HOST}/docs`,
  )

  // =========================================================================
  console.log('\nand the kinds the specification names')

  const kinds: [string, string][] = [
    [`https://${HOST}/api/v2/orders`, 'api'],
    [`https://drive.google.com/drive/folders/probe${run}`, 'folder'],
    [`https://${HOST}/handbook.pdf`, 'document'],
    [`slack://channel?team=probe${run}`, 'application'],
  ]
  const got: string[] = []
  for (const [url, want] of kinds) {
    const r = (
      await one(
        `select public.add_project_reference(app.test_office(), ${lit(slug)}, ${lit(url)}) as r`,
      )
    ).r as { reference?: string; kind?: string }
    if (typeof r.reference === 'string') made.push(r.reference)
    got.push(`${String(r.kind)}${r.kind === want ? '' : ` (wanted ${want})`}`)
  }
  check(
    'an API, a folder, a document and an application are each recognised',
    got.join(', '),
    got.every((g) => !g.includes('wanted')),
  )

  // =========================================================================
  console.log('\nthe same link twice is one source, not two')

  const again = (
    await one(`
      select public.add_project_reference(app.test_office(), ${lit(slug)}, ${lit(`HTTPS://WWW.${HOST}/pricing/`)}) as r
    `)
  ).r as { ok?: boolean; already?: boolean; error?: string }
  /*
    Asserted on the MESSAGE and on the count, not merely that something was
    refused: a raw failure for an unrelated reason looks identical to the rule
    working, and this repository has reported a PASS on that shape twice.
    Scheme, "www." and a trailing slash are all noise, so this IS the same link.
  */
  const copies = Number(
    (
      await one(`
        select count(*)::int as n from public.project_references
         where url ilike ${lit(`%${HOST}/pricing%`)}
      `)
    ).n,
  )
  check(
    'a differently-typed copy of the same link is refused, and says so',
    `${JSON.stringify(again)} · ${String(copies)} row(s)`,
    again.ok === false && again.already === true && copies === 1,
  )

  // =========================================================================
  console.log('\nit reaches the page, beside the connectors')

  const after = await sources()
  const mine = after.find((s) => s.url === `https://${HOST}/pricing`)
  check(
    'the Sources list carries both kinds',
    `${String(after.filter((s) => s.kind === 'connector').length)} connector(s), ` +
      `${String(after.filter((s) => s.kind === 'reference').length)} reference(s)`,
    after.some((s) => s.kind === 'connector') && after.some((s) => s.kind === 'reference'),
  )
  check(
    'and every one of them has a name and a kind, not an empty card',
    mine === undefined ? 'mine is not there' : `${String(mine.kind)} · ${String(mine.name)}`,
    after.every((s) => typeof s.kind === 'string' && String(s.name ?? '') !== ''),
  )

  /*
    The property this whole design turns on. 0307 also exists because of it:
    the first union aggregated the ROW rather than the payload and every field
    of every source came back null, which is a card with nothing in it — no
    overflow, no small type, no bad contrast, and every check green.
  */
  check(
    'a reference carries no health, no last-read and no contribution count',
    mine === undefined
      ? '—'
      : `health=${String(mine.health)} last=${String(mine.last)} gave=${String(mine.gave)}`,
    mine !== undefined && mine.health === null && mine.last === null && mine.gave === null,
  )
  check(
    'CONTROL: a connector on the same project still carries all three',
    (() => {
      const c = after.find((s) => s.kind === 'connector')
      return c === undefined
        ? 'no connector to compare'
        : `health=${String(c.health)} last=${String(c.last)}`
    })(),
    after
      .filter((s) => s.kind === 'connector')
      .every((c) => typeof c.health === 'string' && typeof c.last === 'string'),
  )
  check(
    'and the connectors that were there before are all still there',
    `${String(before.length)} → ${String(after.length)}`,
    before.every((b) => after.some((a) => a.id === b.id)),
  )

  // =========================================================================
  console.log('\na reference is not a degenerate connector')

  /*
    0177's argument, asserted rather than trusted: a sentinel satisfies the
    constraint and lies. If a reference had been modelled as
    `connector = 'link'`, this would find it.
  */
  const sentinel = Number(
    (
      await one(`
        select count(*)::int as n from public.project_attachments a
         where not exists (select 1 from public.knowledge_connectors k
                            where k.connector = a.connector)
      `)
    ).n,
  )
  check(
    'no attachment names a connector that is not in the registry',
    `${String(sentinel)} sentinel row(s)`,
    sentinel === 0,
  )

  const refused = await (async () => {
    try {
      await db.execute(`
        insert into public.project_references (project_id, kind, url, title)
        values ((select project_id from public.projects where slug = ${lit(slug)}),
                'not-a-kind', 'https://x.example', 'x')
      `)
      return ''
    } catch (error) {
      return error instanceof Error ? error.message : String(error)
    }
  })()
  check(
    'and a kind outside the vocabulary is refused by the column, not by the caller',
    refused === '' ? 'IT WAS ACCEPTED' : (refused.split('\n')[0]?.slice(0, 80) ?? ''),
    refused !== '' && /check constraint|violates/i.test(refused),
  )

  // =========================================================================
  console.log('\nand it can be taken away again')

  const gone = (
    await one(
      `select public.remove_project_reference(app.test_office(), ${lit(made[1] ?? '')}::uuid) as r`,
    )
  ).r as { ok?: boolean; removed?: string }
  check('removing one answers with what it removed', JSON.stringify(gone), gone.ok === true)
  const still = await sources()
  check(
    'and it leaves the page',
    `${String(still.filter((s) => s.kind === 'reference').length)} reference(s) left`,
    !still.some((s) => s.url === `https://${HOST}/docs`),
  )
  const twice = (
    await one(
      `select public.remove_project_reference(app.test_office(), ${lit(made[1] ?? '')}::uuid) as r`,
    )
  ).r as { ok?: boolean; error?: string }
  check(
    'removing it again is refused rather than silently succeeding',
    JSON.stringify(twice),
    twice.ok === false,
  )
} finally {
  console.log('\nteardown')
  await db.execute(
    `delete from public.project_references where url ilike ${lit(`%${HOST}%`)}
       or url ilike ${lit(`%probe${run}%`)}`,
  )
  const left = Number(
    (
      await one(`
        select count(*)::int as n from public.project_references
         where url ilike ${lit(`%${HOST}%`)} or url ilike ${lit(`%probe${run}%`)}
      `)
    ).n,
  )
  check(
    'teardown — every probe reference is gone',
    `${String(left)} left of ${String(made.length)} made`,
    left === 0 && made.length > 0,
  )
}

const failed = checks.filter((c) => !c).length
console.log(`\n${String(checks.length - failed)}/${String(checks.length)} checks passed`)
process.exit(failed === 0 ? 0 : 1)
