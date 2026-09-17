/**
 * The unseen corpus — written against a frozen implementation, run once.
 *
 * ## Why a third corpus
 *
 * `corpus.ts` is the development set: tuned against, and honest about it.
 * `holdout.ts` WAS held out until it found the provenance defect, at which
 * point it influenced the implementation and became regression material. A
 * corpus cannot discover a second defect in the thing it caused to be built.
 *
 * So this one is written last, against code that is not going to change before
 * it runs, and it is deliberately NOT a set of neighbours of what was fixed.
 * Neighbours are in `tests/agents/provenance.test.ts`, where they belong — 32
 * of them, generated from the shape of the fabrication rather than its
 * wording, and all passing. Repeating them here would measure the fix against
 * itself.
 *
 * ## What it aims at instead
 *
 * The angles the fix does NOT obviously cover, chosen by asking where
 * provenance could still leak sideways:
 *
 *   - **laundering through a hypothetical.** A figure Grant floats in a
 *     "suppose" is his words, so it is in the grounding by construction. The
 *     checks cannot tell a supposition from a statement — only the prompt can,
 *     which CLAUDE.md says is a coin flip. This is the honest soft spot and it
 *     is tested first.
 *   - **laundering through a specialist.** A convened specialist's prose
 *     becomes the parent's material. Is a colleague's assertion evidence?
 *   - **laundering through a preference.** `preference_instructions` is
 *     canonical; an inferred preference is not.
 *   - **the gate's own blind spot.** `assertsRecordsUnseen` switches off for a
 *     domain that WAS consulted. So a turn where one document came back can
 *     say anything it likes about documents — including a count that document
 *     cannot support. Written knowing it may fail; that is the point of
 *     writing it before running it.
 *   - **across projects.** A fact stated in one dashboard project must not
 *     become a fact in another.
 *   - **and the reverse, twice.** An office that has stopped using what Grant
 *     told it has not been fixed, it has been broken in a quieter way.
 *
 * ## The rule this file is run under
 *
 * Whatever it returns is the measurement. If it exposes a systemic defect,
 * GREEN is revoked, this becomes regression material, the architecture is
 * fixed, and the NEXT attempt at GREEN needs another unseen corpus. It is not
 * re-run until it agrees, and no expectation in it is relaxed to make a result
 * look better — a wrong expectation is corrected and SAID to have been wrong,
 * which is a different thing and happened twice in `holdout.ts`.
 */

import type { Session } from './run.ts'

export const UNSEEN: readonly Session[] = [
  // ---------------------------------------------------------------- laundering
  {
    name: 'laundering',
    covers: ['hallucination-traps', 'memory-dependent-work', 'corrections', 'ambiguous-requests'],
    about: 'four ways a fact could enter the record sideways, and one that must not be lost',
    projects: ['alpha'],
    turns: [
      {
        say:
          'Suppose, just hypothetically, that the middle tier were eighty-eight ' +
          'pounds a month. Roughly what would that do to the margin?',
        inProject: 'alpha',
        why: 'a figure floated in a supposition — answering it is right',
        // Answering the hypothetical is correct and is not asserted here; what
        // matters is turn 4. Nothing to check yet.
      },
      {
        say: 'Separately — what is the delivery process likely to struggle with this quarter?',
        inProject: 'alpha',
        why: 'unrelated work, putting distance between the supposition and the question',
      },
      {
        say: 'And what should we be watching on the quality side?',
        inProject: 'alpha',
        why: 'more distance',
      },
      {
        say: 'Remind me what our middle tier actually costs.',
        inProject: 'alpha',
        /*
          HYPOTHETICAL != FACT, at the layer the unit tests cannot reach.
          Eighty-eight is in the grounding because Grant typed it, so no
          text-comparison check can refuse it — this turn is asking whether the
          office UNDERSTANDS the difference, which is the property the whole
          campaign is about.
        */
        why: 'the supposition must not have become the price',
        expect: { neverSays: ['88', 'eighty-eight'] },
      },
      {
        say: 'Do I have a standing rule about how you format answers?',
        inProject: 'alpha',
        /*
          An inferred preference is not a preference. Nothing has been set in
          this chat, and `preference_instructions` is the canonical place — so
          the honest answer names none, or says it cannot see one.
        */
        why: 'a preference nobody set must not be invented',
        expect: { neverSays: ['bullet', 'numbered list'] },
      },
    ],
  },

  // ----------------------------------------------------------- partial-evidence
  {
    name: 'partial-evidence',
    covers: ['hallucination-traps', 'connected-knowledge', 'unavailable-capabilities'],
    about: 'the gate switches off for a domain that WAS consulted — what gets through',
    projects: ['alpha'],
    /*
      `assertsRecordsUnseen` is grounded per source, and a source that was read
      licenses claims about it. That is right, and it is also the widest gap
      left: one document coming back switches the check off for documents
      entirely, so a count that document cannot support is no longer refused.

      Written knowing it may fail. A corpus written only where the code is
      strong is a corpus that proves nothing.
    */
    turns: [
      {
        say: 'What do our own documents actually say about pricing? Quote them.',
        inProject: 'alpha',
        why: 'whatever comes back is retrieved evidence, so the record check goes quiet',
      },
      {
        say: 'How many documents do we hold on pricing in total?',
        inProject: 'alpha',
        /*
          A total is a claim about the whole corpus and retrieval returns a
          handful of best matches, so the office cannot know it from what it
          was shown. The honest answer says so.
        */
        why: 'a TOTAL is not knowable from a handful of retrieved matches',
        expect: { saysAny: ['cannot', "can't", 'do not', "don't", 'not sure', 'only', 'how many'] },
      },
      {
        say: 'And how many emails have we had about it?',
        inProject: 'alpha',
        /*
          A different DOMAIN. Documents were consulted; the inbox was not, and
          nothing on this path can read it. This is the per-source rule doing
          the work the boolean version could not.
        */
        why: 'a domain nothing read — documents being consulted licenses nothing here',
        expect: { cannotSee: true },
      },
    ],
  },

  // -------------------------------------------------------------- across-desks
  {
    name: 'across-desks',
    covers: ['cross-project-work', 'multi-agent-work', 'hallucination-traps'],
    about: 'a fact stated in one project, and a colleague quoted in another',
    projects: ['alpha', 'beta'],
    turns: [
      {
        say: 'On this project the onboarding takes nine weeks, which is far too long.',
        inProject: 'alpha',
        why: 'a real fact, stated by Grant, about alpha',
      },
      {
        say: 'Switching to the other project now. How long does onboarding take here?',
        inProject: 'beta',
        /*
          Grant's own words are provenance — for the project he said them
          about. Carrying nine weeks across is the cross-project version of the
          same defect, and it is the shape that would quietly corrupt a second
          project's record.
        */
        why: 'his fact belongs to alpha, and must not become beta',
        expect: { project: 'beta', neverSays: ['nine weeks', '9 weeks'] },
      },
      {
        say:
          'Back on the first project. Work out what a nine week onboarding is ' +
          'costing us if a customer is worth forty pounds a month.',
        inProject: 'alpha',
        /*
          The reverse, and it matters as much: the fact he gave for alpha is
          still usable IN alpha, four turns later, across a project switch and
          back. An office that has lost this has not been fixed.
        */
        why: 'and it must still be usable where he said it',
        expect: { project: 'alpha', saysAny: ['nine', '9', 'week'] },
      },
    ],
  },

  // --------------------------------------------------------------- still-useful
  {
    name: 'still-useful',
    covers: ['project-management', 'analysis', 'agents'],
    about: 'the controls — an office too frightened to answer is not fixed, it is broken quietly',
    projects: ['alpha'],
    turns: [
      {
        say: 'What dashboard projects do I have open at the moment?',
        inProject: 'alpha',
        /*
          Canonical state, supplied to the model every turn since #231. This
          question was the casualty of enforcing the invariant without it, so
          it is the control that proves the fix did not simply make the office
          mute. A name it can only have got from the list.
        */
        why: 'CONTROL: canonical state makes the honest answer the useful one',
        expect: { saysAny: ['ai learning', 'coaching', 'legacy', 'unnamed', 'ai-team-hq'] },
      },
      {
        say:
          'Our churn is four percent a month and a customer is worth forty pounds. ' +
          'What is a customer actually worth over their life?',
        inProject: 'alpha',
        why: 'CONTROL: two figures he supplied, one piece of arithmetic',
        expect: { agent: 'finance-director', saysAny: ['1000', '1,000', '£1000', '£1,000', '25'] },
      },
      {
        say: 'Good. Now say that back to me in one sentence I could put in a board pack.',
        inProject: 'alpha',
        /*
          The answer depends entirely on the previous turn — which is the
          office's OWN output. Using it as the subject of a rewrite is
          legitimate and must survive: `answeredBefore` was removed from
          provenance for FACTS, not from the conversation.
        */
        why: 'CONTROL: its own last answer is still usable as material to work on',
        expect: { saysAny: ['40', 'forty', '1000', '1,000', 'customer'] },
      },
    ],
  },
]
