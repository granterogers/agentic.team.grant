/**
 * A repeated delegation says what is true: somebody is already on it. It claims no hand-off it did not make.
 *
 * Version 1 acceptance, journey H3a: the same request sent twice, the model not recognising the repeat. The structural
 * guard (`app.enqueue_child_once`) held: no second team. But it hands back the FIRST turn's live child, and the handler
 * pushed that job into `branchesStarted`, so the second turn (a) registered a fan-in over jobs that are not its
 * children, which `app.fan_in_over` refuses ("job is not a child of this one"), recorded as an impediment as if it were
 * an event, and (b) opened its reply "I have not done this yet". The replica proof (journey H3a/H3d of
 * scripts/isolated/v1-acceptance-b.ts) drives the real handler; these are the pure parts and the wired call.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { wantsAnotherGo } from '../../src/agents/again.ts'
import { alreadyWithSentence } from '../../src/agents/already.ts'

describe('the sentence for a repeat that found the team already on it', () => {
  it('names one, two or three people, and says nothing was started', () => {
    expect(alreadyWithSentence(['Daniel'])).toMatch(/^Daniel is already on that/)
    expect(alreadyWithSentence(['Daniel', 'Emma'])).toMatch(/^Daniel and Emma are already on that/)
    expect(alreadyWithSentence(['Daniel', 'Emma', 'Ruby'])).toMatch(
      /^Daniel, Emma and Ruby are already on that/,
    )
    expect(alreadyWithSentence(['Daniel'])).toMatch(/I have not started it a second time/)
  })
  it('claims no hand-off and opens with no "not done" line', () => {
    const s = alreadyWithSentence(['Daniel', 'Emma'])
    expect(s).not.toMatch(/handed (this|it) on|have handed|will come back|have not done this yet/i)
  })
  it('offers the way to another look, because refusing to duplicate is only safe when asking is easy', () => {
    expect(alreadyWithSentence(['Daniel'])).toMatch(/Say the word if you want somebody else/)
  })
  it('is plain words: no slug, id or issue number, even when handed a duplicate or a blank', () => {
    const s = alreadyWithSentence(['Daniel', 'Daniel', ' ', ''])
    expect(s).toMatch(/^Daniel is already on that/)
    expect(s).not.toMatch(/[a-z]+-director|#\d|[0-9a-f]{8}-[0-9a-f]{4}/)
    expect(alreadyWithSentence([])).toMatch(/^Somebody is already on that/)
  })
})

describe('a genuine "do it again" is still his, from his own words, and is not turned off', () => {
  it('his short sentences authorise another go', () => {
    expect(wantsAnotherGo('give it another go')).toBe('retry')
    expect(wantsAnotherGo('try it again')).toBe('retry')
    expect(wantsAnotherGo('get another person to look at that as well')).toBe('another_person')
  })
  it('negative controls: a question or a hypothetical does not', () => {
    expect(wantsAnotherGo('should we try it again?')).toBeNull()
    expect(wantsAnotherGo('Ask the team to investigate the venue contract risk.')).toBeNull()
  })
})

describe('the hand-off loop only counts what this turn owns', () => {
  const code = readFileSync('src/handlers/instruction.ts', 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
  it('a child that is not this job’s own is set aside and never registered as a branch', () => {
    // set aside only when the existing child's parent is another job, then the loop moves on
    expect(code).toMatch(
      /if \(owner !== job\.jobId\) \{\s*alreadyWithOthers\.push\(\{ agent: other, jobId: row\.id \}\)\s*continue\s*\}/,
    )
    // and the fan-in is registered over the branches this turn started, not over the ones it merely found
    expect(code).toMatch(
      /if \(branchesStarted\.length >= 1\) \{\s*await deps\.db\s*\.execute\(`\s*select app\.fan_in_over\(/,
    )
    expect(code).toMatch(/branchesStarted\.map\(\(b\) => \(\{/)
    const from = code.indexOf('select app.fan_in_over(')
    const to = code.indexOf("'office.synthesise'", from)
    expect(from).toBeGreaterThan(0)
    expect(to).toBeGreaterThan(from)
    // bounded at both ends: the payload of the fan-in call itself
    expect(code.slice(from, to)).toContain('branchesStarted.map')
    expect(code.slice(from, to)).not.toContain('alreadyWithOthers')
  })
  it('the reply says "already on it" only when nothing was started by this turn', () => {
    expect(code).toMatch(
      /branchesStarted\.length === 0 && alreadyWithOthers\.length > 0\s*\?\s*alreadyWithSentence\(/,
    )
  })
  it('a retry of the SAME job (its own earlier child) is still a branch: the ownership test is on the parent', () => {
    expect(code).toMatch(/select parent_job_id::text as p from public\.jobs/)
  })
})
