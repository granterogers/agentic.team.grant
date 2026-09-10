/*
  Realistic mock data — Grant's actual projects, documents and tasks.

  §14A permits a mocked backend for M0 and requires REALISTIC data, which is
  not the same as placeholder data: a layout that only looks composed with three
  short titles is a layout that has not been tested. These are the real titles
  at their real lengths, including the awkward ones.
*/

/*
  The real portraits.

  #24 idea 4. `scripts/staff/generate-cartoon-avatars.ts` drew these months ago
  and put them in the `avatars` bucket, where nothing has looked at them since.
  Eight faces in the rail does more for Grant's *"as close to feeling like a
  human team as possible"* than any amount of surface polish, and the work was
  already done.
*/
const FACES = 'https://baujwlzcziasnfhhkchg.supabase.co/storage/v1/object/public/avatars'

/*
  Eight people, eight hues (#40 idea 4).

  Grant asked for the product to cohere, and one of the ten ways is to give each
  agent a visual identity used everywhere — the portrait in the rail, the tint
  on a job they own, their bubble in chat, the border of anything they made. Then
  provenance is something you recognise before you read it.

  That needs eight DISTINCT hues, and the palette has six. Emma and Ruby were
  both `p-rust`; Tom and Grace were both `p-slate`. Two people sharing a colour
  is worse than nobody having one, because it teaches you the colour means
  nothing.

  So each carries a `tone` — an OKLCH hue angle, spaced around the wheel with
  gaps where perception is compressed (the greens are further apart in degrees
  than the blues, because they are closer to the eye). The palette classes stay
  for projects; this is a separate axis, for people.

  The angles are chosen against the role, not at random: Claire's green is the
  one the office reads as "in hand"; Grace, who is quality and risk, sits next
  to the warning amber without being it.
*/
export const CREW = [
  { slug: 'claire', face: `${FACES}/chief-of-staff.jpg`, name: 'Claire', role: 'Chief of Staff',
    hue: 'p-moss', tone: 152, state: 'busy', doing: 'On a call with you' },
  { slug: 'emma', face: `${FACES}/research-director.jpg`, name: 'Emma', role: 'Research',
    hue: 'p-rust', tone: 28, state: 'busy', doing: 'Comparing Monday and Grok' },
  { slug: 'oliver', face: `${FACES}/communications-director.jpg`, name: 'Oliver', role: 'Communications',
    hue: 'p-iris', tone: 292, state: 'idle' },
  { slug: 'tom', face: `${FACES}/strategy-director.jpg`, name: 'Tom', role: 'Strategy',
    hue: 'p-slate', tone: 248, state: 'idle' },
  { slug: 'daniel', face: `${FACES}/finance-director.jpg`, name: 'Daniel', role: 'Finance & Data',
    hue: 'p-plum', tone: 338, state: 'idle' },
  { slug: 'marcus', face: `${FACES}/operations-director.jpg`, name: 'Marcus', role: 'Operations',
    hue: 'p-amber', tone: 78, state: 'idle' },
  { slug: 'ruby', face: `${FACES}/growth-director.jpg`, name: 'Ruby', role: 'Growth',
    hue: 'p-rust', tone: 4, state: 'idle' },
  { slug: 'grace', face: `${FACES}/quality-director.jpg`, name: 'Grace', role: 'Quality & Risk',
    hue: 'p-slate', tone: 196, state: 'idle' },
]

export const PROJECTS = [
  {
    slug: 'legacy-coaching-course',
    name: 'Legacy Coaching Course',
    purpose: 'Six modules built from the interview corpus.',
    hue: 'p-moss',
    connectors: ['Notion', 'NotebookLM'],
    done: 9, total: 24, docs: 12,
    next: 'Interviews by 16 Sep',
    modules: [
      { n: 1, name: 'Legacy Opening Assessment', state: 'done', docs: 2, tasks: 4 },
      { n: 2, name: 'Ideal Client Avatar', state: 'doing', docs: 3, tasks: 4 },
      { n: 3, name: 'Client Vision & Journey', state: 'todo', docs: 2, tasks: 4 },
      { n: 4, name: 'Coaching Interview Execution', state: 'todo', docs: 2, tasks: 4 },
      { n: 5, name: 'Three-Layer Wellness Impact', state: 'todo', docs: 2, tasks: 4 },
      { n: 6, name: 'Legacy Interview Roadmap', state: 'todo', docs: 1, tasks: 4 },
    ],
    documents: [
      { title: 'WS01 — Legacy Opening Assessment', kind: 'pdf', origin: 'Yours', size: '34,606 words', file: './samples/ws01.pdf', lines: [78, 100, 94, 97, 62, 88, 91, 74] },
      { title: 'Grant Rogers Avatar Document', kind: 'doc', origin: 'Yours', size: '27,841 words', lines: [66, 100, 90, 96, 71, 93] },
      { title: 'WS02 — Creating Client Vision', kind: 'pdf', origin: 'Yours', size: '21,370 words', lines: [84, 98, 86, 92, 58, 79] },
      { title: 'Grant Interview Questions', kind: 'pdf', origin: 'Yours', size: '11,616 words', lines: [70, 96, 88, 60] },
      { title: 'Journey VS Destination', kind: 'pdf', origin: 'Yours', size: '8,683 words', file: './samples/journey.pdf', lines: [82, 94, 90, 68, 86] },
      { title: 'Course one-pager', kind: 'made', origin: 'Oliver · 2 days ago', size: 'A4', file: './samples/one-pager.pdf', lines: [70, 100, 88] },
      { title: 'Legacy Questionnaire', kind: 'pdf', origin: 'Yours', size: '3,370 words', lines: [74, 92, 84] },
      { title: 'Whats App Audio From Ben', kind: 'audio', origin: 'Yours', size: '4 min · transcribed' },
    ],
    tasks: [
      { title: 'Conduct first five interviews', due: 'Due 16 September', who: 'claire', state: 'due' },
      { title: 'Prepare interview questions', note: 'Coaching Interview Execution', who: 'emma' },
      { title: 'List 20 real and prospective clients', note: 'Client Vision & Journey Mapping', who: 'emma' },
      { title: 'Map client answers to the three layers', note: 'Wellness Impact Analysis', who: 'oliver',
        blocked: 'Waiting on the first five interviews' },
      { title: 'Draft the avatar document', note: 'Ideal Client Avatar', who: 'emma', state: 'doing' },
      { title: 'Complete the Success Identity Quiz', state: 'done' },
      { title: 'Review the Zoom Call interview notes', state: 'done' },
    ],
    /*
      Contacts.

      Grant: *"I want a contacts list per project, all the relevant metadata to
      fill in."* For a coaching business these are not a CRM bolt-on — they are
      the work. WS02's open task is literally "list 20 real and prospective
      clients", and Ben already exists in this project as the person who sent
      the WhatsApp audio.

      The fields are chosen so the two questions he will actually ask have
      answers: *who is this and how do I reach them*, and *what happens next*.
      Everything else is optional and stays out of the way when empty.
    */
    contacts: [
      {
        name: 'Ben Hartley', role: 'Referrer', org: 'Hartley & Co',
        stage: 'active', hue: 'p-rust',
        email: 'ben@hartleyco.example', phone: '+44 7700 900118',
        where: 'Manchester', last: '3 days ago',
        next: 'Send the course outline', nextDue: 'This week',
        docs: ['Whats App Audio From Ben', 'WhatsApp from Ben'],
        note: 'Sent the voice note that reframed the vision module. Wants a look before it goes out.',
      },
      {
        name: 'Priya Raman', role: 'Prospective client', org: 'Independent',
        stage: 'prospect', hue: 'p-iris',
        email: 'priya.raman@example.com', phone: '',
        where: 'London', last: '2 weeks ago',
        next: 'Book the opening assessment', nextDue: 'Before 16 Sep',
        docs: ['WS01 - Legacy Opening Assessment - Getting to know you.pdf'],
        note: 'Came through the Journey vs Destination piece. Has not filled in the questionnaire.',
      },
      {
        name: 'Marcus Oyelaran', role: 'Client', org: 'Northgate Studios',
        stage: 'active', hue: 'p-moss',
        email: 'm.oyelaran@northgate.example', phone: '+44 7700 900243',
        where: 'Leeds', last: 'Yesterday',
        next: 'Interview two of five', nextDue: '16 September',
        docs: ['Zoom Call (Interview Sync)', 'Grant Interview Questions.pdf'],
        note: 'First of the five interviews. Answers are the basis of the avatar document.',
      },
      {
        name: 'Dana Whitlock', role: 'Past client', org: 'Whitlock Wellness',
        stage: 'dormant', hue: 'p-slate',
        email: 'dana@whitlockwellness.example', phone: '',
        where: 'Bristol', last: '4 months ago',
        next: '', nextDue: '',
        docs: [],
        note: 'Completed the 2025 cohort. Worth asking for a testimonial.',
      },
    ],
    /*
      What this project points at.

      Two kinds. A CONNECTOR is authenticated and syncs, so it has health and a
      last-read time and can fail. A REFERENCE is a pointer — it can be right or
      stale, never broken. The specification lists websites, APIs and external
      applications alongside NotebookLM and Drive, and none of those are
      connectors.
    */
    sources: [
      { kind: 'connector', name: 'Notion', what: 'Six module pages, written by the office',
        health: 'ok', last: '2 days ago', gave: 6 },
      { kind: 'connector', name: 'NotebookLM', what: 'The interview corpus',
        health: 'ok', last: '4 hours ago', gave: 12 },
      { kind: 'reference', name: 'Journey vs Destination (published)', what: 'The piece Priya came through',
        last: 'Added 3 weeks ago', gave: 0 },
      { kind: 'reference', name: 'Zoom cloud recordings', what: 'Interview recordings, not yet pulled in',
        last: 'Added 1 week ago', gave: 0 },
    ],

    /*
      What the team was asked, and what came back.

      Grant: *"a dedciate dashboard per project as its own tab where the teams
      inputs and outputs can esaily be seen and coordinated"*. A request and the
      artifact it produced are one record, not two systems that happen to
      mention each other. `context` is the item the request was started from —
      the same shape that "talk to the team about this" attaches to a message.
    */
    requests: [
      {
        id: 'r1', ask: 'Turn the six modules into a one-page course outline I can send out',
        from: 'Grant · chat', who: 'oliver', asked: '2 days ago',
        context: { kind: 'project', title: 'Legacy Coaching Course' },
        state: 'review', delivered: '2 days ago',
        output: { title: 'Course one-pager', kind: 'made', size: 'A4', file: './samples/one-pager.pdf', lines: [70, 100, 88] },
        derived: ['WS01 — Legacy Opening Assessment', 'Journey VS Destination'],
      },
      {
        id: 'r2', ask: 'Pull every client mentioned in WS02 into the vision map',
        from: 'Grant · voice', who: 'emma', asked: '2 days ago',
        context: { kind: 'document', title: 'WS02 — Creating Client Vision' },
        state: 'review', delivered: '2 hours ago',
        output: { title: 'WS02 client list — 22 names', kind: 'doc', size: '2 pages', lines: [90, 74, 96, 60] },
        derived: ['WS02 — Creating Client Vision'],
      },
      {
        id: 'r5', ask: 'Put the six modules into the Wellness Notion space',
        from: 'Grant · voice', who: 'marcus', asked: '2 days ago',
        context: null, state: 'working',
        // The state the first version could not express. A job stopped on a
        // missing permission read as "in hand", which is the opposite of true.
        blocked: 'Wellness Notion databases have not been shared with the integration',
        unblock: 'Ask Marcus what to share',
        delivered: '', output: null, derived: [],
      },
      {
        id: 'r3', ask: 'Draft the five interview questions for Marcus',
        from: 'Task · Prepare interview questions', who: 'emma', asked: '4 hours ago',
        context: { kind: 'contact', title: 'Marcus Oyelaran' },
        state: 'working', delivered: '',
        output: null, derived: [],
      },
      {
        id: 'r4', ask: 'Transcribe the WhatsApp note from Ben and tell me what changed',
        from: 'Grant · chat', who: 'claire', asked: '5 days ago',
        context: { kind: 'document', title: 'Whats App Audio From Ben' },
        state: 'approved', delivered: '5 days ago',
        output: { title: 'Ben Hartley — voice note, transcribed', kind: 'doc', size: '900 words', lines: [88, 92, 70] },
        derived: ['Whats App Audio From Ben'],
      },
    ],
    activity: [
      { who: 'emma', verb: 'pulled', what: 'the WS02 client list into the vision map', when: '2h ago' },
      { who: 'oliver', verb: 'made', what: 'the course one-pager', when: '2d ago' },
      { who: 'claire', verb: 'imported', what: '12 documents into Notion as 6 modules', when: '2d ago' },
    ],
  },
  {
    slug: 'ai-learning',
    name: 'AI learning',
    purpose: 'Notes, sources and reading.',
    hue: 'p-slate',
    connectors: ['NotebookLM'],
    done: 2, total: 7, docs: 1,
    modules: [],
    documents: [
      { title: '5 GitHub Repos: Kill AI Slop, Go Viral, Make Money', kind: 'pdf', origin: 'Yours', size: '21,390 words', lines: [80, 96, 88, 92, 64] },
    ],
    contacts: [],
    tasks: [{ title: 'Read the agent-orchestration papers', who: 'tom' }],
    sources: [
      { kind: 'connector', name: 'NotebookLM', what: 'Reading list and notes',
        health: 'ok', last: '1 day ago', gave: 1 },
      { kind: 'reference', name: 'arXiv — agent orchestration', what: 'Search this weekly',
        last: 'Added 2 days ago', gave: 0 },
    ],
    requests: [
      { id: 'r1', ask: 'Compare Monday.com agents against building our own',
        from: 'Grant · voice', who: 'emma', asked: '6 hours ago',
        context: null, state: 'working', delivered: '', output: null, derived: [] },
    ],
    activity: [{ who: 'tom', verb: 'summarised', what: 'two sources', when: '1d ago' }],
  },
  {
    slug: 'wellness',
    name: 'Wellness',
    purpose: 'Not yet connected — its Notion databases need sharing.',
    hue: 'p-amber',
    connectors: [],
    done: 0, total: 0, docs: 0,
    modules: [], documents: [], tasks: [], activity: [], contacts: [],
    sources: [
      { kind: 'connector', name: 'Notion', what: 'Nothing can be written until its databases are shared',
        health: 'blocked', problem: 'Not shared with the integration', last: 'never', gave: 0 },
    ],
    requests: [],
  },
]

export const WAITING = {
  what: 'Wellness needs its Notion databases shared before anything can be written there',
  who: 'Marcus', when: '2 days ago',
  note: 'Everything else on that project is carrying on.',
}

export const byId = (slug) => PROJECTS.find((p) => p.slug === slug) ?? PROJECTS[0]
export const crewBy = (slug) => CREW.find((c) => c.slug === slug) ?? CREW[0]
