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
import { personalTaskRequest } from '../../src/agents/mine.ts'
import { readRetraction } from '../../src/agents/retraction.ts'
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
    /*
      The dictation breath goes too — "you know what?" belongs to the change
      of mind, not to the instruction, and it survived into a title on Grant's
      own list.
    */
    expect(String(t)).not.toContain('you know what')
    expect(String(t)).toContain('the entire project')
    /*
      AND THE VERB SURVIVES, which it did not when this was first written.

      The earlier version asserted `toBe('the entire project')` — deliberately
      and honestly, naming the missing verb as a separate defect and refusing
      to leave a green check over a title nobody would write. This file is
      called *a task title is what to do*, and "the entire project" is not
      something to do.

      The cause was a composition rather than either half: `requestBody` takes
      the verb BY POSITION, because its contract is that a request clause
      opens with the asking verb ("add a task to…" loses "add"). A retraction
      has already removed everything up to the change of mind, so its survivor
      opens with the INSTRUCTION's verb — and running `requestBody` over it
      ate that. `taskTitle` now only strips the verb from a retraction
      survivor when doing so REVEALS a task frame.
    */
    expect(String(t)).toBe('scan the entire project')
  })

  it('and still strips a real frame that follows the change of mind', () => {
    /*
      The control, and the reason the gate is not simply "never strip after a
      retraction". A person who changes their mind and then asks properly gets
      the frame taken off exactly as they would have without the change.
    */
    expect(taskTitle('Chase the plumber, no actually, add a task to chase the roofer')).toBe(
      'chase the roofer',
    )
  })

  it('keeps the verb of a bare instruction after a change of mind', () => {
    expect(taskTitle('Chase the plumber, no actually, call Priya about the venue')).toBe(
      'call Priya about the venue',
    )
  })

  it('CONTROL: an ordinary request is untouched by any of this', () => {
    // The gate is conditioned on a retraction having happened, so the path
    // Grant uses most must be provably unchanged.
    expect(taskTitle('Add a task to chase the roofer')).toBe('chase the roofer')
    expect(taskTitle('Remind me to write the one-pager on Friday')).toBe(
      'write the one-pager on Friday',
    )
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

describe('the OTHER task writer gets the same classes', () => {
  /*
    #307 was fixed in `tasks.ts` and the very next live session found the
    second writer. `mine.ts` writes a task on Grant's own list, has its own
    framing stripper and its own date resolver, and on v699 it stored

        "On coaching to book the venue, end of"

    from "add a task on coaching to book the venue, end of next week" — the
    project adjunct kept, and a preposition left hanging where its resolver
    had taken "next week" out.

    CLAUDE.md's "two doors onto one field" with a title instead of a ledger.
    The answer is the same: one list in `request.ts`, two callers, rather than
    a second copy that drifts. These cases are here rather than beside
    `mine.ts`'s own suite so that the two writers are asserted TOGETHER — the
    defect was that they disagreed.
  */
  const NOW_MINE = new Date('2026-09-22T09:00:00Z')
  const cases: [string, string, string | null][] = [
    ['add a task on coaching to book the venue, end of next week', 'Book the venue', '2026-09-29'],
    ['add a task on the bid to confirm the numbers by Friday', 'Confirm the numbers', '2026-09-25'],
    [
      'remind me to ring Kevin about the quote next week',
      'Ring Kevin about the quote',
      '2026-09-29',
    ],
    ['remind me on Friday to ring the venue', 'Ring the venue', '2026-09-25'],
    // and the shapes that already worked here, which must not move
    ['put a to-do on to check the numbers', 'Check the numbers', null],
    ['stick the invoice chase on my list', 'Invoice chase', null],
    [
      'remind me to book the venue for the first session',
      'Book the venue for the first session',
      null,
    ],
  ]
  for (const [said, title, due] of cases) {
    it(`"${said.slice(0, 46)}…" is called "${title}"`, () => {
      const r = personalTaskRequest(said, NOW_MINE)
      expect(r).not.toBeNull()
      expect({ title: r?.title, due: r?.due ?? null }).toEqual({ title, due })
    })
  }
})

describe('the dictation breath belongs to the change of mind', () => {
  /*
    Found while measuring #318, on a real row: `public.tasks` held

      "For me and the um... No actually, you know what? Scan the entire
       project"

    The pivot matcher stops at "no actually", so "you know what?" survived
    into `kept` and straight into a title on Grant's own list. Three of three
    dictation shapes did it on the first probe.

    Stripped in `readRetraction` rather than in either caller, because two
    callers stripping it their own way is how `taskTitle` and
    `personalTaskRequest` came to disagree about the retraction itself —
    CLAUDE.md's two-doors-onto-one-field entry.
  */
  const SHAPES: readonly (readonly [string, string])[] = [
    [
      'Create a task for me and the um... No actually, you know what? Scan the project and make review tasks',
      'Scan the project and make review tasks',
    ],
    [
      'Add a task to chase the invoice. Actually no, you know what, chase the caterers instead',
      'chase the caterers instead',
    ],
    [
      'Remind me to call the venue. Scrap that, you know what, remind me to email them',
      'remind me to email them',
    ],
  ]

  it.each(SHAPES)('keeps only the instruction: %s', (said, kept) => {
    expect(readRetraction(said)?.kept).toBe(kept)
  })

  it('and "actually" is left alone, because it is a pivot and not filler', () => {
    /*
      Listing it as a breath would let the stripper eat the operator the
      matcher depends on. Asserted so nobody adds it to the list.
    */
    const got = readRetraction('chase the letter, redo the budget - actually no, leave the budget')
    expect(got).not.toBeNull()
    /*
      The word SURVIVES rather than being eaten as filler, which is the
      property. An earlier version of this asserted it was the chosen pivot
      and was simply wrong about the product — the pivot here is "leave",
      from CANCELS. Asserting what actually protects the operator.
    */
    expect(String(got?.kept ?? '')).toContain('actually')
  })

  it('and a sentence that is only a breath is not emptied', () => {
    /*
      Bounded at two strips. An unbounded loop would eat a short instruction
      whole and hand back nothing, which is worse than the filler.
    */
    const got = readRetraction('Add a task to ring them. No actually, you know what, you know what')
    expect(String(got?.kept ?? '')).not.toBe('')
  })
})
