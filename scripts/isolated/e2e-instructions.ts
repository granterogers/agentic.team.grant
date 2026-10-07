/*
  e2e-instructions - Part 1 of the local end-to-end verification (agent E2).

  Drives the PURE, offline readers the instruction handler composes, over realistic sentences, with and without a
  thread, and prints for each: intent class, roster, plan, outward-action reading, clarification, task/reminder.
  No database, no model, no network. Where a reading needs the model it is marked UNPROVEN-needs-model.

  Usage: npx tsx scripts/isolated/e2e-instructions.ts
*/
import { artifactRequest } from '../../src/agents/actions.ts'
import { entitled, noneEntitled } from '../../src/agents/entitled.ts'
import { asksForTasks, asksForWriting } from '../../src/agents/goal.ts'
import { classifyIntent, needsClarification } from '../../src/agents/intent.ts'
import { personalTaskRequest } from '../../src/agents/mine.ts'
import { pickRoster } from '../../src/agents/router.ts'
import { resolveElliptical, taskRequest } from '../../src/agents/tasks.ts'
import { needsResolving } from '../../src/agents/thread.ts'
import { asHumanWords } from '../../src/agents/turn.ts'
import { isolated } from './guard.ts'

interface Row {
  said: string
  forwarded: boolean
  thread: string
}

const ROWS: Row[] = [
  {
    said: 'Research this and tell me what you recommend.',
    forwarded: false,
    thread: 'the Holloway venue contract',
  },
  { said: 'Handle this for me.', forwarded: false, thread: 'the Holloway venue contract' },
  {
    said: 'Ask the team to investigate this.',
    forwarded: false,
    thread: 'the failed backup last night',
  },
  { said: 'Remind me tomorrow.', forwarded: false, thread: 'call Kevin about the deposit' },
  { said: "Draft an email to Kevin but don't send it.", forwarded: false, thread: '' },
  { said: 'Send this to Kevin.', forwarded: false, thread: 'the revised proposal PDF' },
  {
    said: "Keep working on this while I'm away.",
    forwarded: false,
    thread: 'the Holloway venue contract',
  },
  {
    said: 'Find out why this failed and fix whatever you safely can.',
    forwarded: false,
    thread: 'the failed backup last night',
  },
  {
    said: 'Do everything you can without asking me questions.',
    forwarded: false,
    thread: 'the Holloway venue contract',
  },
  { said: 'Stop sending me updates.', forwarded: false, thread: '' },
  {
    said: 'Ask the finance director to review the outstanding work and tell me what needs attention',
    forwarded: false,
    thread: '',
  },
  { said: 'Email Kevin the report and cc my accountant', forwarded: false, thread: '' },
  { said: 'Please send this to everyone', forwarded: true, thread: '' },
]

const j = (v: unknown): string =>
  v === null || v === undefined ? '-' : typeof v === 'string' ? v : JSON.stringify(v)

const read = (text: string, forwarded: boolean) => {
  const e = forwarded ? noneEntitled : entitled
  const w = asHumanWords(text)
  const c = classifyIntent(text)
  const picked = pickRoster(c, text)
  const clarify = needsClarification(c)
  const plan = e.plan(w)
  const task = forwarded ? null : taskRequest(text, c)
  const personal = forwarded ? null : personalTaskRequest(text)
  const file = forwarded ? null : artifactRequest(text)
  const web = e.research(w)
  const off = e.callsItOff(w)
  const rule = e.teaching(w)
  const again = e.anotherGo(w)
  return {
    intent: `${c.intent}${c.confident ? '' : '?'}${c.recognised ? '' : ' (unrecognised)'}`,
    matched: c.matched.join(','),
    roster: picked.roster.join(',') || '(nobody: Claire answers)',
    clarify,
    plan: plan === null ? '-' : `${plan.steps.length} steps`,
    task: task === null ? '-' : `task "${task.title ?? j(task)}"`.slice(0, 80),
    reminder: personal === null ? '-' : `personal ${j(personal).slice(0, 80)}`,
    file: file === null ? '-' : 'pdf',
    web: web === null ? '-' : 'web',
    callsOff: off === null ? '-' : j(off.target),
    rule: rule === null ? '-' : `${rule.kind}`,
    again: again === null ? '-' : j(again),
    unasked: { tasks: asksForTasks(text), writing: asksForWriting(text) },
  }
}

// Optional second argument: a marked local replica. The roster is then the REAL one - `speaker()` reading
// `app.who_knows_about` over `staff.expertise`, role words through `namedColleague` - instead of the offline fallback.
const dbName = process.argv[2]
const db = dbName === undefined ? null : await isolated(dbName)
const speaker = db === null ? null : (await import('../../src/handlers/instruction.ts')).speaker

for (const row of ROWS) {
  console.log(`\n=== ${JSON.stringify(row.said)}${row.forwarded ? '  [FORWARDED]' : ''}`)
  const alone = read(row.said, row.forwarded)
  console.log('  no thread  :', j(alone))
  if (db !== null && speaker !== null) {
    const who = await speaker(db, null, row.said, null, null, [], null)
    console.log(
      `  real roster: speaks=${who.slug} convened=${who.convened.join(',') || '(nobody)'} handoff=${j(who.handoff)} - ${who.reason.slice(0, 110)}`,
    )
  }
  if (row.thread !== '') {
    const elliptical = resolveElliptical(row.said, row.thread)
    const dangling = needsResolving(row.said)
    // The resolver is a model call; stand in for it with the obvious expansion and read THAT, as the handler does for proposals.
    const expanded = row.said.replace(/\b(this|that|it)\b/i, row.thread)
    const withThread = read(expanded, row.forwarded)
    console.log(
      `  thread     : needsResolving=${dangling} elliptical=${JSON.stringify(elliptical === row.said ? null : elliptical)}`,
    )
    console.log('  as resolved:', j(withThread), `<- text: ${JSON.stringify(expanded)}`)
  }
}
if (db !== null) await db.end()
process.exit(0)
