/**
 * The review gate, pressed (#28, #276).
 *
 *   npm run verify:review
 *
 * 0315 closed half of #28: an unapproved document is not in the project's
 * gallery, enforced in `studio_documents` so an agent asking what the project
 * holds gets the same answer as the page. The other half — letting one IN —
 * had no control anywhere. `document_approve` and `document_discard` were
 * gateway actions nothing could press, which is what `check:pressable` found,
 * and the reader that would have shown Grant the queue had never returned a
 * row in its life: `awaiting_review` filtered `state = 'review'` and NOTHING
 * in this repository has ever written that state. A found-nothing reader over
 * a state nobody writes, in front of two buttons nobody had.
 *
 * ## What this proves, and why over HTTP
 *
 * An offer may only promise what the press can perform. The Governance page's
 * Decline button is this repository's cautionary example — it sent no reason,
 * `decline_tool` refuses one without, and the press returned an error and did
 * nothing, while a comment beside it claimed the RPC supplied a default. The
 * only thing that catches that is driving the real action through the
 * deployed gateway, which is what the checks below do.
 *
 * ## Every check has its opposite
 *
 * Approving that put everything in the gallery would pass a suite that only
 * asserted appearance. So: the queue holds the draft and NOT the approved
 * documents already in the project; approving moves it into the gallery;
 * discarding takes it out of the queue AND keeps the row, its content and its
 * provenance, because ADR-0040 is that an unwanted document is archived and
 * restorable rather than destroyed; and a second discard is not an error.
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
console.log('the review gate, pressed (#28, #276) —\n')

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
  A fixture project, and the question #45 says to ask about the SPECIFIC
  reader: `awaiting_review` does not filter fixtures, and neither does
  `studio_documents`, so a fixture subject is tested by the same code path a
  real one takes. A REAL project here would leave permanent debris, because
  anything that gathers a job can never be deleted.

  Paused rather than active, so nothing that watches for new projects fires.
*/
const slug = `fixture-review-${run}`
const projectId = String(
  (
    await one(`
      insert into public.projects (slug, name, purpose, status)
      values (${lit(slug)}, ${lit(`Review gate ${run}`)},
              'Removed at the end of this run', 'paused')
      returning project_id::text as id`)
  ).id,
)

/*
  Three documents: one the office made and has not decided about, one it made
  and Grant already approved, and one that came from a connector.

  The second and third are the negative controls. A queue that showed either
  would be asking Grant to decide about something already decided, and the
  approved one is also what proves the gallery check below discriminates.

  `content_fingerprint` is a sha256 and `fetched_at` must be present iff there
  is content — three separate CHECK constraints that travel together, and four
  runs of another suite were spent discovering them one at a time. `connector`
  is a foreign key onto `knowledge_connectors`, so a made document carries NULL
  rather than the word 'none' — 0177's sentinel, which satisfies a constraint
  and lies. A fourth,
  `documents_file_is_complete`, refuses a `mime_type` with no `storage_path`
  and no `byte_size`: these rows are text, so they carry none of the three.
*/
const mkDoc = async (title: string, origin: string, state: string): Promise<string> =>
  String(
    (
      await one(`
        insert into public.documents
          (project_id, connector, external_ref, title, content, content_fingerprint,
           fetched_at, origin, state, produced_by)
        values (${lit(projectId)}::uuid,
                ${origin === 'made' ? 'null' : lit('notebooklm')},
                ${lit(`${title}-${run}`)}, ${lit(title)},
                'A short body, so the row is a document and not a stub.',
                encode(extensions.digest('body-' || ${lit(title)} || ${lit(run)}, 'sha256'), 'hex'),
                app.now_utc(), ${lit(origin)}, ${lit(state)},
                ${origin === 'made' ? lit('Emma') : lit('')})
        returning document_id::text as id`)
    ).id,
  )

const waiting = await mkDoc(`The draft ${run}`, 'made', 'draft')
const alsoWaiting = await mkDoc(`The second draft ${run}`, 'made', 'draft')
await mkDoc(`Approved already ${run}`, 'made', 'approved')
await mkDoc(`From a connector ${run}`, 'source', 'approved')

// --- the reader -------------------------------------------------------------

const ask = async (section: string): Promise<unknown> => {
  const r = await fetch(`${ENDPOINT}?section=${section}&id=${projectId}`, {
    headers: { Authorization: `Bearer ${bearer}` },
  })
  const body = (await r.json()) as { data?: unknown; error?: string }
  if (!r.ok) throw new Error(body.error ?? `http ${String(r.status)}`)
  return body.data
}

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

const titles = (rows: unknown): string[] =>
  Array.isArray(rows) ? rows.map((r) => String((r as Record<string, unknown>).title ?? '')) : []

const queue0 = await ask('review')
check(
  'the queue is reachable from the page, not only from SQL',
  Array.isArray(queue0) ? `${String(queue0.length)} row(s)` : 'NOT A LIST',
  Array.isArray(queue0),
)
check(
  'and it holds what the team made and nobody has decided about',
  titles(queue0).join(' · ').slice(0, 80),
  titles(queue0).length === 2 && titles(queue0).every((t) => t.includes('draft')),
)
check(
  'CONTROL: a document already approved is not asked about again',
  titles(queue0).some((t) => t.startsWith('Approved already')) ? 'IT IS IN THE QUEUE' : 'absent',
  !titles(queue0).some((t) => t.startsWith('Approved already')),
)
check(
  'CONTROL: and neither is one that came from a connector',
  titles(queue0).some((t) => t.startsWith('From a connector')) ? 'IT IS IN THE QUEUE' : 'absent',
  !titles(queue0).some((t) => t.startsWith('From a connector')),
)

/*
  The gallery, before either press. 0315 filters it on `approved`, so the
  drafts must be absent — that is the half of the gate which already worked,
  and asserting it here is what makes the change below mean something.
*/
const gallery = async (): Promise<string[]> => {
  const r = await one(
    `select coalesce(app.studio_documents(${lit(projectId)}::uuid), '[]'::jsonb)::text as v`,
  )
  const rows = JSON.parse(String(r.v)) as { title?: string }[]
  return rows.map((x) => String(x.title ?? ''))
}
const before = await gallery()
check(
  'before the press, a draft is not in the project',
  `${String(before.length)} in the gallery`,
  before.length === 2 && !before.some((t) => t.includes('draft')),
)

// --- approve ----------------------------------------------------------------

const approved = (await press('document_approve', { p_document: waiting })) as
  | Record<string, unknown>
  | undefined
check(
  'Approve does what it offers, through the deployed gateway',
  approved?.ok === true ? String(approved.title ?? '') : `REFUSED: ${JSON.stringify(approved)}`,
  approved?.ok === true,
)
const after = await gallery()
check(
  'and the document is in the project afterwards',
  `${String(after.length)} in the gallery`,
  after.length === 3 && after.some((t) => t.startsWith('The draft')),
)
const queue1 = await ask('review')
check(
  'so the queue no longer asks about it',
  titles(queue1).join(' · ').slice(0, 60),
  titles(queue1).length === 1 && titles(queue1)[0]?.startsWith('The second draft') === true,
)

// --- discard ----------------------------------------------------------------

const discarded = (await press('document_discard', { p_document: alsoWaiting })) as
  | Record<string, unknown>
  | undefined
check(
  'Discard does what it offers too',
  discarded?.ok === true ? String(discarded.was ?? '') : `REFUSED: ${JSON.stringify(discarded)}`,
  discarded?.ok === true,
)
const queue2 = await ask('review')
check(
  'the queue is empty once both have been decided',
  `${String(titles(queue2).length)} left`,
  titles(queue2).length === 0,
)
const kept = await one(`
  select state, coalesce(length(content), 0)::int as chars,
         coalesce(content_fingerprint, '') as fp
    from public.documents where document_id = ${lit(alsoWaiting)}::uuid`)
check(
  'a discarded document is archived, not destroyed — ADR-0040',
  `state=${String(kept.state)} chars=${String(kept.chars)} fingerprint=${
    String(kept.fp) === '' ? 'GONE' : 'kept'
  }`,
  String(kept.state) === 'archived' && Number(kept.chars) > 0 && String(kept.fp) !== '',
)
const nor = await gallery()
check(
  'CONTROL: and discarding did not put it in the project either',
  `${String(nor.length)} in the gallery`,
  nor.length === 3 && !nor.some((t) => t.startsWith('The second draft')),
)
const twice = (await press('document_discard', { p_document: alsoWaiting })) as
  | Record<string, unknown>
  | undefined
check(
  'a second press is a person making sure, not an error',
  twice?.ok === true && twice.already === true ? 'ok, already' : JSON.stringify(twice),
  twice?.ok === true && twice.already === true,
)

// --- the control the page has to have ---------------------------------------

{
  const source = readFileSync('supabase/functions/hq-api/index.ts', 'utf8')
  const page = readFileSync('web/studio/app.js', 'utf8')
  check(
    'the gateway serves the queue as a section the page can read',
    /review:\s*\{\s*fn:\s*'awaiting_review'/.test(source) ? 'bound' : 'NOT BOUND',
    /review:\s*\{\s*fn:\s*'awaiting_review'/.test(source),
  )
  /*
    Both halves, because a control drawn only when a ROW exists is invisible to
    `verify:wired` — it walks the screens with no token and an empty queue, and
    CLAUDE.md records that blind spot twice. The attribute AND the call, since
    either alone is the defect this suite exists for.
  */
  check(
    'and the studio draws Approve and calls it',
    /data-doc-approve/.test(page) && /act\('document_approve'/.test(page) ? 'present' : 'MISSING',
    /data-doc-approve/.test(page) && /act\('document_approve'/.test(page),
  )
  check(
    'and Discard',
    /data-doc-discard/.test(page) && /act\('document_discard'/.test(page) ? 'present' : 'MISSING',
    /data-doc-discard/.test(page) && /act\('document_discard'/.test(page),
  )
}

// --- teardown ---------------------------------------------------------------

console.log('')
await db.execute(`
  delete from public.document_collections
   where document_id in (select document_id from public.documents
                          where project_id = ${lit(projectId)}::uuid);
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
const left = await one(`select count(*)::int as n from public.projects where slug = ${lit(slug)}`)
check(
  'teardown — nothing of this run is left in Grant’s project list',
  `${gone}, ${String(left.n)} remaining`,
  Number(left.n) === 0,
)

const failed = checks.filter((c) => !c.passed)
console.log(`\n${String(checks.length - failed.length)}/${String(checks.length)} checks passed`)
process.exit(failed.length === 0 ? 0 : 1)
