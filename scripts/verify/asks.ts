/**
 * Does ordinary paraphrasing decide whether the office acts?
 *
 *   npm run verify:asks
 *
 * The acceptance instrument for #249. Not an accuracy score against a fixed
 * vocabulary — the criterion Grant set is SEMANTIC INVARIANCE UNDER ORDINARY
 * PARAPHRASING, so the matrix is built by taking one intention and saying it
 * the ten ways a person says things.
 *
 * ## Both halves, always, and the second one is the dangerous one
 *
 * Recall and precision are reported together and both gate the exit code,
 * because the cheapest way to pass a recall test is to call everything an
 * action. Grant's words: *"we do NOT want 'I wonder whether we should email
 * them' to become an email action merely because the semantic recogniser sees
 * EMAIL."*
 *
 * A missed instruction costs one turn and Grant can see it. A fabricated
 * action is not recoverable. So the controls are weighted accordingly: the
 * suite fails on ANY control that flips, and tolerates a recall miss.
 *
 * ## Held out from the implementation
 *
 * `TUNED` is what the abstraction was written against — the eight failures the
 * examinations found, plus their obvious neighbours. `HELD_OUT` was written
 * afterwards, in one pass, without running it, and the implementation has not
 * been touched since. The two are reported separately, because a score on
 * cases the code was shaped around is not evidence about paraphrase invariance
 * and CLAUDE.md records what happens when the difference is forgotten.
 */
import { clauses } from '../../src/agents/clauses.ts'
import { asksForAction, readRequest } from '../../src/agents/request.ts'

const acts = (say: string): boolean => asksForAction(readRequest(say, clauses))

/** One intention, said the ways people say it. Written against the failures. */
const TUNED: readonly [string, string][] = [
  ['imperative', 'Create a task to chase the supplier quote.'],
  ['indirect object', 'Make me a task to chase the supplier quote.'],
  ['project named', 'Put a task on alpha to get three build quotes by the end of next week.'],
  ['shorthand', 'Task: chase the supplier for the revised quote.'],
  ['idiomatic', 'Stick chasing the supplier on my list for Friday.'],
  ['multi-clause', 'Work out where we stand on the refund policy and draft what I send them.'],
  ['indirect request', 'I need someone to look at the refund policy and write the reply.'],
  ['conversational', 'Can you sort out what we tell the customer about the refund?'],
  ['plain imperative', 'Sort out what we tell the customer about the refund.'],
  ['another verb', 'Handle the supplier chase for me this week.'],
  ['get X done', 'Get the three build quotes in before next Friday.'],
  ['want', 'I want the margin impact worked out before Friday.'],
  ['go-ahead', 'Go ahead and put together the case for taking the stand.'],
  ['can you', 'Can you pull together what we know about the supplier dispute?'],
  ['delegated', 'Get Emma to look at the refund policy this afternoon.'],
  ['board framing', 'Could you put a task on the board to chase the quote?'],
]

/**
 * Written after the implementation was finished, in one pass, unrun.
 *
 * New verbs, new objects, new shapes. If the abstraction is grammatical these
 * score the same as the tuned set; if it has quietly become another phrase
 * list they will not.
 */
const HELD_OUT: readonly [string, string][] = [
  ['object first', 'That supplier — chase them Friday.'],
  ['bare verb, new', 'Draft the note to the landlord about the lease break.'],
  ['bare verb, new 2', 'Pull the numbers on last quarter s returns.'],
  ['bare verb, new 3', 'Tidy up the onboarding checklist before Monday.'],
  ['bare verb, new 4', 'Book a slot with the accountant for next week.'],
  ['bare verb, new 5', 'Chase the landlord about the deposit.'],
  ['bare verb, new 6', 'Summarise where the lease negotiation got to.'],
  ['let us', "Let's get the insurance quote moving this week."],
  ['need, no person', 'I need the lease break clause checked before Thursday.'],
  ['would like', 'I would like a note drafted for the landlord.'],
  ['polite, new verb', 'Could you tidy the supplier list up for me?'],
  ['will you', 'Will you chase the accountant about the year end?'],
  ['delegated, new', 'Have Marcus look at the delivery schedule.'],
  ['delegated, new 2', 'Ask Grace to check the lease for anything nasty.'],
  ['todo shorthand', 'TODO: renew the insurance before the 30th.'],
  ['two actions', 'Check the lease break date and then draft the notice.'],
  ['analysis then action', 'Work out what the deposit is worth and put it in a note.'],
  ['correction to an action', "Actually don't email the landlord; make it a task instead."],
  ['imperative with adverb', 'Quietly sound out whether the landlord would renegotiate.'],
  ['phrasal verb', 'Follow up with the accountant on the year end.'],
  /*
    An action with a prohibition attached to the OTHER clause. This began life
    as a control, asserting that the whole message was not an action, and that
    control was simply wrong: a reasonable person reads "make a note of it but
    do not send anything" as an instruction to make a note. Per-clause reading
    is what gets both halves right, and the precision control below checks the
    second half separately.
  */
  ['action plus a prohibition on the other clause', 'Make a note of it but do not send anything.'],
]

/**
 * The controls, and they matter more than the cases above.
 *
 * Every one of these contains something that looks like an action — a verb, a
 * capability, an object — and none of them is one.
 */
const CONTROLS: readonly [string, string][] = [
  ['a musing with a capability in it', 'I wonder whether we should email them about the deposit.'],
  ['a musing, plain', 'I keep wondering whether the stand is worth it at all.'],
  ['a question', 'What did the stand cost us last year?'],
  ['a question with a verb', 'Did you draft the note to the landlord?'],
  ['an explicit hold', 'Do not create a task for this yet.'],

  ['a note to self', 'fyi the supplier has gone quiet.'],
  ['a pleasantry', 'Morning.'],
  ['thanks', 'Thanks, that is helpful.'],
  ['a statement of fact', 'Revenue was 1.2m last quarter, up from 0.9m.'],
  ['a statement about a person', 'Emma finished the competitor teardown yesterday.'],
  ['a statement, no determiner', 'Deposit is held by the agent, not the landlord.'],
  ['a hypothetical', 'Suppose we chased the landlord this week — would that help?'],
  ['a supposition, plain', 'If we drafted the notice now it would land before the break date.'],
  ['an example', 'Something like drafting a notice, for example, would be premature.'],
  ['a quotation of somebody else', 'The landlord said chase the agent instead.'],
  ['a rejected action', 'I decided against emailing them in the end.'],
  ['a maybe', 'Maybe draft something for the landlord at some point.'],
  ['a past action', 'I chased the accountant myself this morning.'],
  ['a feeling', 'My instinct is to hold off on the lease notice.'],
  ['the prohibited half, alone', 'Do not send anything to the landlord.'],
  ['a prohibition with a verb', 'Never chase the agent without telling me first.'],
]

/**
 * Semantic mutations — the same non-action, said other ways.
 *
 * Grant's instruction: run mutations beyond the development examples. These
 * were generated from the SHAPE of each control rather than from its wording,
 * so a recogniser that has quietly memorised the controls scores worse here
 * than on them. Every one contains a supported capability by name, which is
 * what makes them the dangerous set: the failure mode is seeing EMAIL or TASK
 * and acting.
 */
const MUTATIONS: readonly [string, string][] = [
  ['speculation, new', 'It might be worth emailing the agent about the deposit at some point.'],
  ['speculation, new 2', 'There is an argument for drafting the notice now rather than later.'],
  ['question, new', 'Would a task help here, or is it too small to bother with?'],
  ['question, new 2', 'Is chasing the roofer something you can even do from here?'],
  ['quotation, new', 'Her exact words were "just put a task on it and move on".'],
  ['quotation, new 2', 'The email said draft a response within five working days.'],
  ['example, new', 'Take something like adding a task — that is the kind of thing I mean.'],
  ['example, new 2', 'For instance, drafting the notice would be one option among several.'],
  ['rejected, new', 'We looked at emailing them and decided not to.'],
  ['rejected, new 2', 'I was going to make a task for it and then thought better of it.'],
  ['past, new', 'I drafted the notice myself over the weekend.'],
  ['past, new 2', 'Emma already put a task on the board for the roofing quote.'],
  ['hypothetical, new', 'If we made a task for every one of these the list would be useless.'],
  ['hypothetical, new 2', 'Say we drafted it today — would the landlord even read it?'],
  ['prohibition, new', 'On no account chase the agent before I have spoken to him.'],
  ['prohibition, new 2', 'Leave the insurance renewal alone until the survey is back.'],
  ['report, new', 'The roofer says he will send the quote on Monday.'],
  ['report, new 2', 'Insurance renews on the 30th and the premium has gone up.'],
  ['preference, new', 'I prefer these things as a task rather than an email.'],
  ['opinion, new', 'Drafting it now feels premature to me.'],
]

const report = (
  label: string,
  cases: readonly [string, string][],
  want: boolean,
): { hit: number; total: number; misses: string[] } => {
  const misses: string[] = []
  let hit = 0
  for (const [name, say] of cases) {
    const got = acts(say)
    if (got === want) hit++
    else misses.push(`${name}: ${JSON.stringify(say.slice(0, 62))}`)
  }
  console.log(`\n${label}: ${String(hit)}/${String(cases.length)}`)
  for (const m of misses) console.log(`   miss  ${m}`)
  return { hit, total: cases.length, misses }
}

const tuned = report('ACTION RECALL — tuned set (written against the failures)', TUNED, true)
const held = report('ACTION RECALL — held out (written after the code, unrun)', HELD_OUT, true)
const ctrl = report('PRECISION — controls, none of which is an action', CONTROLS, false)
const mut = report('PRECISION — semantic mutations, generated from the shapes', MUTATIONS, false)

const recall = (tuned.hit + held.hit) / (tuned.total + held.total)
const precision = (ctrl.hit + mut.hit) / (ctrl.total + mut.total)

console.log('\n| measure | result | gate |')
console.log('|---|---|---|')
console.log(
  `| action recall, both sets | ${String(tuned.hit + held.hit)}/${String(tuned.total + held.total)} (${(recall * 100).toFixed(0)}%) | ≥ 85% |`,
)
console.log(
  `| held-out recall alone | ${String(held.hit)}/${String(held.total)} (${((held.hit / held.total) * 100).toFixed(0)}%) | ≥ 85% |`,
)
console.log(
  `| control precision, both sets | ${String(ctrl.hit + mut.hit)}/${String(ctrl.total + mut.total)} (${(precision * 100).toFixed(0)}%) | 100% |`,
)

/*
  Precision is absolute and recall is not, deliberately. A control that flips
  is an action the office might take that Grant did not ask for; a recall miss
  is a turn where he has to say it again. Those are not the same cost and the
  gate should not pretend they are.
*/
const ok = precision === 1 && recall >= 0.85 && held.hit / held.total >= 0.85
console.log(`\n${ok ? 'PASS' : 'FAIL'}`)
process.exit(ok ? 0 : 1)
