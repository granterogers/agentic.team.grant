/**
 * The roughener changes how a sentence arrives, never what it asks for.
 *
 * That claim is the reason the rest of the harness can trust a score: if
 * messiness could quietly delete "Kevin" or turn "don't" into "do", the
 * scenario's recorded intent would describe a sentence nobody sent, and the
 * office would be marked wrong for answering the one it actually received.
 *
 * CLAUDE.md: *"a comment claiming a property is worth nothing without a
 * check behind it"* — recorded four separate times, once about a credential.
 * So the property is checked here across the whole cross-product of personas
 * and a few hundred seeds rather than on one hand-picked example, because a
 * single example proves a single example.
 */

import { describe, expect, it } from 'vitest'
import { GRANT_LIKE, PERSONAS, PRECISE } from '../../src/simulation/persona.ts'
import { derive, Seeded } from '../../src/simulation/random.ts'
import { contentWords, roughen } from '../../src/simulation/roughen.ts'

const SENTENCES = [
  'Can you remind me to call Kevin about the quote on Thursday?',
  'What did cutting the price by 15% do to the margin on Legacy Coaching?',
  "Please don't contact anyone, but find out what they charge.",
  "Add a task to chase the £4,200 invoice and tell me when it's done.",
  'I want the summary in bullet points from now on, thanks.',
]

describe('roughen is deterministic', () => {
  it('gives the same sentence for the same seed, every time', () => {
    for (const s of SENTENCES) {
      const a = roughen(s, GRANT_LIKE, 12345)
      const b = roughen(s, GRANT_LIKE, 12345)
      expect(a.text).toBe(b.text)
      expect(a.applied).toEqual(b.applied)
    }
  })

  it('gives different sentences for different seeds, so it is not inert', () => {
    const seen = new Set<string>()
    for (let seed = 0; seed < 60; seed++) {
      seen.add(roughen(SENTENCES[0] as string, GRANT_LIKE, seed).text)
    }
    // A mutator producing one string for sixty seeds is a mutator that does
    // nothing, and would report full coverage while testing one sentence.
    expect(seen.size).toBeGreaterThan(5)
  })

  it('derived seeds decorrelate turns, so every turn is not roughened alike', () => {
    const a = derive(99, 'scenario-a', 0)
    const b = derive(99, 'scenario-b', 0)
    const c = derive(99, 'scenario-a', 1)
    expect(new Set([a, b, c]).size).toBe(3)
  })
})

describe('roughen preserves meaning', () => {
  it('never loses a content word, across every persona and 200 seeds', () => {
    const losses: string[] = []
    for (const persona of PERSONAS) {
      for (const sentence of SENTENCES) {
        const wanted = contentWords(sentence)
        for (let seed = 0; seed < 200; seed++) {
          const { text, applied } = roughen(sentence, persona, seed)
          const got = new Set(contentWords(text))
          // A typo respells a word, so a respelled word is still present in
          // spirit but not by string. Where typos fired, require the COUNT
          // to hold; where they did not, require every word by name.
          if (applied.includes('typos')) {
            if (contentWords(text).length < wanted.length) {
              losses.push(`${persona.slug} seed ${seed}: count fell — ${text}`)
            }
          } else {
            for (const w of wanted) {
              if (!got.has(w)) losses.push(`${persona.slug} seed ${seed}: lost "${w}" — ${text}`)
            }
          }
        }
      }
    }
    expect(losses.slice(0, 5)).toEqual([])
  })

  it('never turns a negation into its opposite', () => {
    // The single most dangerous mutation available: "don't contact anyone"
    // becoming "do contact anyone" would invert a negative constraint, and
    // §10 makes a lost negative constraint a HARD FAILURE.
    for (const persona of PERSONAS) {
      for (let seed = 0; seed < 300; seed++) {
        const { text } = roughen("Please don't contact anyone about this.", persona, seed)
        expect(text).toMatch(/\b(don't|dont)\b/)
      }
    }
  })

  it('never moves a decimal point', () => {
    // The finding that justified the whole meaning-preservation check.
    // Stripping punctuation used to reach inside numbers, so a voice-shaped
    // message about £4.20 arrived as £420 - a hundredfold error in a figure
    // the person stated, which the evaluator would then have asserted an
    // answer against. Comma removal is harmless; this is not.
    for (const persona of PERSONAS) {
      for (let seed = 0; seed < 300; seed++) {
        const { text } = roughen('The unit price is £4.20 and the fee is 1.5%.', persona, seed)
        expect(text).toContain('4.20')
        expect(text).toContain('1.5%')
      }
    }
  })

  it('never alters a figure', () => {
    for (const persona of PERSONAS) {
      for (let seed = 0; seed < 300; seed++) {
        const { text } = roughen(
          'Cut the price by 15% and check the £4,200 invoice.',
          persona,
          seed,
        )
        expect(text).toContain('15%')
        // Not the literal "4,200": dropping a thousands separator keeps the
        // value, and asserting the literal would be the wording lock
        // CLAUDE.md records five times. The value is what must survive.
        expect(text.replace(/,/g, '')).toContain('4200')
      }
    }
  })
})

describe('personas differ, and the clean one is genuinely clean', () => {
  it('leaves the precise persona untouched', () => {
    for (const s of SENTENCES) {
      for (let seed = 0; seed < 50; seed++) {
        const { text, applied } = roughen(s, PRECISE, seed)
        expect(applied).toEqual([])
        expect(text).toBe(s)
      }
    }
  })

  it('actually roughens the grant-like persona most of the time', () => {
    let touched = 0
    for (let seed = 0; seed < 200; seed++) {
      if (roughen(SENTENCES[0] as string, GRANT_LIKE, seed).applied.length > 0) touched++
    }
    // Not all of them: §6 is explicit that not every message is maximally
    // messy, and a persona that mangled everything would be a different
    // (easier) test than the real one.
    expect(touched).toBeGreaterThan(120)
    expect(touched).toBeLessThan(200)
  })
})

describe('the seeded source is uniform enough to trust', () => {
  it('chance(p) lands near p', () => {
    const rng = new Seeded(7)
    let hits = 0
    for (let i = 0; i < 20_000; i++) if (rng.chance(0.3)) hits++
    expect(hits / 20_000).toBeGreaterThan(0.28)
    expect(hits / 20_000).toBeLessThan(0.32)
  })

  it('pick returns undefined for an empty list rather than throwing', () => {
    expect(new Seeded(1).pick([])).toBeUndefined()
  })
})
