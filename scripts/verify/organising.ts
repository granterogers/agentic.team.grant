/**
 * Tags and collections, pressed (#276).
 *
 *   npm run verify:organising
 *
 * `document_tag`, `collection_put` and `collection_take` have been bound at
 * the gateway since the document work, backed by three RPCs that work, and
 * nothing in `web/` named any of them. So the two ways of organising a library
 * were things an agent holding the bearer token could do and Grant could not —
 * which is what `check:pressable` exists to find, and the third cluster it
 * found after `stop_job` and the review gate.
 *
 * Project Settings had already told him both were here: *"A collection is made
 * by filing a document into one, and unmade by taking the last document out.
 * Both are in Documents, on the document itself."* They were not. An offer may
 * only promise what the press can perform.
 *
 * ## Why the reader had to change first
 *
 * A tag control cannot be built on a reader that does not know which tags are
 * already set: it could only ever add, and the chip row that says what is on
 * would be a row that cannot be drawn. `app.studio_documents` emitted neither
 * tags nor collections, so 0479 added both — derived from
 * `documents.tags` and `document_collections`, never stored a second time.
 *
 * ## Every check has its opposite
 *
 * Tagging that tagged everything would pass a suite that only asserted
 * appearance. So each press is followed by the control that proves it
 * discriminated: the OTHER document in the same project is untouched, an
 * untag removes one word and leaves the rest, a collection holds what was
 * filed and not what was not, and taking something out a second time is a
 * person making sure rather than an error.
 */

import { readFileSync } from 'node:fs'
import { ManagementApiExecutor } from '../../src/db/executor.ts'

const token = process.env.SUPABASE_ACCESS_TOKEN
if (token === undefined || token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}
const ref = process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg'
const db = new ManagementApiExecutor(ref, token)
const ENDPOINT = `https://${ref}.supabase.co/functions/v1/hq-api`

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
const one = async (sql: string): Promise<Record<string, unknown>> =>
  ((await db.execute(sql)).rows[0] ?? {}) as Record<string, unknown>

const checks: { what: string; outcome: string; passed: boolean }[] = []
const check = (what: string, outcome: string, passed: boolean): void => {
  checks.push({ what, outcome, passed })
  console.log(`  ${passed ? 'ok  ' : 'FAIL'} ${what} — ${outcome}`)
}

const run = Math.random().toString(36).slice(2, 10)
console.log('tags and collections, pressed (#276) —\n')

const bearer = String(
  (
    await one(
      `select decrypted_secret as v from vault.decrypted_secrets where name = 'hq.api_token'`,
    )
  ).v ?? '',
)
if (bearer === '') {
  console.error('no hq.api_token in the vault — run `npm run deploy:hq` first')
  process.exit(2)
}

/*
  A fixture project, and #45's question asked about the SPECIFIC readers:
  neither `studio_documents` nor any of the three RPCs filters fixtures, so a
  fixture subject travels the same code path a real one does. A real project
  would leave permanent debris — anything that gathers a job can never be
  deleted — and 0419 means a paused project fires nothing at creation.
*/
const slug = `fixture-organising-${run}`
const projectId = String(
  (
    await one(`
      insert into public.projects (office_id, slug, name, purpose, status)
      values (app.test_office(), ${lit(slug)}, ${lit(`Organising ${run}`)},
              'Removed at the end of this run', 'paused')
      returning project_id::text as id`)
  ).id,
)

/*
  Two approved documents. The second is the negative control for every press
  below: a tag or a filing that reached it would be a write that did not
  discriminate, which is the failure a suite of appearances cannot see.

  The three fixed points of a `documents` fixture travel together — `content`
  with a `content_fingerprint`, the fingerprint a sha256, and `fetched_at` iff
  there is content. `connector` is NULL for a made document rather than the
  word 'none', which is 0177's sentinel.
*/
const mkDoc = async (title: string): Promise<string> =>
  String(
    (
      await one(`
        insert into public.documents
          (office_id, project_id, connector, external_ref, title, content, content_fingerprint,
           fetched_at, origin, state, produced_by)
        values ((select office_id from public.projects where project_id = ${lit(projectId)}::uuid),
                ${lit(projectId)}::uuid, null, ${lit(`${title}-${run}`)}, ${lit(title)},
                'A short body, so the row is a document and not a stub.',
                encode(extensions.digest('body-' || ${lit(title)} || ${lit(run)}, 'sha256'), 'hex'),
                app.now_utc(), 'made', 'approved', 'Emma')
        returning document_id::text as id`)
    ).id,
  )

const subject = await mkDoc(`The subject ${run}`)
const bystander = await mkDoc(`The bystander ${run}`)

const press = async (action: string, args: Record<string, unknown>): Promise<unknown> => {
  const r = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, args }),
  })
  const body = (await r.json()) as { result?: unknown; error?: string }
  if (!r.ok) throw new Error(body.error ?? `http ${String(r.status)}`)
  return body.result
}

/*
  The gallery payload, which is what the page actually holds — not the columns.
  Asserting on `documents.tags` directly would pass while the page could still
  not see a single one, which is precisely the defect this suite is about.
*/
interface Row {
  id?: string
  title?: string
  tags?: string[]
  collections?: string[]
}
const gallery = async (): Promise<Row[]> => {
  const r = await one(
    `select coalesce(app.studio_documents(${lit(projectId)}::uuid), '[]'::jsonb)::text as v`,
  )
  return JSON.parse(String(r.v)) as Row[]
}
const rowFor = async (id: string): Promise<Row> => (await gallery()).find((x) => x.id === id) ?? {}

// --- the reader carries what the controls toggle (0479) ---------------------

const first = await rowFor(subject)
check(
  'the gallery payload carries a document’s tags',
  Array.isArray(first.tags) ? `[] as an empty array` : `MISSING: ${JSON.stringify(first)}`,
  Array.isArray(first.tags) && first.tags.length === 0,
)
check(
  'and the collections it is filed in',
  Array.isArray(first.collections) ? 'an empty array' : 'MISSING',
  Array.isArray(first.collections) && first.collections.length === 0,
)

// --- tagging ----------------------------------------------------------------

const tagged = (await press('document_tag', {
  p_document: subject,
  p_tag: `Pricing ${run}`,
  p_on: true,
})) as Record<string, unknown> | undefined
check(
  'Tag it does what it offers, through the deployed gateway',
  tagged?.ok === true ? JSON.stringify(tagged.tags) : `REFUSED: ${JSON.stringify(tagged)}`,
  tagged?.ok === true,
)
check(
  'and the RPC answers with the whole array, lower-cased, which is what the chips redraw from',
  JSON.stringify(tagged?.tags),
  Array.isArray(tagged?.tags) &&
    (tagged.tags as string[]).length === 1 &&
    (tagged.tags as string[])[0] === `pricing ${run}`,
)
check(
  'the page can see it on the next read',
  JSON.stringify((await rowFor(subject)).tags),
  ((await rowFor(subject)).tags ?? []).includes(`pricing ${run}`),
)
check(
  'CONTROL: and the other document in the same project was not tagged',
  JSON.stringify((await rowFor(bystander)).tags),
  ((await rowFor(bystander)).tags ?? []).length === 0,
)

await press('document_tag', { p_document: subject, p_tag: `Urgent ${run}`, p_on: true })
const twiceTagged = (await press('document_tag', {
  p_document: subject,
  p_tag: `Pricing ${run}`,
  p_on: true,
})) as Record<string, unknown> | undefined
check(
  'tagging the same word twice is one tag, not two',
  JSON.stringify(twiceTagged?.tags),
  Array.isArray(twiceTagged?.tags) && (twiceTagged.tags as string[]).length === 2,
)

const untagged = (await press('document_tag', {
  p_document: subject,
  p_tag: `Pricing ${run}`,
  p_on: false,
})) as Record<string, unknown> | undefined
check(
  'the × on a chip takes exactly that word off and leaves the rest',
  JSON.stringify(untagged?.tags),
  Array.isArray(untagged?.tags) &&
    (untagged.tags as string[]).length === 1 &&
    (untagged.tags as string[])[0] === `urgent ${run}`,
)

/*
  Two layers refuse an empty tag and the first draft of this check only knew
  about one of them. The gateway's `required` list rejects a whitespace-only
  `p_tag` before the RPC is called at all, so the answer is `missing: p_tag`
  and not the RPC's sentence — the check was wrong, not the product, which is
  the most-used rule in CLAUDE.md. Both are asserted, because the RPC's guard
  is the one a caller that is not the page meets.
*/
let refusedEmpty = ''
try {
  await press('document_tag', { p_document: subject, p_tag: '   ', p_on: true })
  refusedEmpty = 'ACCEPTED'
} catch (e) {
  refusedEmpty = String((e as Error).message)
}
check(
  'CONTROL: a tag with no word in it never reaches the database',
  refusedEmpty,
  refusedEmpty.includes('missing: p_tag'),
)
const rpcRefusal = String(
  (
    await one(
      `select app.tag_document(app.test_office(), ${lit(subject)}::uuid, '   ', true) ->> 'error' as v`,
    )
  ).v ?? '',
)
check(
  'and the RPC refuses it too, for a caller that is not the page',
  rpcRefusal === '' ? 'ACCEPTED' : rpcRefusal,
  rpcRefusal === 'a tag needs a word',
)

// --- collections ------------------------------------------------------------

const filed = (await press('collection_put', {
  p_document: subject,
  p_collection_name: `Board pack ${run}`,
})) as unknown
check(
  'File it does what it offers, and creates the collection on first use',
  typeof filed === 'string' ? 'a collection id came back' : JSON.stringify(filed),
  typeof filed === 'string' && /^[0-9a-f-]{36}$/i.test(filed),
)
check(
  'and the page can see which collection the document is in',
  JSON.stringify((await rowFor(subject)).collections),
  ((await rowFor(subject)).collections ?? []).includes(`Board pack ${run}`),
)
check(
  'CONTROL: the other document was not filed with it',
  JSON.stringify((await rowFor(bystander)).collections),
  ((await rowFor(bystander)).collections ?? []).length === 0,
)

/*
  Filed into a second one, because a document belongs to as many collections as
  it belongs to and a chip row that can only ever show one is a chip row built
  on a wrong assumption.
*/
await press('collection_put', { p_document: subject, p_collection_name: `Pricing work ${run}` })
const both = (await rowFor(subject)).collections ?? []
check(
  'a document can be in more than one, and they come back sorted',
  JSON.stringify(both),
  both.length === 2 && both[0] === `Board pack ${run}` && both[1] === `Pricing work ${run}`,
)

const took = (await press('collection_take', {
  p_document: subject,
  p_collection_name: `Board pack ${run}`,
})) as Record<string, unknown> | undefined
check(
  'the × on a collection chip takes it out of that one',
  took?.ok === true ? String(took.removed_from ?? '') : JSON.stringify(took),
  took?.ok === true,
)
const left = (await rowFor(subject)).collections ?? []
check(
  'and leaves the other filing alone',
  JSON.stringify(left),
  left.length === 1 && left[0] === `Pricing work ${run}`,
)
const again = (await press('collection_take', {
  p_document: subject,
  p_collection_name: `Board pack ${run}`,
})) as Record<string, unknown> | undefined
check(
  'taking it out a second time is a person making sure, not an error',
  JSON.stringify(again),
  again?.ok === true && again.already === true,
)
let noSuch = ''
try {
  noSuch = JSON.stringify(
    await press('collection_take', {
      p_document: subject,
      p_collection_name: `Never existed ${run}`,
    }),
  )
} catch (e) {
  noSuch = String((e as Error).message)
}
check(
  'CONTROL: and taking it out of a collection this project does not have says so',
  noSuch,
  noSuch.includes('no such collection in this project'),
)

// --- the controls the page has to have --------------------------------------

{
  const page = readFileSync('web/studio/app.js', 'utf8')
  const settings = readFileSync('web/studio/project-settings.js', 'utf8')
  /*
    Both halves for each, because a control drawn only when a document is OPEN
    is invisible to `verify:wired` — it walks the screens collecting the
    attributes it can see, and the document sheet is built outside the render
    tree. The attribute AND the call, since either alone is the shape this
    suite exists for.
  */
  const has = (attr: string, call: string): boolean =>
    new RegExp(attr).test(page) && new RegExp(`act\\('${call}'`).test(page)
  check(
    'the studio draws a tag control and calls document_tag',
    has('data-doc-tag=', 'document_tag') ? 'present' : 'MISSING',
    has('data-doc-tag=', 'document_tag'),
  )
  check(
    'and a × that takes a tag off',
    /data-doc-untag/.test(page) ? 'present' : 'MISSING',
    /data-doc-untag/.test(page),
  )
  /*
    The literal, not `act('collection_put'`: the page picks between putting and
    taking with a ternary inside one `act` call, because the two presses differ only
    in the verb. The first draft of this check looked for the call spelled out
    and reported MISSING about a control that works — the test was wrong, not
    the product.
  */
  check(
    'and files a document into a collection',
    /data-doc-collect=/.test(page) && /'collection_put'/.test(page) ? 'present' : 'MISSING',
    /data-doc-collect=/.test(page) && /'collection_put'/.test(page),
  )
  check(
    'and takes it back out',
    /data-doc-uncollect/.test(page) && /'collection_take'/.test(page) ? 'present' : 'MISSING',
    /data-doc-uncollect/.test(page) && /'collection_take'/.test(page),
  )
  /*
    The listener is DELEGATED. `docOrganising` replaces its own markup after
    every press, so a listener bound to each chip works exactly once — the trap
    this repository hit three times in one afternoon in the icon picker, and
    the one `verify:controls` cannot catch, because it presses each control
    from a fresh render. Asserted as a property of the source because there is
    no other way to see it.
  */
  check(
    'and the chip presses are delegated, so they survive the redraw',
    /docsheet'?,? ?v?\)?\??\.addEventListener\('click'/.test(page) ||
      /sheetEl\?\.addEventListener\('click'/.test(page)
      ? 'delegated on the sheet'
      : 'BOUND PER CHIP',
    /sheetEl\?\.addEventListener\('click'/.test(page),
  )
  check(
    'and Project Settings now lists the collections it used to only describe',
    /d\.collections/.test(settings) ? 'listed' : 'STILL PROSE ONLY',
    /d\.collections/.test(settings),
  )
}

// --- teardown ---------------------------------------------------------------

console.log('')
await db.execute(`
  delete from public.document_collections
   where document_id in (select document_id from public.documents
                          where project_id = ${lit(projectId)}::uuid);
  delete from public.collections where project_id = ${lit(projectId)}::uuid;
  delete from public.relations where project_id = ${lit(projectId)}::uuid;
  delete from public.documents where project_id = ${lit(projectId)}::uuid;
  delete from public.events where project_id = ${lit(projectId)}::uuid;`)
let gone = 'not attempted'
try {
  await db.execute(`select app.project_delete(${lit(slug)})`)
  gone = 'deleted'
} catch (e) {
  gone = `REFUSED: ${String(e).slice(0, 80)}`
}
const remaining = await one(
  `select count(*)::int as n from public.projects where slug = ${lit(slug)}`,
)
check(
  'teardown — nothing of this run is left in Grant’s project list',
  `${gone}, ${String(remaining.n)} remaining`,
  Number(remaining.n) === 0,
)

const failed = checks.filter((c) => !c.passed)
console.log(`\n${String(checks.length - failed.length)}/${String(checks.length)} checks passed`)
process.exit(failed.length === 0 ? 0 : 1)
