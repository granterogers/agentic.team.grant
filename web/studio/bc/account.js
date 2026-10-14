/*
  Arriving, creating an account, setting up the office, and the first project.

  Four screens, one idea: a person arrives, proves an address, gets ONE private office, and makes a first project. There
  is no organisation, no switching and no sharing here, because the product has none: one person, one office, many
  projects.

  ## Which screen

    - nobody signed in, on a deployed page ........... the entry screen (Sign in / Create account)
    - signed in, the office says there is none yet ... the set-up screen (name the office, once)
    - signed in, an office with no projects .......... the first-run screen (the shell, with one next step)
    - anything else ................................. the shell, as ever

  The entry screen is shown on a deployed page and NOT on a local static server, where the shell has always drawn its
  invented projects so a layout can be judged without an office. `?welcome` asks for it anywhere.

  ## Words

  The page says account, office, project, team. It does not say tenant, workspace, organisation or token.

  ## Honest about what it does

  Creating an account sends a link. Opening it proves the address and signs the person in; the office is made on the
  next screen, by a button the person presses. Nothing is created for an address that has not been proved, and asking
  for a link for an address that already has an account simply signs it in, which the page says.

  Plain words in every comment in this file: the markup lives inside template literals.
*/

import { act, attempt, canWrite } from '../office.js'
import { source } from '../data.js'
import { bounded } from '../net.js'
import * as session from '../session.js'
import { signOut } from '../signout.js'
import { esc } from './parts.js'

/*
  Which tab the entry screen opens on. `?start=create` is how the Sample Office's "Create your own office" lands on the
  right one. Read once, when the module loads: the router rewrites the address before the first paint.
*/
const startTab = (() => {
  try {
    return new URLSearchParams(globalThis.location?.search ?? '').get('start') === 'create' ? 'create' : 'signin'
  } catch {
    return 'signin'
  }
})()

/** What the person typed on the create tab, kept so a redraw does not lose it. */
const form = { tab: startTab, email: '', name: '', sent: '', opening: false }

const NAME_KEY = 'hq.signup-name'

const hostedPage = () => {
  const host = String(globalThis.location?.hostname ?? '')
  return !(host === 'localhost' || host === '127.0.0.1' || host === '')
}
/*
  Read once, when the module loads: the router rewrites the address before the first paint, so asking later finds nothing.
  Kept for the tab in session storage so a reload does not lose it.
*/
const welcomeAsked = (() => {
  try {
    if (new URLSearchParams(globalThis.location?.search ?? '').has('welcome')) {
      sessionStorage.setItem('hq.welcome', '1')
    }
    return sessionStorage.getItem('hq.welcome') === '1'
  } catch {
    return new URLSearchParams(globalThis.location?.search ?? '').has('welcome')
  }
})()
const asked = () => welcomeAsked

/** Which of the screens the page is on. */
export const mode = () => {
  if (source.state === 'no_office') return 'setup'
  if (canWrite()) return 'app'
  return hostedPage() || asked() ? 'entry' : 'app'
}

/* ------------------------------------------------------------------------ *
 * The Sample Office: where a visitor is, and the way out
 * ------------------------------------------------------------------------ */

/** Whether this browser is looking at the public Sample Office rather than somebody's own office. */
export const isSample = () => session.isSample()

/** The words on the header's leave button: a visitor leaves the sample, a person signs out. */
export const leaveWords = () =>
  isSample()
    ? { text: 'Leave sample', label: 'Leave the Sample Office', title: 'Leave the Sample Office' }
    : { text: 'Sign out', label: 'Sign out', title: 'Sign out and clear this browser of your work' }

/*
  The strip above the shell while somebody is exploring. It says where they are and offers the way out in the same
  place, so a visitor is never in the sample without knowing it and never stuck in it.
*/
export const sampleBar = () =>
  isSample()
    ? `<aside class="bcsamplebar" role="region" aria-label="You are in the Sample Office">
        <p class="bcsampletext"><b>Sample Office</b><span class="bcsamplemore"> · a made-up café, so changes are not saved</span></p>
        <span class="bcsampleacts">
          <button type="button" class="bcbtn bcbtn--primary bcsamplecreate" data-bc-sample-create>Create your own office</button>
          <button type="button" class="bcsamplelink" data-bc-sample-signin>Sign in</button>
        </span>
      </aside>`
    : ''

/*
  Leaving the sample is signing out of it: the same wipe a person gets, so nothing the visitor saw or asked is left in this
  browser for whoever comes next, and nothing of the sample can become somebody's real office. Then the entry screen, on the
  tab they asked for.
*/
export async function leaveSample(tab) {
  await signOut({ reload: false })
  const base = String(globalThis.location?.pathname ?? '/')
  globalThis.location.replace(`${base}?welcome=1&start=${tab === 'create' ? 'create' : 'signin'}`)
}

/* ------------------------------------------------------------------------ *
 * The entry screen
 * ------------------------------------------------------------------------ */

const emailField = (id, value) => `<div class="bcfield">
    <label class="bclabel" for="${id}">Email address</label>
    <input class="bcinput" id="${id}" type="email" name="email" autocomplete="email" spellcheck="false"
      autocapitalize="off" inputmode="email" placeholder="you@example.com" value="${esc(value)}" required>
  </div>`

const sentCard = () => `<div class="bcentrysent" role="status">
    <b>Check your email</b>
    <span>We sent a link to <strong>${esc(form.sent)}</strong>. Opening it on this device ${
      form.tab === 'create'
        ? 'confirms your address and takes you to set up your office. If you already had an account, it simply signs you in.'
        : 'signs you in.'
    } It works once.</span>
    <span class="bcentrysmall">It can take a minute. Look in spam if it is not there.</span>
    <div class="bcentryrow">
      <button type="button" class="bcbtn bcbtn--outline" data-bc-entry-again>Send it again</button>
      <button type="button" class="bcbtn" data-bc-entry-other>Use a different address</button>
    </div>
  </div>`

const signinPanel = () => `<form class="bcentryform" data-bc-entry-form="signin" novalidate>
    ${emailField('bc-entry-email-in', form.email)}
    <p class="bcentrysmall">No password. We email you a link that signs you in on this device.</p>
    <button type="submit" class="bcbtn bcbtn--primary bcentrygo">Email me a sign-in link</button>
    <p class="bcentrysaid" data-bc-entry-said role="status" aria-live="polite"></p>
  </form>`

const createPanel = () => `<form class="bcentryform" data-bc-entry-form="create" novalidate>
    <div class="bcfield">
      <label class="bclabel" for="bc-entry-name">Your name</label>
      <input class="bcinput" id="bc-entry-name" type="text" name="name" autocomplete="name" maxlength="80"
        placeholder="Alex Morgan" value="${esc(form.name)}" required>
    </div>
    ${emailField('bc-entry-email-new', form.email)}
    <p class="bcentrysmall">We email you a link. Opening it confirms your address, then you set up your own private office. Nothing is shared with anyone.</p>
    <button type="submit" class="bcbtn bcbtn--primary bcentrygo">Create account</button>
    <p class="bcentrysaid" data-bc-entry-said role="status" aria-live="polite"></p>
  </form>`

/* The build version beside the sign-in kicker, so the signed-out page shows what it is too. */
const entryVersion = () => (typeof window.HQ_VERSION === "string" && window.HQ_VERSION !== "" ? `<span class="bcver bcver--entry" title="Team HQ version ${window.HQ_VERSION}">v${window.HQ_VERSION}</span>` : "");

export const entry = () => {
  const ended = source.state === 'refused'
  return `<main class="bcentry" id="bcmain" tabindex="-1">
    <div class="bcentrycard">
      <p class="bcentrykicker">Team HQ ${entryVersion()}</p>
      <h1 class="bcentrytitle">A team that works on your projects with you</h1>
      <p class="bcentrylead">Every project gets its own tasks, documents, calendar and conversation. Claire, your chief of staff, brings in the right specialist when there is work to do, and checks with you before she acts for you.</p>
      ${ended ? '<p class="bcentrynote" role="status">Your sign-in ended, so you have been signed out. Sign in again to carry on.</p>' : ''}
      ${session.landed.problem === '' ? '' : `<p class="bcentrynote bcentrynote--bad" role="alert">${esc(session.landed.problem)}</p>`}
      <section class="bcentrypath" aria-labelledby="bc-sample-head">
        <h2 class="bcentrypathhead" id="bc-sample-head">New here? Explore a Sample Office</h2>
        <p class="bcentrypathtext">See a working office for a small café: its projects, tasks, documents and a team you can ask a question. No account needed, and nothing you do there is saved.</p>
        <button type="button" class="bcbtn bcbtn--primary bcentrygo" data-bc-sample-start${form.opening ? ' disabled' : ''}>${form.opening ? 'Opening the Sample Office…' : 'Explore the Sample Office'}</button>
        <p class="bcentrysaid" data-bc-sample-said role="status" aria-live="polite"></p>
      </section>
      <h2 class="bcentrypathhead bcentrypathhead--second" id="bc-own-head">Sign in or create your own office</h2>
      <div class="bcentrytabs" role="tablist" aria-labelledby="bc-own-head">
        <button type="button" role="tab" id="bc-tab-signin" aria-selected="${form.tab === 'signin'}" aria-controls="bc-panel-entry" data-bc-entry-tab="signin">Sign in</button>
        <button type="button" role="tab" id="bc-tab-create" aria-selected="${form.tab === 'create'}" aria-controls="bc-panel-entry" data-bc-entry-tab="create">Create account</button>
      </div>
      <div class="bcentrypanel" id="bc-panel-entry" role="tabpanel" aria-labelledby="bc-tab-${form.tab}">
        ${form.sent === '' ? (form.tab === 'create' ? createPanel() : signinPanel()) : sentCard()}
      </div>
    </div>
  </main>`
}

/* ------------------------------------------------------------------------ *
 * Setting up the office, once
 * ------------------------------------------------------------------------ */

let who = ''
/** Whether the address is being asked for right now (see the set-up screen). */
let whoAsking = false

export const setup = () => {
  let remembered = form.name
  try {
    remembered = remembered === '' ? (localStorage.getItem(NAME_KEY) ?? '') : remembered
  } catch {
    // storage blocked: the person types it
  }
  return `<main class="bcentry" id="bcmain" tabindex="-1">
    <div class="bcentrycard">
      <p class="bcentrykicker">Team HQ ${entryVersion()}</p>
      <h1 class="bcentrytitle">One last step: set up your office</h1>
      <p class="bcentrylead">${
        who === '' ? 'You are signed in.' : `You are signed in as <strong>${esc(who)}</strong>.`
      } Your office is private to you. Your projects, tasks, documents and conversations with the team live there, and nobody else can see them.</p>
      <form class="bcentryform" data-bc-setup-form novalidate>
        <div class="bcfield">
          <label class="bclabel" for="bc-setup-name">Your name</label>
          <input class="bcinput" id="bc-setup-name" type="text" name="name" autocomplete="name" maxlength="80"
            placeholder="Alex Morgan" value="${esc(remembered)}" required>
        </div>
        <button type="submit" class="bcbtn bcbtn--primary bcentrygo">Create my office</button>
        <p class="bcentrysaid" data-bc-setup-said role="status" aria-live="polite"></p>
      </form>
      <p class="bcentrysmall">Not you? <button type="button" class="bcentrylink" data-bc-setup-out>Sign out</button></p>
    </div>
  </main>`
}

/* ------------------------------------------------------------------------ *
 * First run, and making a project
 * ------------------------------------------------------------------------ */

/** The project form. `open` draws it already shown (first run) or behind a button (the portfolio). */
export const newProject = ({ open }) => `<form class="bcnewproject" data-bc-newproject-form${open ? '' : ' hidden'} novalidate>
    <div class="bcfield">
      <label class="bclabel" for="bc-newproject-name">Project name</label>
      <input class="bcinput" id="bc-newproject-name" type="text" name="name" maxlength="80" autocomplete="off"
        placeholder="For example: Spring launch" required>
      <span class="bclabel">You can rename it later, and add documents, tasks and people as you go.</span>
    </div>
    <div class="bcnewprojectrow">
      <button type="submit" class="bcbtn bcbtn--primary" data-bc-newproject-go>Create project</button>
      ${open ? '' : '<button type="button" class="bcbtn" data-bc-newproject-cancel>Cancel</button>'}
      <span class="bcentrysaid" data-bc-newproject-said role="status" aria-live="polite"></span>
    </div>
  </form>`

export const firstRun = () => `<section class="bcfirst" aria-labelledby="bc-first-title">
    <p class="bcentrykicker">Welcome to Team HQ</p>
    <h1 class="bcsectiontitle" id="bc-first-title">Your office is ready</h1>
    <p class="bcfirstlead">Start with one project. It is the container for everything about one piece of work.</p>
    <div class="bcfirstcard">
      <b>Create your first project</b>
      ${newProject({ open: true })}
    </div>
    <ul class="bcfirststeps">
      <li><b>Projects</b><span>Each project keeps its own tasks, documents, calendar, contacts and conversation together.</span></li>
      <li><b>Your team</b><span>Claire, your chief of staff, answers in Chat and brings in a specialist (research, finance, strategy and more) when work needs one. Open a project and press Chat with Team.</span></li>
      <li><b>Where things live</b><span>Tasks, documents and the calendar are inside each project. My Tasks is your own list. Activity shows what the team has been doing.</span></li>
    </ul>
  </section>`

/* ------------------------------------------------------------------------ *
 * Wiring
 * ------------------------------------------------------------------------ */

let ctxRef = null
export const mount = (c) => {
  ctxRef = c
}

const say = (el, words) => {
  if (el !== null && el !== undefined) el.textContent = words
}

const looksLikeEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)

/** The create-office call: a pre-office door, because this person has a session and no office yet. */
export async function createOffice(name) {
  const token = await session.presentable()
  if (token === '') throw new Error('You are signed out. Sign in again.')
  // Setting up an office writes several rows, so it may wait longer than a read, but it ends and says where it stopped.
  const r = await bounded(
    'office:create',
    session.apiUrl(),
    {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'create_office', name }),
    },
    40_000,
  )
  const body = await r.json().catch(() => ({}))
  const result = body.result ?? body
  if (!r.ok || result.ok === false || typeof result.error === 'string') {
    throw new Error(
      typeof result.error === 'string' && result.error !== ''
        ? result.error
        : 'The office could not be set up just now. Try again in a moment.',
    )
  }
  return result
}

export function wire(root) {
  const m = mode()
  document.documentElement.dataset.gate = m === 'app' ? '' : m
  if (m === 'app') {
    wireProject(root)
    for (const b of root.querySelectorAll('[data-bc-sample-create]')) {
      b.addEventListener('click', () => void leaveSample('create'))
    }
    for (const b of root.querySelectorAll('[data-bc-sample-signin]')) {
      b.addEventListener('click', () => void leaveSample('signin'))
    }
    return
  }

  const redraw = () => ctxRef?.render?.()

  for (const b of root.querySelectorAll('[data-bc-sample-start]')) {
    const said = root.querySelector('[data-bc-sample-said]')
    b.addEventListener('click', async () => {
      if (form.opening) return
      form.opening = true
      b.disabled = true
      b.textContent = 'Opening the Sample Office…'
      say(said, '')
      try {
        await session.startSample()
        // A fresh start reads the new session the way any page load does.
        globalThis.location.replace(String(globalThis.location?.pathname ?? '/'))
      } catch (error) {
        form.opening = false
        b.disabled = false
        b.textContent = 'Explore the Sample Office'
        say(said, error instanceof Error ? error.message : String(error))
      }
    })
  }

  for (const t of root.querySelectorAll('[data-bc-entry-tab]')) {
    t.addEventListener('click', () => {
      form.tab = t.dataset.bcEntryTab === 'create' ? 'create' : 'signin'
      form.sent = ''
      redraw()
      root.querySelector('.bcentryform input')?.focus()
    })
  }
  for (const f of root.querySelectorAll('[data-bc-entry-form]')) {
    const said = f.querySelector('[data-bc-entry-said]')
    f.addEventListener('submit', async (e) => {
      e.preventDefault()
      const create = f.dataset.bcEntryForm === 'create'
      const email = String(f.querySelector('[name=email]')?.value ?? '').trim()
      const name = create ? String(f.querySelector('[name=name]')?.value ?? '').trim() : ''
      form.email = email
      form.name = name
      if (create && name === '') {
        say(said, 'Tell us your name first.')
        f.querySelector('[name=name]')?.focus()
        return
      }
      if (!looksLikeEmail(email)) {
        say(said, 'That does not look like an email address.')
        f.querySelector('[name=email]')?.focus()
        return
      }
      const go = f.querySelector('button[type=submit]')
      if (go !== null) go.disabled = true
      say(said, 'Sending…')
      try {
        if (create) {
          try {
            localStorage.setItem(NAME_KEY, name)
          } catch {
            // storage blocked: the set-up screen asks again
          }
        }
        await session.askForLink(email)
        form.sent = email
        redraw()
        root.querySelector('.bcentrysent')?.setAttribute('tabindex', '-1')
        root.querySelector('.bcentrysent')?.focus()
      } catch (error) {
        if (go !== null) go.disabled = false
        say(said, error instanceof Error ? error.message : String(error))
      }
    })
  }
  for (const b of root.querySelectorAll('[data-bc-entry-other]')) {
    b.addEventListener('click', () => {
      form.sent = ''
      redraw()
      root.querySelector('.bcentryform input')?.focus()
    })
  }
  for (const b of root.querySelectorAll('[data-bc-entry-again]')) {
    b.addEventListener('click', async () => {
      b.disabled = true
      try {
        await session.askForLink(form.sent)
        b.textContent = 'Sent again'
      } catch (error) {
        b.disabled = false
        b.textContent = error instanceof Error ? error.message : 'Try again'
      }
    })
  }

  if (m === 'setup') {
    // One question at a time: this runs on every draw of the set-up screen, and two draws before the first answer used to ask twice.
    if (who === '' && !whoAsking) {
      whoAsking = true
      void session.whoami().catch(() => '').then((email) => {
        whoAsking = false
        if (email !== '' && who === '') {
          who = email
          redraw()
        }
      })
    }
    for (const out of root.querySelectorAll('[data-bc-setup-out]')) out.addEventListener('click', () => signOut())
    for (const f of root.querySelectorAll('[data-bc-setup-form]')) {
      const said = f.querySelector('[data-bc-setup-said]')
      f.addEventListener('submit', async (e) => {
        e.preventDefault()
        const name = String(f.querySelector('[name=name]')?.value ?? '').trim()
        form.name = name
        if (name === '') {
          say(said, 'Tell us your name first.')
          return
        }
        const go = f.querySelector('button[type=submit]')
        if (go !== null) go.disabled = true
        say(said, 'Setting up your office…')
        try {
          await createOffice(name)
          try {
            localStorage.removeItem(NAME_KEY)
          } catch {
            // nothing to clear
          }
          source.state = 'prototype'
          say(said, 'Done. Opening it…')
          await ctxRef?.refresh?.()
        } catch (error) {
          if (go !== null) go.disabled = false
          say(said, error instanceof Error ? error.message : String(error))
        }
      })
    }
  }
}

/** The project form, wherever it is drawn (first run, or behind the portfolio's button). */
function wireProject(root) {
  for (const b of root.querySelectorAll('[data-bc-newproject-open]')) {
    b.addEventListener('click', () => {
      const f = root.querySelector('[data-bc-newproject-form]')
      if (f === null) return
      f.hidden = !f.hidden
      b.setAttribute('aria-expanded', String(!f.hidden))
      if (!f.hidden) f.querySelector('input')?.focus()
    })
  }
  for (const f of root.querySelectorAll('[data-bc-newproject-form]')) {
    const said = f.querySelector('[data-bc-newproject-said]')
    const input = f.querySelector('input[name=name]')
    const go = f.querySelector('[data-bc-newproject-go]')
    let confirmed = ''
    f.querySelector('[data-bc-newproject-cancel]')?.addEventListener('click', () => {
      f.hidden = true
      root.querySelector('[data-bc-newproject-open]')?.setAttribute('aria-expanded', 'false')
      root.querySelector('[data-bc-newproject-open]')?.focus()
    })
    input?.addEventListener('input', () => {
      confirmed = ''
      if (go !== null) go.textContent = 'Create project'
    })
    f.addEventListener('submit', async (e) => {
      e.preventDefault()
      const name = String(input?.value ?? '').trim()
      if (name === '') {
        say(said, 'A project needs a name.')
        input?.focus()
        return
      }
      if (!canWrite()) {
        say(said, 'Sign in to create a project.')
        return
      }
      /*
        A project starts with a direct-upload source, because a project in this office must hold at least one source and
        a person with nothing connected has nothing else to name. Connecting Drive, Notion or a notebook is a later
        step in the project's own settings. A near match comes back as a question instead of a project.
      */
      const made = await attempt(
        go,
        'Creating…',
        () =>
          act('create_project', {
            p_name: name,
            p_connector: 'upload',
            p_ref: `direct-upload:${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 48)}`,
            ...(confirmed === name ? { p_force: true } : {}),
          }),
        (r) => (r?.candidates?.length ? '' : 'Created.'),
      )
      if (made?.candidates?.length) {
        confirmed = name
        if (go !== null) go.textContent = 'Create it anyway'
        say(
          said,
          `You already have ${made.candidates.map((c) => c.name).join(', ')}. Press again if this is a new project.`,
        )
        return
      }
      if (made?.slug) {
        await ctxRef?.refresh?.()
        ctxRef?.goAnywhere?.(`/p/${made.slug}`)
      }
    })
  }
}
