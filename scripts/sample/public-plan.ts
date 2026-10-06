/**
 * The PUBLIC Sample Office: what a visitor who has not signed in explores. Pure data, no database and no network, so a unit
 * test can read it and assert properties of it (tests/scripts/sample/public-plan.test.ts).
 *
 * This is a polished demonstration and nothing else. It is not the Sample Person (`plan.ts`), which is the authenticated
 * UX-testing account and is allowed to be written to by suites; it is not the TEST office, which is where automated
 * fixtures live; and it is nowhere near Grant's work. Nothing a harness does reaches it, and a visitor cannot change it.
 *
 * ONE fictional story, told consistently so search and the team can reason across it: Jordan Reyes owns Brightside Café, a
 * neighbourhood café, and is opening a second site on Mill Street in nine weeks. Three projects share people, suppliers,
 * money and dates:
 *
 *   Riverside Café Launch   the main project: lease, permits, build-out, hiring, opening week; a team, a budget, decisions
 *   Autumn Menu Research    research-shaped: supplier prices, a customer survey, costing, a tasting
 *   Winter Market Pop-up    calendar-shaped: a stall at the Riverside Winter Market over four weekends
 *
 * Everything is fictional. Addresses end `.invalid` (a reserved domain nothing delivers to), telephone numbers are in the
 * ranges reserved for fiction, and every figure is invented. Dates are OFFSETS from the day of seeding, so "overdue",
 * "due today" and "due this week" are always true.
 */
import type { PlanContact, PlanDoc, PlanTask } from './plan.ts'

export const PUBLIC_VERSION = 'public-sample-1'

/** The office's name as the team and the page see it. */
export const OFFICE_NAME = 'Jordan Reyes (Sample Office)'
/** The login's reserved address and the owner key its member row carries. */
export const SAMPLE_EMAIL = 'sample-office@visitors.agentic.invalid'
export const SAMPLE_KEY = 'sample-visitor'

export type PublicProject = {
  name: string
  ref: string
  shape: string
  tasks: PlanTask[]
  contacts: PlanContact[]
  docs: PlanDoc[]
}

const launch: PublicProject = {
  name: 'Riverside Café Launch',
  ref: 'riverside-launch',
  shape: 'team-heavy: milestones, a budget, decisions',
  tasks: [
    {
      title: 'Lease and permits',
      milestone: true,
      due: 7,
      state: 'doing',
      priority: 20,
      labels: ['launch'],
    },
    {
      title: 'Sign the Mill Street lease',
      parent: 'Lease and permits',
      state: 'done',
      due: -21,
      owner: 'person',
      labels: ['legal'],
    },
    {
      title: 'Pay the lease deposit (£4,800)',
      parent: 'Lease and permits',
      state: 'done',
      due: -19,
      owner: 'person',
      labels: ['money'],
    },
    {
      title: 'File the food business registration',
      parent: 'Lease and permits',
      state: 'done',
      due: -12,
      owner: 'person',
      labels: ['legal'],
    },
    {
      title: 'Book the council fire-safety inspection',
      parent: 'Lease and permits',
      state: 'doing',
      due: 1,
      agent: 'operations-director',
      detail: 'The council needs two weeks notice. Aim for the week before the builders finish.',
      labels: ['legal'],
    },
    {
      title: 'Get the alcohol licence decision',
      parent: 'Lease and permits',
      state: 'blocked',
      blockedOn: 'Waiting on the council licensing office (Dana Okoye)',
      due: 12,
      priority: 30,
      owner: 'person',
      labels: ['legal'],
    },
    { title: 'Build-out', milestone: true, due: 40, state: 'doing', labels: ['launch'] },
    {
      title: "Confirm the builder's quote (Webb & Sons)",
      parent: 'Build-out',
      state: 'done',
      due: -5,
      owner: 'person',
      labels: ['money'],
    },
    {
      title: 'Agree the counter and kitchen layout with Gareth Webb',
      parent: 'Build-out',
      state: 'doing',
      due: 0,
      owner: 'person',
      priority: 20,
      labels: ['design'],
    },
    {
      title: 'Order the espresso machine and grinders',
      parent: 'Build-out',
      due: 9,
      agent: 'operations-director',
      detail:
        'Compare three quotes first. The launch budget has £11,000 set aside for coffee equipment.',
      labels: ['equipment', 'money'],
    },
    {
      title: 'Choose the floor and wall finishes',
      parent: 'Build-out',
      due: 14,
      owner: 'person',
      labels: ['design'],
    },
    {
      title: 'Schedule electrical and plumbing first-fix',
      parent: 'Build-out',
      due: 20,
      agent: 'operations-director',
      labels: ['launch'],
    },
    { title: 'Hiring and training', milestone: true, due: 50, labels: ['people'] },
    {
      title: 'Write the head barista job ad',
      parent: 'Hiring and training',
      state: 'done',
      due: -3,
      agent: 'communications-director',
      labels: ['people'],
    },
    {
      title: 'Shortlist head barista candidates',
      parent: 'Hiring and training',
      state: 'doing',
      due: 4,
      owner: 'person',
      labels: ['people'],
    },
    {
      title: 'Draft the staff handbook',
      parent: 'Hiring and training',
      due: 30,
      agent: 'communications-director',
      labels: ['people'],
    },
    {
      title: 'Plan the two-week training roster',
      parent: 'Hiring and training',
      due: 35,
      agent: 'operations-director',
      labels: ['people'],
    },
    { title: 'Opening week', milestone: true, due: 63, priority: 20, labels: ['launch'] },
    {
      title: 'Set the opening-week offer and pricing',
      parent: 'Opening week',
      due: 45,
      agent: 'finance-director',
      labels: ['money'],
    },
    {
      title: 'Set up the weekly produce order with Harvest Lane',
      parent: 'Opening week',
      due: 42,
      agent: 'operations-director',
      detail:
        'Lena Ortiz offers 5% off for a standing weekly order. Use the same account as the original café.',
      labels: ['suppliers'],
    },
    {
      title: 'Draft the opening-week announcement',
      parent: 'Opening week',
      due: 49,
      agent: 'communications-director',
      labels: ['marketing'],
    },
    {
      title: 'Plan the soft opening for friends and neighbours',
      parent: 'Opening week',
      due: 56,
      owner: 'person',
      labels: ['marketing'],
    },
    {
      title: 'Run the opening-day checklist',
      parent: 'Opening week',
      due: 63,
      owner: 'person',
      priority: 20,
      labels: ['launch'],
    },
    {
      title: 'Check the launch budget against the lease and the quotes',
      due: 2,
      agent: 'finance-director',
      priority: 20,
      detail:
        'The budget is £88,000 including a 10% contingency. Make sure the lease deposit and the builder are both in it.',
      labels: ['money'],
    },
  ],
  contacts: [
    {
      name: 'Priya Nair',
      role: 'Letting agent',
      org: 'Nair & Co Property',
      email: 'priya.nair@nairproperty.example.invalid',
      phone: '+44 7700 900101',
      note: 'Landlord’s agent for 14 Mill Street. Raised the break clause at year five.',
    },
    {
      name: 'Gareth Webb',
      role: 'Builder',
      org: 'Webb & Sons Builders',
      email: 'gareth@webbandsons.example.invalid',
      phone: '+44 7700 900102',
      note: 'Quoted £31,500 for the build-out. Can start on site in ten days.',
    },
    {
      name: 'Dana Okoye',
      role: 'Licensing officer',
      org: 'Riverside Council',
      email: 'licensing@riverside-council.example.invalid',
      phone: '+44 7700 900103',
      note: 'Handles the alcohol licence. Decisions take about six weeks.',
    },
    {
      name: 'Sam Whitaker',
      role: 'Bookkeeper',
      org: 'Whitaker Books',
      email: 'sam@whitakerbooks.example.invalid',
      phone: '+44 7700 900104',
    },
  ],
  docs: [
    {
      name: 'Mill Street lease summary.md',
      mime: 'text/markdown',
      approve: true,
      pinned: true,
      tags: ['lease', 'legal'],
      text: `# 14 Mill Street: lease summary

Signed three weeks ago with Priya Nair at Nair & Co Property, who acts for the landlord.

- **Term:** ten years, with a tenant break at year five.
- **Rent:** £3,200 a month, reviewed every five years.
- **Deposit:** £4,800, paid. Held by the landlord's agent.
- **Rent-free fit-out period:** six weeks from the day the builders start.
- **Permitted use:** café and restaurant. Alcohol is a separate licence from the council.
- **Repairs:** the tenant repairs the inside; the landlord keeps the roof and the structure.
- **Opening date we are working to:** nine weeks from today.

## Things to watch

The break clause at year five is the point Priya raised twice. If the second site does well we may want to drop it in exchange for a longer term; that is a conversation for after opening.

The rent-free period ends six weeks after the builders start, so a late build-out costs real rent.
`,
    },
    {
      name: 'Launch budget.csv',
      mime: 'text/csv',
      approve: true,
      pinned: true,
      tags: ['budget', 'money'],
      text: `Item,Budget,Committed,Paid,Note
Lease deposit,4800,4800,4800,Paid to Nair & Co Property
Builder - Webb & Sons,31500,31500,0,Quote accepted; 30% due at start
Coffee equipment,11000,0,0,Compare three quotes before ordering
Kitchen equipment,9500,0,0,Waiting on the layout
Furniture and fittings,6200,0,0,
Signage and branding,2400,0,0,
Licences and fees,2600,1100,1100,Alcohol licence fee still to pay
Staff training and recruitment,5800,0,0,Two weeks of paid training
Opening-week marketing,3000,0,0,
Insurance and legal,3200,1400,1400,
Contingency (10%),8000,0,0,
Total,88000,38800,7300,
`,
    },
    {
      name: 'Opening timeline.md',
      mime: 'text/markdown',
      approve: true,
      tags: ['plan'],
      text: `# Riverside Café: opening timeline

Working back from opening day, nine weeks from today.

| When | What |
|---|---|
| Week 1 | Fire-safety inspection booked; layout agreed with Gareth Webb |
| Week 2 | Builders start; the six-week rent-free period begins |
| Week 3 | Order coffee and kitchen equipment |
| Weeks 4 to 6 | First-fix electrics and plumbing; shortlist and interview baristas |
| Week 7 | Finishes, furniture and signage |
| Week 8 | Two weeks of staff training start; soft opening for neighbours |
| Week 9 | **Opening week** |

The alcohol licence decision is the one date we do not control. Dana Okoye at the council says about six weeks from the application.
`,
    },
    {
      name: 'Permits and licences tracker.csv',
      mime: 'text/csv',
      approve: true,
      tags: ['legal'],
      text: `Permit,Authority,Status,Owner,Next step
Food business registration,Riverside Council,Done,Jordan,None
Fire-safety inspection,Riverside Fire Service,Booking,Marcus (ops),Pick a date the week before the builders finish
Alcohol licence,Riverside Council licensing,Waiting,Jordan,Decision expected in about six weeks
Signage permission,Riverside Council planning,Not started,Jordan,Send the sign drawings once approved
Public liability insurance,Insurer,Renewal due,Jordan,Add the second site
`,
    },
    {
      name: 'Builder walkthrough notes.md',
      mime: 'text/markdown',
      approve: true,
      tags: ['meeting'],
      text: `# Builder walkthrough with Gareth Webb

Two weeks ago, on site at 14 Mill Street. Jordan and Gareth.

**Agreed**
- The counter goes on the left wall so the queue does not block the door.
- A second sink in the kitchen. Gareth says it adds £900 and is worth it.
- Gareth can start in ten days if we agree the layout this week.

**Open**
- Floor: polished concrete (cheaper, colder) or oak boards (£2,400 more). Jordan leans towards boards.
- Whether the back room becomes storage or a staff area. Decide before first-fix.

**Next:** Jordan sends the layout back to Gareth by Friday.
`,
    },
    {
      name: 'Hiring plan.md',
      mime: 'text/markdown',
      approve: true,
      tags: ['people'],
      text: `# Riverside Café: hiring plan

Opening team of seven: a head barista, two baristas, a head cook, a kitchen assistant and two front-of-house.

- **Head barista first.** The ad is written and live; shortlisting happens this week.
- **Everyone else** is hired after the layout is final, so the training roster fits the real kitchen.
- **Training:** two paid weeks before opening, led by the head barista and by the Brightside team who already know the menu.
- **Budget:** £5,800 for recruitment and training, inside the launch budget.

Two of the current Brightside team have asked to move to Riverside. Jordan wants to keep both in the original café for the first month.
`,
    },
  ],
}

const menu: PublicProject = {
  name: 'Autumn Menu Research',
  ref: 'autumn-menu',
  shape: 'research-shaped: prices, a survey, costing, a tasting',
  tasks: [
    {
      title: 'Collect supplier price lists for autumn produce',
      state: 'done',
      due: -10,
      agent: 'research-director',
      labels: ['suppliers'],
    },
    {
      title: 'Summarise the customer taste survey',
      state: 'done',
      due: -2,
      agent: 'research-director',
      labels: ['customers'],
    },
    {
      title: 'Shortlist five autumn menu items',
      state: 'doing',
      due: 3,
      owner: 'person',
      priority: 20,
      labels: ['menu'],
    },
    {
      title: 'Cost each shortlisted item',
      due: 7,
      agent: 'finance-director',
      detail: 'Use the Harvest Lane prices. Target a food cost under 30% of the menu price.',
      labels: ['money'],
    },
    { title: 'Hold the tasting with the kitchen team', due: 10, owner: 'person', labels: ['menu'] },
    {
      title: 'Decide the final autumn menu',
      due: 14,
      owner: 'person',
      priority: 20,
      labels: ['menu'],
    },
    {
      title: 'Check allergen labelling for the new items',
      due: 16,
      agent: 'quality-director',
      labels: ['safety'],
    },
    { title: 'Photograph the new dishes', owner: 'person', labels: ['marketing'] },
  ],
  contacts: [
    {
      name: 'Lena Ortiz',
      role: 'Account manager',
      org: 'Harvest Lane Produce',
      email: 'lena@harvestlane.example.invalid',
      phone: '+44 7700 900201',
      note: 'Supplies the café’s vegetables and fruit. Offers a 5% discount for a standing weekly order.',
    },
    {
      name: 'Tomas Berg',
      role: 'Head baker',
      org: 'Berg’s Bakery',
      email: 'tomas@bergsbakery.example.invalid',
      phone: '+44 7700 900202',
    },
  ],
  docs: [
    {
      name: 'Supplier price comparison.csv',
      mime: 'text/csv',
      approve: true,
      tags: ['suppliers', 'money'],
      text: `Ingredient,Harvest Lane (per kg),Berg's Bakery (per kg),Local market (per kg)
Butternut squash,1.90,,2.40
Pumpkin,1.40,,1.70
Apples (cooking),2.10,,2.60
Pears,2.80,,3.20
Mushrooms,5.50,,6.20
Sourdough flour,,1.60,
Rye flour,,1.85,
`,
    },
    {
      name: 'Customer taste survey summary.md',
      mime: 'text/markdown',
      approve: true,
      pinned: true,
      tags: ['customers'],
      text: `# Autumn taste survey: summary

We asked regulars at the Brightside counter for two weeks. 148 people answered.

- **62%** would like more vegetarian options in autumn.
- **Soup** is the most requested hot item (41%), then a baked sweet (33%).
- **Spiced drinks** beat plain coffee for a seasonal special: chai latte and pumpkin spice led.
- **Price:** most people would pay up to £7.50 for a soup-and-bread lunch.
- **Allergies:** 9% mentioned a dietary need; nuts and gluten were the most common.

The strongest signal is a vegetarian soup with good bread. Butternut squash and apple came up unprompted.
`,
    },
    {
      name: 'Autumn menu ideas.md',
      mime: 'text/markdown',
      approve: true,
      tags: ['menu'],
      text: `# Autumn menu: candidates

1. **Roast butternut and apple soup** with rye bread. Vegetarian, uses Harvest Lane produce.
2. **Mushroom and thyme toastie** on sourdough.
3. **Pear and almond tart.** Contains nuts, so it needs labelling.
4. **Pumpkin spice latte** as the drink special.
5. **Chai-spiced porridge** for breakfast.

The same menu runs at both sites. The Riverside kitchen is larger, so it can take the tart; the Maple Street kitchen cannot bake in the morning.
`,
    },
    {
      name: 'Allergen checklist.md',
      mime: 'text/markdown',
      approve: true,
      tags: ['safety'],
      text: `# Allergen checklist for new dishes

Before any new item goes on the menu:

1. List every ingredient, including the bread and any stock.
2. Mark the 14 declarable allergens present.
3. Brief the front-of-house team and update the counter card.
4. Check the supplier’s own labelling when an ingredient changes.

Open items: the pear and almond tart contains nuts; the sourdough contains gluten; the chai blend needs a label check with the supplier.
`,
    },
  ],
}

const market: PublicProject = {
  name: 'Winter Market Pop-up',
  ref: 'winter-popup',
  shape: 'calendar-shaped: dated tasks across four market weekends',
  tasks: [
    {
      title: 'Apply for a Winter Market stall',
      state: 'done',
      due: -14,
      owner: 'person',
      labels: ['market'],
    },
    {
      title: 'Confirm the stall fee and dates with the organiser',
      state: 'done',
      due: -9,
      owner: 'person',
      labels: ['market'],
    },
    {
      title: 'Design the pop-up menu: hot drinks and pastries',
      state: 'doing',
      due: 10,
      agent: 'operations-director',
      detail: 'Keep it to six items so the stall stays quick. Reuse the autumn menu winners.',
      labels: ['menu'],
    },
    { title: 'Book the mobile card reader', due: 20, owner: 'person', labels: ['money'] },
    {
      title: 'Order cups, lids and sleeves',
      due: 24,
      agent: 'operations-director',
      labels: ['supplies'],
    },
    {
      title: 'Build the staffing rota for the four market weekends',
      due: 28,
      owner: 'person',
      labels: ['people'],
    },
    { title: 'Pack the stall kit', due: 38, owner: 'person', labels: ['supplies'] },
    { title: 'Market weekend 1', milestone: true, start: 40, due: 41, labels: ['market'] },
    { title: 'Market weekend 2', milestone: true, start: 47, due: 48, labels: ['market'] },
    { title: 'Market weekend 3', milestone: true, start: 54, due: 55, labels: ['market'] },
    { title: 'Market weekend 4', milestone: true, start: 61, due: 62, labels: ['market'] },
  ],
  contacts: [
    {
      name: 'Hannah Frost',
      role: 'Market organiser',
      org: 'Riverside Winter Market',
      email: 'hannah@riversidemarket.example.invalid',
      phone: '+44 7700 900301',
      note: 'Stalls open 10am to 6pm. Setup from 8am. Power is included.',
    },
  ],
  docs: [
    {
      name: 'Winter market stall plan.md',
      mime: 'text/markdown',
      approve: true,
      pinned: true,
      tags: ['market'],
      text: `# Riverside Winter Market: stall plan

Four weekends, Saturday and Sunday, 10am to 6pm, in weeks six to nine. The last one is the weekend before the Riverside café opens, so the stall doubles as an announcement.

- **Stall fee:** £420 per weekend, £1,680 in total, payable two weeks before the first weekend.
- **What we sell:** six items: two hot drinks, a spiced special, two pastries from Berg’s Bakery and the butternut soup in a cup, made with Harvest Lane produce.
- **Staffing:** two people per shift. Jordan covers the first Saturday.
- **Goal:** cover the fee and the supplies, and hand out a card for the Riverside opening week.

Hannah Frost, the organiser, confirmed power is included and setup starts at 8am.
`,
    },
    {
      name: 'Pop-up packing list.md',
      mime: 'text/markdown',
      approve: true,
      tags: ['market', 'supplies'],
      text: `# Pop-up packing list

- Gazebo, weights and two trestle tables
- Two flasks of coffee and a portable hot-water boiler
- Cups, lids and sleeves (order 1,200 for the four weekends)
- Card reader and a float of £100
- Price board and the allergen card
- Opening-week cards for the Riverside café
- Bin bags, cloths and hand-wash
`,
    },
    {
      name: 'Market stall costs.csv',
      mime: 'text/csv',
      approve: true,
      tags: ['money', 'market'],
      text: `Item,Cost,Note
Stall fee (4 weekends),1680,Payable two weeks before the first weekend
Cups lids and sleeves,310,1200 of each
Card reader hire,60,
Ingredients and pastries,720,Estimated for four weekends
Staff cover,1140,Two people per shift
Total,3910,
Break-even sales,4400,At roughly 30% cost of goods
`,
    },
  ],
}

export const PROJECTS: PublicProject[] = [launch, menu, market]

/** To-dos with no project: Jordan's own. */
export const PERSONAL_TASKS: PlanTask[] = [
  {
    title: 'Reply to Priya about the break clause',
    due: -1,
    owner: 'person',
    priority: 20,
    labels: ['legal'],
  },
  {
    title: 'Renew the café public liability insurance for two sites',
    due: 15,
    owner: 'person',
    labels: ['legal'],
  },
  {
    title: 'Send Sam the March invoices',
    state: 'done',
    due: -6,
    owner: 'person',
    labels: ['money'],
  },
]

/**
 * What the team is told about where it is. These reach every specialist's prompt as standing guidance (they are the
 * office's own lessons), which is how a sample office can know it is a sample without any change to the worker.
 */
export const LESSONS: { scope: 'global'; body: string }[] = [
  {
    scope: 'global',
    body: 'This is the Sample Office, a demo for people trying the product before they have an account. Jordan Reyes, Brightside Café and everything in it are fictional. Say so plainly if asked what this is. Talk to the visitor as "you".',
  },
  {
    scope: 'global',
    body: 'Nothing can be changed here. Never say you created, edited, sent, booked or saved anything, and never offer to. Say what you would do in a real office, and that creating their own office is how they would do it for real.',
  },
  {
    scope: 'global',
    body: 'Keep answers short and put the answer first. Use the Brightside Café work as the worked example.',
  },
]

export const AUTONOMY = 'suggest'
export const APPEARANCE = { palette: 'clay' }

export const allTasks = (): PlanTask[] => [...PROJECTS.flatMap((p) => p.tasks), ...PERSONAL_TASKS]
