/**
 * The other half of the floor channel (#282).
 *
 * `narrate` shows the DECISION — what came in, how it was read, who it went
 * to. The channel had never shown the end of a conversation, so a handoff read
 * "Emma has it" and then nothing: whether she answered, produced nothing, or
 * the job died were all the same silence.
 *
 * Every branch here is a sentence Grant will read, and the ones that matter
 * most — nobody answered, it failed, nothing came of it — are the shapes a
 * live run produces least often and a fabricated standup would never produce
 * at all. So they are tested directly rather than waited for.
 */
import { describe, expect, it } from 'vitest'
import { narrateOutcome } from '../../src/slack/narrate.ts'

const base = {
  job_id: '00000000-0000-0000-0000-000000000001',
  state: 'complete',
  state_reason: null,
  thread_ts: null,
  lead_name: null,
  lead_body: null,
  chief_name: 'Claire',
  chief_title: 'Chief of Staff',
  chief_avatar: null,
  contributions: [] as { who: string | null; body: string | null; state: string }[],
  started: [] as string[],
  tasks: [] as string[],
  documents: [] as string[],
}

describe('narrateOutcome', () => {
  it('a turn that produced nothing says so rather than going quiet', () => {
    /*
      The whole reason this exists. Silence in the channel reads as the office
      being busy; it was a turn that did not land.
    */
    expect(narrateOutcome(base)).toBe('That one finished without producing anything.')
  })

  it('names each specialist and quotes what they produced', () => {
    const said = narrateOutcome({
      ...base,
      contributions: [
        { who: 'Emma', body: 'The three suppliers all quote within 5%.', state: 'complete' },
        { who: 'Daniel', body: 'Margin holds at 32% either way.', state: 'complete' },
      ],
    })
    expect(said).toContain('Emma came back with')
    expect(said).toContain('three suppliers')
    expect(said).toContain('Daniel came back with')
  })

  it('a specialist who finished and wrote nothing is named, not omitted', () => {
    /*
      #233's fan-out makes a contribution a real row, so "had it and produced
      nothing" is a fact this can state. A summary that quietly dropped them
      would read as though they were never convened.
    */
    const said = narrateOutcome({
      ...base,
      contributions: [{ who: 'Emma', body: null, state: 'complete' }],
    })
    expect(said).toContain('Emma had it and produced nothing')
  })

  it('a specialist whose own job died is named with its state', () => {
    const said = narrateOutcome({
      ...base,
      contributions: [{ who: 'Emma', body: null, state: 'failed' }],
    })
    expect(said).toContain('Emma did not finish')
    expect(said).toContain('failed')
  })

  it('a dead job says so FIRST, with the reason', () => {
    const said = narrateOutcome({
      ...base,
      state: 'failed',
      state_reason: 'the model returned only scaffolding',
    })
    expect(said.split('\n')[0]).toContain('ended failed')
    expect(said).toContain('scaffolding')
  })

  it('a dead job with no reason still admits it has nothing to show', () => {
    expect(narrateOutcome({ ...base, state: 'cancelled' })).toContain('nothing to show for it')
  })

  it('the synthesis is attributed when there is a lead', () => {
    const said = narrateOutcome({
      ...base,
      lead_name: 'Claire',
      lead_body: 'Both quotes are fine; go with the second on delivery.',
    })
    expect(said).toContain('Claire pulled it together')
  })

  it('and is still reported when nobody is named', () => {
    expect(narrateOutcome({ ...base, lead_body: 'Go with the second.' })).toContain('The answer:')
  })

  it('work started is read out loud rather than printed as a job kind', () => {
    const said = narrateOutcome({ ...base, started: ['artifact.report', 'browser.gather'] })
    expect(said).toContain('writing it up as a file')
    expect(said).toContain('reading a page')
    expect(said).not.toContain('artifact.report')
  })

  it('an unknown job kind prints itself rather than vanishing', () => {
    /*
      A lookup that silently drops what it does not recognise is the
      found-nothing shape: the channel would simply not mention work that
      happened. Same reason `narrate` prints an unmapped duplicate resolution.
    */
    expect(narrateOutcome({ ...base, started: ['office.brand_new'] })).toContain('office.brand_new')
  })

  it('counts what went on the list, and names it', () => {
    expect(narrateOutcome({ ...base, tasks: ['Ring the venue'] })).toContain(
      'One thing went on the list: Ring the venue',
    )
    const three = narrateOutcome({ ...base, tasks: ['A', 'B', 'C'] })
    expect(three).toContain('3 things went on the list')
    expect(three).toContain('A; B; C')
  })

  it('names a document that was made', () => {
    expect(narrateOutcome({ ...base, documents: ['Pricing review'] })).toContain('Pricing review')
  })

  it('a quotation is cut at a word, never mid-word', () => {
    /*
      CLAUDE.md records a table cell reading "client independe": a cell that
      stops at a word reads as a summary and one that stops mid-word reads as
      a bug, because it is one.
    */
    const long = `${'supercalifragilistic '.repeat(30)}end`
    const said = narrateOutcome({ ...base, lead_body: long })
    const quoted = /“([^”]*)”/.exec(said)?.[1] ?? ''
    expect(quoted.endsWith('…')).toBe(true)
    expect(quoted.replace('…', '').trimEnd()).toMatch(/supercalifragilistic$/)
  })

  it('CONTROL: short text is not truncated at all', () => {
    expect(narrateOutcome({ ...base, lead_body: 'Done.' })).toContain('“Done.”')
  })

  it('a failure and a contribution both appear — the failure does not swallow the rest', () => {
    const said = narrateOutcome({
      ...base,
      state: 'failed',
      state_reason: 'output refused',
      contributions: [{ who: 'Emma', body: 'Found three.', state: 'complete' }],
      tasks: ['Chase the quote'],
    })
    expect(said).toContain('ended failed')
    expect(said).toContain('Emma came back with')
    expect(said).toContain('Chase the quote')
  })
})
