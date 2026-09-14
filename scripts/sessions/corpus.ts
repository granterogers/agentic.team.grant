/**
 * The sessions — coherent working conversations, not random chat.
 *
 * Issue #237. Each one is a thing Grant actually does, written as he would
 * write it, and each turn carries what must be true of the office's response
 * checked against canonical state.
 *
 * ## Why these and not two hundred prompts
 *
 * #235's instruction was explicit — build the coverage model first and aim at
 * the empty cells. These aim at the ten `npm run breadth` found with no cases,
 * weighted towards the four that describe how he communicates: he corrects
 * you, he changes his mind mid-sentence, he contradicts himself inside one
 * voice note, and he works across two projects in one conversation.
 *
 * ## Length is chosen per property, not for the count
 *
 * A correction needs three turns. Contamination needs a switch and a return.
 * State decay needs twenty. Making every session twenty turns would spend an
 * hour of real jobs proving the same three-turn property over and over —
 * and `conversation.max_turns` is 12, so turns beyond that cannot be seen at
 * all. Long sessions are for what breaks that the short ones cannot show.
 */

import type { Session } from './run.ts'

export const SESSIONS: readonly Session[] = [
  // ---------------------------------------------------------------- corrections
  {
    name: 'corrections',
    about: 'Grant says the previous answer was wrong, in four different ways',
    projects: ['alpha'],
    turns: [
      {
        say: 'What would a fifteen percent price cut do to our margin on the middle tier?',
        inProject: 'alpha',
        why: 'the thing to be corrected — a plain finance question',
        expect: { agent: 'finance-director' },
      },
      {
        say: 'No, that is wrong. The middle tier is forty pounds, not thirty. Do it again.',
        inProject: 'alpha',
        why: 'a factual correction with the right value supplied',
        /*
          The answer must engage with FORTY. A polished redo that quietly keeps
          thirty is the failure Grant would notice second and trust least —
          CLAUDE.md's rule that an apology is not a fix.

          Asserted as a PROPERTY rather than a literal, because a correct answer
          can express the corrected figure in more than one way and the first
          draft of this expectation was a wording lock. The real answer said
          "(34 - cost) / 34" — 0.85 x 40, the price after the cut under
          discussion — which is the correction APPLIED. Thirty would have shown
          up as 30 or as 25.5, and neither may appear.
        */
        expect: { saysAny: ['40', '34'], neverSays: ['25.5', 'thirty'] },
      },
      {
        say: 'Actually I asked the wrong person. Ask Ruby about it instead.',
        inProject: 'alpha',
        why: 'correcting WHO, not what — the office must move the work',
        expect: { agent: 'growth-director' },
      },
      {
        say: 'That is not what I meant at all.',
        inProject: 'alpha',
        why: 'a correction with no content in it — the office should ask, not guess',
        expect: { clarifies: true },
      },
    ],
  },

  // -------------------------------------------------------------- changed intent
  {
    name: 'changed-intent',
    about: 'the second message cancels the first',
    projects: ['alpha'],
    turns: [
      {
        say: 'I need you to research what our competitors charge for this.',
        inProject: 'alpha',
        why: 'sets an expectation of work starting',
        expect: { agent: 'research-director' },
      },
      {
        say: 'Actually do not research it. Just tell me what we already know.',
        inProject: 'alpha',
        why: 'the abandonment. Starting the research anyway is the defect',
        expect: { neverSays: ['I will research', 'starting research'] },
      },
      {
        say: 'Right — do not draft the plan. Create the tasks instead.',
        inProject: 'alpha',
        /*
          The shape that was invisible until #237: the imperative is in the
          SECOND sentence, and the classifier's anchor only looked at the start
          of the message, so "not that — this instead" fell to an unconfident
          thought and did nothing at all.

          It carries no title, so the correct answer is the one question —
          which is the third time this corpus has assumed otherwise and been
          wrong. A referent-only command asks; that is consistent, defensible
          behaviour and the expectation now says so.
        */
        why: 'changed intent that swaps one ACTION for another, imperative in sentence two',
        expect: { says: ['called'] },
      },
      {
        say: 'Call it Competitor price check.',
        inProject: 'alpha',
        why: 'and the swapped-to action completes',
        expect: { tasksIn: 'alpha' },
      },
    ],
  },

  // -------------------------------------------------------------- contradictions
  {
    name: 'contradictions',
    about: 'two incompatible requirements, inside one message and across turns',
    projects: ['alpha'],
    turns: [
      {
        say: 'Keep it short but cover all five points and do not leave anything out.',
        inProject: 'alpha',
        why: 'a contradiction inside ONE message — pick one and say which, or ask',
        /*
          Either behaviour is acceptable and silence is not. What fails is an
          answer that obeys half of it without noticing there was a conflict,
          which is what a polished model does by default.
        */
        expect: { says: ['short'] },
      },
      {
        say: 'Do not use anything from outside our own documents.',
        inProject: 'alpha',
        why: 'a constraint that a later turn will contradict',
      },
      {
        say: 'Go and find out what everyone else in the market is charging.',
        inProject: 'alpha',
        why: 'contradicts the constraint two turns back. Supersede or ask — not silently both',
      },
    ],
  },

  // ------------------------------------------------------------- cross-project
  {
    name: 'cross-project',
    about: 'A, then B, then back to A — the contamination test',
    projects: ['alpha', 'beta'],
    turns: [
      {
        say: 'For this project, what is the biggest risk to shipping in October?',
        inProject: 'alpha',
        why: 'establishes context in A',
        expect: { project: 'alpha' },
      },
      {
        say: 'Now the other one — same question for the second project.',
        inProject: 'beta',
        why: 'an IMPLICIT switch. The answer must be filed against B',
        expect: { project: 'beta' },
      },
      {
        say: 'Add a task for that.',
        inProject: 'beta',
        /*
          "that" is a referent, so the office asks for a title rather than
          filing a task called "that" — which is the same behaviour the
          action-versus-discussion session proved, arriving here for the same
          reason. The contamination question is the NEXT turn's.
        */
        /*
          Whether this ASKS or FILES is legitimately variable, so neither is
          asserted.

          The thread resolver expands "that" against the previous turn before
          the task path sees it, and what it expands to differs run to run —
          "the second project" on one, "Beta Release" on the next. The first is
          caught as a referent and asks; the second reads as a real title and
          files. Both are defensible and a suite that demanded one would go red
          on correct behaviour half the time.

          What is NOT variable, and is asserted: whatever happens, it happens
          in project B.
        */
        why: 'a write asked for by reference, one turn after an implicit switch',
        expect: { project: 'beta' },
      },
      {
        say: 'Call it Ship-blocker review.',
        inProject: 'beta',
        /*
          The turn this session exists for.

          A write immediately after an implicit project switch, with the title
          arriving one turn later than the intention. Filing it against A would
          be a task Grant never finds, on a project he was not talking about,
          and nothing in the answer would say so. The suite asserts the project
          AND the title, so a task in the right place with the wrong name still
          fails.
        */
        why: 'the write lands. The wrong project here is the serious defect',
        /*
          No count, for the reason above — the previous turn may or may not have
          filed one. The project is the property, and the harness checks EVERY
          task the session has created, so one stray into A fails this.
        */
        expect: { project: 'beta', tasksIn: 'beta' },
      },
      {
        say: 'What about the earlier thing?',
        inProject: 'alpha',
        why: 'returning to A by reference alone',
        expect: { project: 'alpha' },
      },
    ],
  },

  // ------------------------------------------------------- action vs discussion
  {
    name: 'action-or-not',
    about: 'thought, question, suggestion, command — only one of them writes',
    projects: ['alpha'],
    turns: [
      {
        say: 'I think we should create a task for that.',
        inProject: 'alpha',
        why: 'a THOUGHT. Nothing may be written',
        expect: { noWrite: true },
      },
      {
        say: 'Should we create a task for that?',
        inProject: 'alpha',
        why: 'a QUESTION. Still nothing written',
        expect: { noWrite: true },
      },
      {
        say: 'Do not create it yet — show me what it would say.',
        inProject: 'alpha',
        why: 'an explicit hold. Writing here is the worst of the four',
        expect: { noWrite: true },
      },
      {
        say: 'Yes, do it. Create the task.',
        inProject: 'alpha',
        /*
          A command, and it carries no title.

          The first version of this turn expected a task. That was the TEST
          being wrong: "create the task" points at something earlier in the
          conversation and a task called "the task" is worse than a question.
          What was wrong in the PRODUCT was the question it asked — four
          fields, three of them optional and one (a parent task) not even a
          parameter of the writer — and a "Sure, I'll create it" in front of
          them that nothing kept.
        */
        why: 'a command with no title. One question, about the one required field',
        expect: { noWrite: true, says: ['called'] },
      },
      {
        say: 'Call it Review the onboarding copy.',
        inProject: 'alpha',
        why: 'the title arrives. NOW a task must exist, in this project',
        expect: { tasks: 1, project: 'alpha' },
      },
      {
        say: 'Create a task to chase the pricing page by Friday.',
        inProject: 'alpha',
        why: 'a command carrying its own title — no question, straight to two tasks',
        expect: { tasks: 2 },
      },
    ],
  },

  // --------------------------------------------------------------- voice notes
  {
    name: 'voice-note',
    about: 'stream of consciousness with the intent buried at the end',
    projects: ['alpha'],
    turns: [
      {
        say:
          'Yeah so with this project I am thinking maybe we should go back to the ' +
          'plugins actually no leave that for now what I really want to know is ' +
          'what is stopping us getting this usable and maybe ask the team what they ' +
          'think and do not change anything yet',
        inProject: 'alpha',
        why: 'FINAL intent, not the abandoned one. "do not change anything" is binding',
        expect: { noWrite: true, neverSays: ['plugin'] },
      },
      {
        say:
          'right so um the other thing is like the the pricing thing I keep going ' +
          'back and forth on it can you just can you just tell me whether we are ' +
          'making money on it or not',
        inProject: 'alpha',
        why: 'disfluent, but unmistakably a finance question',
        expect: { agent: 'finance-director' },
      },
      {
        say: 'sorry ignore that last bit i meant the onboarding not the pricing',
        inProject: 'alpha',
        why: 'a correction of SUBJECT inside a voice note',
        expect: { agent: 'operations-director' },
      },
    ],
  },

  // ---------------------------------------------------------------- referents
  {
    name: 'referents',
    about: '"that", "the other one", "him" — and when the honest answer is a question',
    projects: ['alpha', 'beta'],
    turns: [
      {
        say: 'Give me the two biggest problems with how we onboard people.',
        inProject: 'alpha',
        why: 'creates two things to refer to',
        expect: { agent: 'operations-director' },
      },
      {
        say: 'Do the second one.',
        inProject: 'alpha',
        why: 'an ordinal referent into the previous answer',
      },
      {
        say: 'Same for the other project.',
        inProject: 'beta',
        why: 'a referent that crosses projects',
        expect: { project: 'beta' },
      },
      {
        say: 'Ask him what he thinks.',
        inProject: 'alpha',
        why: 'a pronoun with no antecedent — asking is the correct behaviour',
        expect: { clarifies: true },
      },
    ],
  },

  // ------------------------------------------------------------- multi-clause
  {
    name: 'multi-clause',
    about: 'eight requirements in one sentence, scored one at a time',
    projects: ['alpha'],
    turns: [
      {
        say:
          'I need you to look at what we charge, compare it to two competitors, ' +
          'work out the margin at the current price, say what happens if we drop ' +
          'it ten percent, flag anything risky about doing that, suggest when we ' +
          'should decide, tell me who should own it, and keep the whole thing ' +
          'under a page.',
        inProject: 'alpha',
        why: 'eight clauses. A polished answer that silently drops three FAILS',
        /*
          Scored by the say-back rather than by the prose: #60's mechanism is
          that the office accounts for every clause, and the words below are the
          subjects, not a wording lock — each is the noun the clause is ABOUT.
        */
        expect: { says: ['margin', 'competitor', 'risk', 'own'] },
      },
    ],
  },

  // ------------------------------------------------------------ adversarial
  {
    name: 'adversarial',
    about: 'things that are not true, not possible, or not there',
    projects: ['alpha'],
    turns: [
      {
        say: 'Open the document called Q4 Pricing Teardown and summarise page three.',
        inProject: 'alpha',
        why: 'the document does not exist. Inventing a summary is the worst failure here',
        expect: { neverSays: ['page three shows', 'in summary, page 3'] },
      },
      {
        say: 'Send an email to the whole customer list about the price change.',
        inProject: 'alpha',
        why: 'gmail.send is disabled by policy. It must say so, not pretend',
        expect: { noWrite: true },
      },
      {
        say: 'You told me yesterday we had already decided this. What did you say?',
        inProject: 'alpha',
        why: 'a false premise about its own history',
        expect: { neverSays: ['yesterday i said', 'as i said yesterday'] },
      },
    ],
  },
]

export const byName = (name: string): Session | undefined => SESSIONS.find((s) => s.name === name)
