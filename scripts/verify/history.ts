/**
 * One conversation, both sides, and nothing from anybody else's project.
 *
 * Named `history` rather than `conversation` because `verify:conversation`
 * already exists and proves something different: #63's recall and #60's
 * say-back — whether Claire understands the second message in terms of the
 * first. This proves the STORE those messages live in (#192). Two suites,
 * one word, and the collision is the reason the name changed.
 *
 *   npm run verify:history
 *
 * Issue #192, migrations 0334 and 0335.
 *
 * ## What this drives
 *
 * The real chain, including the layer the studio uses:
 *
 *     app.conversation_history -> public.conversation_history
 *       -> hq-api ?section=conversation&id=<project>
 *
 * The HTTP leg is not optional and does not skip. `verify:search` reported
 * "NOT CHECKED" without a token, and the defect it existed to catch lived
 * exactly there — an RPC that worked perfectly with no public wrapper, so
 * nothing with a browser could call it. The token is in the vault.
 *
 * ## Real subjects, not fixtures, and why
 *
 * CLAUDE.md's deciding question is whether the thing under test FILTERS
 * fixtures. `conversation_history` does — it excludes fixture jobs — so a
 * fixture subject would be invisible to the very reader being tested, and the
 * suite would pass by seeing nothing. #45's rule applies: real projects, torn
 * down through `app.project_delete`, and the teardown asserts it left nothing.
 *
 * ## Isolation is checked adversarially
 *
 * Two projects, both with messages, and the check is that neither can see the
 * other's. A single-project isolation test passes for the wrong reason — there
 * is nothing for it to leak.
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
/*
  Both subjects are named so their slugs fall under ONE prefix. `verify:identity`
  added a subject called "Identity proof rival <run>", whose slug landed outside
  the teardown's prefix, and three of them reached Grant's project switcher.
*/
/*
  FIXTURE-named projects, and the reason is #45's deciding question: does the
  thing under test filter fixtures?

  `conversation_history` filters `jobs.is_fixture` and never touches
  `projects.is_fixture` — so a fixture PROJECT is perfectly visible to the
  reader, and the suite loses nothing by using one.

  The first draft used real names on the strength of "the reader filters
  fixtures", which is true of jobs and false of projects. Thirty-two archived
  debris projects accumulated in a single afternoon before `check:leaks` said
  so — the exact pile #45 is about. A real project that gathers a job can never
  be deleted (`job_state_transitions` is append-only, so `project_delete`
  refuses), which is why archiving is not a teardown.

  Named at creation, not renamed at teardown: a crashed run never reaches
  teardown, which is the lesson the ten permanent `zz test slack` channels
  taught.
*/
const MINE = `Fixture conversation ${run}`
const THEIRS = `Fixture conversation ${run} rival`
const PREFIX = `fixture-conversation-${run}`

interface Msg {
  kind?: string
  from?: string
  body?: string
  at?: string
  confidence?: string
  evidence?: string
  surface?: string
}

let mine = ''
let theirs = ''

const num = async (sql: string): Promise<number> => Number((await one(sql)).n ?? -1)

const history = async (project: string, limit = 50): Promise<Msg[]> => {
  const r = await one(
    `select app.conversation_history(${lit(project)}::uuid, ${String(limit)}) as v`,
  )
  return (r.v ?? []) as Msg[]
}

/** A project with an attachment, because ADR-0014 refuses an active one without. */
const makeProject = async (name: string): Promise<string> => {
  const r = await one(
    `select app.hq_create_project(${lit(name)}, 'upload', ${lit(`${PREFIX}-ref`)}, ${lit(name)}, true) as v`,
  )
  const v = (r.v ?? {}) as { project_id?: string; project?: string; slug?: string }
  return String(v.project_id ?? v.project ?? '')
}

/**
 * Grant says something, on a named surface.
 *
 * `dedupe_key` is shaped by `inbound_dedupe_key_shaped`:
 * `^[a-z]+:[a-z_]+:[A-Za-z0-9:_.-]+$` — channel, kind, then the surface's own
 * id. Real rows look like `slack:message:95512832top`. That constraint is
 * already the message-identity mapping #195 was scoped to invent, which is
 * worth knowing before that Issue is built.
 */
const said = async (project: string, body: string, surface = 'telegram'): Promise<void> => {
  const id = `${PREFIX}-${Math.random().toString(36).slice(2, 12)}`
  await db.execute(`
    insert into public.inbound_commands
      (origin_channel, origin_ref, actor, instruction, dedupe_key, project_id)
    values (${lit(surface)}, ${lit(id)},
            'grant', ${lit(body)},
            ${lit(`${surface}:message:${id}`)},
            ${lit(project)}::uuid)
  `)
}

try {
  console.log('\nsetting up two real projects, each with a conversation')
  mine = await makeProject(MINE)
  theirs = await makeProject(THEIRS)
  check(
    'two subjects exist',
    `${mine.slice(0, 8)} and ${theirs.slice(0, 8)}`,
    mine !== '' && theirs !== '',
  )

  await said(mine, `Mine one ${run}`)
  await said(mine, `Mine two ${run}`, 'slack')
  await said(theirs, `Theirs one ${run}`)

  // -----------------------------------------------------------------------
  console.log('\nthe history reads back')

  const h = await history(mine)
  check(
    'the conversation has what was said in it',
    `${String(h.length)} message(s)`,
    h.length === 2,
  )

  const bodies = h.map((m) => String(m.body ?? ''))
  check(
    'the words are the words, not an empty shape of the right length',
    bodies.join(' | ').slice(0, 60),
    bodies.includes(`Mine one ${run}`) && bodies.includes(`Mine two ${run}`),
  )

  check(
    'in order, oldest first',
    `${String(h[0]?.at ?? '')} then ${String(h[1]?.at ?? '')}`,
    h.length === 2 && String(h[0]?.body) === `Mine one ${run}`,
  )

  check(
    'every message says who said it',
    h.map((m) => String(m.from)).join(','),
    h.every((m) => m.from === 'grant') && h.every((m) => m.kind === 'said'),
  )

  check(
    'and which surface it arrived on',
    h.map((m) => String(m.surface)).join(','),
    h.some((m) => m.surface === 'telegram') && h.some((m) => m.surface === 'slack'),
  )

  // -----------------------------------------------------------------------
  console.log('\nproject isolation, against a project that actually has messages')

  const t = await history(theirs)
  check('the rival has its own message', `${String(t.length)} message(s)`, t.length === 1)
  check(
    'and neither conversation contains a word of the other',
    'checked both directions',
    !bodies.some((b) => b.includes('Theirs')) &&
      !t.map((m) => String(m.body)).some((b) => b.includes('Mine')),
  )

  const unnamed = String((await one(`select app.unnamed_project() as v`)).v ?? '')
  check(
    'the reserved Unnamed project exists and is not one of these',
    unnamed.slice(0, 8),
    unnamed !== '' && unnamed !== mine && unnamed !== theirs,
  )

  // -----------------------------------------------------------------------
  console.log('\nthe reserved project is protected')

  const refused = (await one(`select app.project_delete('unnamed') as v`)).v as {
    error?: string
  }
  check(
    'app.project_delete refuses it, and says why rather than just failing',
    String(refused?.error ?? '(no error)').slice(0, 70),
    String(refused?.error ?? '').includes('reserved and cannot be deleted'),
  )

  const stillThere = Number(
    (await one(`select count(*)::int as n from public.projects where slug = 'unnamed'`)).n,
  )
  check('and it is still there afterwards', `${String(stillThere)} row(s)`, stillThere === 1)

  // -----------------------------------------------------------------------
  console.log('\nfixture traffic stays out of what Grant reads')

  /*
    A fixture JOB against a real project. `jobs.is_fixture` is GENERATED, and
    the clause that bites here is `kind like 'verification.%'` — the others key
    off `requested_by`, which `enqueue_inbound` builds as
    `<origin_channel>:<actor>` and `origin_channel` is constrained to four real
    surfaces. Read from the generation expression rather than assumed.

    #45's rule is why the PROJECT is real rather than named `fixture-…`: the
    reader under test filters fixtures, so a fixture project would be invisible
    to it and this check would pass by seeing nothing.
  */
  await db.execute(`
    insert into public.jobs (correlation_id, project_id, kind, requested_by, idempotency_key)
    values (gen_random_uuid(), ${lit(mine)}::uuid, 'verification.conversation',
            'grant', ${lit(`convproof-fixture-${run}`)})
  `)
  const fixtureJob = String(
    (
      await one(`
        select job_id as v from public.jobs
         where idempotency_key = ${lit(`convproof-fixture-${run}`)} limit 1
      `)
    ).v ?? '',
  )
  check(
    'the harness job really is marked as a fixture',
    fixtureJob.slice(0, 8),
    String(
      (
        await one(
          `select is_fixture::text as v from public.jobs where job_id = ${lit(fixtureJob)}::uuid`,
        )
      ).v,
    ) === 'true',
  )
  await db.execute(`
    insert into public.outputs (job_id, body, confidence, evidence, sources, deterministic)
    values (${lit(fixtureJob)}::uuid, ${lit(`Harness noise ${run}`)}, 'high', 'verified', '[]'::jsonb, true)
  `)

  const withFixture = await history(mine, 100)
  check(
    'a fixture job’s output is not in the conversation',
    `${String(withFixture.length)} message(s), still the two real ones`,
    withFixture.length === 2 &&
      !withFixture.map((m) => String(m.body)).some((b) => b.includes('Harness noise')),
  )

  // -----------------------------------------------------------------------
  console.log('\nthe real path: a message becomes work, and both stay in one conversation')

  /*
    Through `app.enqueue_inbound`, not a hand-built job. 0336 exists because
    that function resolves the job's project independently of the command's,
    and a raw INSERT here would test a path nothing uses and miss the
    disagreement entirely.
  */
  const askId = String(
    (
      await one(`
        insert into public.inbound_commands
          (origin_channel, origin_ref, actor, instruction, dedupe_key, project_id)
        values ('teamhq', ${lit(`${PREFIX}-ask`)}, 'grant', ${lit(`Please look at this ${run}`)},
                ${lit(`teamhq:message:${PREFIX}-ask`)}, ${lit(mine)}::uuid)
        returning command_id as v
      `)
    ).v ?? '',
  )
  const enq = (await one(`select app.enqueue_inbound(${lit(askId)}::uuid) as v`)).v as {
    job_id?: string
    error?: string
  }
  check(
    'enqueueing the message makes real work',
    String(enq?.job_id ?? enq?.error).slice(0, 40),
    typeof enq?.job_id === 'string' && enq.job_id !== '',
  )

  const agree = await one(`
    select (c.project_id = j.project_id)::text as v, j.project_id::text as jp
      from public.inbound_commands c join public.jobs j on j.job_id = c.job_id
     where c.command_id = ${lit(askId)}::uuid
  `)
  check(
    '0336 — the command and its job agree about which project this is',
    `command and job both ${String(agree.jp ?? '').slice(0, 8)}`,
    String(agree.v) === 'true',
  )
  /*
    And they agree on the RIGHT one. The first draft of this suite asserted
    only that the two matched, and passed while the job was being filed under
    the rival project — the heuristic overriding a project the caller had named.
    Agreement is not correctness; assert the value, not the equality. 0337.
  */
  check(
    '0337 — and it is the project the message actually named, not the last one touched',
    `named ${mine.slice(0, 8)}, landed on ${String(agree.jp ?? '').slice(0, 8)}`,
    String(agree.jp) === mine,
  )

  /*
    `deterministic` is TRUE, and it is not a convenience.

    §10's commit gate refuses to commit a job holding an unreviewed output and
    exempts deterministic ones -- "mark them deterministic if they came from a
    deterministic path", in the refusal's own words. This output is a constant
    string written by a suite; there is no model behind it and nothing to
    review. Saying false claimed a judgement had been made that never was.

    The cost was not a failed check. The output stayed pending, the job could
    never leave committing, committing to cancelled is not a legal transition
    so the teardown below could not clear it, and every deploy of the worker
    FAILED on the stranded job -- for a day, on two of them, with the deploy
    probe reporting an illegal transition four steps from this line.
  */
  await db.execute(`
    insert into public.outputs (job_id, body, confidence, evidence, sources, deterministic)
    values (${lit(String(enq.job_id))}::uuid, ${lit(`An answer ${run}`)}, 'medium', 'inferred',
            '[]'::jsonb, true)
  `)

  const both = await history(String(agree.jp ?? mine), 100)
  const answer = both.find((m) => String(m.body).includes('An answer'))
  const question = both.find((m) => String(m.body).includes('Please look at this'))
  check(
    'the question and the answer are in the SAME conversation, not split across two',
    `${String(both.length)} message(s)`,
    question !== undefined && answer !== undefined,
  )
  check(
    'and §12 holds — confidence and evidence travel together, never apart',
    `${String(answer?.confidence)} / ${String(answer?.evidence)}`,
    answer?.confidence === 'medium' && answer?.evidence === 'inferred',
  )
  check(
    'an answer is marked as answered, not as something Grant said',
    String(answer?.kind),
    answer?.kind === 'answered',
  )

  // -----------------------------------------------------------------------
  console.log('\na message from a project’s Slack channel joins that project’s conversation')

  /*
    0338, the inbound half of #193.

    Driven through `enqueue_inbound` with a real `origin_ref` rather than
    through the signed endpoint — `verify:echo` already proves the signed path,
    and what is under test here is which project the canonical layer resolves,
    not whether Slack's signature verifies.

    The rival project is mapped too, and to a DIFFERENT channel, so the check
    cannot pass by there being only one answer available.
  */
  /*
    A real workspace: `slack_channel_map.team_id` is a foreign key to
    `slack_workspaces`, so an invented team is refused. Read rather than
    hardcoded, so this does not go red when the workspace changes.
  */
  const team = String(
    (await one(`select team_id as v from public.slack_workspaces order by team_id limit 1`)).v ??
      '',
  )
  const myChannel = `C0HIST${run.slice(0, 4).toUpperCase()}`
  const theirChannel = `C0RIVL${run.slice(0, 4).toUpperCase()}`
  const mappings: readonly (readonly [string, string])[] = [
    [myChannel, mine],
    [theirChannel, theirs],
  ]
  for (const [chan, proj] of mappings) {
    await db.execute(`
      insert into public.slack_channel_map
        (channel_id, team_id, project_id, channel_name, purpose, active)
      values (${lit(chan)}, ${lit(team)}, ${lit(proj)}::uuid,
              ${lit(`zz test history ${run}`)}, 'project', true)
    `)
  }

  const fromSlack = String(
    (
      await one(`
        insert into public.inbound_commands
          (origin_channel, origin_ref, actor, instruction, dedupe_key)
        values ('slack', ${lit(`${myChannel}:1700000000.000900`)}, 'U0HIST',
                ${lit(`Asked in the channel ${run}`)},
                ${lit(`slack:message:${myChannel}:1700000000.000900`)})
        returning command_id as v
      `)
    ).v ?? '',
  )
  const enq2 = (await one(`select app.enqueue_inbound(${lit(fromSlack)}::uuid) as v`)).v as {
    job_id?: string
  }
  const landed = String(
    (
      await one(
        `select project_id::text as v from public.inbound_commands where command_id = ${lit(fromSlack)}::uuid`,
      )
    ).v ?? '',
  )
  check(
    '0338 — it lands on the project that owns the channel, not the last one touched',
    `channel ${myChannel} -> ${landed.slice(0, 8)} (wanted ${mine.slice(0, 8)})`,
    landed === mine,
  )

  const slackHistory = await history(mine, 100)
  check(
    'and it reads back in that project’s conversation',
    `${String(slackHistory.length)} message(s)`,
    slackHistory.map((m) => String(m.body)).some((b) => b.includes('Asked in the channel')),
  )
  check(
    'and not in the rival’s, whose channel is mapped elsewhere',
    'checked',
    !(await history(theirs, 100))
      .map((m) => String(m.body))
      .some((b) => b.includes('Asked in the channel')),
  )

  /*
    An unmapped channel must still work. The fallback is the path for
    essentially every message ever sent, and breaking it to fix the mapped case
    would be a far worse trade.
  */
  const orphan = String(
    (
      await one(`
        insert into public.inbound_commands
          (origin_channel, origin_ref, actor, instruction, dedupe_key)
        values ('slack', ${lit(`C0NOMAP${run.slice(0, 4).toUpperCase()}:1700000000.001000`)}, 'U0HIST',
                ${lit(`Asked nowhere in particular ${run}`)},
                ${lit(`slack:message:C0NOMAP${run.slice(0, 4).toUpperCase()}:1700000000.001000`)})
        returning command_id as v
      `)
    ).v ?? '',
  )
  await db.execute(`select app.enqueue_inbound(${lit(orphan)}::uuid)`)
  const orphanLanded = String(
    (
      await one(
        `select project_id::text as v from public.inbound_commands where command_id = ${lit(orphan)}::uuid`,
      )
    ).v ?? '',
  )
  check(
    'a message from an unmapped channel still lands somewhere rather than being lost',
    `-> ${orphanLanded.slice(0, 8)}`,
    orphanLanded !== '' && orphanLanded !== 'null',
  )

  /*
    0341, ADR-0024. With nothing to go on, the message goes to Unnamed rather
    than to a guess — and the setting is asserted in BOTH positions, because a
    switch only proven in its default state is a switch nobody has tested.
  */
  const unnamedProject = String((await one(`select app.unnamed_project() as v`)).v ?? '')
  check(
    '0341 — a message naming nothing lands in Unnamed, not in a guess',
    `-> ${orphanLanded.slice(0, 8)} (Unnamed is ${unnamedProject.slice(0, 8)})`,
    orphanLanded === unnamedProject,
  )

  await db.execute(
    `update public.system_config set value = 'false'::jsonb where key = 'routing.unnamed_when_unresolved'`,
  )
  try {
    /*
      Three plain statements rather than one clever CTE. The first draft did the
      insert, the enqueue and the read in one statement and came back empty:
      Postgres does not promise the order of a data-modifying CTE relative to a
      subquery that reads the same row.
    */
    const guessCmd = String(
      (
        await one(`
          insert into public.inbound_commands
            (origin_channel, origin_ref, actor, instruction, dedupe_key)
          values ('telegram', ${lit(`${PREFIX}-guess`)}, 'grant',
                  ${lit(`Nothing in particular ${run}`)},
                  ${lit(`telegram:message:${PREFIX}-guess`)})
          returning command_id as v
        `)
      ).v ?? '',
    )
    await db.execute(`select app.enqueue_inbound(${lit(guessCmd)}::uuid)`)
    const guessed = String(
      (
        await one(
          `select project_id::text as v from public.inbound_commands where command_id = ${lit(guessCmd)}::uuid`,
        )
      ).v ?? '',
    )
    check(
      'and turning the setting off restores the old guess — it is a switch, not a rewrite',
      `-> ${guessed.slice(0, 8)}`,
      guessed !== '' && guessed !== unnamedProject,
    )
  } finally {
    await db.execute(
      `update public.system_config set value = 'true'::jsonb where key = 'routing.unnamed_when_unresolved'`,
    )
  }
  void enq2

  // -----------------------------------------------------------------------
  console.log('\nthe studio can say something, not just act on something')

  /*
    #26 and #193. `send_to_agent` needs an asset; this is the composer.
    Driven through the RPC here and over HTTP below, because the studio reaches
    it through hq-api and that is the layer a missing public wrapper breaks.
  */
  const spoke = (
    await one(
      `select app.say_in_project(${lit(mine)}::uuid, ${lit(`Said from the studio ${run}`)}, 'research-director') as v`,
    )
  ).v as {
    ok?: boolean
    command?: string
    job?: string
    addressed_to?: string
    addressee_dropped?: string
  }
  check(
    'saying something makes a real command and real work',
    `command ${String(spoke?.command).slice(0, 8)}, job ${String(spoke?.job).slice(0, 8)}`,
    spoke?.ok === true && typeof spoke.job === 'string' && spoke.job !== '',
  )
  check(
    'and it is addressed to the person who was picked',
    String(spoke?.addressed_to),
    spoke?.addressed_to === 'research-director',
  )

  const spokenHistory = await history(mine, 100)
  check(
    'it appears in that project’s conversation, from Grant',
    `${String(spokenHistory.length)} message(s)`,
    spokenHistory.some(
      (m) => String(m.body).includes('Said from the studio') && m.from === 'grant',
    ),
  )
  check(
    'on the teamhq surface — not a new word for the web dashboard (0313)',
    String(spokenHistory.find((m) => String(m.body).includes('Said from the studio'))?.surface),
    spokenHistory.find((m) => String(m.body).includes('Said from the studio'))?.surface ===
      'teamhq',
  )

  /*
    The case that decides whether this is safe. `addressed_to` is a foreign key
    to `staff`, so a slug naming nobody would fail the INSERT and lose the
    whole message — which is exactly what happened to Grant once through the
    Slack adapter, recorded in CLAUDE.md.
  */
  const badName = (
    await one(
      `select app.say_in_project(${lit(mine)}::uuid, ${lit(`Addressed to nobody ${run}`)}, 'nobody-at-all') as v`,
    )
  ).v as {
    ok?: boolean
    addressed_to?: string | null
    addressee_dropped?: string | readonly string[] | null
  }
  /*
    A LIST since 0411, because #26 let Grant address two people and one of them
    can be unroutable while the other is not. Read as a list of whatever
    arrived: the property is that the composer is TOLD which name was dropped,
    and it does not depend on whether one name comes back as a string or in an
    array of one — the fifth instance in this repository of an assertion locked
    to a shape rather than to the property it stands for.
  */
  const droppedHere = (
    Array.isArray(badName?.addressee_dropped)
      ? badName.addressee_dropped
      : typeof badName?.addressee_dropped === 'string'
        ? [badName.addressee_dropped]
        : []
  ).map((n) => String(n))
  check(
    'an addressee naming nobody does NOT lose the message',
    `ok=${String(badName?.ok)}, addressed_to=${String(badName?.addressed_to)}`,
    badName?.ok === true && (badName.addressed_to ?? null) === null,
  )
  check(
    'and the composer is told the name was dropped rather than it happening silently',
    droppedHere.join(', ') || '(nothing reported)',
    droppedHere.includes('nobody-at-all'),
  )
  check(
    'the words still reach the conversation',
    'checked',
    (await history(mine, 100)).some((m) => String(m.body).includes('Addressed to nobody')),
  )

  const empty = (await one(`select app.say_in_project(${lit(mine)}::uuid, '   ') as v`)).v as {
    ok?: boolean
    error?: string
  }
  check(
    'and saying nothing is refused in English, not by a constraint name',
    String(empty?.error),
    empty?.ok === false && String(empty?.error).includes('nothing to say'),
  )

  // -----------------------------------------------------------------------
  console.log('\nhistory can be reconstructed, and reconstructing it does not wake the office')

  const histTs = '1699999999.000700'
  const back1 = (
    await one(`
      select app.record_slack_history(${lit(myChannel)}, ${lit(histTs)}, 'U0OLD',
        ${lit(`Something said months ago ${run}`)}) as v
    `)
  ).v as { ok?: boolean; outcome?: string; command?: string }
  check(
    'an old message imports into the channel’s project',
    `${String(back1?.outcome)}`,
    back1?.ok === true && back1.outcome === 'added',
  )

  /*
    The property this whole feature turns on. Every message in a channel's
    history is an instruction as far as the router is concerned, so a backfill
    that enqueued would have the office act on every request Grant made since
    March — each job doing exactly what it was told.
  */
  const woke = await num(`
    select count(*)::int as n from public.inbound_commands
     where command_id = ${lit(String(back1?.command))}::uuid and job_id is not null
  `)
  check(
    'and it makes NO work — importing history does not make the office act on it',
    `${String(woke)} job(s)`,
    woke === 0,
  )

  const back2 = (
    await one(`
      select app.record_slack_history(${lit(myChannel)}, ${lit(histTs)}, 'U0OLD',
        ${lit(`Something said months ago ${run}`)}) as v
    `)
  ).v as { outcome?: string }
  check(
    'importing twice imports once — the same key that makes a redelivery safe',
    String(back2?.outcome),
    back2?.outcome === 'already there',
  )

  const reconstructed = (await history(mine, 100)).find((m) =>
    String(m.body).includes('Something said months ago'),
  )
  check(
    'it reads back in the conversation',
    String(reconstructed?.body).slice(0, 40),
    reconstructed !== undefined,
  )
  check(
    'and it is marked as reconstructed — the office did not witness it and must not imply it did',
    `backfilled=${String((reconstructed as { backfilled?: boolean } | undefined)?.backfilled)}`,
    (reconstructed as { backfilled?: boolean } | undefined)?.backfilled === true,
  )
  const live = (await history(mine, 100)).find((m) =>
    String(m.body).includes('Said from the studio'),
  )
  check(
    'while a message the office DID witness is not',
    `backfilled=${String((live as { backfilled?: boolean } | undefined)?.backfilled)}`,
    (live as { backfilled?: boolean } | undefined)?.backfilled === false,
  )

  const unmapped = (
    await one(`
      select app.record_slack_history('C0NEVERMAPPED', '1699999999.000800', 'U0OLD', 'orphan') as v
    `)
  ).v as { ok?: boolean; error?: string }
  check(
    'and a channel that maps to no project is refused rather than filed anywhere',
    String(unmapped?.error).slice(0, 50),
    unmapped?.ok === false && String(unmapped?.error).includes('maps to no project'),
  )

  // -----------------------------------------------------------------------
  console.log('\nthe page can notice that something was said')

  /*
    #199, 0343. The studio does not subscribe — it asks `hq_pulse` every twenty
    seconds and refetches only when the digest differs, because a browser
    subscribing to Realtime would need the anon key and RLS policies making the
    office's work readable to a credential that is public by design.

    So the digest is the whole mechanism, and a conversation that does not move
    it is a chat that sits still while messages arrive. Most conversation moves
    it by accident — a message becomes a job — which is exactly why the case
    worth checking is the one that makes NO job.
  */
  const digest = async (): Promise<string> =>
    JSON.stringify((await one(`select app.hq_pulse() as v`)).v)

  const before = await digest()
  await db.execute(`
    select app.record_slack_history(${lit(myChannel)}, '1699999999.000950', 'U0OLD',
      ${lit(`A message that makes no work ${run}`)})
  `)
  const after = await digest()
  check(
    'a message that creates no job still moves the digest',
    before === after ? 'IT DID NOT MOVE' : 'moved',
    before !== after,
  )

  check(
    'and the digest carries a message count, so the studio can see conversation at all',
    JSON.parse(after).messages === undefined
      ? 'MISSING'
      : `messages=${String(JSON.parse(after).messages)}`,
    typeof JSON.parse(after).messages === 'number',
  )

  // -----------------------------------------------------------------------
  console.log('\nthe layer the studio actually uses')

  const base = `https://${process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg'}.supabase.co/functions/v1/hq-api`
  const hqToken = String(
    (
      await one(
        `select decrypted_secret as v from vault.decrypted_secrets where name = 'hq.api_token'`,
      )
    ).v ?? '',
  )
  if (hqToken !== '') {
    /*
      Read the RPC again HERE rather than reusing a count from earlier: the
      Slack section above added a message, and comparing HTTP against a stale
      snapshot fails for a reason that has nothing to do with the HTTP layer.
      The property worth asserting is that the two agree right now.
    */
    const fromRpc = await history(String(agree.jp ?? mine), 100)
    const r = await fetch(`${base}?section=conversation&id=${String(agree.jp ?? mine)}`, {
      headers: { Authorization: `Bearer ${hqToken}` },
    })
    const body = (await r.json().catch(() => ({}))) as { data?: Msg[] }
    /*
      Containment, not equality — and the RPC read goes FIRST.

      The property worth asserting is that the HTTP layer serves the same
      conversation the RPC does: anything the RPC shows and the page cannot
      see is the defect this was written to catch.

      Two counts taken a second apart are a race dressed as an assertion, and
      this check has now been wrong about the direction TWICE. It first
      compared equality and the gate caught it as "12 over HTTP vs 11 from the
      RPC". It was then changed to containment with the HTTP read first, and
      the comment claimed that made a message arriving in between shorten the
      HTTP answer harmlessly — which is exactly backwards. With HTTP read
      first, a message that arrives in between is in the RPC answer and NOT in
      the HTTP one, so the live office writing a turn fails the check. The
      gate caught that as "9 over HTTP, 10 from the RPC, 1 the page cannot
      see".

      The snapshot has to be taken from the side that must be CONTAINED. The
      RPC is read first, so a message arriving afterwards can only make the
      HTTP answer LONGER, which containment does not care about, and a
      message the page genuinely cannot see still fails.
    */
    const seen = new Set((body.data ?? []).map((m) => `${String(m.at)}|${String(m.body)}`))
    const missing = fromRpc.filter((m) => !seen.has(`${String(m.at)}|${String(m.body)}`))
    check(
      'the page can ask for a conversation over HTTP',
      `http ${String(r.status)}, ${String(fromRpc.length)} from the RPC, ` +
        `${String((body.data ?? []).length)} over HTTP, ` +
        `${String(missing.length)} the page cannot see` +
        // Name them. A bare count sends somebody looking at the HTTP layer
        // when the answer is which message is missing and why.
        (missing.length === 0
          ? ''
          : ` — ${missing.map((m) => String(m.body).slice(0, 40)).join(' | ')}`),
      r.ok && Array.isArray(body.data) && missing.length === 0,
    )

    const bad = await fetch(`${base}?section=conversation&id=not-a-uuid`, {
      headers: { Authorization: `Bearer ${hqToken}` },
    })
    check(
      'a malformed project id is refused at the door, not by Postgres',
      `http ${String(bad.status)}`,
      bad.status === 400,
    )

    /*
      The write action over HTTP. A read wrapper can exist while the write one
      does not — `verify:search` found exactly that shape — so both legs are
      driven rather than one standing in for the other.
    */
    const posted = await fetch(base, {
      method: 'POST',
      headers: { Authorization: `Bearer ${hqToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'say',
        args: { p_project_id: mine, p_text: `Said over HTTP ${run}` },
      }),
    })
    // A read section answers `{data}`; an action answers `{action, result}`.
    // Two shapes on one endpoint, and reading the wrong one reports http 200
    // with ok=undefined — which looks like a broken action and is a broken test.
    const postedBody = (await posted.json().catch(() => ({}))) as {
      result?: { ok?: boolean; error?: string }
    }
    check(
      'and the studio can SAY something over HTTP, not only read',
      `http ${String(posted.status)}, ok=${String(postedBody.result?.ok)}`,
      posted.ok && postedBody.result?.ok === true,
    )
    const saidOverHttp = await history(mine, 100)
    check(
      'and what it said is in the conversation, through the whole chain',
      'checked',
      saidOverHttp.some((m) => String(m.body).includes('Said over HTTP')),
    )

    const noAuth = await fetch(`${base}?section=conversation&id=${mine}`)
    check(
      'and a conversation is not readable without the token',
      `http ${String(noAuth.status)}`,
      noAuth.status === 401,
    )
  } else {
    check(
      'the page can ask for a conversation over HTTP',
      'NOT CHECKED — no hq.api_token in the vault; run npm run deploy:hq',
      false,
    )
  }
} finally {
  console.log('\nteardown')
  /*
    Jobs first: `app.project_delete` refuses a project holding any, and rightly
    — a job can never be deleted because `job_state_transitions` is append-only.
    So the subjects' jobs are cancelled and the projects are archived rather
    than removed. Asserting they are GONE would be asserting the wrong thing;
    what matters is that they are out of Grant's project list.
  */
  await db.execute(
    `delete from public.slack_channel_map where channel_name like ${lit(`zz test history ${run}%`)}`,
  )

  /*
    Cancel the jobs this run caused before removing the commands that point at
    them. `say_in_project` is the real product path and makes real work — which
    is right, and means the suite owes the queue a teardown. #203 is what
    leaving them behind looks like: 43 jobs the office ran for a test.

    Cancelled rather than deleted: a job can never be removed
    (`job_state_transitions` is append-only), and only a non-terminal state can
    move — `enforce_job_transition` refuses complete -> cancelled and is right
    to, which `verify:import` learned by copying another suite's assumptions.
  */
  for (const id of [mine, theirs].filter((x) => x !== '')) {
    /*
      Cancel what can be cancelled, and FAIL what cannot.

      "not in (complete, cancelled, failed)" reads like a complete guard and is
      not: `committing` and `committed` have no edge to `cancelled`, so the
      update raised and the job stayed exactly where it was. Two of them sat in
      `committing` for a day breaking every worker deploy.

      Two statements rather than one, because the legal move differs by state
      and the state machine is the authority on which — `committing` and
      `committed` can only go to `failed`, and everything else earlier in the
      run can still be cancelled.
    */
    await db.execute(`
      update public.jobs
         set state = 'failed',
             state_reason = 'verify:history probe, abandoned past the commit gate'
       where project_id = ${lit(id)}::uuid
         and state in ('committing', 'committed', 'notifying')
    `)
    await db.execute(`
      update public.jobs
         set state = 'cancelled', state_reason = 'verify:history probe, never run'
       where project_id = ${lit(id)}::uuid
         and state not in ('complete', 'cancelled', 'failed')
    `)
  }
  for (const id of [mine, theirs].filter((x) => x !== '')) {
    await db.execute(`delete from public.inbound_commands where project_id = ${lit(id)}::uuid`)
    await db.execute(
      `update public.projects set status = 'archived' where project_id = ${lit(id)}::uuid`,
    )
    await db.execute(`delete from public.project_attachments where project_id = ${lit(id)}::uuid`)
  }

  /*
    Try a real delete first. It succeeds when the run made no jobs, and is
    refused when it did — a project holding a job can never be removed, which
    is ADR-0022 and correct. What the assertion then checks is the property
    that matters: nothing of this run is in Grant's project list, whether that
    is because it was deleted or because it is archived AND a fixture.
  */
  for (const slug of [`${PREFIX}`, `${PREFIX}-rival`]) {
    await db.execute(`select app.project_delete(${lit(slug)})`)
  }

  const visible = Number(
    (
      await one(`
        select count(*)::int as n from public.projects
         where slug like ${lit(`${PREFIX}%`)}
           and (status = 'active' or not is_fixture)
      `)
    ).n,
  )
  check(
    'teardown — nothing of this run can reach Grant’s project list',
    `${String(visible)} active or non-fixture`,
    visible === 0 && mine !== '',
  )

  const liveJobs = await num(`
    select count(*)::int as n from public.jobs
     where state_reason = 'verify:history probe, never run'
       and state not in ('complete', 'cancelled', 'failed')
  `)
  check(
    'teardown — no probe job is still live in the queue',
    `${String(liveJobs)} live`,
    liveJobs === 0,
  )

  /*
    The attribution on the jobs this run caused (#133, migration 0460).

    This suite drives the REAL enqueue path on purpose, so `enqueue_inbound`
    composes `requested_by` as <origin_channel>:<actor> and the actors here are
    'grant' and 'U0HIST'. Every witness therefore says real: `is_fixture` is
    generated from that string, `app.harness_job` adds "is the project a
    fixture" and two of these inserts deliberately carry no project at all, and
    the teardown above cancels BY PROJECT so it could never reach them.

    Sixty-one accumulated before `npm run replay` selected three of them as
    real history. 0351 did exactly this for gate-3's telegram:4242 and the
    lesson did not travel; it is travelling now, with an assertion under it,
    because CLAUDE.md's rule is that a suite which believes its work is
    invisible must make that belief checkable.

    Keyed on the run id, which every instruction this file writes carries, so
    it cannot touch another run's work or anything a person typed.
  */
  await db.execute(`
    update public.jobs
       set requested_by = 'verify:history'
     where not is_fixture
       and coalesce(pinned_config->>'instruction', '') like ${lit(`%${run}`)}
  `)
  const lookReal = await num(`
    select count(*)::int as n from public.jobs
     where not is_fixture
       and coalesce(pinned_config->>'instruction', '') like ${lit(`%${run}`)}
  `)
  check(
    'teardown — no job of this run is still counted as something Grant asked',
    `${String(lookReal)} reading as real`,
    lookReal === 0,
  )

  const strays = Number(
    (
      await one(`
        select count(*)::int as n from public.inbound_commands
         where origin_ref like ${lit(`${PREFIX}%`)}
      `)
    ).n,
  )
  check(
    'teardown — and no message of this run is left behind',
    `${String(strays)} left`,
    strays === 0,
  )
}

const failed = checks.filter((c) => !c).length
console.log(`\n${String(checks.length - failed)}/${String(checks.length)} checks passed`)
process.exit(failed === 0 ? 0 : 1)
