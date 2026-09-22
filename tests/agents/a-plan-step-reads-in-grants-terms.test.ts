/**
 * The third task writer — a plan step, whose reason becomes a task title.
 *
 * ## The rows this is taken from
 *
 * `public.tasks`, real, on Grant's own list:
 *
 *     draft.create — redo budget page
 *     draft.create — report outdated items
 *     draft.create — produce a draft listing what is out of date
 *
 * Two of the four tasks the office wrote from a real message in 45 days are
 * this shape. #307 fixed the two writers that compose a title from a
 * SENTENCE; this is the third, which composes one from a PLAN.
 *
 * `PlanStep.why` is documented in its own declaration as *"why this step, in
 * Grant's terms. Shown to him; never used to decide"* — and it is written by
 * the model, which helpfully prefixes it with the capability it picked.
 * `perform.ts` then passes it to `app.my_task_add` verbatim.
 *
 * #242's rule: an internal reference in a sentence a person reads is a
 * defect. A dotted identifier is ours, and the only place Grant could have
 * got one from is us.
 */

import { describe, expect, it } from 'vitest'
import { inGrantsTerms } from '../../src/agents/goal.ts'

describe('our vocabulary comes out of the reason Grant reads', () => {
  const cases: [string, string][] = [
    ['draft.create — redo budget page', 'redo budget page'],
    ['draft.create — report outdated items', 'report outdated items'],
    [
      'draft.create — produce a draft listing what is out of date',
      'produce a draft listing what is out of date',
    ],
    ['task.create — chase the letter of support', 'chase the letter of support'],
    ['slack.post: tell the team the session moved', 'tell the team the session moved'],
    ['notebook.search - find the pricing note', 'find the pricing note'],
  ]
  for (const [raw, want] of cases) {
    it(`"${raw.slice(0, 40)}…" reads as "${want.slice(0, 32)}…"`, () => {
      expect(inGrantsTerms(raw)).toBe(want)
    })
  }

  it('holds for a capability nobody has added yet', () => {
    /*
      Structural rather than a list of capability names, so it does not go
      stale the moment the office learns to do something new.
    */
    expect(inGrantsTerms('calendar.invite — get everyone in a room')).toBe('get everyone in a room')
  })
})

describe('and an ordinary reason is left exactly alone', () => {
  for (const said of [
    'redo the budget page',
    'chase the letter of support before Friday',
    'because the funding officer asked for it',
    'We should use draft.create for this',
  ]) {
    it(`"${said.slice(0, 40)}…" is unchanged`, () => {
      expect(inGrantsTerms(said)).toBe(said)
    })
  }

  it('never strips a reason down to nothing', () => {
    /*
      "draft.create" alone carries no reason at all, and an empty `why` is
      what `perform.ts` already falls back FROM — to the request itself, which
      is a better title than half an identifier. So a strip that would empty
      it stands down instead.
    */
    expect(inGrantsTerms('draft.create')).toBe('draft.create')
    expect(inGrantsTerms('task.create —')).toBe('task.create —')
  })
})
