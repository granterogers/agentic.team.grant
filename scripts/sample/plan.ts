/**
 * The Sample Person's baseline, as DATA and pure functions. No database, no network, no import that reaches either, so a
 * unit test can read it and assert properties of it (tests/scripts/sample/plan.test.ts).
 *
 * Everything here is fictional. Addresses end `.invalid` (a reserved domain nothing delivers to), telephone numbers are
 * the ranges reserved for fiction, and every figure is invented. Dates are OFFSETS from today, resolved at seed time, so
 * "overdue", "due today" and "due tomorrow" are always true and the fixture never goes stale.
 *
 * Three projects, deliberately different in shape:
 *   Wellness Studio Launch  team-heavy: contacts, a moderate calendar, subtasks under three milestones
 *   2027 Financial Plan     document-heavy: long names and dense content, dated task lists, few contacts
 *   Japan Spring Trip       calendar-heavy: itinerary days, flights, hotel stays, booking deadlines, checklists
 */

export const BASELINE_VERSION = 'sample-baseline-2'

export type TaskState = 'todo' | 'doing' | 'blocked' | 'done'
export type Owner = 'person' | 'team'

export type PlanTask = {
  /** Unique across the whole office: it is the key the seed, the reset and the inventory match on. */
  title: string
  detail?: string
  /** Days from today (negative is the past). Absent means undated. */
  due?: number
  /** Days from today the work starts: a span on the calendar, not a single day. */
  start?: number
  state?: TaskState
  blockedOn?: string
  /** `person` is written as Jordan's own to-do; `team` is written as work for the office (optionally an agent's). */
  owner?: Owner
  /** A specialist's slug. Only team work can be an agent's. */
  agent?: string
  milestone?: boolean
  /** Lower is more important, 100 is ordinary. */
  priority?: number
  labels?: string[]
  /** The title of the task this one sits under. Always appears earlier in the list. */
  parent?: string
}

export type PlanContact = {
  name: string
  role: string
  org: string
  email: string
  phone: string
  website?: string
  note?: string
}

export type PlanDoc = {
  name: string
  mime: 'text/markdown' | 'text/csv' | 'text/plain'
  text: string
  /** Approved on seeding. A file the person drops in is filed approved since 0872; this stays so a baseline can still say it. */
  approve?: boolean
  pinned?: boolean
  tags?: string[]
}

export type PlanProject = {
  name: string
  ref: string
  shape: string
  tasks: PlanTask[]
  contacts: PlanContact[]
  docs: PlanDoc[]
}

// ---------------------------------------------------------------------------------------------------------------------
// dates
// ---------------------------------------------------------------------------------------------------------------------

/** `today` as a calendar day in UTC, the same clock the database uses for "overdue". */
export const isoDay = (today: Date, offset = 0): string => {
  const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()))
  d.setUTCDate(d.getUTCDate() + offset)
  return d.toISOString().slice(0, 10)
}

export type Bucket = 'closed' | 'undated' | 'overdue' | 'today' | 'tomorrow' | 'this_week' | 'later'
export const BUCKETS: Bucket[] = [
  'overdue',
  'today',
  'tomorrow',
  'this_week',
  'later',
  'undated',
  'closed',
]

/** Where a task falls relative to `today`. Closed work is its own bucket whatever its date says. */
export const bucketOf = (due: string | null | undefined, state: string, today: Date): Bucket => {
  if (state === 'done' || state === 'cancelled') return 'closed'
  if (due === null || due === undefined || due === '') return 'undated'
  const d = due.slice(0, 10)
  if (d < isoDay(today, 0)) return 'overdue'
  if (d === isoDay(today, 0)) return 'today'
  if (d === isoDay(today, 1)) return 'tomorrow'
  if (d <= isoDay(today, 7)) return 'this_week'
  return 'later'
}

const bucketOfOffset = (t: PlanTask, today: Date): Bucket =>
  bucketOf(t.due === undefined ? null : isoDay(today, t.due), t.state ?? 'todo', today)

// ---------------------------------------------------------------------------------------------------------------------
// content generators: deterministic, so a seed twice writes the same bytes and the same fingerprint
// ---------------------------------------------------------------------------------------------------------------------

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** A fictional monthly budget, one line per category, 12 months, summed. */
const budgetCsv = (): string => {
  const lines: [string, number, number][] = [
    ['Owner drawings', 2400, 60],
    ['Rent share and utilities', 1150, 15],
    ['Groceries and household', 620, 12],
    ['Transport and van costs', 340, 18],
    ['Insurance (all policies)', 210, 0],
    ['Savings transfer', 800, 25],
    ['Pension contribution', 450, 0],
    ['Holidays and travel', 300, 140],
    ['Health and wellbeing', 120, 6],
    ['Gifts and charity', 90, 20],
  ]
  const rows = [`category,${MONTHS.join(',')},annual`]
  for (const [name, base, wobble] of lines) {
    const cells = MONTHS.map((_, m) => base + ((m * 7 + name.length) % 5) * wobble - 2 * wobble)
    rows.push(`${name},${cells.join(',')},${cells.reduce((a, b) => a + b, 0)}`)
  }
  return `${rows.join('\n')}\n`
}

const cashflowCsv = (): string => {
  const rows = ['month,opening,income,spending,closing,note']
  let bal = 18400
  MONTHS.forEach((m, i) => {
    const income = 3900 + (i % 3 === 0 ? 450 : 0)
    const spend = 3550 + ((i * 11) % 6) * 90
    const close = bal + income - spend
    const note =
      i === 0
        ? 'Payment on account due'
        : i === 6
          ? 'Second payment on account due'
          : i === 11
            ? 'Insurance renewals cluster'
            : ''
    rows.push(`${m},${bal},${income},${spend},${close},${note}`)
    bal = close
  })
  return `${rows.join('\n')}\n`
}

const savingsCsv = (): string =>
  `${[
    'provider (fictional),product,rate_pct,access,minimum,notes',
    'Northfield Savings,Easy access saver,3.9,instant,1,variable rate',
    'Harbour Mutual,One-year fixed,4.6,locked 12 months,500,penalty on early exit',
    'Larkspur Bank,Two-year fixed,4.4,locked 24 months,1000,rate guaranteed',
    'Pennant Building Society,Notice 90 days,4.2,90 days notice,250,interest paid monthly',
    'Quill and Co,Cash ISA,4.1,instant,1,uses this tax year allowance',
  ].join('\n')}\n`

const para = (n: number, topic: string): string =>
  Array.from(
    { length: n },
    (_, i) =>
      `${topic}, point ${i + 1}: the figures here are invented for demonstration, but the structure is the one a real plan ` +
      `would need. State the assumption, state the number it produces, say what would change it, and name who checks it ` +
      `next. Assumption ${i + 1} is held constant unless a later checkpoint says otherwise.`,
  ).join('\n\n')

const longFinanceNarrative = (): string =>
  [
    '# Financial plan 2027: master narrative (fictional)',
    '',
    'Prepared for Jordan Reyes, owner of Brightside Cafe. Every number is invented.',
    '',
    '## 1. Position at the start of the year',
    para(3, 'Opening position'),
    '',
    '## 2. Income',
    para(3, 'Income'),
    '',
    '## 3. Expenditure',
    para(4, 'Expenditure'),
    '',
    '## 4. Savings and investments',
    para(3, 'Savings'),
    '',
    '## 5. Insurance',
    para(2, 'Insurance'),
    '',
    '## 6. Tax',
    para(3, 'Tax'),
    '',
    '## 7. Quarterly checkpoints',
    '| Quarter | Checkpoint | Owner | Evidence |',
    '|---|---|---|---|',
    '| Q1 | Payments on account paid, budget variance under 5 percent | Jordan | bank statements |',
    '| Q2 | Savings pot at 40 percent of target | Planner | savings export |',
    '| Q3 | Insurance renewals compared and decided | Jordan | quote sheet |',
    '| Q4 | Return drafted, next year budget approved | Accountant | draft return |',
    '',
    '## 8. Risk register',
    para(3, 'Risk'),
    '',
  ].join('\n')

const tripDays = (start: number): string => {
  const days = [
    'Arrive at Haneda, ride into Shinjuku, check in, an easy evening walk',
    'Asakusa and the river, then Akihabara in the evening',
    'Day trip to Nikko by rail',
    'Tsukiji outer market breakfast, then travel to Kyoto',
    'Fushimi Inari at opening time, Gion in the evening',
    'Arashiyama bamboo grove and the temple route',
    'Nara deer park and Todai-ji',
    'Free day in Kyoto: markets and a tea ceremony',
    'Travel to Osaka, Dotonbori at night',
    'Osaka Castle, then the aquarium',
    'Himeji Castle day trip',
    'Back to Tokyo, teamLab in the evening',
    'Last shopping and a long lunch',
    'Return flight from Haneda',
  ]
  return [
    '# Itinerary, day by day (fictional)',
    '',
    `Day 1 falls ${start} days from the day this baseline was seeded.`,
    '',
    ...days.map((d, i) => `**Day ${i + 1}.** ${d}.`),
    '',
  ].join('\n')
}

// ---------------------------------------------------------------------------------------------------------------------
// Project 1: Wellness Studio Launch (team-heavy)
// ---------------------------------------------------------------------------------------------------------------------

const WELLNESS: PlanProject = {
  name: 'Wellness Studio Launch',
  ref: 'sample-wellness-studio',
  shape: 'team-heavy',
  tasks: [
    { title: 'Space and fit-out', milestone: true, due: 21, priority: 30, labels: ['space'] },
    { title: 'Programme and instructors', milestone: true, due: 30, labels: ['programme'] },
    { title: 'Launch marketing', milestone: true, due: 40, labels: ['marketing'] },
    {
      title: 'Shortlist three studio venues',
      state: 'done',
      parent: 'Space and fit-out',
      owner: 'person',
      labels: ['space'],
    },
    {
      title: 'Sign the venue hire agreement with the building manager',
      detail: 'The manager wants it back by the end of the week. Break clause at month six.',
      due: -4,
      parent: 'Space and fit-out',
      owner: 'person',
      priority: 10,
      labels: ['space', 'legal'],
    },
    {
      title: 'Collect three quotes for the sprung floor',
      due: -1,
      state: 'doing',
      agent: 'operations-director',
      parent: 'Space and fit-out',
      labels: ['space'],
    },
    {
      title: 'Confirm the mirror and barre delivery date',
      due: 0,
      parent: 'Space and fit-out',
      priority: 20,
      labels: ['space'],
    },
    {
      title: 'Book the electrician for the lighting rail',
      due: 1,
      parent: 'Space and fit-out',
      owner: 'person',
      labels: ['space'],
    },
    {
      title: 'Order 24 mats and the storage rack',
      due: 9,
      agent: 'finance-director',
      parent: 'Space and fit-out',
      labels: ['space', 'budget'],
    },
    {
      title: 'Hang the studio signage',
      due: 12,
      state: 'blocked',
      blockedOn: 'Waiting for the building manager to approve the sign wording',
      parent: 'Space and fit-out',
      labels: ['space'],
    },
    {
      title: 'Fire safety walkthrough with the surveyor',
      parent: 'Space and fit-out',
      labels: ['space', 'legal'],
    },
    {
      title: 'Pick the studio name',
      state: 'done',
      parent: 'Programme and instructors',
      owner: 'person',
      labels: ['programme'],
    },
    {
      title: 'Draft the first-term timetable',
      due: 3,
      state: 'doing',
      owner: 'person',
      priority: 10,
      parent: 'Programme and instructors',
      labels: ['programme'],
    },
    {
      title: 'Interview two instructors for the Saturday slot',
      due: 6,
      parent: 'Programme and instructors',
      labels: ['programme', 'people'],
    },
    {
      title: 'Agree instructor pay rates',
      due: 8,
      state: 'blocked',
      blockedOn: 'Needs the budget figures from the studio fit-out costings',
      parent: 'Programme and instructors',
      labels: ['programme', 'budget'],
    },
    {
      title: 'Write the class descriptions for the website, one paragraph each',
      due: 10,
      agent: 'communications-director',
      parent: 'Programme and instructors',
      labels: ['programme', 'marketing'],
    },
    {
      title: 'Decide on the introductory offer for the first fortnight',
      agent: 'research-director',
      parent: 'Programme and instructors',
      labels: ['programme', 'budget'],
    },
    {
      title: 'Design the launch flyer',
      due: -2,
      agent: 'communications-director',
      parent: 'Launch marketing',
      priority: 30,
      labels: ['marketing'],
    },
    {
      title: 'Plan the invitation list for the preview evening',
      due: 2,
      owner: 'person',
      parent: 'Launch marketing',
      labels: ['marketing', 'people'],
    },
    {
      title: 'Photograph the finished studio for the website',
      due: 30,
      parent: 'Launch marketing',
      labels: ['marketing'],
    },
    {
      title:
        'Compare the three insurance quotes for public liability, equipment damage and instructor cover, and confirm which one the venue hire agreement actually requires us to hold before the first class',
      due: 5,
      agent: 'quality-director',
      labels: ['legal', 'budget'],
    },
    { title: 'Open a studio bank account', state: 'done', owner: 'person', labels: ['budget'] },
    { title: 'Register the studio name', state: 'done', owner: 'person', labels: ['legal'] },
    { title: 'Buy a kettle', owner: 'person' },
    { title: 'Print timetable', due: 14, owner: 'person', priority: 100 },
  ],
  contacts: [
    {
      name: 'Dana Whitlock',
      role: 'Building manager',
      org: 'Corner House Studios (fictional)',
      email: 'dana.whitlock@cornerhouse.invalid',
      phone: '+44 7700 900101',
      note: 'Prefers a call before noon. Keys are collected from the ground floor desk, never the side door.',
    },
    {
      name: 'Rafael Quill',
      role: 'Graphic designer',
      org: 'Quill and Fern (fictional)',
      email: 'rafael@quillfern.invalid',
      phone: '+44 7700 900102',
      website: 'https://quillfern.example.test',
    },
    {
      name: 'Imogen Hartley-Pryce',
      role: 'Lead instructor (yoga and mobility)',
      org: 'Freelance (fictional)',
      email: 'imogen@hartleypryce.invalid',
      phone: '+44 7700 900103',
      note: 'Available Tuesday and Thursday mornings and all day Saturday. Teaches in English and a little Spanish.',
    },
    {
      name: 'Tomasz Brandt',
      role: 'Floor contractor',
      org: 'Brandt Surfaces (fictional)',
      email: 'tomasz@brandtsurfaces.invalid',
      phone: '+44 7700 900104',
    },
    {
      name: 'Aisha Kamara',
      role: 'Insurance broker',
      org: 'Beacon Cover (fictional)',
      email: 'aisha.kamara@beaconcover.invalid',
      phone: '+44 7700 900105',
      note: 'Needs the floor plan and the headcount before she can quote instructor cover.',
    },
  ],
  docs: [
    {
      name: 'venue-hire-agreement-summary.md',
      mime: 'text/markdown',
      approve: true,
      pinned: true,
      tags: ['legal', 'space'],
      text: '# Venue hire agreement summary (fictional)\n\nTerm: two years from the first class.\nBreak clause at month six.\nDeposit: held against damage, returned within 28 days.\nOut of hours access needs written notice from the manager.\n',
    },
    {
      name: 'studio-fit-out-budget.csv',
      mime: 'text/csv',
      approve: true,
      tags: ['budget'],
      text: 'item,estimate\nSprung floor,5200\nMirrors and barre,2100\nLighting rail,1350\nMats and storage,780\nSignage,640\nContingency,1000\n',
    },
    {
      name: 'class-timetable-draft-term-one.md',
      mime: 'text/markdown',
      tags: ['programme'],
      text: '# Draft timetable, term one (fictional)\n\n| Day | Class | Time |\n|---|---|---|\n| Mon | Mobility | 07:30 |\n| Tue | Yoga flow | 18:00 |\n| Thu | Breathwork | 18:00 |\n| Sat | Family yoga | 10:00 |\n',
    },
    {
      name: 'instructor-shortlist-and-rates.csv',
      mime: 'text/csv',
      tags: ['programme', 'people'],
      text: 'name (fictional),speciality,rate_per_class\nImogen Hartley-Pryce,Yoga and mobility,45\nCormac Dell,Breathwork,40\nPriya Venn,Family classes,38\n',
    },
    {
      name: 'launch-marketing-plan.md',
      mime: 'text/markdown',
      tags: ['marketing'],
      text: `# Launch marketing plan (fictional)\n\n${para(2, 'Channel mix')}\n\n- Week 1: flyers to neighbouring cafes\n- Week 2: preview evening\n- Week 3: opening offer\n`,
    },
    {
      name: 'preview-evening-run-sheet.txt',
      mime: 'text/plain',
      text: 'Preview evening run sheet (fictional)\n18:00 doors\n18:20 welcome\n18:30 taster class\n19:15 tea and questions\n20:00 close\n',
    },
  ],
}

// ---------------------------------------------------------------------------------------------------------------------
// Project 2: 2027 Financial Plan (document-heavy)
// ---------------------------------------------------------------------------------------------------------------------

const FINANCE: PlanProject = {
  name: '2027 Financial Plan',
  ref: 'sample-financial-plan',
  shape: 'document-heavy',
  tasks: [
    { title: 'Annual tax and filings', milestone: true, due: 60, labels: ['tax'] },
    { title: 'Savings and investments review', milestone: true, due: 45, labels: ['savings'] },
    { title: 'Insurance renewals', milestone: true, due: 25, labels: ['insurance'] },
    {
      title: 'Gather the receipts for the quarter-end self-assessment return',
      due: -2,
      owner: 'person',
      parent: 'Annual tax and filings',
      priority: 10,
      labels: ['tax'],
    },
    {
      title: 'Send the accountant the mileage log and home-office figures',
      due: 0,
      owner: 'person',
      parent: 'Annual tax and filings',
      labels: ['tax'],
    },
    {
      title: 'Book the review call with the accountant',
      due: 1,
      owner: 'person',
      parent: 'Annual tax and filings',
      priority: 20,
      labels: ['tax'],
    },
    {
      title: 'Estimate the next two payments on account',
      due: 14,
      agent: 'finance-director',
      parent: 'Annual tax and filings',
      labels: ['tax'],
    },
    {
      title: 'Check the filing deadline for the 2026 to 2027 return',
      due: 40,
      agent: 'research-director',
      parent: 'Annual tax and filings',
      labels: ['tax'],
    },
    {
      title: 'File the return',
      due: 58,
      state: 'todo',
      parent: 'Annual tax and filings',
      priority: 40,
      labels: ['tax'],
    },
    {
      title:
        'Compare four fixed-rate savings accounts against the current 3.9 percent easy-access rate and write up the break-even point for each lock-in period',
      due: 10,
      state: 'doing',
      agent: 'finance-director',
      parent: 'Savings and investments review',
      labels: ['savings'],
    },
    {
      title: 'Model three scenarios for the emergency fund target',
      due: 12,
      state: 'blocked',
      blockedOn: "Waiting for the planner's cash-flow projection",
      parent: 'Savings and investments review',
      labels: ['savings'],
    },
    {
      title: 'Review the pension contribution and the annual allowance',
      due: 30,
      parent: 'Savings and investments review',
      labels: ['savings', 'tax'],
    },
    {
      title: 'Rebalance the investment allocation',
      parent: 'Savings and investments review',
      labels: ['savings'],
    },
    {
      title: 'Open the new savings pot',
      state: 'done',
      owner: 'person',
      parent: 'Savings and investments review',
      labels: ['savings'],
    },
    {
      title: 'Collect renewal quotes for home and contents',
      due: 6,
      owner: 'person',
      parent: 'Insurance renewals',
      labels: ['insurance'],
    },
    {
      title: 'Decide whether to raise the excess',
      due: 20,
      parent: 'Insurance renewals',
      labels: ['insurance'],
    },
    {
      title: 'Cancel the duplicate travel cover',
      state: 'done',
      owner: 'person',
      parent: 'Insurance renewals',
      labels: ['insurance'],
    },
    {
      title:
        'Read the policy wording on business interruption cover before the renewal date and note every exclusion that would matter to a small cafe operator',
      due: 18,
      agent: 'quality-director',
      parent: 'Insurance renewals',
      labels: ['insurance'],
    },
    {
      title: 'Update the 2027 budget spreadsheet',
      due: -6,
      state: 'doing',
      agent: 'finance-director',
      priority: 10,
      labels: ['budget'],
    },
    { title: 'Set the monthly savings transfer', due: 0, owner: 'person', labels: ['budget'] },
    {
      title: 'Ask the planner about the ISA allowance',
      due: 3,
      owner: 'person',
      labels: ['savings'],
    },
    { title: 'Archive the 2025 paperwork', owner: 'person' },
    { title: 'Check ISA', due: 22, owner: 'person' },
    { title: 'Review recurring subscriptions', agent: 'research-director', labels: ['budget'] },
    { title: 'Collect last year statements', state: 'done', owner: 'person', labels: ['tax'] },
    { title: 'Year-end checkpoint', milestone: true, due: 120, labels: ['budget'] },
  ],
  contacts: [
    {
      name: 'Hugh Ashworth-Lane',
      role: 'Accountant',
      org: 'Ashworth Lane and Partners (fictional)',
      email: 'hugh@ashworthlane.invalid',
      phone: '+44 7700 900201',
      note: 'Needs figures by the 20th of the month. Replies fastest to short numbered lists, slowest to long emails with attachments.',
    },
    {
      name: 'Neve Calloway',
      role: 'Independent financial planner',
      org: 'Calloway Planning (fictional)',
      email: 'neve@callowayplanning.invalid',
      phone: '+44 7700 900202',
    },
    {
      name: 'Oskar Feldman',
      role: 'Insurance adviser',
      org: 'Feldman Cover (fictional)',
      email: 'oskar@feldmancover.invalid',
      phone: '+44 7700 900203',
      note: 'Renewal packs go out 30 days before the policy date.',
    },
  ],
  docs: [
    {
      name: '2027-annual-budget.csv',
      mime: 'text/csv',
      approve: true,
      pinned: true,
      tags: ['budget'],
      text: budgetCsv(),
    },
    {
      name: 'monthly-cashflow-forecast-2027.csv',
      mime: 'text/csv',
      approve: true,
      tags: ['budget'],
      text: cashflowCsv(),
    },
    {
      name: 'savings-account-comparison.csv',
      mime: 'text/csv',
      tags: ['savings'],
      text: savingsCsv(),
    },
    {
      name: 'net-worth-statement-year-end-2026.md',
      mime: 'text/markdown',
      approve: true,
      tags: ['savings'],
      text: '# Net worth statement (fictional)\n\n| Item | Value |\n|---|---|\n| Current accounts | 6,420 |\n| Savings | 21,350 |\n| Pension (estimated transfer value) | 48,900 |\n| Van (written down) | 7,800 |\n| Loans | -3,200 |\n| **Net** | **81,270** |\n',
    },
    {
      name: 'pension-contribution-analysis.md',
      mime: 'text/markdown',
      tags: ['savings', 'tax'],
      text: `# Pension contribution analysis (fictional)\n\n${para(4, 'Contribution')}\n`,
    },
    {
      name: 'insurance-renewal-comparison.md',
      mime: 'text/markdown',
      tags: ['insurance'],
      text: `# Insurance renewal comparison (fictional)\n\n| Policy | Current | Quote A | Quote B |\n|---|---|---|---|\n| Home and contents | 412 | 389 | 401 |\n| Van | 640 | 655 | 610 |\n| Business interruption | 280 | 295 | 270 |\n\n${para(2, 'Cover')}\n`,
    },
    {
      name: 'tax-position-summary-and-payments-on-account-estimate-for-the-2026-to-2027-tax-year-including-assumptions-and-open-questions.md',
      mime: 'text/markdown',
      tags: ['tax'],
      text: `# Tax position summary (fictional)\n\n${para(5, 'Tax position')}\n\n## Open questions\n\n1. Does the van count as a business asset in full?\n2. Is the home-office share 12 or 15 percent?\n3. Which payment on account date applies?\n`,
    },
    {
      name: 'financial-plan-2027-master-narrative-covering-income-expenditure-savings-insurance-and-tax-with-quarterly-checkpoints-and-a-risk-register.md',
      mime: 'text/markdown',
      approve: true,
      tags: ['budget', 'tax', 'savings'],
      text: longFinanceNarrative(),
    },
  ],
}

// ---------------------------------------------------------------------------------------------------------------------
// Project 3: Japan Spring Trip (calendar-heavy)
// ---------------------------------------------------------------------------------------------------------------------

/** Day 1 of the trip, in days from today. Far enough away that every booking deadline still lies ahead or just behind. */
export const TRIP_START = 160

const day = (n: number): number => TRIP_START + n - 1

const JAPAN: PlanProject = {
  name: 'Japan Spring Trip',
  ref: 'sample-japan-trip',
  shape: 'calendar-heavy',
  tasks: [
    { title: 'Flights and hotels', milestone: true, due: TRIP_START - 20, labels: ['bookings'] },
    { title: 'Itinerary', milestone: true, due: day(14), start: day(1), labels: ['itinerary'] },
    {
      title: 'Packing and paperwork checklist',
      milestone: true,
      due: TRIP_START - 7,
      labels: ['checklist'],
    },
    {
      title: 'Book the outbound flight',
      state: 'done',
      owner: 'person',
      parent: 'Flights and hotels',
      labels: ['bookings'],
    },
    {
      title: 'Book the return flight',
      due: -5,
      owner: 'person',
      priority: 10,
      parent: 'Flights and hotels',
      labels: ['bookings'],
    },
    {
      title: 'Check in online for the outbound flight',
      due: TRIP_START - 1,
      parent: 'Flights and hotels',
      labels: ['bookings'],
    },
    {
      title: 'Booking deadline: teamLab tickets',
      due: 1,
      priority: 20,
      parent: 'Flights and hotels',
      labels: ['bookings', 'deadline'],
    },
    {
      title: 'Booking deadline: Ghibli museum tickets',
      due: 0,
      priority: 20,
      parent: 'Flights and hotels',
      labels: ['bookings', 'deadline'],
    },
    {
      title: 'Booking deadline: Kyoto tea ceremony',
      due: 4,
      parent: 'Flights and hotels',
      labels: ['bookings', 'deadline'],
    },
    {
      title: 'Booking deadline: Himeji Castle guided tour',
      due: 20,
      parent: 'Flights and hotels',
      labels: ['bookings', 'deadline'],
    },
    {
      title: 'Hotel check-in: Shinjuku',
      start: day(1),
      due: day(1),
      parent: 'Flights and hotels',
      labels: ['hotel'],
    },
    {
      title: 'Hotel check-out: Shinjuku',
      start: day(4),
      due: day(4),
      parent: 'Flights and hotels',
      labels: ['hotel'],
    },
    {
      title: 'Hotel check-in: Kyoto ryokan',
      start: day(4),
      due: day(4),
      parent: 'Flights and hotels',
      labels: ['hotel'],
    },
    {
      title: 'Hotel check-out: Kyoto ryokan',
      start: day(9),
      due: day(9),
      parent: 'Flights and hotels',
      labels: ['hotel'],
    },
    {
      title: 'Hotel check-in: Osaka',
      start: day(9),
      due: day(9),
      parent: 'Flights and hotels',
      labels: ['hotel'],
    },
    {
      title: 'Hotel check-out: Osaka',
      start: day(12),
      due: day(12),
      parent: 'Flights and hotels',
      labels: ['hotel'],
    },
    {
      title: 'Stay in Kyoto (days 4 to 9)',
      start: day(4),
      due: day(9),
      parent: 'Itinerary',
      labels: ['itinerary', 'hotel'],
    },
    {
      title: 'Rail pass valid (days 2 to 9)',
      start: day(2),
      due: day(9),
      parent: 'Itinerary',
      labels: ['itinerary'],
    },
    {
      title: 'Day 1: Arrive at Haneda and ride into Shinjuku',
      start: day(1),
      due: day(1),
      parent: 'Itinerary',
      labels: ['itinerary'],
    },
    {
      title: 'Day 2: Asakusa and the river, Akihabara in the evening',
      start: day(2),
      due: day(2),
      parent: 'Itinerary',
      labels: ['itinerary'],
    },
    {
      title: 'Day 3: Day trip to Nikko by rail',
      start: day(3),
      due: day(3),
      parent: 'Itinerary',
      labels: ['itinerary'],
    },
    {
      title: 'Day 4: Tsukiji breakfast, then travel to Kyoto',
      start: day(4),
      due: day(4),
      parent: 'Itinerary',
      labels: ['itinerary'],
    },
    {
      title: 'Day 5: Fushimi Inari at opening time, Gion in the evening',
      start: day(5),
      due: day(5),
      parent: 'Itinerary',
      labels: ['itinerary'],
    },
    {
      title: 'Day 6: Arashiyama and the temple route',
      start: day(6),
      due: day(6),
      parent: 'Itinerary',
      labels: ['itinerary'],
    },
    {
      title: 'Day 7: Nara deer park and Todai-ji',
      start: day(7),
      due: day(7),
      parent: 'Itinerary',
      labels: ['itinerary'],
    },
    {
      title: 'Day 8: Free day in Kyoto, tea ceremony',
      start: day(8),
      due: day(8),
      parent: 'Itinerary',
      labels: ['itinerary'],
    },
    {
      title: 'Day 9: Travel to Osaka, Dotonbori at night',
      start: day(9),
      due: day(9),
      parent: 'Itinerary',
      labels: ['itinerary'],
    },
    {
      title: 'Day 11: Himeji Castle day trip',
      start: day(11),
      due: day(11),
      parent: 'Itinerary',
      labels: ['itinerary'],
    },
    {
      title: 'Day 14: Return flight from Haneda',
      start: day(14),
      due: day(14),
      parent: 'Itinerary',
      labels: ['itinerary', 'bookings'],
    },
    {
      title: 'Check the passport is valid for six months after the return date',
      due: 3,
      owner: 'person',
      parent: 'Packing and paperwork checklist',
      priority: 20,
      labels: ['checklist'],
    },
    {
      title: 'Buy travel insurance',
      due: 30,
      owner: 'person',
      parent: 'Packing and paperwork checklist',
      labels: ['checklist'],
    },
    {
      title: 'Set up an eSIM',
      due: TRIP_START - 3,
      parent: 'Packing and paperwork checklist',
      labels: ['checklist'],
    },
    {
      title: 'Yen',
      due: TRIP_START - 10,
      owner: 'person',
      parent: 'Packing and paperwork checklist',
      labels: ['checklist'],
    },
    {
      title: 'Pack a rain jacket and a travel adapter',
      parent: 'Packing and paperwork checklist',
      owner: 'person',
      labels: ['checklist'],
    },
    {
      title: 'Carry a letter for prescription medication',
      state: 'done',
      owner: 'person',
      parent: 'Packing and paperwork checklist',
      labels: ['checklist'],
    },
    {
      title: 'Research the best week for cherry blossoms in Kyoto',
      due: 7,
      agent: 'research-director',
      labels: ['research'],
    },
    {
      title: 'Compare IC card and rail pass options for Tokyo, Kyoto and Osaka',
      due: 11,
      state: 'doing',
      agent: 'research-director',
      labels: ['research', 'bookings'],
    },
    {
      title:
        'Work out the full day plan for the Kyoto temple route including opening hours, the order that avoids backtracking, a lunch stop near Arashiyama, and what to do if it rains all morning',
      due: 35,
      agent: 'research-director',
      labels: ['research', 'itinerary'],
    },
    {
      title: 'Find out whether the ryokan can store luggage after check-out',
      state: 'blocked',
      blockedOn: 'Waiting for the ryokan to reply to the email about luggage storage',
      due: 15,
      owner: 'person',
      labels: ['hotel'],
    },
    { title: 'Learn ten phrases', owner: 'person', labels: ['checklist'] },
  ],
  contacts: [
    {
      name: 'Haruka Mori',
      role: 'Travel agent',
      org: 'Sakura Journeys (fictional)',
      email: 'haruka.mori@sakurajourneys.invalid',
      phone: '+81 90 0000 0101',
      note: 'Holds the rail pass vouchers. Replies within one working day. Office closed on Japanese public holidays.',
    },
    {
      name: 'Kaito Nakamura',
      role: 'Front desk, Kyoto ryokan',
      org: 'Ryokan Hanabi (fictional)',
      email: 'frontdesk@ryokanhanabi.invalid',
      phone: '+81 75 0000 0102',
      website: 'https://ryokanhanabi.example.test',
    },
    {
      name: 'Mei Tanaka',
      role: 'Licensed tour guide',
      org: 'Walks of Kyoto (fictional)',
      email: 'mei@walksofkyoto.invalid',
      phone: '+81 90 0000 0103',
      note: 'Offers a half-day temple route in English. Needs the group size by the Friday before.',
    },
    {
      name: 'Rin Okabe',
      role: 'Hotel reservations, Shinjuku',
      org: 'Hotel Meridian Shinjuku (fictional)',
      email: 'reservations@meridianshinjuku.invalid',
      phone: '+81 3 0000 0104',
    },
  ],
  docs: [
    {
      name: 'itinerary-day-by-day.md',
      mime: 'text/markdown',
      approve: true,
      pinned: true,
      tags: ['itinerary'],
      text: tripDays(TRIP_START),
    },
    {
      name: 'flight-and-hotel-bookings.md',
      mime: 'text/markdown',
      approve: true,
      tags: ['bookings', 'hotel'],
      text: '# Flights and hotels (fictional)\n\n| Item | Reference | Notes |\n|---|---|---|\n| Outbound flight | SAMPLE-OUT-001 | Window seat |\n| Return flight | not booked | Deadline passed in the plan |\n| Shinjuku hotel | SAMPLE-HTL-14 | 3 nights |\n| Kyoto ryokan | SAMPLE-RYO-07 | 5 nights, breakfast included |\n| Osaka hotel | SAMPLE-OSK-22 | 3 nights |\n',
    },
    {
      name: 'japan-trip-budget-estimate.csv',
      mime: 'text/csv',
      tags: ['bookings'],
      text: 'item,estimate_gbp\nFlights,1240\nHotels,1710\nRail pass,380\nFood,620\nActivities,310\nContingency,300\n',
    },
    {
      name: 'rail-pass-comparison.csv',
      mime: 'text/csv',
      tags: ['research'],
      text: 'option,days,price_gbp,notes\nSeven-day regional pass,7,290,Covers Kyoto and Osaka\nFourteen-day national pass,14,450,Does not pay back on this route\nPay per journey,14,330,Most flexible\n',
    },
    {
      name: 'kyoto-temple-route-notes-with-opening-hours-and-rainy-day-alternatives-and-lunch-options-near-arashiyama.md',
      mime: 'text/markdown',
      tags: ['itinerary', 'research'],
      text: `# Kyoto temple route (fictional)\n\n${para(3, 'Temple route')}\n\n**Rainy day alternative:** museums first, temples after lunch.\n`,
    },
    {
      name: 'packing-checklist.txt',
      mime: 'text/plain',
      tags: ['checklist'],
      text: 'Packing checklist (fictional)\n[ ] Passport\n[ ] Insurance letter\n[ ] Rain jacket\n[ ] Adapter\n[ ] Walking shoes\n[ ] Yen\n',
    },
    {
      name: 'phrasebook-essentials.md',
      mime: 'text/markdown',
      text: '# Phrasebook essentials\n\n- Sumimasen: excuse me\n- Arigato gozaimasu: thank you\n- Oishii: delicious\n- Toire wa doko desu ka: where is the toilet\n',
    },
  ],
}

export const PROJECTS: PlanProject[] = [WELLNESS, FINANCE, JAPAN]

/** Personal to-dos with no project: the Inbox of a person who also has a life. */
export const PERSONAL_TASKS: PlanTask[] = [
  { title: 'Renew the van tax', due: -1, priority: 20, owner: 'person', labels: ['home'] },
  {
    title: 'Call the dentist to rebook',
    due: 1,
    priority: 50,
    owner: 'person',
    labels: ['health'],
  },
  { title: 'Book a haircut', due: 9, priority: 100, owner: 'person', labels: ['home'] },
  { title: 'Water the office plants', due: 0, priority: 100, owner: 'person' },
  { title: 'Sort the recycling', owner: 'person' },
]

export const LESSONS = [
  { scope: 'global', body: 'Keep answers short and put the decision first.' },
  { scope: 'global', body: 'Ask before spending money on anything.' },
]

/** Open requests for reach. Raised by the product's own writer; answering them is the Sample's own decision. */
export const TOOL_REQUESTS = [
  {
    tool: 'drive.ingest',
    by: 'research-director',
    why: 'Read the supplier price lists you keep in a shared folder.',
  },
  {
    tool: 'calendar.write',
    by: 'operations-director',
    why: 'Put the builder and floor-fitting visits straight into your calendar.',
  },
  {
    tool: 'gmail.search',
    by: 'finance-director',
    why: 'Find the insurance renewal letters and the accountant replies for the 2027 plan.',
  },
  {
    tool: 'notebook.read',
    by: 'communications-director',
    why: 'Read the launch notes you keep for the studio.',
  },
]

export const AUTONOMY = 'act_with_review'
export const APPEARANCE = { palette: 'clay' }

// ---------------------------------------------------------------------------------------------------------------------
// planning
// ---------------------------------------------------------------------------------------------------------------------

export const allTasks = (): PlanTask[] => [...PROJECTS.flatMap((p) => p.tasks), ...PERSONAL_TASKS]
export const baselineTitles = (): Set<string> => new Set(allTasks().map((t) => t.title))
export const baselineContactNames = (): Set<string> =>
  new Set(PROJECTS.flatMap((p) => p.contacts.map((c) => c.name)))
export const baselineDocNames = (): Set<string> =>
  new Set(PROJECTS.flatMap((p) => p.docs.map((d) => d.name)))
export const baselineProjectNames = (): Set<string> =>
  new Set(['Unnamed', ...PROJECTS.map((p) => p.name)])

/** What a task should look like in the database once seeded, with every offset resolved against `today`. */
export type Wanted = {
  title: string
  state: TaskState
  due: string | null
  start: string | null
  priority: number
  labels: string[]
  blockedOn: string
  agent: string | null
  parent: string | null
}

export const wantedOf = (t: PlanTask, today: Date): Wanted => ({
  title: t.title,
  state: t.state ?? 'todo',
  due: t.due === undefined ? null : isoDay(today, t.due),
  start: t.start === undefined ? null : isoDay(today, t.start),
  priority: t.priority ?? 100,
  labels: [...(t.labels ?? [])].sort(),
  blockedOn: t.state === 'blocked' ? (t.blockedOn ?? '') : '',
  agent: t.owner === 'person' ? null : (t.agent ?? null),
  parent: t.parent ?? null,
})

export type Have = {
  title: string
  state: string
  due: string | null
  start: string | null
  priority: number
  labels: string[]
  blockedOn: string
  agent: string | null
  parent: string | null
}

/** The fields on which a task the office holds differs from what the baseline wants. Empty means converged. */
export const driftOf = (have: Have, want: Wanted): string[] => {
  const out: string[] = []
  if (have.state !== want.state) out.push('state')
  if ((have.due ?? null) !== want.due) out.push('due')
  if ((have.start ?? null) !== want.start) out.push('start')
  if (Number(have.priority) !== want.priority) out.push('priority')
  if ([...have.labels].sort().join('|') !== want.labels.join('|')) out.push('labels')
  if (want.state === 'blocked' && have.blockedOn !== want.blockedOn) out.push('blockedOn')
  if ((have.agent ?? null) !== want.agent) out.push('agent')
  if ((have.parent ?? null) !== want.parent) out.push('parent')
  return out
}

/** Counts of what a plan holds per project, by bucket, for the inventory and for tests that assert by property. */
export const planSummary = (p: PlanProject, today: Date) => {
  const buckets = Object.fromEntries(BUCKETS.map((b) => [b, 0])) as Record<Bucket, number>
  for (const t of p.tasks) buckets[bucketOfOffset(t, today)] += 1
  return {
    name: p.name,
    tasks: p.tasks.length,
    subtasks: p.tasks.filter((t) => t.parent !== undefined).length,
    buckets,
    contacts: p.contacts.length,
    docs: p.docs.length,
  }
}

/** Problems in the plan itself. Empty means the plan is internally consistent. */
export const planProblems = (): string[] => {
  const out: string[] = []
  const seen = new Set<string>()
  for (const p of PROJECTS) {
    const here = new Set<string>()
    for (const t of p.tasks) {
      if (seen.has(t.title)) out.push(`duplicate title across the office: ${t.title}`)
      seen.add(t.title)
      if (t.parent !== undefined && !here.has(t.parent))
        out.push(`${t.title}: parent "${t.parent}" must appear earlier in the same project`)
      here.add(t.title)
      if (t.state === 'blocked' && (t.blockedOn ?? '').trim() === '')
        out.push(`${t.title}: blocked without a reason`)
      if (t.owner === 'person' && t.agent !== undefined)
        out.push(`${t.title}: a person-owned task cannot be an agent's`)
      if (t.start !== undefined && t.due !== undefined && t.start > t.due)
        out.push(`${t.title}: starts after it is due`)
    }
  }
  for (const t of PERSONAL_TASKS) {
    if (seen.has(t.title)) out.push(`duplicate title across the office: ${t.title}`)
    seen.add(t.title)
  }
  const emails = [...PROJECTS.flatMap((p) => p.contacts.map((c) => c.email))]
  for (const e of emails)
    if (!/@[a-z0-9.-]+\.invalid$/.test(e)) out.push(`contact address is not on .invalid: ${e}`)
  const names = new Set<string>()
  for (const p of PROJECTS)
    for (const d of p.docs) {
      if (names.has(d.name)) out.push(`duplicate document name: ${d.name}`)
      names.add(d.name)
    }
  return out
}

/** Does `title` mention a real-looking secret, token or address that is not fictional? Used by the test. */
export const looksReal = (text: string): boolean =>
  /(eyJ[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{20,}|xox[abp]-[A-Za-z0-9-]{10,}|@(?!.*\.(invalid|test)\b)[a-z0-9-]+\.(com|org|net|co\.uk)\b)/i.test(
    text,
  )
