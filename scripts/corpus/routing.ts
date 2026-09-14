/**
 * The routing corpus — 91 realistic asks, ten linguistic forms.
 *
 * Lives here rather than inside `verify:routing-breadth` because two things
 * now read it: that suite, which measures accuracy against it, and
 * `npm run breadth`, which counts how many of Grant's coverage dimensions have
 * any cases at all. CLAUDE.md: a list built twice is a list that will disagree,
 * and a coverage model built from a second copy of the corpus would report
 * coverage the suite does not actually have.
 *
 * Mutation (#235, workstream H) appends here. Grant's requirement is that
 * *"every genuine routing defect should produce permanent nearby regression
 * variants"* — so a variant that catches something is added to this file and
 * stays, rather than being generated fresh each run where it could quietly
 * stop being generated.
 */

import type { RoleSlug } from '../../src/agents/router.ts'

/**
 * A case. `wants` is who should get it; `also` are answers a reasonable person
 * would accept.
 *
 * `form` records HOW it is phrased, so the report can say whether failures
 * cluster in one linguistic form — which is the difference between "routing is
 * weak" and "routing cannot handle speech".
 */
export type Form =
  | 'explicit' // names the domain in its own words
  | 'synonym' // domain words, but not the ones in the expertise list
  | 'indirect' // describes the problem, never names the domain
  | 'colloquial' // how a person actually talks
  | 'vague'
  | 'command'
  | 'assignment'
  | 'long' // multi-clause
  | 'speech' // stream of consciousness, disfluencies
  | 'typo'
export type Case = {
  readonly wants: RoleSlug | 'nobody'
  readonly also?: readonly RoleSlug[]
  readonly form: Form
  readonly ask: string
  /*
    A control whose subject genuinely belongs to a specialist.

    Kept in the corpus and still reported, but excluded from the
    false-positive assertion, because sending an operations question to the
    operations director is the vocabulary WORKING — it is only a control in
    the weaker sense that a timestamp lookup does not need a specialist. The
    assertion is about chatter and administrivia summoning nobody; a case that
    names a real operations noun tests the opposite thing and would make the
    guard fire on correct behaviour.
  */
  readonly defensible?: true
}

/*
  The corpus.

  Written to test CONCEPTS. The `explicit` cases exist as a control — if those
  fail, something is broken rather than merely narrow — and everything else
  deliberately avoids the obvious vocabulary. Grant's own examples are in here
  verbatim, because they are the ones he will actually ask.
*/
export const CORPUS: readonly Case[] = [
  // ---------------------------------------------------------------- finance
  {
    wants: 'finance-director',
    form: 'explicit',
    ask: 'What is our gross margin on the middle tier?',
  },
  {
    wants: 'finance-director',
    form: 'explicit',
    ask: 'Can you model the revenue impact of a price change?',
  },
  {
    wants: 'finance-director',
    form: 'synonym',
    ask: 'How much money are we actually making per customer?',
  },
  {
    wants: 'finance-director',
    form: 'synonym',
    ask: 'What is the unit economics of the coaching course?',
  },
  { wants: 'finance-director', form: 'indirect', ask: 'Run the numbers if we sell it cheaper.' },
  { wants: 'finance-director', form: 'indirect', ask: 'Can we afford to discount this?' },
  {
    wants: 'finance-director',
    form: 'indirect',
    ask: 'How badly would knocking fifteen percent off hurt profitability?',
  },
  {
    wants: 'finance-director',
    form: 'colloquial',
    ask: 'Are we actually making money on this thing or not?',
  },
  {
    wants: 'finance-director',
    form: 'vague',
    ask: 'I want to understand the money side of the relaunch.',
  },
  {
    wants: 'finance-director',
    form: 'command',
    ask: 'Work out what it costs us to deliver one of these.',
  },
  {
    wants: 'finance-director',
    form: 'speech',
    ask: 'so I was thinking about the, the pricing thing, and whether we can actually afford to come down a bit, what does that do to us',
  },
  { wants: 'finance-director', form: 'typo', ask: 'whats our margin liek on the middle teir?' },
  {
    wants: 'finance-director',
    form: 'long',
    ask: 'Two things — first, what does a fifteen percent cut do to the margin, and second, how many extra sales would we need to stand still afterwards?',
  },

  // ------------------------------------------------------------- operations
  {
    wants: 'operations-director',
    form: 'explicit',
    ask: 'What is the bottleneck in our onboarding process?',
  },
  {
    wants: 'operations-director',
    form: 'explicit',
    ask: 'Can we review the capacity of the delivery schedule?',
  },
  {
    wants: 'operations-director',
    form: 'synonym',
    ask: 'Where does the workflow slow down when a client signs up?',
  },
  {
    wants: 'operations-director',
    form: 'indirect',
    ask: 'Where are things getting stuck when somebody joins?',
  },
  {
    wants: 'operations-director',
    form: 'indirect',
    ask: 'Onboarding takes eleven days and it should take three. Why?',
  },
  {
    wants: 'operations-director',
    form: 'colloquial',
    ask: 'Everything grinds to a halt once they sign. What is going on?',
  },
  {
    wants: 'operations-director',
    form: 'vague',
    ask: 'The way we run things after a sale feels clunky.',
  },
  {
    wants: 'operations-director',
    form: 'command',
    ask: 'Map out every step from signup to first session and tell me which one is slowest.',
  },
  {
    wants: 'operations-director',
    form: 'speech',
    ask: 'right so people sign up and then, and then nothing happens for like a week, and I do not know where the hold up actually is',
  },
  {
    wants: 'operations-director',
    form: 'assignment',
    ask: 'I need you to find the hold-up in how we deliver this.',
  },
  { wants: 'operations-director', form: 'typo', ask: 'wheres the bottlneck in the onbaording' },

  // ---------------------------------------------------------- quality / risk
  {
    wants: 'quality-director',
    form: 'explicit',
    ask: 'What are the risks of shipping the payment change on Friday?',
  },
  {
    wants: 'quality-director',
    form: 'explicit',
    ask: 'Can you audit this for accuracy before it goes out?',
  },
  {
    wants: 'quality-director',
    form: 'synonym',
    ask: 'What is the exposure if this goes wrong in front of a customer?',
  },
  {
    wants: 'quality-director',
    form: 'indirect',
    ask: 'What could bite us if we push this live Friday?',
  },
  {
    wants: 'quality-director',
    form: 'indirect',
    ask: 'What could go wrong if we ship this on a Friday afternoon?',
  },
  {
    wants: 'quality-director',
    form: 'indirect',
    ask: 'Is there anything in here that contradicts what we said last month?',
  },
  {
    wants: 'quality-director',
    form: 'colloquial',
    ask: 'Talk me out of doing this. What am I missing?',
  },
  {
    wants: 'quality-director',
    form: 'vague',
    ask: 'I am nervous about this one. Give it a proper look.',
  },
  { wants: 'quality-director', form: 'command', ask: 'Check this over properly before I send it.' },
  {
    wants: 'quality-director',
    form: 'speech',
    ask: 'I keep going back and forth on whether this is safe to do, like what happens if it breaks on a Friday and nobody is around',
  },
  { wants: 'quality-director', form: 'typo', ask: 'what culd go wrong if we shipp this friday' },

  // ---------------------------------------------------------------- strategy
  {
    wants: 'strategy-director',
    form: 'explicit',
    ask: 'Should we enter the enterprise market or stay with SMB?',
  },
  {
    wants: 'strategy-director',
    form: 'explicit',
    ask: 'What are our options for the direction of the business next year?',
  },
  {
    wants: 'strategy-director',
    form: 'synonym',
    ask: 'Are we better going after larger companies or staying focused on smaller customers?',
  },
  {
    wants: 'strategy-director',
    form: 'indirect',
    ask: 'Where should we be pointing this thing in twelve months?',
  },
  {
    wants: 'strategy-director',
    form: 'indirect',
    ask: 'Is it worth changing course, or do we keep doing what we are doing?',
  },
  {
    wants: 'strategy-director',
    form: 'colloquial',
    ask: 'Big picture — what should we actually be betting on?',
  },
  {
    wants: 'strategy-director',
    form: 'vague',
    ask: 'I need to make a call on where this goes next.',
  },
  {
    wants: 'strategy-director',
    form: 'command',
    ask: 'Make the case both ways and tell me which you would pick.',
  },
  {
    wants: 'strategy-director',
    form: 'speech',
    ask: 'so the question really is do we go up market or, or do we just double down where we are, and I honestly cannot decide',
  },
  { wants: 'strategy-director', form: 'typo', ask: 'shold we go enterprize or stay smb' },

  // ------------------------------------------------------------------ growth
  {
    wants: 'growth-director',
    form: 'explicit',
    ask: 'Which acquisition campaign is bringing the best audience?',
  },
  {
    wants: 'growth-director',
    form: 'explicit',
    ask: 'How should we position the brand for the relaunch?',
  },
  {
    wants: 'growth-director',
    form: 'synonym',
    ask: 'Where are our best customers actually coming from?',
  },
  {
    wants: 'growth-director',
    form: 'indirect',
    ask: 'How do we get more of the right people through the door?',
  },
  { wants: 'growth-director', form: 'indirect', ask: 'Which channel should we stop spending on?' },
  {
    wants: 'growth-director',
    form: 'colloquial',
    ask: 'Nobody knows we exist. What do we do about it?',
  },
  { wants: 'growth-director', form: 'vague', ask: 'We need more people signing up.' },
  {
    wants: 'growth-director',
    form: 'command',
    ask: 'Work out who we should be talking to and where they are.',
  },
  {
    wants: 'growth-director',
    form: 'speech',
    ask: 'I think our problem is just that not enough of the right sort of person is finding us in the first place',
  },
  { wants: 'growth-director', form: 'typo', ask: 'which aquisition chanel is working best' },

  // ---------------------------------------------------------- communications
  {
    wants: 'communications-director',
    form: 'explicit',
    ask: 'Draft the announcement email for the pricing change.',
  },
  {
    wants: 'communications-director',
    form: 'explicit',
    ask: 'Can you edit this copy so it reads better?',
  },
  {
    wants: 'communications-director',
    form: 'synonym',
    ask: 'What wording should we use when we tell people about this?',
  },
  {
    wants: 'communications-director',
    form: 'indirect',
    ask: 'How do we say this without sounding apologetic?',
  },
  {
    wants: 'communications-director',
    form: 'indirect',
    ask: 'Put something together that I can send out tomorrow.',
  },
  {
    wants: 'communications-director',
    form: 'colloquial',
    ask: 'Make this sound less like a robot wrote it.',
  },
  {
    wants: 'communications-director',
    form: 'vague',
    ask: 'I need to tell everyone about the change and I do not know how to phrase it.',
  },
  {
    wants: 'communications-director',
    form: 'command',
    ask: 'Write the short version for the phone.',
  },
  {
    wants: 'communications-director',
    form: 'speech',
    ask: 'so I need to let people know about the price thing but I do not want it to sound like we are, you know, making excuses',
  },
  {
    wants: 'communications-director',
    form: 'typo',
    ask: 'draft teh anouncement for the pricing chnage',
  },

  // ---------------------------------------------------------------- research
  {
    wants: 'research-director',
    form: 'explicit',
    ask: 'Find out what the competitors are charging.',
  },
  {
    wants: 'research-director',
    form: 'explicit',
    ask: 'Compare the three main alternatives and benchmark them.',
  },
  { wants: 'research-director', form: 'synonym', ask: 'What is the evidence for that claim?' },
  {
    wants: 'research-director',
    form: 'indirect',
    ask: 'What is everyone else in this space doing?',
  },
  {
    wants: 'research-director',
    form: 'indirect',
    ask: 'Dig into how the other lot package theirs.',
  },
  {
    wants: 'research-director',
    form: 'colloquial',
    ask: 'Go and have a proper look at what is out there.',
  },
  {
    wants: 'research-director',
    form: 'vague',
    ask: 'I want to know more about this before I decide.',
  },
  {
    wants: 'research-director',
    form: 'command',
    ask: 'Pull together everything we know about the market.',
  },
  {
    wants: 'research-director',
    form: 'speech',
    ask: 'can you go and find out what, what other people charge for this sort of thing, roughly',
  },
  { wants: 'research-director', form: 'typo', ask: 'find out what competitos are chargin' },

  // ------------------------------------------- negative controls: Claire only
  { wants: 'nobody', form: 'explicit', ask: 'What is the status of the migration?' },
  { wants: 'nobody', form: 'explicit', ask: 'What documents do we have on this project?' },
  {
    wants: 'nobody',
    form: 'explicit',
    ask: 'What time did the backup finish?',
    defensible: true,
  },
  { wants: 'nobody', form: 'colloquial', ask: 'How are we doing?' },
  { wants: 'nobody', form: 'colloquial', ask: 'Morning. Anything I should know about?' },
  { wants: 'nobody', form: 'explicit', ask: 'Is that done yet?' },
  { wants: 'nobody', form: 'vague', ask: 'Do we have anything on record about that?' },
  { wants: 'nobody', form: 'explicit', ask: 'What is on my plate this week?' },
  { wants: 'nobody', form: 'colloquial', ask: 'Thanks, that is helpful.' },
  { wants: 'nobody', form: 'explicit', ask: 'Remind me what we called that project.' },

  // -------------------------------------------------------- overlapping work
  {
    wants: 'finance-director',
    also: ['strategy-director'],
    form: 'long',
    ask: 'If we move up market, what does that do to our pricing and is it the right call?',
  },
  {
    wants: 'growth-director',
    also: ['communications-director'],
    form: 'long',
    ask: 'Who should we be targeting with the relaunch and what should the messaging say?',
  },
  {
    wants: 'operations-director',
    also: ['quality-director'],
    form: 'long',
    ask: 'Our delivery process keeps slipping and I think it is causing mistakes. Look at both.',
  },
  {
    wants: 'research-director',
    also: ['strategy-director'],
    form: 'long',
    ask: 'Find out what the competition charges and tell me whether we should match them.',
  },
  {
    wants: 'finance-director',
    also: ['growth-director'],
    form: 'long',
    ask: 'What does it cost us to acquire a customer and is that channel worth keeping?',
  },
  {
    wants: 'communications-director',
    also: ['quality-director'],
    form: 'long',
    ask: 'Draft the incident note and check it does not overstate what we know.',
  },
]
