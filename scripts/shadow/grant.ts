/**
 * Shadow Grant — §15.
 *
 *   npm run shadow:grant
 *   npm run shadow:grant -- --arc arc.preference-continuity
 *   npm run shadow:grant -- --persona dictates --seed 12
 *
 * A bounded working session, not a test sweep. Over one session Shadow Grant
 * asks for work, follows up, changes his mind, establishes a preference and
 * expects it later, refers back, switches project, approves and declines,
 * walks into something the office cannot do, and asks what happened.
 *
 * ## It does not know what is under test
 *
 * §15 is explicit, and it is the whole reason this is a separate command
 * rather than a filtered corpus run. The arcs are chosen by what a person
 * would plausibly do in an hour, not by which mechanism is interesting, and
 * nothing in the session's own state records which dimension a turn is
 * probing. If it did, the session would drift towards the turns that score
 * well, which is the office being tested by somebody who wants it to pass.
 *
 * ## It ends with a sentence, not a number
 *
 * §15: *"End with a grounded narrative: what would have annoyed, confused or
 * misled Grant?"* That is a different question from "what percentage
 * passed", and it is the more useful one, because three of the four things
 * that genuinely annoy a person about an assistant - being asked something
 * you already said, being told something that is not true, and being
 * silently ignored - are invisible in an aggregate.
 *
 * Every complaint below is grounded in canonical evidence from the run and
 * quotes the turn that caused it. A narrative without the turn beside it is
 * a story.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import {
  ARC_RECIPES,
  type Arc,
  buildArc,
  reactionFor,
  reactionText,
} from '../../src/simulation/arcs.ts'
import type { Verdicts } from '../../src/simulation/dimensions.ts'
import { evaluate } from '../../src/simulation/evaluate.ts'
import { HiddenIntentLeak, sealed } from '../../src/simulation/isolation.ts'
import { GRANT_LIKE, personaBySlug } from '../../src/simulation/persona.ts'
import { derive, Seeded } from '../../src/simulation/random.ts'
import { utteranceOf } from '../../src/simulation/scenario.ts'
import { comprehensionDoor } from '../../src/simulation/transport.ts'
import { DEFAULT_WORLD } from '../../src/simulation/world.ts'

const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? fallback : (process.argv[i + 1] ?? fallback)
}

const persona = personaBySlug(arg('persona', 'grant-like')) ?? GRANT_LIKE
const seed = Number(arg('seed', '1'))
const only = arg('arc', '')
const recipes = only === '' ? ARC_RECIPES : ARC_RECIPES.filter((r) => r.id.includes(only))
const door = comprehensionDoor()

/** One thing that would have irritated a person, with the turn that caused it. */
interface Complaint {
  readonly kind: 'annoyed' | 'confused' | 'misled'
  readonly said: string
  readonly what: string
}

const complaints: Complaint[] = []
const allVerdicts: Verdicts[] = []
let turns = 0

console.log(`\nShadow Grant - a working session`)
console.log(`  as        ${persona.slug}  (${persona.about})`)
console.log(`  door      ${door.door}`)
console.log(`  seed      ${seed}`)
console.log(`  arcs      ${recipes.length}\n`)

for (const recipe of recipes) {
  const arc: Arc = buildArc(recipe, persona, DEFAULT_WORLD, seed)
  console.log(`── ${arc.id}`)
  console.log(`   ${arc.about}\n`)

  const history: { who: 'person' | 'office'; text: string }[] = []
  let officeAsked = false
  let hadAnswer = false

  for (const [i, turn] of arc.turns.entries()) {
    /*
      A reaction replaces the turn's own words when the office asked
      something. §8: the simulator reacts. A person who ignores a direct
      question and carries on with their script is not a person, and a
      harness that never answers a clarification never tests what happens
      after one.
    */
    const rng = new Seeded(derive(arc.seed, 'react', i))
    const reacting = officeAsked && (turn.reactsBy !== undefined || rng.chance(0.7))
    const reaction = turn.reactsBy ?? reactionFor(persona, rng)
    const words = reacting ? (turn.ifAsked ?? reactionText(reaction, rng)) : turn.say

    let sent: string
    try {
      sent = sealed(
        arc,
        turn,
        utteranceOf(arc.channel, words),
        history.map((h) => h.text),
      ).text
    } catch (e) {
      if (e instanceof HiddenIntentLeak) {
        console.log(`\n   HIDDEN INTENT LEAKED - this session is not reportable\n   ${e.message}\n`)
        process.exit(1)
      }
      throw e
    }

    const o = await door.ask(
      { text: sent, channel: arc.channel },
      { history, standing: arc.standing ?? [], hadAnswer },
    )
    turns++
    const v = evaluate({ scenario: { ...arc, compositions: [] }, turn, sent, observation: o })
    allVerdicts.push(v)

    const flags = [
      o.recognised ? '' : 'not understood',
      o.asked ? 'would ask' : '',
      o.learned ? 'learned a rule' : '',
      o.wouldFile ? 'would file something' : '',
    ].filter((x) => x !== '')
    console.log(`   ${reacting ? '(replying) ' : ''}"${sent}"`)
    console.log(`      ${flags.length === 0 ? 'read, nothing to do' : flags.join(' · ')}`)

    // ---- what would have irritated him -----------------------------------

    /*
      The same layer discipline the evaluator uses.

      A turn whose meaning IS the previous turn - "yes but take the last
      paragraph out", "hold off on that" - is resolved by the thread
      resolver, not by reading the message. Reporting "the office did not
      register a request" about one of those overstates what this door can
      see, and the first multi-persona run did exactly that: three of the
      clean control's complaints were about replies whose referent lives in
      a conversation the comprehension door does not carry.
      
      An instrument that declines to SCORE something and then COMPLAINS
      about it is inconsistent with itself, and the complaint is the half
      people read.
    */
    const layer = turn.intent.turnsOn ?? 'comprehension'
    /*
      And a REACTING turn is a reply whatever its family declares.

      The family says what the turn would be if the person said it cold.
      When the office has just asked something, the words become an answer
      to that question - "hold off on that", "the coaching thing" - and the
      referent is in the conversation, not the sentence. The first version
      gated on the family alone and still complained about three of those,
      because the family underneath was an ordinary comprehension case.
    */
    const judgeable = layer === 'comprehension' && !reacting

    if (
      judgeable &&
      !o.recognised &&
      ['task', 'task_changed', 'document'].includes(turn.intent.effect)
    ) {
      complaints.push({
        kind: 'annoyed',
        said: sent,
        what: 'asked for something to be done and the office did not register a request at all',
      })
    }
    if (
      judgeable &&
      o.reading === 'direct_command' &&
      !o.wouldFile &&
      ['task', 'task_changed'].includes(turn.intent.effect)
    ) {
      complaints.push({
        kind: 'misled',
        said: sent,
        what: 'the office took this as an instruction and nothing would be filed from it, which is the condition under which it goes on to say it will (#289)',
      })
    }
    if (turn.intent.effect === 'preference' && !o.learned) {
      complaints.push({
        kind: 'misled',
        said: sent,
        what: 'told the office how he wants things and it was not stored, so he will have to say it again and it will look like being ignored',
      })
    }
    // Not gated on the layer: whether a withdrawal is SEPARABLE is decided
    // by the clause splitter, which is comprehension, whatever the turn
    // otherwise turns on.
    if ((turn.intent.withdrawn?.length ?? 0) > 0 && o.clauses.length < 2) {
      complaints.push({
        kind: 'misled',
        said: sent,
        what: 'changed his mind mid-message and the withdrawal was not separable from what it withdrew',
      })
    }
    if (
      judgeable &&
      o.asked &&
      (turn.intent.alreadyKnows?.length ?? 0) > 0 &&
      (turn.intent.mayAskAbout?.length ?? 0) === 0
    ) {
      complaints.push({
        kind: 'annoyed',
        said: sent,
        what: 'would be asked something he had already said in this conversation',
      })
    }

    history.push({ who: 'person', text: sent })
    officeAsked = o.asked
    if (o.reply !== '') {
      history.push({ who: 'office', text: o.reply })
      hadAnswer = true
    }
  }
  console.log()
}

// ---------------------------------------------------------------------------

console.log('─'.repeat(72))
console.log('\nWHAT WOULD HAVE ANNOYED, CONFUSED OR MISLED GRANT\n')

if (complaints.length === 0) {
  console.log('  Nothing in this session. That is one session, on one door, at one seed.\n')
} else {
  for (const kind of ['misled', 'annoyed', 'confused'] as const) {
    const mine = complaints.filter((c) => c.kind === kind)
    if (mine.length === 0) continue
    console.log(`  ${kind.toUpperCase()} (${mine.length})`)
    // De-duplicated by what happened, because the same complaint eight times
    // is one complaint. A report that lists it eight times is one nobody
    // finishes reading.
    const seen = new Set<string>()
    for (const c of mine) {
      if (seen.has(c.what)) continue
      seen.add(c.what)
      const also = mine.filter((x) => x.what === c.what).length
      console.log(`    - ${c.what}${also > 1 ? `  (${also} times this session)` : ''}`)
      console.log(`        "${c.said.slice(0, 96)}"`)
    }
    console.log()
  }
}

const notUnderstood = allVerdicts.filter((v) =>
  v.findings.some((f) => f.dimension === 'understanding' && f.verdict === 'fail'),
).length

console.log(`  ${turns} turns across ${recipes.length} conversations.`)
console.log(`  ${notUnderstood} of them the office did not understand well enough to act on.`)
console.log(`  ${complaints.length} moments a person would have noticed.\n`)
console.log('  Nothing was sent anywhere. No project was touched. No model was called.\n')

mkdirSync('.out', { recursive: true })
const path = `.out/shadow-grant-${persona.slug}-${seed}.json`
writeFileSync(
  path,
  JSON.stringify({ persona: persona.slug, seed, complaints, verdicts: allVerdicts }, null, 2),
)
console.log(`  Full record: ${path}\n`)
