/**
 * The office remembers what it decided, across every project (#129).
 *
 *   npm run verify:decisions
 *
 * Migrations 0425 and 0426, ADR-0036.
 *
 * ## What is worth asserting
 *
 * #129's three acceptance sentences, and each is easy to satisfy vacuously:
 *
 *   * *"an agent asked something already settled cites the decision rather
 *     than re-deriving it"* — satisfied by a table existing. Driven here as a
 *     SEARCH: the same question in different words comes back with the answer.
 *   * *"a declined approach is not proposed again without saying it was
 *     declined"* — driven through `decide_proposal`, and the ruled-out option
 *     is asserted by name rather than by count.
 *   * *"superseding a decision leaves both visible"* — the one that a `live`
 *     flag would quietly break. Asserted in both directions: the search
 *     returns only the current answer, and the log returns both.
 *
 * ## And the two rules the Issue states
 *
 * **Scoped to the office, not to a project.** Proved by recording against one
 * project and finding it with no project at all, which is what the reader
 * actually does — a check that passed a project in would be testing something
 * nobody calls.
 *
 * **Append-only.** Three triggers, pushed, asserting on the MESSAGE: a refusal
 * for the wrong reason looks exactly like the rule working.
 *
 * ## Subjects, and why a teardown is impossible
 *
 * `public.decisions` refuses DELETE, so every row this writes is permanent —
 * which is why `decided_by` starting `verify:` makes `is_fixture` true by
 * generation, and why every reader excludes fixtures. A fixture decision is
 * permanent AND invisible, which is exactly what a suite against an
 * append-only ledger wants (the `job_impediments` rule, applied on purpose
 * rather than discovered).
 */

import type { SqlExecutor } from '../../src/db/executor.ts'
import { ManagementApiExecutor } from '../../src/db/executor.ts'

const token = process.env.SUPABASE_ACCESS_TOKEN
if (token === undefined || token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}
const db: SqlExecutor = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  token,
)
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

const checks: boolean[] = []
const check = (what: string, said: string, good: boolean): void => {
  checks.push(good)
  console.log(`  ${good ? 'ok  ' : 'FAIL'} ${what} — ${said}`)
}
const one = async (sql: string): Promise<Record<string, unknown>> =>
  ((await db.execute(sql)).rows as Record<string, unknown>[])[0] ?? {}
const refusedBy = async (sql: string): Promise<string> => {
  try {
    await db.execute(sql)
    return ''
  } catch (error) {
    return (error as Error).message.replace(/\s+/g, ' ')
  }
}

const run = Date.now().toString(36)
/*
  Two authors, and the difference is the point.

  `WHO` starts `verify:`, so `decisions.is_fixture` is generated true and every
  reader that feeds a prompt excludes it — which is what section 6 proves and
  what makes a row in an append-only table safe to write.

  That also means a check that a SEARCH finds something cannot use it: the
  reader would correctly return nothing and the suite would be asserting
  against its own filter. Those sections use a real author instead, and are
  safe because every one of them ends in `rollback` — #210's rule, wrap the
  call rather than the assertion.
*/
const WHO = `verify:decisions-${run}`
const REAL = 'operations-director'

console.log(`\nverify:decisions — ${run}`)

// ===========================================================================
// 1. A settled question stays settled, and the search finds it in other words
// ===========================================================================

console.log('\nasked again in different words, the office finds what it settled')

/*
  One transaction, so the fixture rows this section writes are rolled back.

  They would be harmless if they survived — `decided_by` starts `verify:` so
  `is_fixture` is generated true and every reader excludes them — but a
  suite that can put nothing at all in an append-only table is better than one
  that relies on a filter it also wrote.
*/
const subject = `hexavolt ${run}`
const searched = await one(`
  begin;
  select app.record_decision_made(
    ${lit(`Which supplier do we use for the ${subject} order?`)},
    'Northgate',
    array['Bellamy', 'splitting it between both'],
    'Bellamy could not commit to the lead time and splitting it doubles the admin.',
    ${lit(REAL)}, null, null, null);
  select
    jsonb_array_length(app.decisions_about(app.sole_person_office(), ${lit(`who supplies our ${subject}`)})) as found,
    (app.decisions_about(app.sole_person_office(), ${lit(`who supplies our ${subject}`)}) -> 0 ->> 'chose') as chose,
    (app.decisions_about(app.sole_person_office(), ${lit(`did we ever consider Bellamy for ${subject}`)}) -> 0 ->> 'chose')
      as by_ruled_out,
    jsonb_array_length(app.decisions_about(app.sole_person_office(), ${lit(`what colour is the ${run} van`)})) as unrelated;
  rollback;
`)

check(
  'the same question in different words finds the decision',
  `${String(searched.found)} found, chose ${String(searched.chose)}`,
  Number(searched.found) === 1 && searched.chose === 'Northgate',
)
check(
  'and an option it RULED OUT finds it too, which is the field the Issue is about',
  `asking about Bellamy returns ${String(searched.by_ruled_out)}`,
  searched.by_ruled_out === 'Northgate',
)
/*
  CONTROL. A reader that returned everything would pass both checks above.
*/
check(
  'CONTROL: and an unrelated question finds nothing',
  `${String(searched.unrelated)} returned`,
  Number(searched.unrelated) === 0,
)

// ===========================================================================
// 2. It crosses projects, which is the whole point
// ===========================================================================

console.log('\nit crosses projects — a boundary that is not a privacy boundary')

{
  const got = await one(`
    begin;
    insert into public.projects (name, slug, status)
    values (${lit(`Fixture decisions ${run}`)}, ${lit(`fixture-decisions-${run}`)}, 'paused');
    select app.record_decision_made(
      ${lit(`Do we run the ${run} webinars live or recorded?`)},
      'Recorded, with a live Q and A after',
      array['Fully live'],
      'Two live sessions overran and the recording is what people actually watch.',
      ${lit(REAL)},
      (select project_id from public.projects where slug = ${lit(`fixture-decisions-${run}`)}),
      null, null);
    -- No project argument at all, which is what the reader takes and what the
    -- handler calls. A check that passed one in would be testing a signature
    -- nobody uses.
    select
      jsonb_array_length(app.decisions_about(app.sole_person_office(), ${lit(`should the ${run} webinars be live`)})) as found,
      (app.decisions_about(app.sole_person_office(), ${lit(`should the ${run} webinars be live`)}) -> 0 ->> 'project') as named;
    rollback;
  `)
  check(
    'a decision recorded on one project is found with no project at all',
    `${String(got.found)} found, recorded on "${String(got.named)}"`,
    Number(got.found) === 1 && String(got.named).startsWith('Fixture decisions'),
  )
}

// ===========================================================================
// 3. Superseding leaves both visible
// ===========================================================================

console.log('\nchanging its mind, without losing what it thought before')

{
  const got = await one(`
    begin;
    select app.record_decision_made(
      ${lit(`Where do the ${run} module pages live?`)}, 'Google Drive', array['Notion'],
      'Everyone already had Drive open.', ${lit(REAL)}, null, null, null);
    select app.record_decision_made(
      ${lit(`Where do the ${run} module pages live?`)}, 'Notion', array['Google Drive'],
      'The team needs to edit in place.', ${lit(REAL)}, null, null,
      (select decision_id from public.decisions
        where question = ${lit(`Where do the ${run} module pages live?`)}
          and chose = 'Google Drive'));
    select
      (select count(*) from public.decisions
        where question = ${lit(`Where do the ${run} module pages live?`)}) as total,
      (select count(*) from public.decisions_live
        where question = ${lit(`Where do the ${run} module pages live?`)}) as live,
      (app.decisions_about(app.sole_person_office(), ${lit(`where do the ${run} module pages go`)}) -> 0 ->> 'chose') as answer;
    rollback;
  `)
  check(
    'both decisions are still there',
    `${String(got.total)} in the log`,
    Number(got.total) === 2,
  )
  check('only the later one is live', `${String(got.live)} live`, Number(got.live) === 1)
  check(
    'and a search returns the CURRENT answer, not the one it replaced',
    `it says ${String(got.answer)}`,
    got.answer === 'Notion',
  )

  // Two rows claiming to replace the same older one is a history that cannot
  // be read in order, so the index refuses it.
  const said = await refusedBy(`
    begin;
    select app.record_decision_made('a', 'b', array[]::text[], 'c', ${lit(WHO)});
    select app.record_decision_made('d', 'e', array[]::text[], 'f', ${lit(WHO)}, null, null,
      (select decision_id from public.decisions where question = 'a' and decided_by = ${lit(WHO)}));
    select app.record_decision_made('g', 'h', array[]::text[], 'i', ${lit(WHO)}, null, null,
      (select decision_id from public.decisions where question = 'a' and decided_by = ${lit(WHO)}));
    rollback;
  `)
  check(
    'and two decisions cannot both claim to replace the same one',
    said === '' ? 'IT WAS ALLOWED' : said.slice(0, 110),
    said.includes('decisions_one_successor'),
  )
}

// ===========================================================================
// 4. Append-only, at all three doors
// ===========================================================================

console.log('\nthe log cannot be rewritten')

for (const [what, sql] of [
  ['UPDATE', `update public.decisions set chose = 'something else' where decided_by = ${lit(WHO)}`],
  ['DELETE', `delete from public.decisions where decided_by = ${lit(WHO)}`],
] as const) {
  const said = await refusedBy(`
    begin;
    select app.record_decision_made('a', 'b', array[]::text[], 'c', ${lit(WHO)});
    ${sql};
    rollback;
  `)
  check(
    `${what} is refused, and says why`,
    said === '' ? 'IT WAS ALLOWED' : said.slice(0, 100),
    said.includes('append-only') && said.includes(what),
  )
}

// ===========================================================================
// 5. The two writers that fill it
// ===========================================================================

console.log('\nanswering a question and settling a proposal both write one down')

{
  const got = await one(`
    begin;
    insert into public.jobs (correlation_id, project_id, idempotency_key, kind, requested_by)
    values (extensions.gen_random_uuid(), null, ${lit(`verify-decisions-${run}`)},
            'research', ${lit(`teamhq:verify-decisions-${run}`)});
    insert into public.blockers
      (project_id, job_id, requested_action, why_needed, consequences_of_delay,
       approval_options, originating_agent, work_can_continue)
    values (null, (select job_id from public.jobs
                    where idempotency_key = ${lit(`verify-decisions-${run}`)}),
            ${lit(`Where do the ${run} pages live?`)},
            'Two places could hold them and only you can say.',
            'Nothing moves until you answer.',
            array['Notion', 'Google Drive', 'Neither, leave it'],
            'chief-of-staff', true);
    select app.hq_answer_blocker(
      (select blocker_id from public.blockers
        where requested_action = ${lit(`Where do the ${run} pages live?`)}), 'Notion', 'grant');
    select chose, array_to_string(ruled_out, ' | ') as ruled_out, decided_by
      from public.decisions where question = ${lit(`Where do the ${run} pages live?`)};
    rollback;
  `)
  check(
    'answering a question writes the decision, and the options he did NOT pick',
    `${String(got.chose)} — ruled out ${String(got.ruled_out)}`,
    got.chose === 'Notion' &&
      String(got.ruled_out).includes('Google Drive') &&
      String(got.ruled_out).includes('Neither, leave it') &&
      got.decided_by === 'grant',
  )
}

{
  const got = await one(`
    begin;
    -- kind and cost_note are NOT NULL: read from information_schema rather
    -- than guessed, after the first run was refused on the one that was missed.
    -- No backticks in this comment: it lives inside a template literal.
    insert into public.proposals
      (staff_slug, kind, title, remedy, argument, cost_note, needed, state)
    values ('growth-director', 'missing_tool', ${lit(`Reading a page on the open web (${run})`)},
            'web.search', 'Nine research jobs ended with a citation I could not read.',
            'Free tier, 100 lookups a day', ${lit(`fixture-need-${run}`)}, 'open');
    select app.decide_proposal(
      (select proposal_id from public.proposals where needed = ${lit(`fixture-need-${run}`)}),
      'declined', 'Not until there is a free tier we can live inside.', ${lit(REAL)});
    select chose, array_to_string(ruled_out, ' | ') as ruled_out, because
      from public.decisions
     where question like ${lit(`%Reading a page on the open web (${run})%`)};
    rollback;
  `)
  check(
    'declining a proposal records what was declined, by name',
    `${String(got.chose)} — ruled out ${String(got.ruled_out)}`,
    String(got.chose).startsWith('No') && String(got.ruled_out).includes('web.search'),
  )
  check(
    'and keeps the reason he gave rather than a summary of it',
    String(got.because).slice(0, 60),
    String(got.because).includes('free tier we can live inside'),
  )
}

/*
  CONTROL. Reopening a proposal is Grant changing his mind about whether to
  decide, not a decision — and a row for it would put "open" in a log whose
  whole purpose is to say what was concluded.
*/
{
  const got = await one(`
    begin;
    -- Inserted OPEN and then settled through the RPC, because
    -- proposals_decided_iff_settled refuses a declined row with no decider —
    -- and because settling it is what makes the reopen a REOPEN.
    insert into public.proposals
      (staff_slug, kind, title, remedy, argument, cost_note, needed, state)
    values ('growth-director', 'missing_tool', ${lit(`Reopened (${run})`)}, 'web.search',
            'x', 'none', ${lit(`fixture-reopen-${run}`)}, 'open');
    select app.decide_proposal(
      (select proposal_id from public.proposals where needed = ${lit(`fixture-reopen-${run}`)}),
      'declined', 'Not now.', ${lit(REAL)});
    select app.decide_proposal(
      (select proposal_id from public.proposals where needed = ${lit(`fixture-reopen-${run}`)}),
      'open', null, ${lit(REAL)});
    -- ONE, from the decline. The reopen adds nothing.
    select count(*)::int as n from public.decisions
     where question like ${lit(`%Reopened (${run})%`)};
    rollback;
  `)
  check(
    'CONTROL: reopening a settled proposal adds nothing — it is not a conclusion',
    `${String(got.n)} row(s) after decline then reopen`,
    Number(got.n) === 1,
  )
}

// ===========================================================================
// 6. Fixtures never reach a prompt
// ===========================================================================

console.log('\nand harness traffic never reaches a prompt')

{
  const got = await one(`
    begin;
    select app.record_decision_made(
      ${lit(`Should the ${run} fixture reach a prompt?`)}, 'No', array['Yes'],
      'Because it is a fixture.', ${lit(WHO)}, null, null, null);
    select
      (select count(*) from public.decisions
        where decided_by = ${lit(WHO)} and is_fixture) as flagged,
      jsonb_array_length(app.decisions_about(app.sole_person_office(),
        ${lit(`should the ${run} fixture reach a prompt`)})) as reachable,
      jsonb_array_length(app.decisions_so_far(200)) as on_the_page_before;
    rollback;
  `)
  check(
    'a decision a suite wrote is a fixture by generation',
    `${String(got.flagged)} flagged`,
    Number(got.flagged) >= 1,
  )
  check(
    'and the reader the prompt uses cannot see it',
    `${String(got.reachable)} reachable`,
    Number(got.reachable) === 0,
  )
}

const passed = checks.filter(Boolean).length
console.log(`\n${String(passed)}/${String(checks.length)} checks passed`)
if (passed !== checks.length) process.exit(1)
