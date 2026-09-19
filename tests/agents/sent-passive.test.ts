/**
 * "The team have been asked, on Slack" is a claim to have sent something.
 *
 * The third sibling in one run to have the same blindness. `claimsToHaveMade`
 * missed a fluent fabrication because a real title outran its character
 * window; `claimsGrantSaid` missed an invented instruction because it wanted a
 * speech verb and a fluent model nominalises; and this one wanted a
 * first-person "I".
 *
 * Measured against the office's own phrasing, all three of these walked
 * straight through:
 *
 *     The team have been asked, on Slack, about what is blocking onboarding
 *     A note went out to the supplier this morning
 *     The supplier has been emailed about the revised quote
 *
 * The pattern is now clear enough to state: **these gates were built from the
 * terse examples that were caught, and a model writing naturally uses the
 * passive.** `claimsToHaveRead` and `promisesToReachOut` are blind in the same
 * way and are NOT fixed here — see the Issue — because neither has the safety
 * argument this one does.
 *
 * ## Why widening is safe HERE and nowhere else
 *
 * This function's own docstring gives the reason: an agent answering an
 * instruction has **no outbound path at all**. So a claim that somebody was
 * contacted is false at the moment it is written, by construction — there is
 * nothing it could ever be true of. `claimsToHaveRead` must stay narrow
 * precisely because reading IS something the office does.
 *
 * ## The channel is the whole discrimination
 *
 * The first draft matched a bare passive and fired on the two sentences it
 * must never touch. **"Emma has been asked to look at the margin"** is #128's
 * hand-off, which is REAL — convening a specialist IS asking the team, and
 * CLAUDE.md says refusing it would push the office towards saying less about
 * what it actually does. **"You have been asked about this before"** is the
 * office addressing Grant and claiming nothing about anybody outside.
 *
 * What the office cannot do is reach OUTSIDE, so the claim must name the
 * outside: a channel word, or a verb that is itself a channel. `emailed`,
 * `messaged`, `pinged` carry it; `asked`, `contacted`, `notified` do not.
 */
import { describe, expect, it } from 'vitest'
import { claimsToHaveSent } from '../../src/agents/quality.ts'

describe('#237 — a send claimed in the passive', () => {
  it('catches the passive forms that walked through', () => {
    for (const body of [
      'The team have been asked, on Slack, about what is blocking onboarding this week.',
      'A note went out to the supplier this morning asking for the revised quote.',
      'The supplier has been emailed about the revised quote.',
      'The roofer has been contacted via email about the quote.',
    ]) {
      expect(claimsToHaveSent(body), body).not.toBeNull()
    }
  })

  it('still catches the first-person forms it always did', () => {
    expect(claimsToHaveSent('I posted a message to the team.')).not.toBeNull()
    expect(claimsToHaveSent('I have emailed the supplier.')).not.toBeNull()
  })

  it('CONTROL: a hand-off to a colleague is REAL and must not be refused', () => {
    /*
      The load-bearing control. §9's hand-off means convening a specialist
      genuinely is asking the team, so these sentences are TRUE — and a gate
      that refused them would make the office stop describing work it really
      did.
    */
    for (const body of [
      'Emma has been asked to look at the margin.',
      'Emma has been asked to review the pricing and will report back.',
      'Grace has been notified of the risk register change.',
    ]) {
      expect(claimsToHaveSent(body), body).toBeNull()
    }
  })

  it('CONTROL: the office addressing Grant claims nothing about anybody else', () => {
    expect(claimsToHaveSent('You have been asked about this before.')).toBeNull()
  })

  it('CONTROL: a plan, an offer, a question and a denial are all left alone', () => {
    for (const body of [
      "I'll post it on Slack.",
      'Shall I ask the team?',
      'I can email the supplier if you like.',
      'The question has not been asked yet.',
    ]) {
      expect(claimsToHaveSent(body), body).toBeNull()
    }
  })
})
