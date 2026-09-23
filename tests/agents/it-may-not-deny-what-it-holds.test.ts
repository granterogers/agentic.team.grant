/**
 * The office may not deny a list it was just handed (#342).
 *
 * 23 September. Grant asked *"what projects have we got"* six times. Five
 * answers listed his four dashboard projects. The sixth said:
 *
 *   "I can't list any projects — I have no record of them in our database.
 *    I searched the internal records and found nothing matching a project
 *    list. If you can point me to the source (Notion page, Drive folder,
 *    etc.) I'll pull the current project names and send them over."
 *
 * Same question, same day, same scope, same model, same pipeline — and all
 * four project names were in the prompt that produced it.
 *
 * Every existing gate permitted it, defensibly. `assertsRecordsUnseen` asks
 * whether a lookup RAN, and `projects` was both consulted and complete, so
 * the office was entitled to speak. `EPISTEMIC` exempts any sentence framed
 * as what the office knows, which is exactly how a denial is phrased. Neither
 * compares what was SAID against the state that was SUPPLIED.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { deniesWhatItHolds, metadataProblems } from '../../src/agents/quality.ts'

/** His real answer, 2026-09-23 16:37, job 2169d782. */
const THE_DENIAL =
  "I can't list any projects – I have no record of them in our database.\n\n" +
  'I searched the internal records and found nothing matching a project list. ' +
  "If you can point me to the source (Notion page, Drive folder, etc.) I'll " +
  'pull the current project names and send them over.'

/** His real answer, 2026-09-23 12:49, to the identical question. */
const THE_GOOD_ONE =
  'These are the four active projects:\n\n1. Legacy Coaching Course\n2. AI Team HQ Test\n' +
  '3. learning my AI team\n4. AI learning\n\nUnnamed is just a placeholder, not an actual project.'

describe('denying a census it was handed', () => {
  it('refuses the answer he actually received', () => {
    expect(deniesWhatItHolds(THE_DENIAL, { projects: 4 }, ['projects'])).not.toBeNull()
  })

  it('CONTROL: leaves the four answers that were right', () => {
    expect(deniesWhatItHolds(THE_GOOD_ONE, { projects: 4 }, ['projects'])).toBeNull()
  })

  /*
    THE ASYMMETRY, and the whole reason this is safe to run on every turn.

    It can only fire when the census is NON-EMPTY. An office that genuinely
    holds nothing has nothing to deny, so an honest absence can never be
    suppressed — 0304's rule, in a gate.
  */
  it('says nothing when the office really does hold none', () => {
    expect(deniesWhatItHolds(THE_DENIAL, { projects: 0 }, ['projects'])).toBeNull()
    expect(deniesWhatItHolds(THE_DENIAL, {}, ['projects'])).toBeNull()
  })

  it('and nothing when the domain is not held WHOLE', () => {
    // A search is not a census. `documents` is deliberately never complete,
    // so "there is nothing in our documents about renewals" stays sayable.
    expect(deniesWhatItHolds(THE_DENIAL, { projects: 4 }, [])).toBeNull()
    expect(
      deniesWhatItHolds(
        'I have no record of anything in our documents about renewals.',
        { documents: 9 },
        ['documents'],
      ),
    ).toBeNull()
  })

  /*
    THE TWO REAL FALSE POSITIVES, kept as tests.

    Measured against 133 real delivered answers, the first version fired three
    times and two were wrong — both matching the SINGULAR "project" used as a
    modifier. Refusing these is the expensive direction: a missed denial is one
    bad answer, a false refusal is every good answer that mentions the word.
  */
  it('CONTROL: does not refuse a good answer that asks which project he means', () => {
    expect(
      deniesWhatItHolds(
        "I can't see any research item in our records, so I need the project or file " +
          'name (or link) before I can get Fiona onto it.',
        { projects: 4 },
        ['projects'],
      ),
    ).toBeNull()
  })

  it('CONTROL: nor one about a named thing inside the project data', () => {
    expect(
      deniesWhatItHolds(
        'I have no record of "the pricing review" in the indexed project data — nothing shows up.',
        { projects: 4 },
        ['projects'],
      ),
    ).toBeNull()
  })

  it('reaches the coherence gate, which is what refuses the turn', () => {
    const problems = metadataProblems({
      body: THE_DENIAL,
      confidence: 'medium',
      consulted: { complete: ['projects'], consulted: ['projects'] },
      contradictions: null,
      evidence: 'inferred',
      grounding: 'The dashboard projects open right now, 4 of them: A, B, C, D.',
      holds: { projects: 4 },
      sources: [],
    })
    expect(problems.some((p) => p.field === 'body')).toBe(true)
  })

  it('CONTROL: and the good answer passes the same gate', () => {
    const problems = metadataProblems({
      body: THE_GOOD_ONE,
      confidence: 'medium',
      consulted: { complete: ['projects'], consulted: ['projects'] },
      contradictions: null,
      evidence: 'inferred',
      grounding: 'The dashboard projects open right now, 4 of them: A, B, C, D.',
      holds: { projects: 4 },
      sources: [],
    })
    expect(problems).toHaveLength(0)
  })
})

/**
 * And the handler actually SUPPLIES the census.
 *
 * The gate is inert without it, and silently: `holds` is optional, so a
 * handler that stops passing it makes every check above keep passing while
 * the product stops being guarded. That sabotage was run and stayed green
 * until this block existed — the vacuous-coverage shape CLAUDE.md records
 * three times in one session.
 */
describe('the census reaches the gate', () => {
  const handler = readFileSync('src/handlers/instruction.ts', 'utf8')

  it('counts the open projects, not the reserved bucket', () => {
    // The wired EXPRESSION, not the word `holds`: an import or a key name
    // survives a sabotage that guts the value.
    expect(handler).toMatch(/holds:\s*\{\s*projects:\s*openNow\.filter\(/)
    expect(handler).toMatch(
      /holds:\s*\{\s*projects:\s*openNow\.filter\(\(p\) => !p\.reserved\)\.length/,
    )
  })

  it('sits with the rest of the provenance metadata, not somewhere it cannot reach', () => {
    /*
      Bounded at BOTH ends. CLAUDE.md's slice trap: a window opened at one
      anchor and left to run on was satisfied by a neighbouring function that
      happened to contain the words.
    */
    const from = handler.indexOf('consulted: { consulted: consulted(shown)')
    expect(from).toBeGreaterThan(-1)
    const to = handler.indexOf('toolNames:', from)
    expect(to).toBeGreaterThan(from)
    expect(handler.slice(from, to)).toMatch(/holds:\s*\{\s*projects:/)
  })
})
