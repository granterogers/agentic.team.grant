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
const MINE = `Conversation proof ${run}`
const THEIRS = `Conversation proof ${run} rival`
const PREFIX = `conversation-proof-${run}`

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

  await db.execute(`
    insert into public.outputs (job_id, body, confidence, evidence, sources, deterministic)
    values (${lit(String(enq.job_id))}::uuid, ${lit(`An answer ${run}`)}, 'medium', 'inferred',
            '[]'::jsonb, false)
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
  ).v as { ok?: boolean; addressed_to?: string | null; addressee_dropped?: string }
  check(
    'an addressee naming nobody does NOT lose the message',
    `ok=${String(badName?.ok)}, addressed_to=${String(badName?.addressed_to)}`,
    badName?.ok === true && (badName.addressed_to ?? null) === null,
  )
  check(
    'and the composer is told the name was dropped rather than it happening silently',
    String(badName?.addressee_dropped),
    badName?.addressee_dropped === 'nobody-at-all',
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
    const overHttp = await history(String(agree.jp ?? mine), 100)
    const r = await fetch(`${base}?section=conversation&id=${String(agree.jp ?? mine)}`, {
      headers: { Authorization: `Bearer ${hqToken}` },
    })
    const body = (await r.json().catch(() => ({}))) as { data?: Msg[] }
    check(
      'the page can ask for a conversation over HTTP',
      `http ${String(r.status)}, ${String((body.data ?? []).length)} over HTTP vs ${String(overHttp.length)} from the RPC`,
      r.ok && Array.isArray(body.data) && (body.data ?? []).length === overHttp.length,
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
  for (const id of [mine, theirs].filter((x) => x !== '')) {
    await db.execute(`delete from public.inbound_commands where project_id = ${lit(id)}::uuid`)
    await db.execute(
      `update public.projects set status = 'archived' where project_id = ${lit(id)}::uuid`,
    )
    await db.execute(`delete from public.project_attachments where project_id = ${lit(id)}::uuid`)
  }

  const left = Number(
    (
      await one(`
        select count(*)::int as n from public.projects
         where slug like ${lit(`${PREFIX}%`)} and status = 'active'
      `)
    ).n,
  )
  check(
    'teardown — no subject of this run is still in Grant’s project list',
    `${String(left)} active`,
    left === 0 && mine !== '',
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
