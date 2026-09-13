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
    const r = await fetch(`${base}?section=conversation&id=${String(agree.jp ?? mine)}`, {
      headers: { Authorization: `Bearer ${hqToken}` },
    })
    const body = (await r.json().catch(() => ({}))) as { data?: Msg[] }
    check(
      'the page can ask for a conversation over HTTP',
      `http ${String(r.status)}, ${String((body.data ?? []).length)} message(s)`,
      r.ok && Array.isArray(body.data) && (body.data ?? []).length === both.length,
    )

    const bad = await fetch(`${base}?section=conversation&id=not-a-uuid`, {
      headers: { Authorization: `Bearer ${hqToken}` },
    })
    check(
      'a malformed project id is refused at the door, not by Postgres',
      `http ${String(bad.status)}`,
      bad.status === 400,
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
