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

const runToken = Math.random().toString(36).slice(2, 10)
const door = canonicalDoor({ runToken, deadlineMs: Number(arg('deadline', '240')) * 1000 })
if (!door.reachable) {
  console.log(`\n  ${door.blockedBecause ?? 'unreachable'}`)
  console.log(firstRunChecklist())
  process.exit(0)
}

console.log(`\n  run token   ${runToken}`)
console.log(`  said        ${JSON.stringify(said)}\n`)

const o = await door.ask(
  { text: said, channel: 'teamhq' },
  { conversation: `probe-${runToken}`, history: [], standing: [], hadAnswer: false },
)

console.log(`  reading     ${o.reading === '' ? '(none)' : o.reading}`)
console.log(`  recognised  ${String(o.recognised)}`)
console.log(`  asked       ${String(o.asked)}`)
console.log(`  would file  ${String(o.wouldFile)}`)
console.log(`  ms          ${String(o.ms)}  model calls ${String(o.modelCalls)}\n`)
console.log(`  REPLY\n    ${o.reply.replace(/\n/g, '\n    ')}\n`)
console.log(`  CANONICAL EFFECTS`)
console.log(`    ${JSON.stringify(o.effects, null, 2).replace(/\n/g, '\n    ')}\n`)
