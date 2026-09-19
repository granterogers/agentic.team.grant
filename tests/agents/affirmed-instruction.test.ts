/**
 * "Fine. Set aside a task…" was not read as an instruction at all (#254).
 *
 * Measured, and identical for every opener Grant uses:
 *
 *     Set aside a task to book the room once they confirm  -> assignment ✓
 *     Fine. Set aside a task to book the room once they…   -> THOUGHT ✗
 *     OK. / Right. / Thanks. / Good. / Yes. / Perfect.     -> THOUGHT ✗
 *
 * `thought` convenes nobody and writes nothing, so a whole class of his
 * instructions silently did nothing and the model was left to improvise an
 * answer. Two of this run's worst outputs came from exactly that turn: an
 * invented four-field intake form, and `Task "Book interview room (once
 * candidates confirm)" created, owned by you` with no such task anywhere.
 *
 * ## Why the existing rule did not cover it
 *
 * `affirmed-imperative` was written for this shape and ENUMERATES the verb —
 * generate, make, create, produce, build, record, prepare, add, attach,
 * upload, push, send, post, put, log, raise. "Set aside" is not on the list,
 * and neither are #254's own examples: "line up", "square away", "knock
 * together". Those are the verbs nothing has seen, and the grammar reader
 * handles all of them perfectly — the moment the preamble is out of the way.
 *
 * CLAUDE.md: prefer a property over an enumeration wherever the enumeration is
 * of things a future change will add to. So the affirmation is stripped and
 * what follows is read on its own terms.
 *
 * ## It is a FALLBACK, and that placement is the whole safety
 *
 * The first attempt stripped before the rules ran and turned "Yes, do it.
 * Create the task." from `direct_command` into something cheaper, undoing
 * #237's deliberate reading. Its own test caught it in one run.
 *
 * Now nothing the rules already understand is touched: only text that reached
 * the bottom UNRECOGNISED is read again without its opening agreement. It can
 * rescue and it cannot demote.
 */
import { describe, expect, it } from 'vitest'
import { classifyIntent, withoutOpeningAffirmation } from '../../src/agents/intent.ts'
import { taskRequest } from '../../src/agents/tasks.ts'

const ask = (s: string) => taskRequest(s, classifyIntent(s))
/*
  Not only agreements. Every one of these was measured reading the same
  instruction as a passing remark — greetings and discourse markers, which are
  a genuinely CLOSED class. That is what makes enumerating them legitimate
  where enumerating verbs was not: a new verb arrives with every feature and
  nobody invents a new way to say hello.

  The stacked pairs are here because people write them: "OK, so…".
*/
const OPENERS = [
  'Fine. ',
  'OK. ',
  'Right. ',
  'Thanks. ',
  'Good. ',
  'Yes. ',
  'Perfect. ',
  'So, ',
  'Also, ',
  'Anyway, ',
  'Sorry, ',
  'Actually, ',
  'Right then, ',
  'Hi. ',
  'Morning. ',
  'Good morning. ',
  'Thank you. ',
  'One more thing. ',
  'OK, so ',
  'Right, anyway ',
]

describe('#254 — an instruction behind a word of agreement', () => {
  it('is an assignment whatever the opener, and keeps its title', () => {
    const body = 'Set aside a task to book the room myself once they confirm.'
    for (const open of ['', ...OPENERS]) {
      const c = classifyIntent(open + body)
      expect(c.intent, open).toBe('assignment')
      expect(ask(open + body)?.title, open).toBe('book the room myself once they confirm')
    }
  })

  it('works for the verbs nothing has seen, which is what the enumeration missed', () => {
    /*
      #254's own three. Each one already worked bare and failed behind a
      preamble, which is the tell that the verb list was never the problem.
    */
    expect(
      ask('Fine. Line up a task on alpha to take up references for the two we keep.')?.title,
    ).toBe('take up references for the two we keep')
    expect(
      ask('OK. Square away a task on alpha to bottom out the match funding by the tenth.')?.title,
    ).toBe('bottom out the match funding by the tenth')
    expect(ask('Right. Knock together a task to confirm the window by phone.')?.title).toBe(
      'confirm the window by phone',
    )
  })

  it('CONTROL: #237 still reads an affirmed imperative as a direct command', () => {
    // The regression the first draft caused. This is the load-bearing control:
    // the fix must only ever RESCUE, never reclassify something that worked.
    expect(classifyIntent('Yes, do it. Create the task.').intent).toBe('direct_command')
  })

  it('CONTROL: a bare acknowledgement is still a remark that convenes nobody', () => {
    for (const s of ['Fine.', 'OK, thanks', 'Perfect.', 'Thanks, that is helpful.']) {
      const c = classifyIntent(s)
      expect(c.intent, s).toBe('thought')
      expect(ask(s), s).toBeNull()
    }
  })

  it('CONTROL: a bare greeting or marker is still a remark', () => {
    // The openers must not become instructions merely by being recognised.
    for (const s of ['Hi.', 'Morning.', 'Right then.', 'Anyway.']) {
      expect(classifyIntent(s).intent, s).toBe('thought')
    }
  })

  it('CONTROL: the longest opener wins, or a two-word one half-strips', () => {
    /*
      Alternation is first-match-wins. With `right|right\s+then` the short
      branch took "Right then, set aside a task" down to "then, Set aside…",
      which is still unrecognised — the rescue silently doing nothing for the
      one opener that needed two words.
    */
    expect(withoutOpeningAffirmation('Right then, set aside a task')).toBe('set aside a task')
    expect(withoutOpeningAffirmation('Good morning. Set aside a task')).toBe('Set aside a task')
  })

  it('CONTROL: an agreement in front of a NON-instruction stays cheap', () => {
    // Stripping a word must not turn "Fine, whatever" into a confident
    // reading of "whatever".
    expect(classifyIntent('Fine, whatever.').confident).toBe(false)
    expect(ask('OK. I will think about it.')).toBeNull()
    expect(classifyIntent('Right. What does that cost?').intent).toBe('question')
    expect(classifyIntent('Sorry, I cannot make it.').intent).toBe('thought')
    expect(classifyIntent('So, what does that cost?').intent).toBe('question')
  })

  it('the cut is one definition, used by the classifier and the title alike', () => {
    /*
      Fixing the intent and leaving the title was the half-fix that actually
      happened: `assignment` with a null title, which makes the office decide
      it must write something and then be unable to say what. The clause
      splitter will not give "Fine." a clause of its own, so the extractor
      needs the same cut.
    */
    expect(withoutOpeningAffirmation('Fine. Set aside a task')).toBe('Set aside a task')
    expect(withoutOpeningAffirmation('Set aside a task')).toBe('Set aside a task')
    expect(withoutOpeningAffirmation('Fine')).toBe('Fine')
  })
})
