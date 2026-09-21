/**
 * Surface messiness — the way a sentence comes out, not what it says.
 *
 * §6 asks for filler, false starts, shorthand, typos, missing punctuation and
 * fragments. This applies those, deterministically from a seed, so any
 * roughened sentence can be regenerated exactly.
 *
 * ## The line this file will not cross
 *
 * Everything here is MEANING-PRESERVING. A typo respells a word; it never
 * turns one word into a different real word. Filler adds sounds nobody
 * parses. Dropping an apostrophe from "don't" leaves "dont", which is the
 * same word badly typed — dropping the "n't" would be the opposite
 * instruction, and a mutator that could do that would silently make the
 * scenario's recorded intent wrong while the run still reported a score.
 *
 * The structural mutations §6 also asks for — changing your mind mid-message,
 * two requests in one, "no, the other project", an afterthought — are NOT
 * here, deliberately. Each of them changes what the person is asking for, so
 * each has to be applied where the hidden intent can be updated in the same
 * breath. That is the generator's job (`src/simulation/compose.ts`). Putting
 * them here would produce a message saying "actually forget that" over a
 * scenario still expecting the task to be created, and the harness would
 * report the office failing for doing exactly the right thing.
 *
 * CLAUDE.md records that pattern costing real time repeatedly, under the
 * heading *"a harness expectation is a claim about the product and is wrong
 * about half the time at first"*. The separation below is how this harness
 * avoids being wrong in that specific way by construction.
 */

import type { Persona } from './persona.ts'
import { Seeded } from './random.ts'

/** Openers that carry no content. Safe to prepend to anything. */
const FILLER = ['so', 'right so', 'ok so', 'yeah so', 'um', 'hey so', 'quick one', 'right'] as const

/**
 * A false start: the speaker begins, stops, and begins again.
 *
 * Built from the sentence's OWN first words, because that is what a false
 * start is — "can you, can you just" — rather than a canned phrase. Purely
 * additive, so the sentence that follows is untouched.
 */
const falseStartOf = (text: string, rng: Seeded): string => {
  const words = text.split(/\s+/)
  const take = Math.min(words.length, 2 + rng.int(2))
  const stub = words.slice(0, take).join(' ')
  return `${stub}${rng.chance(0.5) ? ',' : ''} ${rng.chance(0.3) ? 'sorry, ' : ''}${text}`
}

/**
 * Shorthand substitutions, each an exact synonym in this register.
 *
 * Only pairs where a person would read either identically. "asap" for "as
 * soon as possible" qualifies; "tmrw" for "tomorrow" qualifies; anything that
 * loses a distinction does not appear.
 */
const SHORTHAND: readonly (readonly [RegExp, string])[] = [
  [/\bplease\b/gi, 'pls'],
  [/\bas soon as possible\b/gi, 'asap'],
  [/\bwith\b/gi, 'w/'],
  [/\band\b/gi, '&'],
  [/\bthanks\b/gi, 'thx'],
  [/\btomorrow\b/gi, 'tmrw'],
  [/\bnumber\b/gi, 'no.'],
  [/\babout\b/gi, 're'],
]

/** Apostrophes dropped. Still the same word, still unambiguous. */
const LOOSE: readonly (readonly [RegExp, string])[] = [
  [/\bdon't\b/gi, 'dont'],
  [/\bwon't\b/gi, 'wont'],
  [/\bcan't\b/gi, 'cant'],
  [/\bdidn't\b/gi, 'didnt'],
  [/\bisn't\b/gi, 'isnt'],
  [/\bthat's\b/gi, 'thats'],
  [/\bit's\b/gi, 'its'],
  [/\bi'm\b/gi, 'im'],
  [/\bi've\b/gi, 'ive'],
  [/\bwe're\b/gi, 'were'],
  [/\blet's\b/gi, 'lets'],
]

/**
 * Words a typo may not touch.
 *
 * Short words, because respelling a three-letter word usually produces a
 * different three-letter word — "not" into "nto" is a typo, "not" into "no"
 * is the opposite instruction. And numerals, because a typo in a figure is
 * not messiness, it is a different request, and the harness would then be
 * asserting against a number the person never said.
 */
const NEVER_RESPELL = new Set([
  "don't",
  'dont',
  "won't",
  'wont',
  "can't",
  'cant',
  "isn't",
  'isnt',
  "didn't",
  'didnt',
  "doesn't",
  'doesnt',
  "shouldn't",
  'shouldnt',
  "wouldn't",
  'wouldnt',
  "couldn't",
  'couldnt',
  "haven't",
  'havent',
  "hasn't",
  'hasnt',
  'not',
  'never',
  'no',
  'nothing',
  'none',
  'without',
  'stop',
  'cancel',
  'instead',
])

/**
 * Words a typo may not touch.
 *
 * Short words, because respelling a three-letter word usually produces a
 * different three-letter word -- "not" into "nto" is a typo, "not" into "no"
 * is the opposite instruction. Numerals, because a typo in a figure is not
 * messiness, it is a different request. And negations by name, whatever their
 * length.
 *
 * The negation list is belt and braces: no respelling of "don't" that this
 * operator can produce actually reads as "do", and relying on that argument
 * is the wrong kind of safe. A lost negative constraint is a HARD FAILURE in
 * §10, so the one word class where a typo is not worth the risk is the one
 * where inverting it would be undetectable and catastrophic.
 */
const untypoable = (w: string): boolean =>
  w.length < 5 || /\d/.test(w) || NEVER_RESPELL.has(w.toLowerCase().replace(/[^a-z']/g, ''))

/**
 * One keystroke gone wrong, in the middle of a word.
 *
 * The middle specifically: first and last letters carry most of a word's
 * recognisability, and a human typo overwhelmingly lands between them. It
 * also keeps the result unambiguous, which is the property that matters —
 * "recieve" is obviously "receive"; "eeceive" is a puzzle.
 */
const typo = (w: string, rng: Seeded): string => {
  if (untypoable(w)) return w
  const i = 1 + rng.int(w.length - 2)
  const kind = rng.int(3)
  if (kind === 0) {
    // transpose with the next letter
    const j = Math.min(i + 1, w.length - 1)
    const a = w[i]
    const b = w[j]
    return a === undefined || b === undefined ? w : w.slice(0, i) + b + a + w.slice(j + 1)
  }
  if (kind === 1) return w.slice(0, i) + w[i] + w.slice(i) // doubled letter
  return w.slice(0, i) + w.slice(i + 1) // dropped letter
}

/**
 * Punctuation dropped, except where it is load-bearing.
 *
 * The lookaround keeps any mark that sits BETWEEN two digits, because there
 * it is not punctuation at all -- it is part of the number. Stripping it
 * turns £4.20 into £420 and 1,500 into 1500: the second is harmless and the
 * first is a hundredfold error in a figure the person stated, which would
 * then be asserted against an answer about a different amount entirely.
 *
 * Found by the meaning-preservation check rather than by reading this
 * function, which is the argument for having the check.
 */
const stripPunctuation = (text: string): string =>
  text
    .replace(/(?<!\d)([.!?,;:])|([.!?,;:])(?!\d)/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()

export interface Roughened {
  readonly text: string
  /** Which operators fired. Recorded so a failure names its own cause. */
  readonly applied: readonly string[]
}

/**
 * Roughen a clean sentence the way this persona would say it.
 *
 * Deterministic in (`text`, `persona`, `seed`). Same three in, same sentence
 * out, on any machine — which is what makes a failure reproducible rather
 * than a story about something that happened once.
 */
export const roughen = (text: string, persona: Persona, seed: number): Roughened => {
  const rng = new Seeded(seed)
  const applied: string[] = []
  let out = text

  if (rng.chance(persona.filler)) {
    const f = rng.pick(FILLER)
    if (f !== undefined) {
      out = `${f} ${out}`
      applied.push('filler')
    }
  }

  if (rng.chance(persona.falseStart)) {
    out = falseStartOf(out, rng)
    applied.push('false-start')
  }

  if (rng.chance(persona.shorthand)) {
    const before = out
    for (const [re, to] of SHORTHAND) out = out.replace(re, to)
    if (out !== before) applied.push('shorthand')
  }

  if (rng.chance(persona.looseApostrophes)) {
    const before = out
    for (const [re, to] of LOOSE) out = out.replace(re, to)
    if (out !== before) applied.push('loose-apostrophes')
  }

  if (persona.typos > 0) {
    const words = out.split(' ')
    let hit = false
    // Per word, so a long message picks up more typos than a short one —
    // which is how typing works, and a per-message coin flip is not.
    const mutated = words.map((w) => {
      if (!rng.chance(persona.typos) || untypoable(w)) return w
      hit = true
      return typo(w, rng)
    })
    if (hit) {
      out = mutated.join(' ')
      applied.push('typos')
    }
  }

  if (rng.chance(persona.unpunctuated)) {
    out = stripPunctuation(out)
    applied.push('unpunctuated')
  }

  return { text: out, applied }
}

/**
 * The content words of a sentence, for proving a mutation kept its meaning.
 *
 * Function words are excluded because several operators legitimately move or
 * add them. What must survive is the nouns, verbs and numbers — if "Kevin",
 * "quote" or "15" can vanish, the roughener is changing the request rather
 * than the delivery, and every score downstream is about a sentence nobody
 * wrote.
 */
const FUNCTION_WORDS = new Set([
  'a',
  'an',
  'the',
  'to',
  'of',
  'in',
  'on',
  'at',
  'for',
  'and',
  'or',
  'but',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'it',
  'that',
  'this',
  'with',
  'as',
  'by',
  'from',
  'so',
  'if',
  'then',
  'me',
  'my',
  'you',
  'your',
  'we',
  'our',
  'i',
  'can',
  'could',
  'would',
  'should',
  'will',
  'do',
  'does',
  'did',
  'just',
  'please',
  'pls',
  'um',
  'ok',
  'right',
  'yeah',
  'hey',
  'quick',
  'one',
  'sorry',
  'about',
  're',
  'w/',
  '&',
  'thanks',
  'thx',
])

export const contentWords = (text: string): readonly string[] =>
  text
    .toLowerCase()
    // Apostrophes removed BEFORE splitting, so "don't" and "dont" are one
    // token. Dropping an apostrophe is a delivery change and the whole point
    // of this function is to compare meaning across delivery changes -- a
    // comparison that called those two different words would report 1,253
    // meaning losses in a mutator that had not lost any.
    .replace(/['\u2019]/g, '')
    .replace(/[^a-z0-9%£$\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w !== '' && !FUNCTION_WORDS.has(w.replace(/['\u2019]/g, '')))
