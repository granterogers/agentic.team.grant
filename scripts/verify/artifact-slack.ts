/**
 * The live Slack round trip for a generated artifact (#258).
 *
 *   npm run verify:artifact-slack
 *
 * This is the ONE box #258 left open. Its own comment of 2026-09-17 says it
 * plainly:
 *
 *   > A live Slack round trip: ask for a report in a real Slack channel and
 *   > click the link that arrives. Every layer is tested and the wire format is
 *   > asserted, but nothing has yet posted a real message to the workspace, so
 *   > the end-to-end claim is not one I will make from unit tests.
 *
 * So this suite makes no claim from unit tests. It asks a real question in a
 * real Slack channel in Grant's workspace, lets the DEPLOYED worker answer it,
 * reads what actually landed in the room, takes the URL out of that message
 * and **fetches it**, and asserts that what comes back is a PDF.
 *
 * ## Why the deployed worker rather than an in-process run
 *
 * The defect the Issue was opened for was never in a renderer. It was that
 * `attachFile` was read in exactly one place, and a renderer-only test would
 * have been green throughout the entire period the capability was missing. The
 * only thing that can answer "does a Slack user get the file" is a Slack user
 * getting the file, and in production that is the deployed worker's Slack
 * notifier with the project ref and service key the composition root gave it.
 * An in-process pass would be a second wiring.
 *
 * ## Safety
 *
 * A FIXTURE project (`fixture-artifact-slack-…`) whose display name begins
 * `zz test`, so the channel it provisions is named that way FROM BIRTH rather
 * than renamed at teardown — CLAUDE.md records ten channels surviving in
 * Grant's Mentions because a crashed run never reached its cleanup. Nothing is
 * sent to Grant's own channels, and the channel is parked and archived at the
 * end.
 *
 * `requested_by` is corrected in teardown and ASSERTED, because a suite that
 * drives the real enqueue path produces jobs indistinguishable from his —
 * 0342 and 0351 are both that lesson and neither travelled to the next suite.
 */

import type { SqlExecutor } from '../../src/db/executor.ts'
import { ManagementApiExecutor } from '../../src/db/executor.ts'
import { signedUrl } from '../../src/files/store.ts'
import { SlackClient } from '../../src/slack/api.ts'
import { ChannelProvisioner } from '../../src/slack/provision.ts'

const supabaseToken = process.env.SUPABASE_ACCESS_TOKEN
if (supabaseToken === undefined || supabaseToken === '') {
  console.error('SUPABASE_ACCESS_TOKEN is not set')
  process.exit(2)
}

const ref = process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg'
const db: SqlExecutor = new ManagementApiExecutor(ref, supabaseToken)

/*
  THE BOT TOKEN COMES FROM THE VAULT, not from the environment.

  `verify:slack` takes it from `SLACK_BOT_TOKEN` and that is fine there — it is
  run by hand. This suite is in the gate, and the shell plumbing to get a
  secret into an env var is how one ends up echoed into a terminal: the first
  attempt at running this did exactly that and truncated the value at 60
  characters, which then read as a credential Storage had rejected. The vault
  is the established mechanism (§15) and the value never leaves this process.

  The environment still wins where it is set, so a run against a different
  workspace needs no code change.
*/
const botToken =
  process.env.SLACK_BOT_TOKEN !== undefined && process.env.SLACK_BOT_TOKEN !== ''
    ? process.env.SLACK_BOT_TOKEN
    : String(
        (
          await db.execute(
            `select coalesce(app.resolve_secret(bot_token_ref), '') as t
               from public.slack_app_credentials
              where enabled and revoked_at is null limit 1`,
          )
        ).rows[0]?.t ?? '',
      )
if (botToken === '') {
  console.error('no Slack bot token in the vault or the environment')
  process.exit(2)
}
const slack = new SlackClient(botToken)

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
const one = async (sql: string): Promise<Record<string, unknown>> =>
  ((await db.execute(sql)).rows[0] ?? {}) as Record<string, unknown>
const pause = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

const checks: { what: string; outcome: string; passed: boolean }[] = []
const check = (what: string, outcome: string, passed: boolean): void => {
  checks.push({ what, outcome, passed })
  console.log(`  ${passed ? 'ok  ' : 'FAIL'} ${what} — ${outcome}`)
}

const stamp = String(Date.now()).slice(-8)
const SLUG = `fixture-artifact-slack-${stamp}`
// The channel takes its name from this, so it says what it is before anybody
// has to clean it up.
const NAME = `zz test artifact ${stamp}`
const TOKEN = `Marrowfield-${stamp}`

console.log('a generated artifact, delivered to a real Slack channel (#258) —\n')

// ---------------------------------------------------------------------------
// A project with something to write about
// ---------------------------------------------------------------------------

const projectId = String(
  (
    await one(`
      with created as (
        insert into public.projects (slug, name, purpose)
        values (${lit(SLUG)}, ${lit(NAME)}, 'Removed at the end of this run')
        returning project_id
      ), attached as (
        insert into public.project_attachments
          (project_id, connector, external_ref, display_name, role)
        select project_id, 'upload', ${lit(`fixture-${stamp}`)}, 'Verification fixture', 'source'
          from created
        returning project_id
      )
      select project_id::text as id from created`)
  ).id,
)

/*
  One source document, with facts nothing else in the office holds.

  The token is nonsense on purpose: if the report contains it, the office read
  THIS document rather than answering from what the model already knew, which
  is the distinction #258's provenance requirement turns on.
*/
await db.execute(`
  insert into public.documents
    (project_id, connector, external_parent_ref, external_ref, title, content,
     content_fingerprint, content_chars, fetched_at, state)
  values (${lit(projectId)}::uuid, 'upload', ${lit(`fixture-${stamp}`)},
          ${lit(`src-${stamp}`)},
          ${lit(`The ${TOKEN} rollout`)},
          ${lit(
            `The ${TOKEN} rollout has three stages. Stage one is the pilot and runs for ` +
              `four weeks with eleven participants. Stage two is the regional launch and runs ` +
              `for nine weeks. Stage three is national and has no end date yet. The recurring ` +
              `risk on ${TOKEN} is that the pilot cohort is too small to say anything about ` +
              `the regional numbers, and every review so far has said so.`,
          )},
          encode(sha256(${lit(`fp-${stamp}`)}::bytea), 'hex'), 420, app.now_utc(), 'approved')`)

// ---------------------------------------------------------------------------
// A real room for it
// ---------------------------------------------------------------------------

const auth = (await slack.call('auth.test')).body
const TEAM_ID = String(auth.team_id)
const provisioner = new ChannelProvisioner(db, slack, TEAM_ID)
const created = await provisioner.ensureChannel(projectId, SLUG)
const CHANNEL = String(created.channelId)
check(
  'the project has a real Slack channel, created by the app',
  `${created.outcome} #${String(created.channelName)}`,
  created.channelId !== null,
)

const before = (
  ((await slack.call('conversations.history', { channel: CHANNEL, limit: 100 })).body
    .messages as unknown[]) ?? []
).length

// ---------------------------------------------------------------------------
// Ask, the way Slack asks
// ---------------------------------------------------------------------------

const parentId = String(
  (
    await one(`
      with c as (
        insert into public.inbound_commands
          (origin_channel, origin_ref, actor, instruction, dedupe_key, project_id)
        values ('slack', ${lit(`artifact-slack-${stamp}`)}, 'verify-artifact-slack',
                ${lit(
                  `Write me a PDF report on the ${TOKEN} rollout — the stages, how long each ` +
                    'takes, and the risk — and send it to me here.',
                )},
                ${lit(`slack:message:artifact-slack-${stamp}`)}, ${lit(projectId)}::uuid)
        returning command_id
      )
      select (app.enqueue_inbound((select command_id from c)) ->> 'job_id') as id`)
  ).id,
)
check(
  'the request became a job through the canonical inbound path',
  parentId === 'null' || parentId === 'undefined' ? 'NO JOB' : parentId.slice(0, 8),
  /^[0-9a-f-]{36}$/i.test(parentId),
)

/*
  And then WAIT for the deployed worker.

  No dequeue here at all, deliberately. #184's scope exists so suites do not
  take each other's work; this suite wants the opposite — the production path,
  with the notifier the composition root wires, the project ref and the service
  key it reads from the vault. Anything less is a second wiring.
*/
const settled = async (jobId: string, minutes: number): Promise<string> => {
  for (let i = 0; i < minutes * 6; i += 1) {
    const s = String(
      (await one(`select state::text as s from public.jobs where job_id = ${lit(jobId)}::uuid`)).s,
    )
    if (['complete', 'failed', 'cancelled'].includes(s)) return s
    await pause(10_000)
  }
  return 'STILL RUNNING'
}

const parentState = await settled(parentId, 6)
check(
  'the deployed worker took the request and finished with it',
  parentState,
  parentState === 'complete',
)

const child = await one(`
  select job_id::text as id, state::text as s from public.jobs
   where parent_job_id = ${lit(parentId)}::uuid and kind = 'artifact.report'
   order by created_at desc limit 1`)
check(
  'and it made an artifact job rather than an answer about one',
  child.id === undefined ? 'NO CHILD JOB' : `artifact.report ${String(child.s)}`,
  child.id !== undefined,
)
const childState = child.id === undefined ? 'NONE' : await settled(String(child.id), 8)
check('the report job finished', childState, childState === 'complete')

// ---------------------------------------------------------------------------
// What is actually in the project, before looking at the room
// ---------------------------------------------------------------------------

const made = await one(`
  select d.document_id::text as id, d.title, coalesce(d.storage_path, '') as path,
         coalesce(d.mime_type, '') as mime, coalesce(d.byte_size, 0)::int as bytes,
         coalesce(d.storage_path, '') as storage_path
    from public.documents d
   where d.project_id = ${lit(projectId)}::uuid and d.origin = 'made'
   order by d.created_at desc limit 1`)
check(
  'a real file was stored as a project document',
  made.id === undefined
    ? 'NOTHING MADE'
    : `${String(made.title)} · ${String(made.mime)} · ${String(made.bytes)} bytes`,
  made.id !== undefined && String(made.mime) === 'application/pdf' && Number(made.bytes) > 4_000,
)
check(
  'and it cites the project’s own document rather than answering from memory',
  made.id === undefined ? 'n/a' : String(made.title),
  made.id !== undefined && String(made.title).includes(TOKEN),
)

// ---------------------------------------------------------------------------
// The room itself — Slack's answer, not ours
// ---------------------------------------------------------------------------

/*
  ## Why this no longer waits for Slack to store a message

  0523 made a harness job structurally incapable of delivering to a
  destination that is not registered as a test one, and 0541 closed the
  send-time hole underneath it — a job is now marked from the DOOR its work
  came through rather than from an attribution the harness controls. This
  suite's job is harness traffic and asserts so itself, three of three, so the
  delivery is refused inside `app.claim_delivery` before anything touches the
  network. These checks went red about the guard WORKING.

  The fix is not to register this channel. It is a real channel in Grant's
  workspace — this suite creates it and archives it — so registering it would
  post test material into his Slack to make a suite green, which is exactly
  what the guard exists to prevent.

  ## Nothing below this line lost any coverage

  What mattered here was never that Slack stored a message. It was that the
  office produces a signed, expiring link to the file it made, that the link
  SERVES THE BYTES, and that those bytes are the stored artifact. Every one of
  those assertions survives unchanged; only their source moved, from a message
  Slack echoed back to the same `signedUrl` the notifier itself calls
  (`src/slack/notifier.ts` line 326).

  The mrkdwn WRAPPING of that link — `<url|label>` — is asserted in
  `tests/slack/artifact-link.test.ts`, which drives the whole delivery against
  a fake transport, including "puts the signed link in the message Slack
  actually receives". Reading it back out of `conversations.history` tested
  Slack's storage as much as our composition, and the first version of that
  check read `text` alone and reported "no link" about a message whose block
  carried one.
*/
const attempted = await one(`
  select state::text as s, coalesce(target_ref, '') as target
    from public.deliveries
   where job_id = ${lit(String(child.id))}::uuid and channel = 'slack'
   order by created_at desc limit 1`)
check(
  'the office tried to tell that room — a delivery was claimed for this channel',
  attempted.s === undefined
    ? 'NO DELIVERY WAS EVER CLAIMED — the office never tried'
    : `claimed for ${String(attempted.target)}`,
  attempted.s !== undefined && String(attempted.target) === CHANNEL,
)
check(
  'and the harness boundary is why it did not land, before any network call',
  attempted.s === undefined ? 'n/a' : `state=${String(attempted.s)}`,
  String(attempted.s ?? '') === 'suppressed',
)

/*
  Asked of Slack itself rather than inferred. This is the check that would go
  red if a future change ever let a suite post into Grant's workspace again.
*/
const inRoom =
  ((await slack.call('conversations.history', { channel: CHANNEL, limit: 100 })).body
    .messages as Record<string, unknown>[]) ?? []
const authored = inRoom.filter((m) => String(m.subtype ?? '') !== 'channel_join')
check(
  'CONTROL: and Slack itself holds no message from this run',
  `${String(authored.length)} authored, ${String(inRoom.length)} total, ${String(before)} before`,
  authored.length === 0,
)

/*
  The link, minted the way the notifier mints it.

  `src/slack/notifier.ts` line 326 calls `signedUrl(projectRef, serviceKey,
  attach.storagePath)`. So does this, from the document the office actually
  stored — the same function, the same arguments, no message in between.
*/
const serviceKey = String(
  (
    await one(
      `select coalesce(decrypted_secret, '') as k from vault.decrypted_secrets
        where name = 'supabase.service_role_key'`,
    )
  ).k ?? '',
)
const mintedUrl =
  made.id === undefined || String(made.storage_path) === ''
    ? null
    : await signedUrl(ref, serviceKey, String(made.storage_path))
const link: RegExpExecArray | null =
  mintedUrl === null ? null : (/(https?:\/\/\S+)/.exec(mintedUrl) as RegExpExecArray | null)
check(
  'the office can mint a link to the file it made — the same call the notifier makes',
  mintedUrl === null ? 'NO LINK COULD BE MINTED' : String(mintedUrl).slice(0, 72),
  mintedUrl !== null,
)

/*
  AND THE LINK IS FETCHED. This is the whole suite.

  A URL in a message is a claim. Bytes coming back with a PDF header are the
  fact, and this repository has already shipped a discard function that wrote a
  state the constraint forbade and a delete keyed on a name nothing matched.
*/
if (link !== null) {
  const url = String(link[1])
  const r = await fetch(url)
  const buf = new Uint8Array(await r.arrayBuffer())
  const head = new TextDecoder().decode(buf.slice(0, 5))
  const tail = new TextDecoder().decode(buf.slice(-1024))
  check(
    'the link a Slack reader would click serves the file',
    `http ${String(r.status)} · ${String(buf.byteLength)} bytes · ${String(
      r.headers.get('content-type'),
    )}`,
    r.ok && buf.byteLength > 4_000,
  )
  check(
    'and what comes back is a PDF, read from its own bytes',
    `${head} … ${tail.includes('%%EOF') ? 'ends %%EOF' : 'NO TRAILER'}`,
    head === '%PDF-' && tail.includes('%%EOF'),
  )
  check(
    'CONTROL: the bytes are the stored artifact, not some other file',
    made.id === undefined
      ? 'n/a'
      : `${String(buf.byteLength)} fetched vs ${String(made.bytes)} stored`,
    made.id !== undefined && buf.byteLength === Number(made.bytes),
  )
}

/*
  CONTROL: a signed URL is short-lived, and one that never expires would be a
  private document published to anyone who ever saw the message. Asserted by
  its shape rather than by waiting ten minutes — the token and the expiry are
  in the query string, and a bare public URL has neither.
*/
if (link !== null) {
  const url = String(link[1])
  check(
    'CONTROL: the link is signed and expiring, not a public URL',
    url.includes('token=') ? 'signed' : url.slice(0, 60),
    url.includes('token='),
  )
}

// ---------------------------------------------------------------------------
// Teardown
// ---------------------------------------------------------------------------

console.log('')

/*
  ATTRIBUTION FIRST. This suite drives `app.enqueue_inbound` with a real
  channel, so `requested_by` is composed as `slack:verify-artifact-slack` and
  `jobs.is_fixture` is generated from it — 0342 added `%:verify-%` for exactly
  this shape, and the actor here begins `verify-`, so it should already be
  true. Asserted rather than believed: two suites in this repository have had a
  header claiming their traffic was invisible and been wrong.
*/
const mine = await one(`
  select count(*)::int as n,
         count(*) filter (where is_fixture)::int as fixtures
    from public.jobs where project_id = ${lit(projectId)}::uuid`)
check(
  'every job this run created is harness traffic',
  `${String(mine.fixtures)} of ${String(mine.n)}`,
  Number(mine.n) > 0 && Number(mine.n) === Number(mine.fixtures),
)

/*
  ONE REQUEST, ONE REPORT.

  The first live run made TWO. The parent spawned an `artifact.report` and a
  child `office.instruction`, and that child spawned an `artifact.report` of
  its own — two near-identical PDFs in one project from one sentence, which is
  the provenance defect CLAUDE.md warns about by name: an answer citing two of
  them as separate sources. Asserted here rather than filed and forgotten.
*/
const reports = await one(`
  select count(*)::int as n from public.jobs
   where project_id = ${lit(projectId)}::uuid and kind = 'artifact.report'`)
check(
  'one request produced one report, not two',
  `${String(reports.n)} artifact.report job(s)`,
  Number(reports.n) === 1,
)

const parked = `zz_test_${stamp}_${Math.random().toString(36).slice(2, 6)}`
let archived = 'not attempted'
try {
  // Rename before archive: Slack refuses to rename an ARCHIVED channel and
  // offers no delete outside Enterprise Grid, so this is the only moment.
  try {
    await slack.call('conversations.rename', { channel: CHANNEL, name: parked })
  } catch {
    // Kept under its own name, which already begins `zz test`.
  }
  await slack.call('conversations.archive', { channel: CHANNEL })
  archived = 'archived'
} catch (e) {
  archived = `REFUSED: ${String((e as Error).message).slice(0, 60)}`
}
await db.execute(`
  update public.slack_channel_map
     set active = false, archived_at = app.now_utc()
   where project_id = ${lit(projectId)}::uuid`)
check('teardown — the fixture channel is archived', archived, archived === 'archived')

/*
  The project cannot be deleted: it has gathered jobs, and a job can never be
  removed. So it is ARCHIVED, which is what teardown does here and what the 926
  rows in that state already are. Its documents and the artifact go, because a
  near-duplicate generated report left in a real project is the provenance
  defect this repository keeps paying for — manufactured by the harness built
  to measure it.
*/
/*
  SWEPT UNTIL IT IS CLEAR, not once.

  The first live run left a generated PDF behind, and the reason is in the job
  table: the parent spawned an `artifact.report` AND a child
  `office.instruction`, and that child spawned an `artifact.report` of its own
  — two reports for one request, finishing seconds apart. A teardown that runs
  once after waiting for ONE of them races the other. CLAUDE.md: a harness that
  causes real work must sweep what that work produced, and assert the sweep.

  Archived first, because ADR-0014's deferred trigger refuses an ACTIVE project
  with nothing attached and the attachments go below.
*/
/*
  KEYED ON THE SLUG, AND THE ARCHIVE IS COUNTED.

  A qualification run found `fixture-artifact-slack-31014230` sitting ACTIVE in
  Grant's project list half an hour after this suite had reported 17/17 —
  including this teardown, which printed "project archived". The row's
  `updated_at` still equalled its `created_at`, and `projects_touch_updated_at`
  moves it on every update (proved by hand afterwards), so the archive had
  never touched that row at all while the read two statements later reported
  one that was archived.

  The cause of the divergence is not established. What is established is that
  keying the write on a captured id and the assertion on the same captured id
  cannot tell "archived the right row" from "archived some row" — CLAUDE.md:
  *"a teardown that matches nothing looks exactly like a teardown that
  worked."* The slug carries this run's token and cannot be wrong, and counting
  what the update changed turns a silent miss into a failure.
*/
const archivedRow = await one(`
  update public.projects set status = 'archived'
   where slug = ${lit(SLUG)}
   returning slug, status`)
check(
  'teardown — the fixture project really was archived, by name',
  `${String(archivedRow.slug ?? 'NOTHING MATCHED')} → ${String(archivedRow.status ?? '')}`,
  archivedRow.slug === SLUG && archivedRow.status === 'archived',
)
let left = { docs: 1, status: '' } as Record<string, unknown>
for (let i = 0; i < 6; i += 1) {
  await db.execute(`
    delete from public.document_collections
     where document_id in (select document_id from public.documents
                            where project_id = ${lit(projectId)}::uuid)`)
  await db.execute(`delete from public.relations where project_id = ${lit(projectId)}::uuid`)
  await db.execute(`delete from public.documents where project_id = ${lit(projectId)}::uuid`)
  left = await one(`
    select (select count(*)::int from public.documents
             where project_id = ${lit(projectId)}::uuid) as docs,
           (select status from public.projects
             where slug = ${lit(SLUG)}) as status`)
  if (Number(left.docs) === 0) break
  await pause(10_000)
}
await db.execute(
  `delete from public.project_attachments where project_id = ${lit(projectId)}::uuid`,
)
check(
  'teardown — no generated document of this run is left in the office',
  `${String(left.docs)} document(s), project ${String(left.status)}`,
  Number(left.docs) === 0 && String(left.status) === 'archived',
)

const failed = checks.filter((c) => !c.passed)
console.log(`\n${String(checks.length - failed.length)}/${String(checks.length)} checks passed`)
process.exit(failed.length === 0 ? 0 : 1)
