/**
 * One sentence, through the real office, with the canonical effects.
 *
 * §10's whole discipline in one command: what the office SAYS is never
 * evidence that anything happened, so this prints the reply beside the rows
 * the correlation family actually produced. Used to confirm a fix that
 * offline evidence has already established - not to find one, because one
 * live turn is one sample of a stochastic system.
 *
 *   npm run shadow:probe-live -- "stick something down so I do not forget to ring Kevin"
 *
 * Harness-attributed and undeliverable by construction: the door stamps
 * `synthetic` at the inbound command (0541/0542), which the trigger carries
 * onto the job and its children, and 0523's delivery guard refuses the send.
 */

import { canonicalDoor, firstRunChecklist } from '../../src/simulation/transport.ts'

const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? fallback : (process.argv[i + 1] ?? fallback)
}

const said = process.argv.slice(2).filter((a) => !a.startsWith('--'))[0] ?? ''
if (said === '') {
  console.log('\n  Give it a sentence.\n')
  process.exit(1)
}

/*
  The run token is nameable, so two invocations can share one THREAD.

  The canonical door builds its chat as `shadow-<runToken>-<conversation>`,
  and the token is in there deliberately: without it two harness runs would
  thread into each other, which is the cross-scenario contamination fixed on
  21 September. But it also means `--conversation` alone cannot join two
  separate probe runs into one conversation - each invocation minted a fresh
  token, so a deliberate two-turn sequence produced two chats.

  That was found by a follow-up probe reading as a product defect: the office
  asked for a task title it had itself proposed one turn earlier, and the
  honest explanation is that it had no thread to remember it from. Asking
  again with no history is CORRECT.

  Passing the token explicitly keeps the containment property - it is still
  in the chat name, still in `requested_by` - and makes a multi-turn sequence
  expressible.
*/
const runToken = arg('token', Math.random().toString(36).slice(2, 10))
const door = canonicalDoor({ runToken, deadlineMs: Number(arg('deadline', '240')) * 1000 })
if (!door.reachable) {
  console.log(`\n  ${door.blockedBecause ?? 'unreachable'}`)
  console.log(firstRunChecklist())
  process.exit(0)
}

console.log(`\n  run token   ${runToken}`)
console.log(`  said        ${JSON.stringify(said)}\n`)

/*
  The conversation is nameable, so two probes can share one or deliberately
  NOT share one.

  Live multi-turn ARCS are throughput-bound: a turn that drafts something
  spends minutes, and four of them outrun a foreground session. But the
  continuity properties do not need slow turns - they need two turns and
  control over which conversation each belongs to:

    - a preference is a LESSON. It must still hold in a conversation that
      has never heard it said.
    - a bare referent is a THREAD fact. After a boundary there is nothing
      to resolve it against and the office should ASK rather than guess.

  Those have opposite right answers and only a named conversation tells
  them apart.
*/
const conversation = arg('conversation', `probe-${runToken}`)
console.log(`  chat        ${conversation}\n`)

const o = await door.ask(
  { text: said, channel: 'teamhq' },
  { conversation, history: [], standing: [], hadAnswer: false },
)

console.log(`  reading     ${o.reading === '' ? '(none)' : o.reading}`)
console.log(`  recognised  ${String(o.recognised)}`)
console.log(`  asked       ${String(o.asked)}`)
console.log(`  would file  ${String(o.wouldFile)}`)
console.log(`  ms          ${String(o.ms)}  model calls ${String(o.modelCalls)}\n`)
console.log(`  REPLY\n    ${o.reply.replace(/\n/g, '\n    ')}\n`)
console.log(`  CANONICAL EFFECTS`)
console.log(`    ${JSON.stringify(o.effects, null, 2).replace(/\n/g, '\n    ')}\n`)
