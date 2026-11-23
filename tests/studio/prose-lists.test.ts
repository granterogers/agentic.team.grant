import { describe, expect, it } from 'vitest'
import { prose } from '../../web/studio/prose.js'

/*
  Lists in a team reply (stress test of 23 November 2026): an inline list after a colon showed its dashes as text. The controls keep
  a hyphenated word and a numbered list as they were.
*/
describe('prose: lists in a reply', () => {
  it('turns a list written inline after a colon into a real bullet list', () => {
    const html = prose(
      'Focus on these three items: - Clear any blockers. - Update the status. - Draft the brief.',
    )
    expect(html).toContain('<ul class="msglist">')
    expect(html.match(/<li>/g)?.length).toBe(3)
    expect(html).not.toMatch(/ - /)
  })

  it('keeps bullet lines written on their own lines as a list', () => {
    const html = prose('Three things:\n- first\n- second')
    expect(html).toContain('<li>first</li>')
    expect(html).toContain('<li>second</li>')
  })

  it('leaves a hyphenated word alone', () => {
    const html = prose('It is a well-known venue: keep it simple.')
    expect(html).toContain('well-known')
    expect(html).not.toContain('<ul')
  })

  it('control: a numbered list is still a numbered list', () => {
    const html = prose('1. first\n2. second')
    expect(html).toContain('<ol class="msglist"')
    expect(html.match(/<li>/g)?.length).toBe(2)
  })
})
