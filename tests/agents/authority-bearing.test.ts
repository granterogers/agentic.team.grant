import { describe, expect, it } from 'vitest'
import { readAuthority } from '../../src/agents/authority-bearing.ts'
import { dimensionOf } from '../../src/agents/preference.ts'

/*
  Decision 5: a rule that would hand the office authority is offered, never stored. This is the recogniser; the
  proof that nothing it misses can matter is structural (scripts/isolated/policy-learning.ts). Both directions are
  pinned, because a check that only ever says "authority" refuses every preference and one that only says "ordinary"
  stores the permission.
*/
const reads = (said: string) => readAuthority(said, dimensionOf(said))

describe('learning that would become authority', () => {
  it.each([
    'From now on keep every answer short.',
    'Always give me the conclusion first.',
    'Use British spelling.',
    'Never use bullet points.',
    'Put the date at the top of every summary.',
    'Do not put links in anything you write.',
    'Keep replies to me under four sentences.',
    'Email me a short summary in the morning.',
    'Message me when the report is ready.',
    'Tell me before you start.',
  ])('is ordinary, learned on its own: %s', (said) => {
    expect(reads(said).bearsAuthority).toBe(false)
  })

  it.each([
    'You may email my clients without asking me.',
    'From now on go ahead and send invoices on my behalf.',
    'Every Monday message the whole team the weekly summary.',
    'Never ask me before you post in the shared channel.',
    'Whenever a client replies, forward it to my accountant.',
    'You are allowed to delete old files.',
    'No need to check with me before booking travel.',
    'Automatically pay any invoice under a hundred pounds.',
    'Always cc Kevin on everything you send.',
    'Contact the venue every week until they confirm.',
    'I authorise you to approve expenses.',
    'Post the update to Slack every day at five.',
    'From now on, without asking, share the deck with the board.',
  ])('is authority-bearing, offered and never stored: %s', (said) => {
    expect(reads(said).bearsAuthority).toBe(true)
  })

  it('says WHY, in the words the Governance page shows', () => {
    const r = reads('You may email my clients without asking me.')
    expect(r.because.join(' ')).toMatch(/permission/)
    expect(readAuthority('x', 'asking-first').because.join(' ')).toMatch(/without asking/)
  })

  it('telling Grant is not reaching anybody: "message me" is ordinary, "message the team" is not', () => {
    expect(reads('Message me when it is done.').bearsAuthority).toBe(false)
    expect(reads('Message the team when it is done.').bearsAuthority).toBe(true)
  })

  it('the asking-first dimension is authority on its face, whatever else the sentence says', () => {
    expect(readAuthority('Check with me first.', 'asking-first').bearsAuthority).toBe(true)
  })
})
