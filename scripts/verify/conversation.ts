/**
 * Claire remembers the last few minutes, and says back everything she was asked.
 *
 *   npm run verify:conversation
 *
 * Issues #63 and #60. Both have a mechanism and neither had a proof, which is
 * why both stayed open after the code landed — this repository's own #72
 * pattern with the halves swapped.
 *
 * ## What each Issue asked to be shown, and why a unit test cannot
 *
 * #63's last box: *"a verify suite replays a two-message exchange and asserts
 * the second is understood in terms of the first."* `tests/agents/thread.test.ts`
 * already pins `needsResolving` and `accept`, which is the judgement half. What
 * it cannot see is the half that actually failed for Grant: whether the
 * conversation is READ BACK at all, and whether it is read back from the right
 * chat. That is a question about `app.recent_exchange` and about real rows.
 *
 * #60's last box: *"a verify suite replays this exact transcript and asserts
 * all six clauses are accounted for."* So it does, verbatim, because the
 * failure was that four of them vanished silently.
 *
 * ## The property that matters most is the one about OTHER chats
 *
 * A thread that leaks is worse than no thread: work filed against the wrong
 * project because a sentence resolved against somebody else's conversation is
 * a mistake nobody can see afterwards. So the exchange is planted in two chats
 * and each is asserted not to see the other — and there is a control that the
 * planting worked, because a scoping check passes trivially when the decoy is
 * not there.
 */

import { describePlan, readPlan } from '../../src/agents/plan.ts'
import { accept, exchange, needsResolving } from '../../src/agents/thread.ts'
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
const chatA = `verify-thread-a-${run}`
const chatB = `verify-thread-b-${run}`

/*
  `inbound_commands` rows, which are the conversation. `requested_by`-style
  fixture marking does not exist on this table, so the rows are removed by hand
  at the end and the removal is asserted.
*/
/*
  A dedupe key of the shape the table demands.

  `inbound_dedupe_key_shaped` is `^[a-z]+:[a-z_]+:[A-Za-z0-9:_.-]+$` — channel,
  kind, reference — so a free-form string is refused, and so is anything with a
  space in it. Built here rather than inline in the SQL because a comment
  explaining it INSIDE the template literal is the backtick trap CLAUDE.md
  names, and it bit while writing this file.
*/
const dedupe = (chat: string, minutesAgo: number): string =>
  `telegram:verify_thread:${chat}-${String(minutesAgo)}-${Math.random().toString(36).slice(2, 8)}`

const said = async (chat: string, text: string, minutesAgo: number): Promise<string> =>
  String(
    (
      await one(`
        insert into public.inbound_commands
          (origin_channel, origin_ref, actor, instruction, dedupe_key, received_at)
        values ('telegram', ${lit(`${chat}:1`)}, 'grant', ${lit(text)},
                ${lit(dedupe(chat, minutesAgo))},
                app.now_utc() - make_interval(mins => ${String(minutesAgo)}))
        returning command_id::text as id
      `)
    ).id,
  )

console.log(`\nverify:conversation — ${run}\n`)

try {
  // =========================================================================
  console.log('a conversation, in one chat (#63)')

  await said(chatA, 'Create a notebook called Coaching for Success.', 30)
  await said(chatA, 'Add the three interview transcripts to it as sources.', 20)
  const latestA = await said(chatA, 'Now make the audio one long.', 0)

  // A decoy in another chat, at the same time, about something else entirely.
  await said(chatB, 'Let us talk about the Wellness pricing model instead.', 25)
  const latestB = await said(chatB, 'Make that one short.', 0)

  const turnsA = await exchange(db, latestA)
  check(
    'the recent conversation is read back',
    `${String(turnsA.length)} turn(s): ${turnsA.map((t) => t.text.slice(0, 28)).join(' | ')}`,
    turnsA.length === 2,
  )
  check(
    'and it is the conversation, in order, oldest first',
    turnsA.map((t) => t.text.slice(0, 16)).join(' → '),
    turnsA[0]?.text.startsWith('Create a notebook') === true &&
      turnsA[1]?.text.startsWith('Add the three') === true,
  )

  /*
    The property this suite exists for. A thread that leaks resolves a sentence
    against somebody else's conversation and files the work somewhere nobody
    can trace, which is worse than having no thread at all.
  */
  const turnsB = await exchange(db, latestB)
  check(
    'CONTROL: the other chat has its own turns, so the check below is not vacuous',
    `${String(turnsB.length)} turn(s) in chat B`,
    turnsB.length === 1,
  )
  check(
    'and one chat cannot see another',
    `A has ${String(turnsA.length)}, none of them B's`,
    !turnsA.some((t) => t.text.includes('Wellness pricing')) &&
      !turnsB.some((t) => t.text.includes('Coaching for Success')),
  )

  // The window is bounded, which is what keeps this at ~£0.
  await said(chatA, 'Something said hours ago that is not the subject.', 600)
  const windowed = await exchange(db, latestA, 90, 12)
  check(
    'the window is bounded in time',
    `${String(windowed.length)} turn(s) inside 90 minutes, with an older one present`,
    windowed.length === 2 && !windowed.some((t) => t.text.includes('hours ago')),
  )
  const capped = await exchange(db, latestA, 1_000, 1)
  check('and in number', `${String(capped.length)} turn(s) at limit 1`, capped.length === 1)

  // =========================================================================
  console.log('\nwhat gets sent to a model, and what does not (#63)')

  check(
    'an elliptical instruction is recognised as needing resolution',
    'Now make the audio one long.',
    needsResolving('Now make the audio one long.'),
  )
  /*
    Most messages are self-contained, and the budget is ~£0. A resolver that
    called a model on every message would be the cost of the feature.
  */
  check(
    'CONTROL: a self-contained instruction never reaches a model',
    'Create a notebook called Coaching for Success and add the transcripts.',
    !needsResolving('Create a notebook called Coaching for Success and add the transcripts.'),
  )
  check(
    'a rewrite that starts planning is refused',
    'multi-line answer',
    accept('make it longer', '1. Make the audio\n2. Make it longer').changed === false,
  )
  check(
    'a rewrite that drops half the sentence is refused',
    'much shorter than the original',
    accept('make the audio overview for Coaching for Success a long one please', 'make it long')
      .changed === false,
  )
  check(
    'and a real resolution is taken, and says what it was',
    'the audio one → the audio overview for Coaching for Success',
    accept(
      'Now make the audio one long.',
      'Now make the audio overview for Coaching for Success long.',
    ).changed === true,
  )

  // =========================================================================
  console.log('\nthe say-back accounts for every clause (#60)')

  /*
    Grant's voice note of 11 September, verbatim from the Issue. Four of its
    six clauses vanished from the say-back and it still offered a Go ahead.
  */
  const TRANSCRIPT =
    'Create for me a new Google Notebook project. You can call it Coaching for ' +
    'Success and I want you to do some research on how to make good money ' +
    'coaching people in wellness over three or six month long programs. The ' +
    'research can be done via Google Notebook as relevant sources and then I ' +
    'want you to produce a presentation and a short audio explanation and once ' +
    "that's done I want you to send me the link to the audio and presentation " +
    'directly here that I can click on it and open it.'

  const plan = readPlan(TRANSCRIPT)
  check(
    'the transcript still produces a plan',
    plan === null ? 'no plan at all' : `${String(plan.steps.length)} step(s)`,
    plan !== null,
  )

  const kinds = (plan?.steps ?? []).map((s) => s.kind)
  const unread = plan?.unread ?? []
  const accounted = `${kinds.join(', ')} + unread[${unread.join(' / ')}]`

  /*
    `project`, not `create_project`.

    The planner names the project and does not decide its fate — the handler
    resolves it against Grant's own projects and his notebooks, and rewrites it
    into `create_project` or `use_project` before the plan is ever shown. So
    what he approves says which one it is. Asserting `create_project` here
    tests the wrong stage, and the first version of this check did exactly that
    and reported the clause as missing when it was present.
  */
  const named = plan?.steps.find((s) => s.kind === 'project' || s.kind === 'create_project')
  check(
    'it names the notebook — the clause that used to vanish',
    JSON.stringify(named ?? {}),
    named !== undefined,
  )
  check(
    'and it survives the name arriving in the FOLLOWING sentence',
    JSON.stringify(named ?? {}),
    JSON.stringify(named ?? {}).includes('Coaching for Success'),
  )
  check(
    'the presentation and the audio are both there',
    kinds.join(', '),
    kinds.filter((k) => k === 'generate').length >= 2,
  )
  /*
    The two it has no step for. Named out loud rather than silently dropped —
    which is the whole of #60: a plan that understands a third of an
    instruction and offers a confirm button makes a partial reading look
    checked.
  */
  check(
    'the research it cannot do is NAMED, not dropped',
    unread.join(' / ') || 'nothing named',
    unread.some((u) => u.includes('research')),
  )
  check(
    'and so is sending the links back',
    unread.join(' / ') || 'nothing named',
    unread.some((u) => u.includes('link')),
  )

  const covered =
    named !== undefined &&
    kinds.filter((k) => k === 'generate').length >= 2 &&
    unread.some((u) => u.includes('research')) &&
    unread.some((u) => u.includes('link'))
  check('so all six clauses are accounted for, as a step or as a stated gap', accounted, covered)

  /*
    And the thing the Issue says is worse than a parse failure: a partial plan
    presented with a bare Go ahead. The say-back must carry the gap.
  */
  const saidBack = plan === null ? '' : describePlan(plan)
  check(
    'a partial plan cannot present itself as complete',
    saidBack.replace(/\s+/g, ' ').slice(0, 130) || 'no say-back',
    /could not work out/i.test(saidBack),
  )
  /*
    Written first as `!/from it/i.test(saidBack) || named !== undefined`, which
    passes the moment a project is named — i.e. always, on this transcript. A
    check that cannot fail is not a check. So it is asked the other way round,
    against a plan that genuinely HAS no source.
  */
  check(
    'the say-back names the subject rather than saying "from it"',
    saidBack.replace(/\s+/g, ' ').slice(0, 120),
    /from “Coaching for Success”/.test(saidBack) && !/from it/i.test(saidBack),
  )
  const sourceless = readPlan('Make me a slide deck and an audio overview, and send me the links.')
  check(
    'and a plan with no project at all still says nothing about "it"',
    sourceless === null ? 'no plan' : describePlan(sourceless).replace(/\s+/g, ' ').slice(0, 120),
    sourceless === null || !/from it/i.test(describePlan(sourceless)),
  )

  /*
    And the closing line itself, which is what Grant actually read. The Issue's
    complaint was not that the gap was unrecorded — it was that the message
    ended "Go ahead and I will start" under a one-third understanding.
  */
  check(
    'and the closing line stops being a bare Go ahead',
    saidBack
      .split('\n')
      .filter((l) => l.trim() !== '')
      .at(-1) ?? '',
    !/^Go ahead and I will start/.test(
      saidBack
        .split('\n')
        .filter((l) => l.trim() !== '')
        .at(-1) ?? '',
    ),
  )
} finally {
  console.log('')
  const gone = await db.execute(`
    delete from public.inbound_commands
     where origin_ref like ${lit(`verify-thread-%-${run}:%`)}
    returning command_id
  `)
  const left = Number(
    (
      await one(`
        select count(*)::int as n from public.inbound_commands
         where origin_ref like ${lit(`verify-thread-%-${run}:%`)}
      `)
    ).n,
  )
  // "A teardown that matches nothing looks exactly like one that worked."
  check(
    'teardown',
    `${String(gone.rows.length)} row(s) removed, ${String(left)} left`,
    gone.rows.length > 0 && left === 0,
  )
}

const failed = checks.filter((c) => !c).length
console.log(`\n${String(checks.length - failed)}/${String(checks.length)} checks passed`)
process.exit(failed === 0 ? 0 : 1)
