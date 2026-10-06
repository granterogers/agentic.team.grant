/**
 * The showcase layer of the public Sample Office: what makes it demonstrate Agentic Team rather than a project list.
 *
 * `public-plan.ts` is the café's world (projects, tasks, contacts, documents). This is the work the TEAM does inside that world,
 * and it is produced by the real product, not inserted: each turn is a real message to the real team, answered by the real
 * worker while the office is open for seeding, so Claire hands work to a specialist, the specialist answers from the Sample's
 * own papers, and a report is made by the same handler a person's request would reach. What is data here is only what is asked.
 *
 * Pure data: no I/O. `tests/sample/public-showcase-plan.test.ts` checks it against `public-plan.ts`.
 */
import type { PlanTask } from './plan.ts'

export const SHOWCASE_VERSION = 'public-showcase-1'

/**
 * Team HQ's My Tasks lists today's and overdue tasks (it has no other tab), so the personal list is shaped for that view:
 * a believable morning rather than a single reminder.
 */
export const MORE_PERSONAL_TASKS: PlanTask[] = [
  { title: 'Call Gareth Webb about the second sink', due: 0, owner: 'person', labels: ['build'] },
  {
    title: 'Order business cards for the second site',
    due: 0,
    owner: 'person',
    labels: ['marketing'],
  },
]

/** Existing personal tasks whose date moves, by title: the insurance renewal is the morning's job, not next fortnight's. */
export const REDATE_PERSONAL: { title: string; due: number }[] = [
  { title: 'Renew the café public liability insurance for two sites', due: 0 },
]

/**
 * The lessons the first Sample shipped, as retired by the showcase run (matched on the opening words), and what replaces them.
 * They are visible to every visitor on the "What it has learned" page, so they are written as rules a team might really hold,
 * not as instructions to a model.
 */
export const RETIRE_LESSONS_STARTING = [
  'This is the Sample Office, a demo for people trying the product',
  'Nothing can be changed here. Never say you created',
]

export const NEW_LESSONS: { scope: 'global'; body: string }[] = [
  {
    scope: 'global',
    body: 'This is the Sample Office, a demonstration for people trying Team HQ before they have an account. Jordan Reyes, Brightside Café and everything here are made up. If anyone asks what this is, say so plainly.',
  },
  {
    scope: 'global',
    body: 'Nothing a visitor asks for is saved in this demonstration. Say what you would do in a real office, and that creating their own office is how they would do it for real.',
  },
]

export type Turn = {
  /** A stable key: `seed --only=<key>` runs one, and a turn already in the project's thread is not asked twice. */
  key: string
  /** The project's slug as the plan derives it. */
  project: string
  /** Exactly what is said to the team, in Jordan's words. */
  said: string
  /** The answer must contain at least one of these, or the turn is reported as not grounded in the Sample's papers. */
  grounded?: RegExp[]
  /** A made document is a draft awaiting review. true: Jordan approves it (so it is in Docs & Files); false: it stays Needs You. */
  approve?: boolean
  /** Turns that share a thread share this, so "Daniel's summary" resolves to the turn before. Defaults to the key. */
  thread?: string
}

export const TURNS: Turn[] = [
  {
    key: 'budget',
    project: 'riverside-caf-launch',
    said: "Ask Daniel to check the launch budget against the lease and the builder's quote, and tell me where we stand.",
    grounded: [/88,?000/, /38,?800/, /31,?500/, /4,?800/],
    thread: 'budget',
  },
  {
    // The first answer slipped on one sum (it called £2,500 of committed spend £1,500) and counted the contingency twice.
    // The honest response is the product's own second opinion, not an edit: the quality director checks the figures.
    // A first phrasing ("check Daniel's budget summary") failed on a handler error that is recorded as an issue, and the
    // office's own apology is in the thread; this is the same ask made again, which is what the apology invites.
    key: 'budget-check',
    project: 'riverside-caf-launch',
    said: 'Ask Grace to check that the launch budget adds up and that nothing in it is counted twice.',
    grounded: [/88,?000/, /38,?800/, /8,?000/],
  },
  {
    key: 'riverside-report',
    project: 'riverside-caf-launch',
    said: 'Write me a one-page PDF report on where the Riverside launch has got to.',
    approve: true,
  },
  {
    key: 'menu',
    project: 'autumn-menu-research',
    // Asked of a specialist by name, which the product answers in one clean reading of the project's own papers. Two broader
    // phrasings ("cost the dishes"; "get someone to summarise the survey") went through the planner, which reached for tools
    // this team does not hold and printed their names; both are left out (see HIDDEN_TURNS).
    said: 'Ask Emma what the customer taste survey says about soup and vegetarian options.',
    grounded: [/62\s?%/, /41\s?%/, /butternut/i],
  },
  {
    key: 'caption',
    project: 'winter-market-pop-up',
    said: 'Ask Oliver to draft a short Instagram caption announcing our Winter Market stall.',
  },
  {
    key: 'winter-report',
    project: 'winter-market-pop-up',
    said: 'Write me a PDF report on the Winter Market stall costs for me to look over.',
    approve: false,
  },
  {
    // The first costs report (above) was made, but the thread around it contradicted itself and was left out of the
    // demonstration, which also hid the draft from the Agentic Team tool (the page lists work by its job). The same ask in other
    // words, so the team does not recognise a repeat, gives a draft that is shown: the Needs You example.
    key: 'winter-report-2',
    project: 'winter-market-pop-up',
    said: 'Please put together a one-page PDF summary of the Winter Market stall costs for me to review.',
    approve: false,
  },
  {
    key: 'priorities',
    project: 'unnamed',
    said: 'Claire, which of Riverside Café Launch, Autumn Menu Research and Winter Market Pop-up needs me most this week, and why?',
  },
]

/**
 * Real turns that completed and demonstrated nothing, left out of the demonstration (never deleted: the ledger keeps them, and
 * the flag is `inbound_commands.context.showcase_hidden`, see migration 0903). Matched on the exact words said.
 */
export const HIDDEN_TURNS: string[] = [
  // Asked to "note a decision" in the project's own thread, the team answered "which project do you mean?" and recorded nothing.
  'We have decided on oak boards for the floor, not polished concrete. Concrete is cheaper but colder, and boards are £2,400 more. Please note that decision.',
  // Asked to cost the autumn dishes, the team contradicted itself, said it could not rank them, and left a garbled aside in the answer.
  'Can you get someone to work out which two of the autumn dishes are cheapest to make, using the supplier price comparison?',
  // A good summary arrived beside a second specialist printing "I could not notebook.read: research-director has not been given it".
  'Can you get someone to summarise what the customer taste survey says about soup and vegetarian options?',
  // Asked again by name a few minutes later, the product recognised the repeat and relayed the earlier answer under another name.
  'Ask Emma what the customer taste survey says about soup and vegetarian options.',
  // The report WAS made (and is the Needs You example), but the thread around it is contradictory: two specialists saying they
  // have not done it, a garbled system aside, and a synthesis that disagrees with the last line. The document stands without it.
  'Write me a PDF report on the Winter Market stall costs for me to look over.',
  // Made the Needs You draft, but a specialist said she had uploaded the file to a Drive link nothing created. Left out of the
  // chat; the report itself is shown (SHOW_REPORT_OF).
  'Please put together a one-page PDF summary of the Winter Market stall costs for me to review.',
]

/** Hidden turns whose made report is still listed in the Agentic Team tool (migration 0905). */
export const SHOW_REPORT_OF: string[] = [
  'Please put together a one-page PDF summary of the Winter Market stall costs for me to review.',
]

/**
 * Turns whose answer is filed in the project as a document (the "Add to project" press), so the team can find what a
 * specialist concluded when asked later. Found by asking the Sample "what did Daniel conclude about the launch budget?" and
 * being told there was no record: the conclusion lived only in a chat thread a visitor's questions cannot read.
 */
export const IMPORT_TURNS: string[] = ['budget']

/**
 * Decisions Jordan has made, recorded with the product's own writer (app.record_decision_made), each grounded in the Sample's
 * papers: the builder walkthrough notes (floor) and the launch budget (builder). They are what "Decisions that are settled" shows
 * on "What it has learned", and what the team finds when asked what was decided.
 */
export const DECISIONS: {
  project: string
  question: string
  chose: string
  ruledOut: string[]
  because: string
}[] = [
  {
    project: 'riverside-caf-launch',
    question: 'Which floor for the café?',
    chose: 'Oak boards',
    ruledOut: ['Polished concrete'],
    because:
      'Boards cost £2,400 more, but polished concrete is colder and the room is meant to feel warm. Agreed after the walkthrough with Gareth Webb.',
  },
  {
    project: 'riverside-caf-launch',
    question: 'Who builds the Mill Street fit-out?',
    chose: 'Webb & Sons Builders',
    ruledOut: [],
    because:
      'Their £31,500 quote is accepted, 30% is due at the start, and Gareth Webb can be on site within ten days.',
  },
]

/** An agent asking for a tool it does not hold: the Requests page's concept, made with the product's own writer. */
export const TOOL_REQUEST = {
  staff: 'Oliver',
  tool: 'gmail.send',
  whatFor:
    'Send the reply to Priya Nair about the break clause, once you have approved the wording. It would be drafted for you first; nothing is sent without your yes.',
}

/** A standing instruction, repeated on a schedule: the Automations tab's concept, made with the product's own writer. */
export const AUTOMATION = {
  project: 'riverside-caf-launch',
  who: 'Marcus',
  instruction:
    'Every Monday morning, list what is overdue or due this week on the Riverside launch, who owns each item, and which one needs my decision first.',
  everyMinutes: 10080,
  atTime: '08:00',
}
