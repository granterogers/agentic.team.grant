/**
 * "Thanks, that is helpful." must not summon the strategy director.
 *
 * Found by the `roster` session's own control — *"CONTROL: a pleasantry
 * convenes nobody"* — which had been red for four days underneath a provider
 * outage the report was scoring as nine behavioural failures. With the outage
 * separated out, seven of those nine turns passed and this one stayed red for
 * a real reason.
 *
 * ## The chain
 *
 * `classifyIntent` had no rule for a bare acknowledgement, so it fell to the
 * final fallback and returned `recognised: false`. `pickRoster`'s unrecognised
 * branch then consulted the subject matcher — a TRIGRAM search, which always
 * finds something — and recorded, verbatim:
 *
 *     no intent rule matched this, but the subject is clearly strategy
 *
 * So Grant saying "thanks" convened a specialist to answer it.
 *
 * The unrecognised branch is not at fault: it exists so that a vague or
 * colloquial request whose subject is plain still reaches the right desk, and
 * CLAUDE.md records the 0%-scoring defect that made it necessary. What it
 * cannot do is tell a request nobody parsed from a message that contains no
 * request at all. That distinction belongs in `classifyIntent`, beside the
 * `recognised` flag that already separates a deliberate remark from noise.
 *
 * ## The direction that matters
 *
 * A false NEGATIVE here costs nothing new — the message falls through to
 * exactly today's behaviour. A false POSITIVE means a real instruction is
 * classed as a pleasantry, answered by the Chief of Staff, with nobody
 * convened and no work done. So most of this file is the second kind, and the
 * method is CLAUDE.md's: strip the acknowledgement and count what survives,
 * rather than enumerating the shapes a request can take — an enumeration that
 * "was wrong in both directions on its first run" the last time it was tried.
 */
import { describe, expect, it } from 'vitest'
import { classifyIntent, onlyAnAcknowledgement } from '../../src/agents/intent.ts'

describe('a message that only acknowledges', () => {
  it('recognises the exact sentence that convened the strategy director', () => {
    expect(onlyAnAcknowledgement('Thanks, that is helpful.')).toBe(true)
  })

  it('recognises the ordinary ways of saying it', () => {
    for (const said of [
      'Thanks',
      'thanks!',
      'Thank you',
      'Great, thanks',
      'Perfect, thank you.',
      'Cheers',
      'Got it',
      'Understood, thanks',
      'ok',
      'Okay, noted',
      'That makes sense',
      'Sounds good',
      'Brilliant, thanks very much',
      'yep',
    ]) {
      expect(onlyAnAcknowledgement(said), `"${said}" should acknowledge only`).toBe(true)
    }
  })

  it('CONTROL: a pleasantry in FRONT of an instruction is an instruction', () => {
    /*
      The expensive direction. `links.ts` already records this shape by name —
      *"add it" is an instruction with a pleasantry in front of it* — and
      classing one of these as a remark would lose the work silently.
    */
    for (const said of [
      'Thanks — can you check the pricing?',
      'Great, now draft the announcement email',
      'Perfect. Please add a task to chase the printers.',
      'Got it, and what does that do to the margin?',
      'Thanks. Remind me tomorrow to ring the venue.',
      'ok but the refund policy still needs a look',
    ]) {
      expect(onlyAnAcknowledgement(said), `"${said}" carries an instruction`).toBe(false)
    }
  })

  it('CONTROL: praise ABOUT something is not a bare acknowledgement', () => {
    // "Good work on the pricing model" names a subject, and a subject is the
    // thing the strip is designed to leave behind.
    expect(onlyAnAcknowledgement('Good work on the pricing model')).toBe(false)
    expect(onlyAnAcknowledgement('That is helpful for the interview corpus')).toBe(false)
  })

  it('CONTROL: an ordinary short request is not an acknowledgement', () => {
    for (const said of ['What is the margin?', 'Draft the email', 'Cancel that job', 'Any news?']) {
      expect(onlyAnAcknowledgement(said), `"${said}" is a request`).toBe(false)
    }
  })

  it('CONTROL: a long message is doing something else whatever it opens with', () => {
    const long = `Thanks, that is helpful. ${'Now about the pricing tiers and what they mean for us. '.repeat(3)}`
    expect(long.length).toBeGreaterThan(120)
    expect(onlyAnAcknowledgement(long)).toBe(false)
  })

  it('CONTROL: empty is not an acknowledgement', () => {
    // Nothing to acknowledge with. Returning true would make a lost message
    // look like a polite one.
    expect(onlyAnAcknowledgement('')).toBe(false)
    expect(onlyAnAcknowledgement('   ')).toBe(false)
  })
})

describe('and the classifier acts on it', () => {
  it('reads it as a RECOGNISED remark, so nobody is convened', () => {
    /*
      `recognised` is the load-bearing field. It is what sends this to the
      empty `thought` ceiling — §9's "trivial work spawns no subagents" —
      instead of to the unrecognised branch that consults the subject matcher.
    */
    const c = classifyIntent('Thanks, that is helpful.')
    expect(c.intent).toBe('thought')
    expect(c.recognised).toBe(true)
    expect(c.confident).toBe(true)
  })

  it('CONTROL: a pleasantry plus a request is still not a remark', () => {
    const c = classifyIntent('Thanks — can you check the pricing?')
    expect(c.recognised && c.intent === 'thought' && c.matched.includes('acknowledgement')).toBe(
      false,
    )
  })
})
