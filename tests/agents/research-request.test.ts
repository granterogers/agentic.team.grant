/** The door: which sentences start a web lookup. Both signals are required, and every positive has its negative. */
import { describe, expect, it } from 'vitest'
import { pageRequest, researchRequest } from '../../src/agents/actions.ts'
import { entitled, noneEntitled } from '../../src/agents/entitled.ts'

describe('researchRequest', () => {
  it('starts on an explicit ask to look something up on the web', () => {
    for (const said of [
      'Search the web for what widgets cost for small shops',
      'Can you look this up online: best widget suppliers in Ohio',
      'Please research widget pricing on the internet and keep the good sources',
      'Google the latest widget regulations for me',
      'find out online who makes the Zed widget',
    ]) {
      expect(researchRequest(said), said)?.not.toBeNull()
    }
    expect(researchRequest('Search the web for widget prices')?.question).toBe(
      'Search the web for widget prices',
    )
  })

  it("does not start on a research verb with no web in it (that is about this office's own material)", () => {
    for (const said of [
      'Research the pricing options',
      'Look into the venue budget',
      'find out what Emma found',
    ]) {
      expect(researchRequest(said), said).toBeNull()
    }
  })

  it('does not start on a web word with no ask, a remark, or a prohibition', () => {
    for (const said of [
      'The web page needs fixing before Friday',
      'I read online that widgets are up',
      "Don't search the web for that",
      'Please do not google our competitors',
      'Should I search the web for that?',
      'Kevin said to search the web for the price',
      '',
    ]) {
      expect(researchRequest(said), said).toBeNull()
    }
  })

  it('leaves a sentence with a link to the page request, never both', () => {
    const said = 'Search the web and read https://x.example/widgets for me'
    expect(researchRequest(said)).toBeNull()
    expect(pageRequest(said)).not.toBeNull()
  })

  it('is read only from his own words: a forwarded message asks for nothing', () => {
    const said = 'Search the web for widget prices'
    expect(entitled.research(said as never)).not.toBeNull()
    expect(noneEntitled.research(said as never)).toBeNull()
  })
})

describe('the door is wired, and starts the reading kind only', () => {
  it('instruction.ts enqueues web.research from entitled.research, behind the branch and repeat guards', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync('src/handlers/instruction.ts', 'utf8')
    expect(src).toMatch(/: entitled\.research\(turn\.kept\)/)
    expect(src).toMatch(/'web\.research',\s*jsonb_build_object\(\s*'question'/)
    const guard =
      /const wantsResearch =\s*job\.projectId === null \|\|\s*isBranch \|\|\s*wantsFile !== null \|\|\s*alreadyOn !== null \|\|\s*wantsPage !== null/
    expect(src).toMatch(guard)
  })
})
