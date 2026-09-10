/*
  Realistic mock data — Grant's actual projects, documents and tasks.

  §14A permits a mocked backend for M0 and requires REALISTIC data, which is
  not the same as placeholder data: a layout that only looks composed with three
  short titles is a layout that has not been tested. These are the real titles
  at their real lengths, including the awkward ones.
*/

export const CREW = [
  { slug: 'claire', name: 'Claire', role: 'Chief of Staff', hue: 'p-moss', state: 'busy',
    doing: 'On a call with you' },
  { slug: 'emma', name: 'Emma', role: 'Research', hue: 'p-rust', state: 'busy',
    doing: 'Comparing Monday and Grok' },
  { slug: 'oliver', name: 'Oliver', role: 'Communications', hue: 'p-iris', state: 'idle' },
  { slug: 'tom', name: 'Tom', role: 'Strategy', hue: 'p-slate', state: 'idle' },
  { slug: 'daniel', name: 'Daniel', role: 'Finance & Data', hue: 'p-plum', state: 'idle' },
  { slug: 'marcus', name: 'Marcus', role: 'Operations', hue: 'p-amber', state: 'idle' },
  { slug: 'ruby', name: 'Ruby', role: 'Growth', hue: 'p-rust', state: 'idle' },
  { slug: 'grace', name: 'Grace', role: 'Quality & Risk', hue: 'p-slate', state: 'idle' },
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
      { title: 'WS01 — Legacy Opening Assessment', kind: 'pdf', origin: 'Yours', size: '34,606 words', lines: [78, 100, 94, 97, 62, 88, 91, 74] },
      { title: 'Grant Rogers Avatar Document', kind: 'doc', origin: 'Yours', size: '27,841 words', lines: [66, 100, 90, 96, 71, 93] },
      { title: 'WS02 — Creating Client Vision', kind: 'pdf', origin: 'Yours', size: '21,370 words', lines: [84, 98, 86, 92, 58, 79] },
      { title: 'Grant Interview Questions', kind: 'pdf', origin: 'Yours', size: '11,616 words', lines: [70, 96, 88, 60] },
      { title: 'Journey VS Destination', kind: 'pdf', origin: 'Yours', size: '8,683 words', lines: [82, 94, 90, 68, 86] },
      { title: 'Course one-pager', kind: 'made', origin: 'Oliver · 2 days ago', size: 'A4', lines: [70, 100, 88] },
      { title: 'Legacy Questionnaire', kind: 'pdf', origin: 'Yours', size: '3,370 words', lines: [74, 92, 84] },
      { title: 'Whats App Audio From Ben', kind: 'audio', origin: 'Yours', size: '4 min · transcribed' },
    ],
    tasks: [
      { title: 'Conduct first five interviews', due: 'Due 16 September', who: 'claire', state: 'due' },
      { title: 'Prepare interview questions', note: 'Coaching Interview Execution', who: 'emma' },
      { title: 'List 20 real and prospective clients', note: 'Client Vision & Journey Mapping', who: 'emma' },
      { title: 'Map client answers to the three layers', note: 'Wellness Impact Analysis', who: 'oliver' },
      { title: 'Complete the Success Identity Quiz', state: 'done' },
      { title: 'Review the Zoom Call interview notes', state: 'done' },
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
    tasks: [{ title: 'Read the agent-orchestration papers', who: 'tom' }],
    activity: [{ who: 'tom', verb: 'summarised', what: 'two sources', when: '1d ago' }],
  },
  {
    slug: 'wellness',
    name: 'Wellness',
    purpose: 'Not yet connected — its Notion databases need sharing.',
    hue: 'p-amber',
    connectors: [],
    done: 0, total: 0, docs: 0,
    modules: [], documents: [], tasks: [], activity: [],
  },
]

export const WAITING = {
  what: 'Wellness needs its Notion databases shared before anything can be written there',
  who: 'Marcus', when: '2 days ago',
  note: 'Everything else on that project is carrying on.',
}

export const byId = (slug) => PROJECTS.find((p) => p.slug === slug) ?? PROJECTS[0]
export const crewBy = (slug) => CREW.find((c) => c.slug === slug) ?? CREW[0]
