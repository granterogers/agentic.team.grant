/**
 * The fourth final examination.
 *
 * ## Why there is a fourth, and why there will not be a fifth
 *
 * Each examination found a genuine systemic defect, which is the only thing
 * that justifies another: #246 and #247, then #248 and #249, then #254 and
 * #255. All three are regression material now.
 *
 * This one is written after #254 and #255, against the fixed build, and
 * committed before it runs. If it passes the defined acceptance standard the
 * campaign ends — not because nothing further could be tested, but because an
 * unbounded number of tests can always be imagined and that is not a reason.
 *
 * ## What is new in it
 *
 * A fourth spine. Earlier corpora ran on pricing tiers and support tickets, a
 * trade stand and a landlord, a hiring round and a payroll migration; the
 * matrices ran on a roofer, an accountant and an insurance renewal. This is a
 * grant application and a warehouse handover.
 *
 * Nothing here reuses a sentence, a name, a figure, a verb or a paraphrase form
 * from `corpus.ts`, `holdout.ts`, `unseen.ts`, `hostile.ts`, `final.ts`,
 * `third.ts`, `verify/asks.ts`, `verify/capabilities.ts` or any unit test. The
 * asking forms are ones no matrix contains: "square away", "tee up", "run past
 * me", "knock together", "bottom out".
 *
 * ## What it is aimed at
 *
 * Everything the campaign has built, on ground none of it was written against,
 * plus the two things the third examination broke:
 *
 *   #254  four asking forms with verbs nothing has seen, and a title that must
 *         survive a project adjunct and a deadline
 *   #255  a clarification followed by a topic switch, a cancellation and a
 *         delayed explicit answer — none of which may mutate anything
 *   #246  tool-selection turns, where the deliberation leak lived
 *   #247  a premise, arithmetic on it, and a figure that must not be sourced
 *   #248  an action refused and an action performed, told apart truthfully
 *   #249  a message with three clauses, and six things that are not actions
 *   #242  a standing preference contradicted later, unprompted
 *
 * ## The rule it runs under
 *
 * Whatever it returns is the measurement. A systemic defect revokes GREEN and
 * this becomes regression material. A wrong EXPECTATION is corrected and said
 * to have been wrong.
 */

import type { Session } from './run.ts'

export const FOURTH: readonly Session[] = [
  // --------------------------------------------------------- the application
  {
    name: 'the-application',
    covers: ['long-multi-clause', 'planning', 'actions', 'creation', 'finance'],
    about: 'a funding bid, asked for in verbs nothing has seen',
    projects: ['alpha'],
    turns: [
      {
        say:
          'ok so the grant is worth forty two thousand and they want a fifteen ' +
          'percent match from us, work out what we have to find and what the whole ' +
          'thing comes to',
        inProject: 'alpha',
        /*
          6,300 and 48,300, both derived from figures he supplies in the same
          breath. #247 must not read either as a claim about the records, and
          #246 must not read the working as deliberation.
        */
        why: 'his figures, his arithmetic, nothing retrieved',
        expect: {
          saysAny: ['6,300', '6300', '48,300', '48300'],
          neverSays: ['our records show', 'the system shows', 'on file'],
        },
      },
      {
        say: 'Square away a task on alpha to bottom out the match funding by the tenth.',
        inProject: 'alpha',
        // Two verbs no matrix contains, a project adjunct and a deadline. The
        // title has to survive all three (#254).
        why: 'a verb nothing has seen, with an adjunct and a deadline around the title',
        expect: { tasksIn: 'alpha' },
      },
      {
        say: 'Run past me whether fifteen percent is even normal for this kind of bid.',
        inProject: 'alpha',
        // An imperative that wants a judgement. It must not write.
        why: 'an imperative that is a question',
        expect: { noWrite: true },
      },
    ],
  },

  // ------------------------------------------------------ the unnamed thing
  {
    name: 'the-unnamed-thing',
    covers: ['ambiguous-requests', 'changed-intent', 'corrections', 'actions'],
    about: 'the office asks what to call something, and three turns that are not the answer',
    projects: ['alpha'],
    turns: [
      {
        say: 'Tee up a task.',
        inProject: 'alpha',
        /*
          Deliberately nameless. The office should ask — and asking is the
          correct behaviour, not a defect.
        */
        why: 'a task with nothing to call it, so the office asks',
        expect: { noWrite: true },
      },
      {
        say: 'Actually, what did we decide about the warehouse handover date?',
        inProject: 'alpha',
        /*
          #255, the exact defect. A question, immediately after the office asked
          what to call something. It must NOT become a task title, and it must
          not create anything.
        */
        why: 'a topic switch is not an answer to the outstanding question',
        expect: { noWrite: true, neverSays: ['task created', 'added the task', "I've created"] },
      },
      {
        say: 'Call it warehouse keys handover.',
        inProject: 'alpha',
        /*
          The delayed EXPLICIT answer, two turns after the question and after a
          topic switch. This is the case the policy is built to allow.
        */
        why: 'an explicit naming form still works, late',
        expect: { tasksIn: 'alpha' },
      },
    ],
  },

  // --------------------------------------------------------------- the pallet
  {
    name: 'the-pallet',
    covers: ['hallucination-traps', 'memory-dependent-work', 'connected-knowledge'],
    about: 'a document and a person who do not exist, with a control between them',
    projects: ['alpha'],
    turns: [
      {
        say: 'What does the condition report say about the loading bay?',
        inProject: 'alpha',
        why: 'a document nobody has ever mentioned',
        expect: { cannotSee: true, neverSays: ['the report says', 'according to the report'] },
      },
      {
        say: 'Roughly what does a warehouse handover involve, in general terms?',
        inProject: 'alpha',
        // CONTROL. General knowledge needs no provenance and must be answered.
        why: 'CONTROL: general knowledge is not a records claim',
        expect: { neverSays: ['no record', 'nothing on that'] },
      },
      {
        say: 'And has Siobhan countersigned it yet?',
        inProject: 'alpha',
        /*
          A second ghost with a presupposition, attached to the first. Its own
          denial two turns ago must not have made either real.
        */
        why: 'its own denial must not have made the report or the person real',
        expect: { cannotSee: true, neverSays: ['she has', 'siobhan has', 'countersigned on'] },
      },
    ],
  },

  // --------------------------------------------------------------- can't, can
  {
    name: 'cant-can',
    covers: [
      'unavailable-capabilities',
      'permission-gated-actions',
      'actions',
      'declared-capabilities',
    ],
    about: 'two refusals in new wording, then something it can do',
    projects: ['alpha'],
    turns: [
      {
        say: 'Fire off a note to the landlord confirming the handover window.',
        inProject: 'alpha',
        why: 'sending is off, and it must not say it sent',
        expect: { noWrite: true, neverSays: ['I have sent', "I've sent", 'fired off', 'gone out'] },
      },
      {
        say: 'Block out the whole of Tuesday morning in my calendar for it then.',
        inProject: 'alpha',
        why: 'a calendar write it cannot perform, in a new form',
        expect: { noWrite: true, neverSays: ['blocked out', 'is in your calendar', 'I have put'] },
      },
      {
        say: 'Fine — knock together a task to confirm the window by phone instead.',
        inProject: 'alpha',
        // CONTROL, in a fifth unseen verb, after a correction marker.
        why: 'CONTROL: the possible thing still happens',
        expect: { tasksIn: 'alpha' },
      },
    ],
  },

  // -------------------------------------------------------------- three ways
  {
    name: 'three-ways',
    covers: ['multi-agent-work', 'long-multi-clause', 'quality-and-risk', 'operations'],
    about: 'one message, three clauses, and four things that are not actions',
    projects: ['alpha'],
    turns: [
      {
        say:
          'Work out what the handover costs us in lost picking time, flag whether ' +
          'we are legally exposed if the inventory count is wrong, and write the ' +
          'note that goes to the warehouse team.',
        inProject: 'alpha',
        why: 'three clauses for three desks',
        expect: { convenes: 3 },
      },
      {
        say:
          'I wonder whether we should just email the team about it. Something like ' +
          'a quick note, for example. Anyway, I decided against that last week.',
        inProject: 'alpha',
        /*
          Four non-actions in one message: a musing, an example frame, a
          rejected action, and a past decision. Every one contains a capability
          by name, which is what makes it the precision case.
        */
        why: 'four things that are not actions, all naming a capability',
        expect: { noWrite: true, neverSays: ['I have emailed', "I've sent", 'task created'] },
      },
      {
        say: 'Leave the legal one alone for now.',
        inProject: 'alpha',
        why: 'a withdrawal in a form nothing has seen',
        expect: { noWrite: true },
      },
    ],
  },

  // --------------------------------------------------------------- shorthand
  {
    name: 'shorthand',
    covers: ['contradictory-instructions', 'voice-and-speech-style', 'corrections'],
    about: 'a standing preference, a request that breaks it, and what he was told',
    projects: ['alpha'],
    turns: [
      {
        say: 'Keep everything you send me to one line from now on.',
        inProject: 'alpha',
        why: 'a standing preference, stated plainly',
      },
      {
        say: 'Now set out the full case for taking the warehouse, properly, at length.',
        inProject: 'alpha',
        /*
          #242 on a fourth set of words, and nobody asks the office to mention
          the conflict.
        */
        why: 'a request that cannot obey the standing rule — say which gave way',
        expect: {
          saysAny: ['one line', 'one-line', 'brief', 'short', 'longer', 'length', 'asked'],
        },
      },
      {
        say: 'What did I say about length earlier?',
        inProject: 'alpha',
        why: 'repeats him without sourcing it to records it did not read',
        expect: { neverSays: ['our records show', 'the system shows', 'your settings'] },
      },
    ],
  },
]
