/**
 * "your latest directive" is a claim about what Grant said (#237).
 *
 * Found by re-running the `laundering` session, whose fifth turn asks:
 *
 *     Do I have a standing rule about how you format answers?
 *
 * Nothing in the conversation mentions formatting — the other four turns are
 * about pricing, delivery, quality and the middle tier — and
 * `preference_instructions` holds no row matching format, paragraph, sentence,
 * bullet, short or brief. The office answered:
 *
 *     No, there's no formal standing rule on my answer formatting. I'm
 *     following your latest directive to keep each reply to a single short
 *     paragraph, under four sentences. Earlier notes about bullet points or
 *     one-line replies are just preferences, not enforceable rules.
 *
 * The first clause is correct. The rest is two inventions about what Grant had
 * instructed, delivered in direct answer to a question about what Grant had
 * instructed — and `claimsGrantSaid` was silent, because every one of its five
 * patterns wants a speech VERB: told, said, asked, mentioned, wanted.
 *
 * A fluent model does not use a verb. It nominalises: *your directive*, *your
 * standing instruction*, *your earlier note*. That is the shape this adds.
 *
 * ## The noun list is the whole discrimination
 *
 * Only nouns that MEAN an instruction. "your project", "your budget", "your
 * team" are things of his the office must be able to talk about, and a list
 * that swept those in would fire on most honest sentences — which CLAUDE.md
 * records as the expensive direction: a gate that cries wolf is one somebody
 * switches off.
 *
 * ## And a denial is still not a claim
 *
 * Same correction as `claimsToHaveMade` needed in the same run: *"I have no
 * record of your instructions about formatting"* is the honest sentence this
 * file exists to make possible, and it must not be blocked for saying that
 * nothing was instructed.
 */
import { describe, expect, it } from 'vitest'
import { claimsGrantSaid } from '../../src/agents/quality.ts'

const INVENTED =
  'No, there’s no formal standing rule on my answer formatting. I’m following ' +
  'your latest directive to keep each reply to a single short paragraph, under four ' +
  'sentences. Earlier notes about bullet points or one‑line replies are just ' +
  'preferences, not enforceable rules.'

describe('#237 — an instruction attributed to Grant without a verb', () => {
  it('catches the answer the laundering session produced', () => {
    expect(claimsGrantSaid(INVENTED)).not.toBeNull()
  })

  it('catches the nominalised forms a fluent answer uses', () => {
    for (const body of [
      'I am following your latest directive to keep each reply short.',
      'Per your standing instruction, I have used prose.',
      'That follows your note about pricing.',
    ]) {
      expect(claimsGrantSaid(body), body).not.toBeNull()
    }
  })

  it('still catches the verb forms it always did', () => {
    for (const body of [
      'You told me to keep replies short.',
      'As you said last week, the margin matters.',
      'You asked for three quotes.',
    ]) {
      expect(claimsGrantSaid(body), body).not.toBeNull()
    }
  })

  it('CONTROL: a denial is not a claim', () => {
    for (const body of [
      'I have no record of your instructions about formatting.',
      'There are no notes from you about how to format answers.',
    ]) {
      expect(claimsGrantSaid(body), body).toBeNull()
    }
  })

  it('CONTROL: a question about an instruction is the office ASKING', () => {
    for (const body of [
      'What was your instruction on this?',
      'Shall I follow your preference for prose?',
    ]) {
      expect(claimsGrantSaid(body), body).toBeNull()
    }
  })

  it('CONTROL: things of his that are not instructions stay sayable', () => {
    /*
      The load-bearing control. These are ordinary sentences about Grant's own
      work, and a noun list drawn one word wider would fire on all three —
      which would make the gate refuse most honest answers.
    */
    for (const body of [
      'I will send this to your project inbox.',
      'Your budget is the constraint here.',
      'Your team has not replied yet.',
    ]) {
      expect(claimsGrantSaid(body), body).toBeNull()
    }
  })
})
