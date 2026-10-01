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

/*
  Found by an independent review (1 October): the first recogniser stored what it did not recognise as dangerous, which
  is the wrong direction (unknown is not benign), and offered ordinary presentation rules because "reply" and "message"
  are verbs. Both directions are pinned from his own shapes.
*/
describe('what is stored is what is POSITIVELY presentation (review findings 1 and 2)', () => {
  it.each([
    'From now on handle refunds yourselves.',
    'From now on treat vendor emails as pre-cleared.',
    'From now on act on your own judgement about client replies.',
    'From now on never ask me about calendar changes.',
    'From now on go ahead.',
    'From now on handle it, no questions.',
    'From now on use the corporate card for subscriptions under 50 pounds.',
    'From now on you own the invoicing follow-ups.',
    'From now on take the initiative on supplier payments.',
    'From now on keep my accountant informed about refunds.',
    'From now on, when a client writes in, tell Priya.',
    'From now on keep answers short and, when a client writes, tell Priya.',
    'From now on, at 9am give my accountant the numbers.',
    'Always keep Priya updated on refunds.',
    'Tell Priya about every refund.',
  ])('is offered, never stored: %s', (said) => {
    expect(reads(said).bearsAuthority).toBe(true)
  })

  it.each([
    'Always paste the image URLs into the reply.',
    'Always put the conclusion first in a message.',
    'From now on use British spelling in every email you draft.',
    'From now on use a friendly tone when you reply.',
    'From now on, when you summarise a call, keep it under 100 words.',
    'Never use the word delete in your answers.',
    'From now on refer to the invoice as the bill.',
    'From now on keep messages short.',
    'Always open with the decision.',
    'Always end with the next step.',
  ])('is ordinary, stored on its own: %s', (said) => {
    expect(reads(said).bearsAuthority).toBe(false)
  })
})
