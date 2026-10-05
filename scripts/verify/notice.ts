/**
 * Does the office notice anything, and does it shut up when told?
 *
 *   npm run verify:notice
 *
 * Issue #52. Grant: *"not just necessarily wait for me to tell them, but to be
 * actively trying to be more useful to me, to make suggestions, not just
 * necessarily respond to specific questions."*
 *
 * ## Why every branch is manufactured
 *
 * Run against the office as it stands, `app.notice()` returns nothing — no
 * overdue task, no quiet project, no idle source. That is the correct answer
 * and it is **indistinguishable from a query that is broken**. A noticing pass
 * is exactly the kind of feature that can be silently dead for a month, so each
 * branch here has its condition created, asserted, and cleared.
 *
 * ## And the ranking, because noise is the failure mode
 *
 * A page of plausible observations costs Grant attention daily and teaches him
 * to skim — and a skimmed suggestion is worse than none, because the morning
 * one matters he will skim that too. So the order is asserted, not just the
 * presence.
 */

import type { SqlExecutor } from '../../src/db/executor.ts'
import { ManagementApiExecutor } from '../../src/db/executor.ts'

const token = process.env.SUPABASE_ACCESS_TOKEN
if (token === undefined || token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is not set')
  process.exit(2)
}
const db: SqlExecutor = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  token,
)

let pass = 0
let fail = 0
const ok = (what: string, good: boolean, note = '') => {
  if (good) {
    pass++
    console.log(`  ok   ${what}`)
  } else {
    fail++
    console.error(`  FAIL ${what}${note === '' ? '' : ` — ${note}`}`)
  }
}
const all = async (sql: string): Promise<Record<string, unknown>[]> =>
  (await db.execute(sql)).rows as Record<string, unknown>[]
const one = async (sql: string): Promise<Record<string, unknown>> =>
  ((await db.execute(sql)).rows as Record<string, unknown>[])[0] ?? {}
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
const run = Date.now().toString(36)

/*
  A REAL dashboard project, not a fixture.

  `app.notice` excludes fixtures — correctly, and for the fifth time today that
  rule is the thing a suite has to work around. A subject named `verify-%` is
  invisible to the function under test, so every branch would return nothing
  and every check would pass for the wrong reason.
*/
const proj = await one(`
  insert into public.projects (slug, name, purpose, status)
  values (${lit(`noticeproof-${run}`)}, ${lit(`Notice proof ${run}`)}, 'Thrown away', 'paused')
  returning project_id
`)
const pid = String(proj.project_id)
const noticed = async (kind: string) =>
  await all(
    `select body, weight from app.notice(app.test_office(), 40)
      where kind = ${lit(kind)} and project_id = ${lit(pid)}::uuid`,
  )

console.log('notice —')

// The project has to be live and attached before any of this applies.
await db.execute(`
  insert into public.project_attachments
    (project_id, connector, external_ref, display_name, role, enabled)
  values (${lit(pid)}::uuid, 'upload', ${lit(`noticeproof-${run}`)}, 'Uploads', 'source', true)
`)
await db.execute(
  `update public.projects set status = 'active' where project_id = ${lit(pid)}::uuid`,
)

// --- a deadline nobody is on ------------------------------------------------

{
  ok('a healthy project produces nothing to say', (await noticed('deadline_unowned')).length === 0)

  await db.execute(`
    insert into public.tasks (project_id, title, state, due_on, added_by)
    values (${lit(pid)}::uuid, ${lit(`Send the invoices ${run}`)}, 'todo',
            (app.now_utc() at time zone app.grant_timezone())::date + 3, 'grant')
  `)
  const got = await noticed('deadline_unowned')
  ok('a deadline three days out with nobody on it is noticed', got.length === 1)
  ok(
    'and it names the task and the date rather than counting them',
    String(got[0]?.body ?? '').includes('Send the invoices') &&
      /due \w+ \d+/.test(String(got[0]?.body ?? '')),
    String(got[0]?.body ?? ''),
  )
  // The one kind where not saying it costs a missed date, so it outranks
  // everything else.
  ok('and it is the loudest kind there is', Number(got[0]?.weight) >= 80)

  await db.execute(`
    update public.tasks
       set assignee_staff = (select staff_id from public.staff where slug = 'operations-director')
     where project_id = ${lit(pid)}::uuid
  `)
  ok(
    'giving it to someone silences it — that is the whole remedy',
    (await noticed('deadline_unowned')).length === 0,
  )
}

// --- a project that has gone quiet ------------------------------------------

{
  /*
    Untouched for a fortnight, with work still open on it — and the update that
    says so cannot be an ordinary update.

    `projects_touch_updated_at` (migration 0002) is a BEFORE UPDATE trigger that
    sets `updated_at` to now on every write, so `set updated_at = ... - 20 days`
    is silently overwritten by the trigger and the row stays fresh. Three checks
    failed against a branch that was correct. Real quiet is the absence of any
    update, which a test cannot produce by updating, so the trigger comes off
    for exactly this one statement and goes straight back on — in one batch, so
    a failure between them rolls back rather than leaving the office unable to
    date its own projects.
  */
  await db.execute(`
    alter table public.projects disable trigger projects_touch_updated_at;
    update public.projects set updated_at = app.now_utc() - interval '20 days'
     where project_id = ${lit(pid)}::uuid;
    alter table public.projects enable trigger projects_touch_updated_at;
  `)
  const got = await noticed('project_quiet')
  ok('a project with open work and no movement in 20 days is noticed', got.length === 1)
  ok(
    'and says how long and how much, so he can judge without opening it',
    /20 days/.test(String(got[0]?.body ?? '')) && /open task/.test(String(got[0]?.body ?? '')),
    String(got[0]?.body ?? ''),
  )
  // Quieter than a deadline: nothing is being missed, it just needs a decision.
  ok('and is quieter than a deadline', Number(got[0]?.weight) < 80)

  await db.execute(`
    update public.tasks set state = 'done', done_at = app.now_utc()
     where project_id = ${lit(pid)}::uuid
  `)
  ok(
    'a quiet project with nothing open is not worth mentioning',
    (await noticed('project_quiet')).length === 0,
  )
}

// --- a source that has given nothing ----------------------------------------

{
  await db.execute(`
    update public.project_attachments
       set created_at = app.now_utc() - interval '30 days'
     where project_id = ${lit(pid)}::uuid
  `)
  const got = await noticed('source_unused')
  ok('a source attached a month ago that produced nothing is noticed', got.length === 1)
  ok(
    'and names it and when it was attached',
    String(got[0]?.body ?? '').includes('Uploads'),
    String(got[0]?.body ?? ''),
  )

  /*
    One document is enough to stop it. The observation is "this gave nothing",
    not "this gave little" — the second is a judgement and this pass only
    counts.
  */
  await db.execute(`
    insert into public.documents
      (project_id, title, doc_type, connector, origin, state, produced_by,
       content, content_fingerprint, fetched_at, added_by)
    values (${lit(pid)}::uuid, ${lit(`A note ${run}`)}, 'note', 'upload', 'source',
            'draft', 'grant', 'x', repeat('a', 64), app.now_utc(), 'grant')
  `)
  ok(
    'and one document from it is enough to stop saying so',
    (await noticed('source_unused')).length === 0,
  )
}

// --- the ranking ------------------------------------------------------------

{
  // Both conditions at once: the loudest must come first, because the caller
  // takes the top few and a wrong order is a missed deadline.
  await db.execute(`
    insert into public.tasks (project_id, title, state, due_on, added_by)
    values (${lit(pid)}::uuid, ${lit(`Urgent ${run}`)}, 'todo',
            (app.now_utc() at time zone app.grant_timezone())::date + 1, 'grant')
  `)
  await db.execute(`
    update public.project_attachments set created_at = app.now_utc() - interval '30 days'
     where project_id = ${lit(pid)}::uuid
  `)
  await db.execute(`
    delete from public.documents where project_id = ${lit(pid)}::uuid
  `)
  const got = await all(
    `select kind, weight from app.notice(app.test_office(), 40) where project_id = ${lit(pid)}::uuid`,
  )
  ok('two things at once are both noticed', got.length >= 2, `${got.length} noticed`)
  ok(
    'and the deadline comes first',
    String(got[0]?.kind ?? '') === 'deadline_unowned',
    got.map((r) => String(r.kind)).join(' → '),
  )
  ok(
    'and the caller can take only the loudest',
    (await all(`select kind from app.notice(app.test_office(), 1)`)).length === 1,
  )
}

// --- the table dismissal attaches to ----------------------------------------

{
  const made = await one(`
    insert into public.suggestions (project_id, kind, subject_ref, body, weight)
    values (${lit(pid)}::uuid, 'project_quiet', '',
            ${lit(`Notice proof ${run} has gone quiet.`)}, 55)
    returning suggestion_id
  `)
  ok('a suggestion can be recorded', String(made.suggestion_id ?? '') !== '')

  /*
    The identity is (kind, project, subject) and NOT the wording.

    Dismissing "gone quiet for 20 days" must silence "gone quiet for 27 days"
    next week — the sentence will have a different number in it and it is the
    same observation.
  */
  let clashed = false
  try {
    await db.execute(`
      insert into public.suggestions (project_id, kind, subject_ref, body, weight)
      values (${lit(pid)}::uuid, 'project_quiet', '',
              ${lit(`Notice proof ${run} has gone quiet for 27 days.`)}, 55)
    `)
  } catch {
    clashed = true
  }
  ok('and the same observation said differently does not become a second one', clashed)

  await db.execute(`
    update public.suggestions
       set state = 'dismissed', settled_at = app.now_utc(), dismissals = dismissals + 1
     where suggestion_id = ${lit(String(made.suggestion_id))}::uuid
  `)
  const open = await all(
    `select 1 from public.suggestions
      where project_id = ${lit(pid)}::uuid and state = 'open'`,
  )
  ok('dismissing it leaves nothing open', open.length === 0)

  const kept = await one(`
    select dismissals from public.suggestions
     where suggestion_id = ${lit(String(made.suggestion_id))}::uuid
  `)
  // Counted, not just cleared: repeated dismissal should make the office
  // harder to convince, or the same thing returns weekly with a new date.
  ok('and the dismissal is counted, so the bar can rise', Number(kept.dismissals) === 1)
}

// --- and a dismissal that actually silences the pass -------------------------
//
// The bug 0210 shipped and twenty-one checks did not catch: `suggestions` and
// `app.notice()` never spoke to each other, so dismissing an observation
// silenced nothing and the same sentence would have arrived every morning
// afterwards. It was invisible here because the table and the function were
// tested separately and the bug was only in the gap.

{
  // There is still an unowned deadline on this project from the ranking block.
  ok('the observation is live to begin with', (await noticed('deadline_unowned')).length === 1)

  const before = new Set(
    (await all('select suggestion_id::text as id from public.suggestions')).map((r) =>
      String(r.id),
    ),
  )
  await db.execute('select app.raise_suggestions(app.test_office(), 40)')
  const mine = await all(`
    select suggestion_id::text as id, kind from public.suggestions
     where project_id = ${lit(pid)}::uuid and kind = 'deadline_unowned' and state = 'open'
  `)
  ok('raising writes it down, so there is something to dismiss', mine.length === 1)

  /*
    An open suggestion is not raised again either.

    Not a nicety. Without it the office would write a second row the moment the
    unique index was relaxed, and — worse — the briefing would repeat an
    observation already sitting unanswered on the dashboard as though it were
    new this morning.
  */
  ok(
    'and an observation already on the dashboard is not raised twice',
    (await noticed('deadline_unowned')).length === 0,
  )

  const sid = lit(String(mine[0]?.id ?? ''))
  await db.execute(`
    update public.suggestions
       set state = 'dismissed', settled_at = app.now_utc(), dismissals = 1
     where suggestion_id = ${sid}::uuid
  `)
  ok('dismissing it silences the pass', (await noticed('deadline_unowned')).length === 0)

  // A fortnight later it may be said again — the condition is still true and
  // "not now" has expired.
  await db.execute(`
    update public.suggestions set settled_at = app.now_utc() - interval '15 days'
     where suggestion_id = ${sid}::uuid
  `)
  ok('a fortnight later it is worth saying again', (await noticed('deadline_unowned')).length === 1)

  /*
    And the bar rises. Two dismissals buy a month, not another fortnight —
    otherwise the same observation returns every two weeks with a new date on
    it, which is the behaviour the whole design was meant to prevent.
  */
  await db.execute(`
    update public.suggestions set dismissals = 2
     where suggestion_id = ${sid}::uuid
  `)
  ok(
    'but a second dismissal buys longer than the first',
    (await noticed('deadline_unowned')).length === 0,
  )

  // Anything this block raised beyond our own subject was a real observation
  // about Grant's real office, and a verification run must not leave those
  // behind as though the office had noticed them itself.
  const strays = (await all('select suggestion_id::text as id from public.suggestions'))
    .map((r) => String(r.id))
    .filter((id) => !before.has(id))
    .filter((id) => !mine.some((m) => String(m.id) === id))
  for (const id of strays) {
    await db.execute(`delete from public.suggestions where suggestion_id = ${lit(id)}::uuid`)
  }
  ok('and the run raises nothing about the real office', true, `${String(strays.length)} cleared`)
}

// --- tidy up ----------------------------------------------------------------

await db.execute(
  `update public.projects set status = 'archived' where project_id = ${lit(pid)}::uuid`,
)
await db.execute(`delete from public.suggestions where project_id = ${lit(pid)}::uuid`)
await db.execute(`delete from public.documents where project_id = ${lit(pid)}::uuid`)
await db.execute(`delete from public.tasks where project_id = ${lit(pid)}::uuid`)
await db.execute(`delete from public.project_attachments where project_id = ${lit(pid)}::uuid`)
await db.execute(`delete from public.projects where project_id = ${lit(pid)}::uuid`)
{
  const left = await all(`select 1 from public.projects where slug = ${lit(`noticeproof-${run}`)}`)
  ok('the suite leaves nothing behind', left.length === 0)

  /*
    Including the trigger it borrowed. A suite that left
    `projects_touch_updated_at` disabled would stop every dashboard project in
    the office from dating itself, and nothing else here would notice.
  */
  const trig = await one(`
    select tgenabled::text as state from pg_trigger
     where tgrelid = 'public.projects'::regclass
       and tgname = 'projects_touch_updated_at'
  `)
  ok('and puts the touch trigger back', String(trig.state ?? '') === 'O', String(trig.state))
}

/*
  A suite's failure is not the office failing (0491).

  `public.failure_signatures` feeds `app.recurring_failures`, which the
  noticing pass turns into a suggestion weighted 75 and
  `app.morning_briefing_facts` puts in the message Grant reads every day. Every
  row in it was harness traffic — 138 of them saying `office.instruction` had
  failed, which is how his own messages are answered and which had zero real
  failures in the same period.

  Asserted as a PROPERTY, never a count: "nothing a reader shows Grant belongs
  to a harness job" survives the next suite run; a number does not, which is
  precisely how this class keeps coming back.
*/
{
  /*
    Asked of the TABLE, not of `app.recurring_failures`.

    The first version asked the reader — which 0491 had just taught to exclude
    harness signatures — so injecting one left the check GREEN. Inert by
    construction, and only the sabotage found it. The writer's property is
    that nothing harness ever gets INTO the table; the reader's property is
    tested separately below, by putting one in on purpose.
  */
  const polluted = await all(`
    select f.job_kind from public.failure_signatures f
     where f.last_job_id is not null and app.harness_job(f.last_job_id)
  `)
  ok(
    'no failure signature in the table belongs to a harness job',
    polluted.length === 0,
    polluted.map((r) => String(r.job_kind)).join(', '),
  )

  /*
    And the control, because an empty table would satisfy the line above for
    the wrong reason — the found-nothing shape this repository has been caught
    building three times. A real failure must still be counted and must still
    recur, or 0491 simply switched #132 off.
  */
  /*
    A REAL failure means a real KIND as well as a real job (0568).

    This used to invent a kind of its own and attach it to a real job, which
    made it invisible to 0491's guard on purpose -- and two crashed runs then
    sat in Grant's morning briefing for five days as the ONLY two rows in it,
    named to him as things that had failed three times. The office writes a
    signature from exactly one place, failure_seen (job.kind, ...), so a
    genuine one always names a kind some job has had; the reader enforces that
    now, and this control has to use a real kind or it is asserting against
    the fix.

    Three separate statements, because failure_seen upserts and three calls
    inside ONE statement all read the pre-statement snapshot -- they insert
    three rows at seen = 1 instead of one at seen = 3, and the reader then
    correctly returns nothing. The first draft did that and reported the
    product as broken. Same shape as a data-modifying CTE that cannot see its
    own rows.

    Not wrapped in a transaction, because this executor returns the FIRST
    statement's result and the assertion has to read the last. The rows are
    swept instead, by a sweep armed before they are written -- which is the
    thing whose absence caused this defect.
  */
  const real = await one(`
    select job_id::text as id, kind from public.jobs
     where not app.harness_job(job_id) order by created_at desc limit 1
  `)
  const realKind = String(real.kind)
  /*
    NO SPACE IN THE SUBJECT. `failure_seen` blanks any subject that does not
    match its own pattern -- lower-case, digits, underscore, dot, colon, hyphen
    -- so "noticeproof <run>" is stored as the empty string and a reader
    looking for it finds nothing. The first draft did that and reported a
    working product as broken; a hand-drive of the writer settled it, and the
    row it left had to be swept out of Grant's briefing.
  */
  const subject = `noticeproof-${run}`
  const neverRan = `noticeproof.${run.replace(/[^a-z0-9]/g, '')}`
  const sweepSignatures = async (): Promise<void> => {
    await db
      .execute(`
        delete from public.failure_signatures
         where subject = ${lit(subject)} or job_kind = ${lit(neverRan)}`)
      .catch(() => undefined)
  }
  const onCrash = (error: unknown): void => {
    console.error(`\nthe suite failed -- sweeping its signatures anyway\n${String(error)}`)
    void sweepSignatures().finally(() => {
      process.exitCode = 1
    })
  }
  process.on('unhandledRejection', onCrash)
  process.on('uncaughtException', onCrash)

  /*
    WRITTEN AND READ INSIDE ONE TRANSACTION THAT NEVER COMMITS (#357).

    This control has to write a signature the reader will SURFACE -- that is
    the whole point of it, and #45 is why it carries a real job id rather than
    a fixture one. Which means that for as long as those rows exist, they are
    indistinguishable from one of Grant's own recurring failures.

    The sweep below is not enough, and the briefing proved it: at 04:00 on 23
    September his morning briefing said "noticeproof.mu6wxsku and
    noticeproof.mu6ww50g have each failed three times since 18 Sep". A sweep
    that runs at the END of a suite cannot protect a surface that reads
    CONTINUOUSLY -- it only narrows the window, and a duty firing inside that
    window is exactly what happened. The suite's own comment above already
    records a row having been swept out of his briefing once.

    A transaction closes the window to zero: the rows exist only for the
    statement that asserts on them, and `app.recurring_failures` sees its own
    transaction's writes, so the control is just as strong. The block ends by
    raising, which is what discards them -- there is no commit to forget.
  */
  const surfacedOutcome = await db
    .execute(`
      do $notice$
      begin
        begin
          perform app.failure_seen(app.job_office(${lit(String(real.id))}::uuid), ${lit(realKind)}, 'noticeproof',
                                   ${lit(subject)}, ${lit(String(real.id))}::uuid);
          perform app.failure_seen(app.job_office(${lit(String(real.id))}::uuid), ${lit(realKind)}, 'noticeproof',
                                   ${lit(subject)}, ${lit(String(real.id))}::uuid);
          perform app.failure_seen(app.job_office(${lit(String(real.id))}::uuid), ${lit(realKind)}, 'noticeproof',
                                   ${lit(subject)}, ${lit(String(real.id))}::uuid);

          if (select count(*) from app.recurring_failures(app.test_office(), 3, 14) f
               where f.job_kind = ${lit(realKind)}
                 and f.subject = ${lit(subject)}) = 1 then
            raise exception 'SURFACED';
          end if;
          raise exception 'DID_NOT_SURFACE';
        end;
      end
      $notice$;`)
    .then(() => 'no exception, which this block never produces')
    .catch((e: unknown) => String((e as Error).message))

  ok(
    'and a REAL repeated failure still surfaces',
    surfacedOutcome.includes('SURFACED') && !surfacedOutcome.includes('DID_NOT_SURFACE'),
    surfacedOutcome.slice(0, 90),
  )

  // And it left nothing behind for a duty to find, which is the half the
  // briefing caught. Asserted rather than assumed: a teardown that matches
  // nothing looks exactly like one that worked.
  ok(
    'and the control left no signature a duty could report as his',
    (await all(`select 1 from public.failure_signatures where subject = ${lit(subject)}`))
      .length === 0,
  )

  /*
    And the other half of 0568, which is what actually reached him: a
    signature naming a kind the office has NEVER run must not.
  */
  for (let i = 0; i < 3; i++) {
    await db.execute(`
      select app.failure_seen(app.job_office(${lit(String(real.id))}::uuid), ${lit(neverRan)}, 'drive', 'sub',
                              ${lit(String(real.id))}::uuid)`)
  }
  const hidden = await all(`
    select 1 from app.recurring_failures(app.test_office(), 3, 14) f where f.job_kind = ${lit(neverRan)}`)
  ok('and a kind the office has never run does not', hidden.length === 0)
  await sweepSignatures()
  const bothGone = await all(`
    select 1 from public.failure_signatures
     where subject = ${lit(subject)} or job_kind = ${lit(neverRan)}`)
  ok('and neither control is left in the table', bothGone.length === 0)

  /*
    And the reader's own half: a harness signature put in ON PURPOSE must not
    come back out. Belt and braces with the writer, because a path that writes
    around the front door would otherwise reach Grant.

    failure_signatures_kind_format allows only lower-case dotted segments --
    no hyphen -- so this is noticeproofharness, not noticeproof-harness.
  */
  const fixKind = `noticeproofharness.${run.replace(/[^a-z0-9]/g, '')}`
  await db.execute(`
    insert into public.failure_signatures
      (job_kind, error_class, subject, seen, first_seen, last_seen, last_job_id)
    select ${lit(fixKind)}, 'unknown', '', 9, app.now_utc(), app.now_utc(), job_id
      from public.jobs where app.harness_job(job_id) order by created_at desc limit 1
  `)
  const planted = await all(
    `select 1 from public.failure_signatures where job_kind = ${lit(fixKind)}`,
  )
  ok('the harness signature really was planted', planted.length === 1)
  const leaked = await all(
    `select 1 from app.recurring_failures(app.test_office(), 3, 14) f where f.job_kind = ${lit(fixKind)}`,
  )
  ok('and the reader refuses to hand it to Grant', leaked.length === 0)

  await db.execute(`delete from public.failure_signatures where job_kind = ${lit(fixKind)}`)
  const plantedLeft = await all(
    `select 1 from public.failure_signatures where job_kind = ${lit(fixKind)}`,
  )
  ok('and the controls leave nothing behind', plantedLeft.length === 0)
}

console.log(`\n${pass}/${pass + fail} checks passed`)
process.exit(fail === 0 ? 0 : 1)
