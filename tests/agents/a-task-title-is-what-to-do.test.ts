/**
 * #307 — every task title the office wrote from a real message was malformed.
 *
 * ## The evidence, from the rows rather than from reading
 *
 * `public.tasks`, the 45 days to 22 September 2026. Twelve rows: four harness
 * fixtures, three reconnection chores written by code, and **four written
 * from something Grant said**. All four wrong:
 *
 *     draft.create — produce a draft listing what is out of date   (a job kind)
 *     For me and the um... No actually, you know what? Scan the…   (a retraction)
 *     all of Grant's current tasks across all of Grant's projects  (a question)
 *     down for the printer quote, due Tuesday                      (today's run)
 *
 * Four of four. Not a sample.
 *
 * ## #249's defect returning in the half that was not rebuilt
 *
 * #249 moved RECOGNITION off a verb list and onto grammar, and left TITLING
 * stripping a frame with patterns. So the better recognition got, the more
 * malformed titles it produced — which is why this arrived now rather than
 * then.
 *
 * Four structural gaps, each a closed class, none a missing word:
 *
 *   1. a verb particle survives the frame — "get a task DOWN FOR the printer
 *      quote" is framed by "get a task down for", not "get a task"
 *   2. a topic named before the instruction is not a frame at all —
 *      "on the bid, put something down to…" was untouched, because
 *      `requestBody` strips a LEADING verb
 *   3. the purpose clause survives — "so I do not forget to ring Kevin" is
 *      the reason, and "ring Kevin" is the reminder
 *   4. a withdrawn false start is kept, though `readRetraction` exists
 *
 * ## The date is the fifth, and it is not in this file
 *
 * `taskTitle` deliberately still keeps it, because the handler passes the
 * TITLE to `dueOn` — a title with the date already removed resolves to no
 * date at all, which is how the first attempt at this fix would have broken
 * the feature outright. The subtraction happens after the resolver has run
 * and only on what it consumed: `withoutTheDate`, tested below.
 */

import { describe, expect, it } from 'vitest'
import { dueOn, withoutTheDate } from '../../src/agents/due.ts'
import { taskTitle } from '../../src/agents/tasks.ts'

/** A Tuesday, so "by Friday" and "on Thursday" have somewhere to land. */
const NOW = new Date('2026-09-22T09:00:00Z')

/** What the handler ends up storing: the title, then the date taken out of it. */
const stored = (said: string): { title: string; due: string | null } => {
  const t = taskTitle(said) ?? ''
  const d = dueOn(t, NOW)
  return { title: withoutTheDate(t, d), due: d?.on ?? null }
}

describe('the title is what to do, not what is left over', () => {
  const cases: [string, string, string | null][] = [
    // the four gaps, in order
    ['get a task down for the printer quote, due Tuesday', 'the printer quote', '2026-09-22'],
    [
      'on the bid, put something down to chase the letter of support',
      'chase the letter of support',
      null,
    ],
    [
      'stick something down so I do not forget to ring Kevin about the quote',
      'ring Kevin about the quote',
      null,
    ],
    // and the shapes that already worked, which must not move
    [
      'add a task to book the venue for the first session',
      'book the venue for the first session',
      null,
    ],
    ['remind me to ring the venue on Thursday', 'ring the venue', '2026-09-24'],
    ['put a task on alpha to take up references', 'take up references', null],
    [
      'Raise a task in alpha to review the lease break clause by Friday',
      'review the lease break clause',
      '2026-09-25',
    ],
    [
      'put a task on the bid to confirm the printer quote by Tuesday',
      'confirm the printer quote',
      '2026-09-22',
    ],
  ]
  for (const [said, title, due] of cases) {
    it(`"${said.slice(0, 48)}…" is called "${title}"`, () => {
      expect(stored(said)).toEqual({ title, due })
    })
  }
})

describe('the date leaves the name only because it reached the column', () => {
  /*
    THE CONDITION THAT MAKES THE SUBTRACTION SAFE, and the reason the old
    comment against it was right about the unconditional version. #253 refuses
    a phrase it cannot be sure of — "at some point", "soon" — and on every one
    of those the title must keep every word Grant said, because nothing else
    holds them.
  */
  for (const said of [
    'add a task to sort the insurance at some point',
    'add a task to chase the quote soon',
    'add a task to follow up when you can',
  ]) {
    it(`keeps every word of "${said.slice(0, 44)}…" when no date resolved`, () => {
      const { title, due } = stored(said)
      expect(due).toBeNull()
      expect(taskTitle(said)).toBe(title)
    })
  }

  it('never empties a title to take a date out of it', () => {
    /*
      "by Friday" and nothing else is a bad title and an empty one is worse,
      so the subtraction stands down rather than producing "".
    */
    expect(withoutTheDate('by Friday', dueOn('by Friday', NOW))).toBe('by Friday')
  })
})

describe('a retracted false start is not part of the name', () => {
  it('drops what he took back in the same breath', () => {
    /*
      The row this is taken from is real: `public.tasks` held
      "For me and the um... No actually, you know what? Scan the entire
      project" on the unnamed project, written from a voice note.
    */
    const t = taskTitle('For me and the um... No actually, you know what? scan the entire project')
    expect(t).not.toBeNull()
    expect(String(t)).not.toContain('For me and the um')
    expect(String(t)).toContain('scan the entire project')
  })
})

describe('what this does NOT fix, stated rather than glossed', () => {
  /*
    An action whose only object is the placeholder. "book something in so we
    do not lose the slot" has no content noun to promote, so the residue is
    still poor — it was poor before this change too, and inventing a noun to
    cover it would be #249's own invariant broken. The honest answer is to
    ask for a title, which is a separate change to `NOT_A_TITLE`.
  */
  it('still does badly on an action with no object but the placeholder', () => {
    expect(taskTitle('book something in so we do not lose the slot')).toContain('lose the slot')
  })
})
