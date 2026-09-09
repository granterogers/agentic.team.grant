/**
 * The sentence that caused this file, and the ones that must still be allowed.
 */
import { describe, expect, it } from 'vitest'
import { capabilityBrief, contradictsReality, type Reach } from '../../src/agents/capability.ts'

const REACH: Reach[] = [
  { service: 'Notion', reachable: true, detail: null },
  { service: 'Slack', reachable: true, detail: null },
  { service: 'Google NotebookLM', reachable: true, detail: null },
  { service: 'GitHub', reachable: false, detail: 'no read token for other repos' },
]

describe('claiming it cannot reach something it can', () => {
  it('catches the reply that started this', () => {
    // Verbatim, from Slack, 2026-09-09. Every clause of it false.
    const said =
      "I can't post to Slack or pull data from your Notion teamspace. " +
      "I don't have integration access and I can't see the notebook you mention."
    expect(contradictsReality(said, REACH)).not.toBeNull()
  })

  it('catches the quieter phrasings too', () => {
    for (const said of [
      'I do not have access to Notion, so I cannot help with that.',
      'No integration is set up for Notion yet.',
      'I am unable to connect to Slack from here.',
      "I can't reach the Google NotebookLM account.",
    ]) {
      expect(contradictsReality(said, REACH), said).not.toBeNull()
    }
  })

  it('allows the true and useful sentence about a search', () => {
    // The distinction the whole file exists for: our records holding nothing is
    // hers to report, and the wiring is not.
    for (const said of [
      'I could not find anything about that in Notion.',
      'There is nothing on it in Notion that I can see — where should I be looking?',
      'Nothing in our records matched. Do you have a link?',
      'I searched Notion and came up empty.',
    ]) {
      expect(contradictsReality(said, REACH), said).toBeNull()
    }
  })

  it('allows a denial about something genuinely unreachable', () => {
    // GitHub really is limited, so saying so is correct and must not be caught.
    expect(
      contradictsReality('I cannot get access to that GitHub repository yet.', REACH),
    ).toBeNull()
  })

  it('ignores a service the reply never mentions', () => {
    expect(contradictsReality('I have no idea, sorry.', REACH)).toBeNull()
  })
})

describe('the brief handed to the model', () => {
  it('names what is reachable and what is not, with the reason', () => {
    const brief = capabilityBrief(REACH)
    expect(brief).toContain('Notion')
    expect(brief).toContain('Slack')
    expect(brief).toContain('no read token for other repos')
  })

  it('draws the distinction that was collapsed', () => {
    const brief = capabilityBrief(REACH).toLowerCase()
    expect(brief).toContain('records hold nothing')
    expect(brief).toContain('not yours to make')
  })

  it('says nothing at all when it knows nothing', () => {
    expect(capabilityBrief([])).toBe('')
  })
})
