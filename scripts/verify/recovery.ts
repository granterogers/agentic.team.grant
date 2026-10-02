/**
 * The three ways back (#276, #135, #118).
 *
 *   npm run verify:recovery
 *
 * Three gateway actions that undid something and that nothing in `web/` could
 * press, so each was a one-way door Grant could walk through and not back out
 * of:
 *
 *   `project_unarchive`       — Project Settings archives; nothing un-archived
 *   `reattach`                — Sources disconnects; nothing reconnected
 *   `browser_session_forget`  — the office signs in; nothing signed it out
 *
 * The third is the one with a credential behind it, and a stored cookie jar
 * Grant cannot revoke from the product is the wrong way round for anything
 * holding a login.
 *
 * ## The recovery list, and why it is empty
 *
 * 926 projects in this database are archived and **not one holds a document, a
 * task or a contact**: archiving is what a suite teardown does when it cannot
 * delete, and a list of those is harness traffic presented to Grant as his own
 * work — on the surface built for recovering from a mistake, which is the
 * worst place for it. `app.recoverable_projects` asks whether the project HELD
 * something. Derived, not named, so it cannot go stale the way a list of
 * prefixes does; and this suite drives it from both sides, because a
 * found-nothing reader with no positive control is indistinguishable from a
 * reader that cannot report anything.
 */

import { readFileSync } from 'node:fs'
import { ManagementApiExecutor } from '../../src/db/executor.ts'
import { pressAsPerson, refusedForTheKey } from './lib/as-person.ts'

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
console.log('the three ways back (#276) —\n')

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
  These presses are a signed-in person's (#385); the office key is refused by name at the door (asserted below).
  This suite holds the key, so it presses them as the gateway does for a person: the function each action is
  routed to, as the operator. See lib/as-person.ts.
*/
const press = (action: string, args: Record<string, unknown>): Promise<unknown> =>
  pressAsPerson(db, action, args)

for (const action of ['detach', 'reattach', 'browser_session_forget']) {
  const d = await refusedForTheKey(ENDPOINT, bearer, action, {
    p_attachment_id: '00000000-0000-4000-8000-000000000000',
    p_session: '00000000-0000-4000-8000-000000000000',
  })
  check(
    `the door refuses the office key for ${action}, by name (a credential is not a person)`,
    `http ${String(d.status)}`,
    d.status === 403 && d.named,
  )
}
const ask = async (section: string): Promise<unknown> => {
  const r = await fetch(`${ENDPOINT}?section=${section}`, {
    headers: { Authorization: `Bearer ${bearer}` },
  })
  const body = (await r.json()) as { data?: unknown; error?: string }
  if (!r.ok) throw new Error(body.error ?? `http ${String(r.status)}`)
  return body.data
}

/*
  A REAL-looking slug, deliberately, and the reason is #45 in its sharpest
  form: the reader under test EXCLUDES harness-labelled projects, so a
  `fixture-` subject would be filtered and every assertion would pass for the
  wrong reason. The first drive of migration 0480 failed on exactly that.

  Paused at creation, not active, so 0419's channel provisioning cannot see it
  — six real Slack channels appeared in Grant's workspace the last time a
  suite's project was both real-looking and active, and Slack cannot delete a
  channel. Archived immediately afterwards by the function under test.
*/
const slug = `recovery-proof-${run}`
const projectId = String(
  (
    await one(`
      -- Grant's office (#45): a real-looking subject, pressed as the operator.
      insert into public.projects (office_id, slug, name, purpose, status)
      values (app.operator_office(), ${lit(slug)}, ${lit(`Recovery proof ${run}`)},
              'Removed at the end of this run', 'paused')
      returning project_id::text as id`)
  ).id,
)
// Something held, which is what makes it recoverable rather than debris.
await db.execute(`
  insert into public.tasks (office_id, project_id, title, state)
  values ((select office_id from public.projects where project_id = ${lit(projectId)}::uuid), ${lit(projectId)}::uuid, ${lit(`Something it held ${run}`)}, 'todo')`)

/*
  And a source, because ADR-0014 refuses an ACTIVE project with nothing
  attached. The first run of this suite did not attach one and found a real
  defect: `unarchive_project` raised 23514 at COMMIT out of a SECURITY DEFINER
  function, which the gateway rendered as "the action failed" — so any project
  whose sources had been disconnected before it was put away could never be
  brought back, which is the ordinary way a project stops being used. Fixed in
  0481; the refusal branch is asserted below, before the attachment is enabled.
*/
const attachmentId = String(
  (
    await one(`
      insert into public.project_attachments
        (project_id, connector, external_ref, display_name, role, enabled)
      values (${lit(projectId)}::uuid, 'notebooklm', ${lit(`recovery-${run}`)},
              ${lit(`A notebook ${run}`)}, 'source', true)
      returning attachment_id::text as id`)
  ).id,
)

// --- the recovery list, from both sides -------------------------------------

interface Recoverable {
  slug?: string
  name?: string
  held?: number
}
const list = async (): Promise<Recoverable[]> => {
  const rows = await ask('archived')
  return Array.isArray(rows) ? (rows as Recoverable[]) : []
}

const before = await list()
check(
  'CONTROL: a project that is not archived is not offered for recovery',
  before.some((x) => x.slug === slug) ? 'IT IS ON THE LIST' : 'absent',
  !before.some((x) => x.slug === slug),
)

const archived = (await press('project_archive', { p_slug: slug })) as
  | Record<string, unknown>
  | undefined
check(
  'archiving works and offers a way back in the same answer',
  archived?.ok === true
    ? `undo=${archived.undo === null ? 'NONE' : 'offered'}`
    : JSON.stringify(archived),
  archived?.ok === true && typeof archived.undo === 'string',
)

const after = await list()
const mine = after.find((x) => x.slug === slug)
check(
  'and the page can now see it as something to bring back',
  mine === undefined ? 'NOT ON THE LIST' : `${String(mine.name)} · held ${String(mine.held)}`,
  mine !== undefined && Number(mine.held) > 0,
)
/*
  The other side of the same reader, and the reason it exists. A list of every
  archived project would be 926 rows of suite debris; this asserts the
  property rather than a count, because a count goes stale the next time a
  suite runs and the property does not.
*/
const debris = await one(`
  select count(*)::int as n from public.projects
   where status = 'archived'
     and (is_fixture or app.harness_label(slug))`)
check(
  'CONTROL: and none of the archived test subjects is on it',
  `${String(debris.n)} archived harness projects exist, ${String(
    after.filter((x) => /^(fixture|verify|probe|gate|ledger-proof)[-_.:]/.test(x.slug ?? ''))
      .length,
  )} are offered`,
  Number(debris.n) > 0 &&
    after.every((x) => !/^(fixture|verify|probe|gate|ledger-proof)[-_.:]/.test(x.slug ?? '')),
)

// --- bringing it back -------------------------------------------------------

/*
  ADR-0014 first, and this is the branch the defect lived in. Disconnected,
  the project has nothing enabled attached, so bringing it back must REFUSE
  with a sentence naming the remedy rather than raising a constraint at commit.
*/
// `hq_detach` takes the attachment and nothing else — it writes its own
// reason. Passing one made PostgREST look for an overload that is not there
// and the gateway answered "the action failed": the suite was wrong, not the
// product, which is the rule this file keeps proving.
await press('detach', { p_attachment_id: attachmentId })
let refusedBare = ''
try {
  refusedBare = JSON.stringify(await press('project_unarchive', { p_slug: slug }))
} catch (e) {
  refusedBare = `RAISED: ${String((e as Error).message)}`
}
check(
  'a project with nothing attached is refused, not raised at — ADR-0014',
  refusedBare,
  refusedBare.includes('nothing attached') && refusedBare.includes('Reconnect a source first'),
)
check(
  'and the refusal left it archived rather than half-moved',
  String((await one(`select status from public.projects where slug = ${lit(slug)}`)).status),
  String((await one(`select status from public.projects where slug = ${lit(slug)}`)).status) ===
    'archived',
)
await press('reattach', { p_attachment_id: attachmentId })

const back = (await press('project_unarchive', { p_slug: slug })) as
  | Record<string, unknown>
  | undefined
check(
  'Bring it back does what it offers, through the deployed gateway',
  back?.ok === true ? String(back.name ?? '') : `REFUSED: ${JSON.stringify(back)}`,
  back?.ok === true,
)
const status = String(
  (await one(`select status from public.projects where slug = ${lit(slug)}`)).status,
)
check('and the project is active again', status, status === 'active')
check(
  'so it leaves the recovery list',
  (await list()).some((x) => x.slug === slug) ? 'STILL THERE' : 'gone',
  !(await list()).some((x) => x.slug === slug),
)
let twice = ''
try {
  twice = JSON.stringify(await press('project_unarchive', { p_slug: slug }))
} catch (e) {
  twice = String((e as Error).message)
}
check(
  'CONTROL: un-archiving one that is not archived says so rather than pretending',
  twice,
  twice.includes('no archived project called'),
)

// --- reconnecting a source --------------------------------------------------

/*
  A SECOND attachment for this section, because by now the project is active
  again — and ADR-0014's deferred trigger refuses an active project with no
  enabled attachment, so detaching the only one raises at commit rather than
  disconnecting. That is the product working; the run before this one read it
  as a failure. A project with two sources is also the ordinary case for the
  control being tested: you disconnect one of several.
*/
const spareId = String(
  (
    await one(`
      insert into public.project_attachments
        (project_id, connector, external_ref, display_name, role, enabled)
      values (${lit(projectId)}::uuid, 'drive', ${lit(`recovery-spare-${run}`)},
              ${lit(`A folder ${run}`)}, 'source', true)
      returning attachment_id::text as id`)
  ).id,
)
await press('detach', { p_attachment_id: spareId })
const blocked = await one(`
  select enabled, coalesce(disabled_reason, '') as why
    from public.project_attachments where attachment_id = ${lit(spareId)}::uuid`)
check(
  'a disconnected source is blocked and says why',
  `enabled=${String(blocked.enabled)} reason=${String(blocked.why)}`,
  blocked.enabled === false && String(blocked.why) !== '',
)
const reattached = (await press('reattach', { p_attachment_id: spareId })) as
  | Record<string, unknown>
  | undefined
check(
  'Reconnect does what it offers',
  reattached?.reattached === spareId ? 'reattached' : JSON.stringify(reattached),
  reattached?.reattached === spareId,
)
const live = await one(`
  select enabled, disabled_reason is null as cleared
    from public.project_attachments where attachment_id = ${lit(spareId)}::uuid`)
check(
  'and the row is enabled with the reason cleared, in one statement',
  `enabled=${String(live.enabled)} reason_cleared=${String(live.cleared)}`,
  live.enabled === true && live.cleared === true,
)
let noSuchAttachment = ''
try {
  noSuchAttachment = JSON.stringify(
    await press('reattach', { p_attachment_id: '00000000-0000-4000-8000-000000000000' }),
  )
} catch (e) {
  noSuchAttachment = String((e as Error).message)
}
check(
  'CONTROL: and reconnecting something that is not there says so',
  noSuchAttachment,
  noSuchAttachment.includes('no such attachment'),
)

// --- forgetting a signed-in site --------------------------------------------

/*
  A real Vault secret, because the whole point of the action is that it removes
  one and that a dangling reference is worse than a missing credential (0350
  took down every job in the building). Its value is a harmless string and it
  is never printed.
*/
const sessionId = String(
  (
    await one(`
      with s as (
        select vault.create_secret(
          ${lit(`not-a-credential-${run}`)},
          ${lit(`browser.recovery-proof.${run}`)},
          'Written and removed by verify:recovery') as ref)
      insert into public.browser_sessions
        (project_id, site, purpose, credential_ref, established_at)
      select ${lit(projectId)}::uuid, ${lit(`example-${run}.test`)},
             'Proving the forget control', s.ref, app.now_utc()
        from s
      returning session_id::text as id`)
  ).id,
)
const held = await one(`
  select credential_ref is not null as has
    from public.browser_sessions where session_id = ${lit(sessionId)}::uuid`)
check('a signed-in session holds a credential to begin with', String(held.has), held.has === true)
const forgot = (await press('browser_session_forget', { p_session: sessionId })) as
  | Record<string, unknown>
  | undefined
check(
  'Forget it does what it offers',
  forgot?.ok === true ? String(forgot.note ?? '') : JSON.stringify(forgot),
  forgot?.ok === true && String(forgot.site ?? '') === `example-${run}.test`,
)
const gone = await one(`
  select b.credential_ref is null as dropped,
         b.revoked_at is not null as revoked,
         (select count(*)::int from vault.secrets v
           where v.name = ${lit(`browser.recovery-proof.${run}`)}) as secrets
    from public.browser_sessions b where b.session_id = ${lit(sessionId)}::uuid`)
check(
  'the reference goes, the Vault row goes, and the session is marked revoked',
  `ref_dropped=${String(gone.dropped)} revoked=${String(gone.revoked)} secrets_left=${String(gone.secrets)}`,
  gone.dropped === true && gone.revoked === true && Number(gone.secrets) === 0,
)
check(
  'and the row survives, so what it already read still has its provenance',
  `${String(
    (
      await one(`select count(*)::int as n from public.browser_sessions
                 where session_id = ${lit(sessionId)}::uuid`)
    ).n,
  )} row(s)`,
  Number(
    (
      await one(`select count(*)::int as n from public.browser_sessions
                  where session_id = ${lit(sessionId)}::uuid`)
    ).n,
  ) === 1,
)
let noSuchSession = ''
try {
  noSuchSession = JSON.stringify(
    await press('browser_session_forget', { p_session: '00000000-0000-4000-8000-000000000000' }),
  )
} catch (e) {
  noSuchSession = String((e as Error).message)
}
check(
  'CONTROL: forgetting a session that does not exist says so',
  noSuchSession,
  noSuchSession.includes('there is no session by that id'),
)

// --- the controls the page has to have --------------------------------------

{
  const page = readFileSync('web/studio/app.js', 'utf8')
  const gateway = readFileSync('supabase/functions/hq-api/index.ts', 'utf8')
  /*
    Attribute AND call for each, because either alone is the defect: an
    attribute nothing looks up is a dead control, and a call nothing draws is a
    capability Grant does not have. All three are drawn conditionally — on an
    archived project existing, on a source being blocked, on a session holding
    a credential — so `verify:wired` walks past every one of them with nothing
    to see, which is the blind spot CLAUDE.md records twice.
  */
  const pair = (attr: string, action: string): boolean =>
    new RegExp(attr).test(page) && new RegExp(`'${action}'`).test(page)
  check(
    'the studio draws Bring it back and calls project_unarchive',
    pair('data-unarchive=', 'project_unarchive') ? 'present' : 'MISSING',
    pair('data-unarchive=', 'project_unarchive'),
  )
  check(
    'and Reconnect, on a source it has already drawn as blocked',
    pair('data-reattach=', 'reattach') ? 'present' : 'MISSING',
    pair('data-reattach=', 'reattach'),
  )
  check(
    'and Forget it, on a session that still holds a credential',
    pair('data-forget-site=', 'browser_session_forget') ? 'present' : 'MISSING',
    pair('data-forget-site=', 'browser_session_forget'),
  )
  check(
    'and the recovery list is a section the page reads',
    /archived: \{ fn: 'recoverable_projects' \}/.test(gateway) && /read\('archived'\)/.test(page)
      ? 'bound and read'
      : 'NOT REACHABLE',
    /archived: \{ fn: 'recoverable_projects' \}/.test(gateway) && /read\('archived'\)/.test(page),
  )
}

// --- teardown ---------------------------------------------------------------

console.log('')
await db.execute(`
  /*
    ARCHIVE FIRST. ADR-0014 is enforced by a deferred trigger, so deleting the
    attachments of a project that is still ACTIVE raises 23514 at commit — the
    first run of this teardown did exactly that, after every check had passed,
    which is the worst place to learn it. CLAUDE.md already gives the order:
    archive, then attachments, then the project.
  */
  update public.projects set status = 'archived'
   where project_id = ${lit(projectId)}::uuid;
  delete from public.browser_actions where session_id = ${lit(sessionId)}::uuid;
  delete from public.browser_sessions where project_id = ${lit(projectId)}::uuid;
  delete from public.undo_requests where action_id in (
    select action_id from public.undoable_actions
     where reversal -> 'args' ->> 'p_slug' = ${lit(slug)});
  delete from public.undoable_actions
   where reversal -> 'args' ->> 'p_slug' = ${lit(slug)};
  delete from public.tasks where project_id = ${lit(projectId)}::uuid;
  delete from public.project_attachments where project_id = ${lit(projectId)}::uuid;
  delete from public.events where project_id = ${lit(projectId)}::uuid;`)
let removed = 'not attempted'
try {
  await db.execute(`select app.project_delete(${lit(slug)})`)
  removed = 'deleted'
} catch (e) {
  removed = `REFUSED: ${String(e).slice(0, 90)}`
}
const remaining = await one(
  `select count(*)::int as n from public.projects where slug = ${lit(slug)}`,
)
check(
  'teardown — nothing of this run is left in Grant’s project list',
  `${removed}, ${String(remaining.n)} remaining`,
  Number(remaining.n) === 0,
)
const leakedSecret = await one(
  `select count(*)::int as n from vault.secrets where name like ${lit(`browser.recovery-proof.%`)}`,
)
check(
  'teardown — and no Vault row of this run survives',
  `${String(leakedSecret.n)} left`,
  Number(leakedSecret.n) === 0,
)

const failed = checks.filter((c) => !c.passed)
console.log(`\n${String(checks.length - failed.length)}/${String(checks.length)} checks passed`)
process.exit(failed.length === 0 ? 0 : 1)
