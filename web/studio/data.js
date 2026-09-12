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
const FALLBACK_CREW = [
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

const FALLBACK_PROJECTS = [
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
      /*
        A watched Drive folder (#62).

        Grant: *"anytime I drop a document in there, chief of staff is like, oh,
        we see that a file has been dropped. What would you like me to do with
        that?"* So a Drive source says when it was last looked at, not merely
        that it is connected — the useful fact about a watcher is whether it is
        awake.
      */
      { kind: 'connector', name: 'Google Drive', what: 'Course material — watched for new files',
        health: 'ok', last: '6 minutes ago', gave: 3 },
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

const FALLBACK_WAITING = {
  what: 'Wellness needs its Notion databases shared before anything can be written there',
  who: 'Marcus', when: '2 days ago',
  note: 'Everything else on that project is carrying on.',
}

/*
  ---------------------------------------------------------------------------
  Real data (#68, ADR-0019)
  ---------------------------------------------------------------------------

  Grant chose to make the studio the product rather than port its design into
  the plain page, so this file stops being the source of truth and becomes the
  fallback plus the design layer.

  Two things stay here on purpose:

  **The mock, as a fallback.** With no token, or with the API unreachable, the
  studio still renders. That matters more than it sounds: §14A's loop is render
  → capture → critique, and a design that cannot be looked at without a live
  backend is a design nobody critiques on the morning the backend is down.

  **The colour.** `hue` and `tone` are decisions from `docs/design/direction.md`
  about perception — the greens spaced further apart than the blues because they
  are closer to the eye — and they are not facts about a project. Putting them
  in a database column is how somebody eventually sets one to a hex code.
*/

/*
  The database calls her `chief-of-staff` and the design calls her Claire.

  Issue #42, which has been open since the prototype was written. Rather than
  renaming eight rows in a live office to match a prototype, the mapping lives
  here — one place, and the direction of travel is obvious if the slugs are ever
  reconciled.
*/
export const DESIGN = {
  'chief-of-staff':          { slug: 'claire', hue: 'p-moss',  tone: 152 },
  'research-director':       { slug: 'emma',   hue: 'p-rust',  tone: 28 },
  'communications-director': { slug: 'oliver', hue: 'p-iris',  tone: 292 },
  'strategy-director':       { slug: 'tom',    hue: 'p-slate', tone: 248 },
  'finance-director':        { slug: 'daniel', hue: 'p-plum',  tone: 338 },
  'operations-director':     { slug: 'marcus', hue: 'p-amber', tone: 78 },
  'growth-director':         { slug: 'ruby',   hue: 'p-rust',  tone: 4 },
  'quality-director':        { slug: 'grace',  hue: 'p-slate', tone: 196 },
}

/*
  A project's hue, stable for the life of its slug.

  Not stored, and not assigned by position: position changes when a project is
  created and every card in the portfolio would change colour at once, which
  looks like a fault. A hash of the slug means Legacy Coaching Course is the
  same green next week and a new project takes whatever is left.
*/
const HUES = ['p-moss', 'p-slate', 'p-amber', 'p-iris', 'p-rust', 'p-plum']

/*
  Assigned in one pass over the whole list rather than one project at a time.

  A pure hash per slug is stable, which is the property that matters, but two of
  four projects came out the same purple on the first real render — and two
  adjacent cards sharing a colour is worse than nobody having one, because it
  teaches you the colour means nothing. Exactly the argument `data.js` already
  makes about Emma and Ruby both being rust.

  So the hash picks a STARTING point and collisions walk to the next free hue.
  Stable while the set of projects is stable, which is the honest guarantee: a
  new project can shift one other card, and that is a better trade than two
  cards that look related and are not.
*/
const hueFor = (slug) => {
  let n = 0
  for (const ch of String(slug)) n = (n * 31 + ch.charCodeAt(0)) % 9973
  return HUES[n % HUES.length]
}

const huesFor = (slugs) => {
  const taken = new Set()
  const out = {}
  for (const slug of [...slugs].sort()) {
    const wanted = HUES.indexOf(hueFor(slug))
    let at = wanted
    while (taken.has(HUES[at]) && taken.size < HUES.length) at = (at + 1) % HUES.length
    out[slug] = HUES[at]
    taken.add(HUES[at])
  }
  return out
}

/** Live, and mutable in place so importers holding the array see the update. */
export const CREW = [...FALLBACK_CREW]
export const PROJECTS = [...FALLBACK_PROJECTS]
export const WAITING = { ...FALLBACK_WAITING }

/*
  Whether what is on screen is the office or the mock, and WHICH KIND of not-live
  it is (#119).

  There used to be one boolean and a sentence, so "you are not signed in" and
  "the office is down" wore the same calm label: `Prototype data`. The first is
  normal and expected; the second means an outage, and it should not take a
  second look to tell them apart. The more alarming state was wearing the
  quieter word.

  `state` is one of:

    prototype    no token. Nothing is wrong. This is the design, on invented
                 projects, which is exactly what it says.
    unreachable  the fetch failed or timed out. The office may be down and
                 nothing on screen is current. Offers a retry.
    refused      a 401 with a token present. The token is stale, and it is
                 cleared, because a page retrying a dead token forever is a
                 page that never recovers.
    stale        it answered once and has stopped. Distinguished because the
                 numbers on screen were real at `at` and are not now, which is
                 a different warning from never having had any.

  `live` stays a boolean and stays true only for the good case, so every
  existing reader keeps working.
*/
export const source = {
  live: false,
  at: null,
  state: 'prototype',
  why: 'not asked yet',
  /** How many times in a row a fetch has failed. Drives the retry's wording. */
  misses: 0,
}

const replace = (target, rows) => {
  target.length = 0
  for (const r of rows) target.push(r)
}

/**
 * Fetch the real office and put it behind the same shapes.
 *
 * Deliberately forgiving: any failure leaves the mock in place and records why.
 * A studio that shows a stack trace instead of a design is a studio nobody can
 * judge, and the fallback is already realistic data at realistic lengths.
 */
export async function hydrate(endpoint, token) {
  try {
    /*
      A timeout, because a fetch with none can hang for the browser's default
      and the page sits on a spinner-less blank claiming nothing is wrong. Ten
      seconds is far longer than the office ever takes and far shorter than a
      person will wait before deciding the product is broken.
    */
    const stop = AbortSignal.timeout(10_000)
    const r = await fetch(`${endpoint}?section=studio`, {
      headers: { authorization: `Bearer ${token}` },
      signal: stop,
    })
    if (r.status === 401 || r.status === 403) {
      const refused = new Error('that token was not accepted')
      refused.name = 'Refused'
      throw refused
    }
    if (!r.ok) throw new Error(`http ${r.status}`)
    const { data } = await r.json()
    if (!data || !Array.isArray(data.projects)) throw new Error('unexpected shape')

    const base = data.avatar_base ?? FACES
    replace(
      CREW,
      (data.crew ?? []).map((c) => {
        const d = DESIGN[c.slug] ?? { slug: c.slug, hue: 'p-slate', tone: 210 }
        return {
          ...d,
          // The real slug travels too: everything that writes back — a chat
          // addressed to somebody, a tool grant — needs the name the office
          // answers to, not the one the design calls them.
          staffSlug: c.slug,
          face: c.avatar_ref ? `${base}/${c.avatar_ref}` : '',
          name: c.name,
          role: c.role,
          state: c.state,
          doing: c.doing,
          expertise: c.expertise ?? [],
        }
      }),
    )

    const hues = huesFor(data.projects.map((p) => p.slug))
    replace(
      PROJECTS,
      data.projects.map((p) => ({
        ...p,
        hue: hues[p.slug] ?? hueFor(p.slug),
        // Every section the studio renders, guaranteed to be an array so a
        // renderer never has to ask. An absent section and an empty one are the
        // same thing to a reader, and only one of them can throw.
        modules: p.modules ?? [],
        documents: p.documents ?? [],
        tasks: p.tasks ?? [],
        contacts: p.contacts ?? [],
        sources: p.sources ?? [],
        activity: p.activity ?? [],
        requests: p.requests ?? [],
      })),
    )

    for (const k of Object.keys(WAITING)) delete WAITING[k]
    if (data.waiting) Object.assign(WAITING, data.waiting)

    source.live = true
    source.at = data.generated_at ?? new Date().toISOString()
    source.state = 'live'
    source.why = ''
    source.misses = 0
    return true
  } catch (e) {
    source.live = false
    source.misses += 1
    /*
      Name the kind of failure, because the answer differs.

      A refused token is the page's to fix — clear it, and the next load is an
      honest prototype rather than a loop retrying a credential that will never
      work again. Everything else is the office's, and all the page can do is
      say so and offer to try again.

      `stale` rather than `unreachable` once it has answered at least once: the
      numbers on screen WERE real, and "these are from 11 minutes ago" is a
      different warning from "there has never been anything here".
    */
    if (e instanceof Error && (e.name === 'Refused' || /http 40[13]/.test(e.message))) {
      source.state = 'refused'
      source.why = 'that token was not accepted — sign in again'
      try { localStorage.removeItem('hq.token') } catch { /* nothing to clear */ }
    } else {
      source.state = source.at === null ? 'unreachable' : 'stale'
      source.why =
        e instanceof Error && e.name === 'TimeoutError'
          ? 'the office did not answer in ten seconds'
          : e instanceof Error
            ? e.message
            : String(e)
    }
    return false
  }
}

export const byId = (slug) => PROJECTS.find((p) => p.slug === slug) ?? PROJECTS[0]
export const crewBy = (slug) =>
  CREW.find((c) => c.slug === slug || c.staffSlug === slug) ?? CREW[0]
