/*
  Project Settings — who works here, what runs by itself, and how to leave.

  Issue #36, the last unbuilt child of #25. The specification closes the
  project hierarchy with a section that did not exist:

      PROJECT SETTINGS
        Team / permissions
        Integrations
        Agent configuration
        Automations
        Labels / categories
        Archive / export

  ## Four panes, not six, and the two that are missing are not missing

  Integrations is the Sources section — `project_attachments` and
  `project_references`, connected and disconnected there, beside the documents
  they produced. A second copy of it here would be a second place to change one
  thing, which is the complaint the Labels line of the Issue is itself making.

  Team and Agent configuration are ONE pane, because they are one fact: what a
  person is told on this project belongs on the row that says they are on it.
  A separate screen for it would mean two switches to find for one decision.

  So: Team, Automations, Labels, and This project.

  ## Nothing here is mocked

  Every control writes through `office.act` to a named action on `hq-api`, and
  every refusal shown is the sentence the RPC returned. `verify:settings` drives
  the same chain, HTTP included.

  ## The one destructive control, and it is not

  Archive is reversible — `status` changes, nothing is detached, nothing is
  deleted — and that is what makes the confirmation honest rather than
  ceremonial. There is no Delete button and there will not be: `project_delete`
  refuses a project holding documents or jobs, which is nearly all of them, and
  ADR-0014's order is a thing a person at a terminal does having read it.
*/

import { CREW } from './data.js'
import { act, attempt, canWrite, read, say, sure } from './office.js'

/*
  The panes. 8 October 2026, Grant: remove the Team tab (the main Team section stays) and the Project tab; keep
  Automations and Labels. Nothing the Project tab did is lost: its rename, export and archive controls moved to a
  fold at the foot of this page (projectFold, below), and How it looks was already in the project menu, which is why
  that block is no longer drawn twice.
*/
export const PANES = [
  { id: 'automations', name: 'Automations' },
  { id: 'labels', name: 'Labels' },
]

/*
  What has been fetched, per project.

  Its own payload rather than a field on `studio`, for the reason Lately and
  the portfolio task list have their own: this is a screen you navigate TO, and
  folding it into the first paint would make every project switch carry a
  settings screen nobody has opened. The export is a third of a megabyte on a
  real project, which settles it.

  Keyed by SLUG, not by id. A prototype project has no id at all — the invented
  ones in `data.js` carry a slug, a name and a purpose and nothing from the
  database — so keying on the id meant the map was keyed on `undefined`, `need`
  returned at its first line, and the pane said "Reading the office…" for ever
  on the one surface §14A exists to judge. It rendered, it threw nothing, it
  did not overflow, and it was empty. Found by opening the PNG.

  A slug is unique across projects and present in both worlds, which is what a
  key has to be. Switching projects and coming back does not refetch, and one
  project's team can never appear under another's name.
*/
const held = new Map()

const esc = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  )

/**
 * The design, on invented data, when there is no office to ask.
 *
 * Every other module here does this — `settings.js` has `FALLBACK_CONNECTIONS`
 * and says why: *"the mock below has the shape of those tables so that wiring
 * it is a swap, not a rewrite."* This pane needs it more than most, because it
 * is the only project section with a payload of its own: without a fallback,
 * the whole of Project Settings is a blank page in the prototype, and §14A's
 * loop cannot judge a blank page.
 *
 * Shaped exactly like `app.project_team` and `app.project_automations`, so the
 * live path and this one render through the same code. The automations are
 * plausible rather than aspirational — both are things the mechanism can
 * actually do today.
 */
const invented = () => ({
  team: CREW.map((c, i) => ({
    slug: c.slug,
    name: c.name,
    title: c.role,
    on: i !== 4,
    fixed: c.role === 'Chief of Staff',
    why_fixed: c.role === 'Chief of Staff' ? 'She is the only person who messages you.' : null,
    instruction:
      c.name === 'Emma'
        ? 'Prefer the interview transcripts over the module summaries on this one.'
        : '',
    decided: i === 4 || c.name === 'Emma',
  })),
  automations: [
    {
      slug: 'invented-1',
      what: 'Summarise anything new in the transcripts and say what changed.',
      instruction: 'Summarise anything new in the transcripts and say what changed.',
      who: 'Emma',
      when: 'every day at 08:00',
      on: true,
      mine: true,
      last_run: null,
    },
    {
      slug: 'invented-2',
      what: 'Check the module drafts against the workshop notes and flag anything that has drifted.',
      instruction:
        'Check the module drafts against the workshop notes and flag anything that has drifted.',
      who: null,
      when: 'once a week',
      on: false,
      mine: true,
      last_run: null,
    },
    {
      slug: 'invented-office',
      what: 'Read anything new in the connected sources',
      when: 'every hour',
      on: true,
      mine: false,
    },
  ],
  loading: false,
  invented: true,
})

/** Whether this project's settings are in hand yet. */
export const ready = (p) => held.has(p?.slug)

/**
 * Fetch a project's team and automations, once.
 *
 * The export is deliberately NOT fetched here. It is hundreds of kilobytes and
 * it is wanted at the moment Grant presses Export and at no other time.
 */
export async function need(p, redraw) {
  const key = p?.slug
  if (key === undefined || held.has(key)) return
  /*
    No token, or no id, means there is no office to ask and nothing to wait
    for. A prototype project has no id; asking anyway would spend a round trip
    to be told 401 and then show the same invented data, with a spinner in
    front of it for as long as the network took — the one state a prototype
    must never have.
  */
  if (!canWrite() || p.id === undefined || p.id === null) {
    held.set(key, invented())
    redraw()
    return
  }
  // Marked as in flight before either fetch, so a second render during the
  // await does not start a third and fourth request.
  held.set(key, { team: [], automations: [], loading: true })
  try {
    const [team, automations] = await Promise.all([
      read('project_team', p.id),
      read('project_automations', p.id),
    ])
    held.set(key, {
      team: Array.isArray(team) ? team : [],
      automations: Array.isArray(automations) ? automations : [],
      loading: false,
    })
  } catch {
    /*
      Empty rather than an error, and the pane says which. A settings screen
      that cannot reach the office should not also be the thing that announces
      the office is unreachable — #119's strip already does that, and saying it
      twice is noise.
    */
    held.set(key, invented())
  }
  redraw()
}

/** Throw away what is held, after a write, so the next render reads it again. */
export function forget(p) {
  held.delete(p?.slug)
}

// ---------------------------------------------------------------------------
// Team, and what each of them is told here
// ---------------------------------------------------------------------------

/**
 * The face this person is drawn with, matched in both worlds.
 *
 * `crewBy` in `data.js` does nearly this and falls back to CREW[0] for an
 * unknown slug, which here would put Claire's photograph on all eight. A
 * missing face is a monogram; the wrong face is a lie about who is on the
 * project.
 *
 * Matched on slug, on `staffSlug` (which `hydrate` sets from the office) and
 * on name, because the prototype crew are keyed `emma` and the office keys her
 * `research-director` — the same person, two vocabularies, and the name is the
 * one thing both agree on.
 */
const portrait = (m) =>
  CREW.find((c) => c.slug === m.slug || c.staffSlug === m.slug || c.name === m.name)


// ---------------------------------------------------------------------------
// What runs by itself
// ---------------------------------------------------------------------------

/**
 * The schedule picker, as words rather than a number of minutes.
 *
 * `period_minutes` is what the column stores and "every morning" is what a
 * person means. The mapping is here and the English on a saved automation
 * comes from `app.say_schedule`, which is one place further in — deliberately,
 * because the list a form offers is a smaller thing than the range the column
 * accepts, and a page inventing its own phrasing for a saved row is how two
 * spellings of one schedule appear.
 */
const EVERY = [
  { minutes: 60, name: 'every hour' },
  { minutes: 240, name: 'every four hours' },
  { minutes: 1440, name: 'once a day' },
  { minutes: 10080, name: 'once a week' },
]

function automationsPane(p, state) {
  const list = state.automations ?? []
  const mine = list.filter((a) => a.mine)
  const office = list.filter((a) => !a.mine)
  const team = (state.team ?? []).filter((m) => m.on)

  return `
    <p class="t-lead setlead">Things that happen on ${esc(p.name)} without you asking.
      Each one is a standing instruction — the same sentence you would send the
      team, repeated on a schedule.</p>

    ${
      canWrite()
        ? `<div class="setmake" data-saidwrap>
             <textarea data-auto-what rows="2"
               placeholder="Summarise anything new in the transcripts and say what changed"
               aria-label="What should happen"></textarea>
             <div class="setmakerow">
               <label class="t-meta">Who
                 <select data-auto-who aria-label="Who should do it">
                   <option value="">whoever it suits</option>
                   ${team
                     .map((m) => `<option value="${esc(m.slug)}">${esc(m.name)}</option>`)
                     .join('')}
                 </select>
               </label>
               <label class="t-meta">How often
                 <select data-auto-every aria-label="How often">
                   ${EVERY.map(
                     (e) =>
                       `<option value="${e.minutes}" ${e.minutes === 1440 ? 'selected' : ''}>${e.name}</option>`,
                   ).join('')}
                 </select>
               </label>
               <!--
                 A time of day only means something on a daily or slower
                 schedule, and the RPC refuses the combination. The field is
                 left enabled and the refusal is a sentence, rather than a
                 control that greys out and explains nothing.

                 No backticks in this comment. Template literal.
               -->
               <label class="t-meta">At
                 <input data-auto-at type="time" value="08:00" aria-label="At what time">
               </label>
               <button class="btn" data-auto-add="${esc(p.slug)}">Set it going</button>
             </div>
             <span class="t-meta" data-said></span>
           </div>`
        : ''
    }

    ${
      mine.length === 0
        ? `<p class="t-meta setnone">Nothing runs by itself on this project yet.</p>`
        : `<div class="setautos">${mine
            .map(
              (a) => `
        <article class="setauto ${a.on ? '' : 'off'}" data-saidwrap>
          <p class="setautowhat">${esc(a.instruction ?? a.what)}</p>
          <!--
            One meta line, in one order: when, who, and where it has got to.

            The first draft put "Running" or "Paused" on its own line under
            "not run yet", which is two facts about the same thing in two
            places saying apparently different things. State belongs in the
            sentence that describes the schedule, because it IS a fact about
            the schedule.

            No backticks in this comment. Template literal.
          -->
          <span class="t-meta">${esc(a.when)} · ${
            a.who ? esc(a.who) : 'whoever it suits'
          } · ${a.on ? (a.last_run ? 'running' : 'not run yet') : 'paused'}</span>
          ${
            canWrite()
              ? `<span class="setautofoot">
                   <button class="btn small quiet" data-auto-set="${esc(a.slug)}"
                     data-on="${a.on ? 'off' : 'on'}">${a.on ? 'Pause' : 'Resume'}</button>
                   <button class="btn small quiet" data-auto-remove="${esc(a.slug)}"
                     data-what="${esc(a.instruction ?? a.what)}">Remove</button>
                   <span class="t-meta" data-said></span>
                 </span>`
              : ''
          }
        </article>`,
            )
            .join('')}</div>`
    }

    <!--
      The office's own duties, listed and not editable here.

      Deleting the nightly backup from a project settings sheet is exactly the
      destructive action to check before, and the check that works is not
      offering it. They are shown rather than hidden because a page that says
      "nothing runs by itself" while nine things do is lying.

      No backticks in this comment. Template literal.
    -->
    ${
      office.length === 0
        ? ''
        : `<div class="setoffice">
             <span class="t-label">Also on this project, run by the office</span>
             ${office
               .map(
                 (a) =>
                   `<span class="t-meta">${esc(a.what)} — ${esc(a.when)}${a.on ? '' : ' (paused)'}</span>`,
               )
               .join('')}
           </div>`
    }`
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

/**
 * Labels and collections, in one place.
 *
 * #36: *"the collections and labels from #29, and the contact labels already
 * shipped in `web/studio/people.js`, edited in one place instead of two."*
 *
 * The contact labels are editable, through the same three actions the Contacts
 * tab uses — one implementation, two doors, which is what the Issue asked for
 * and the opposite of a second copy.
 *
 * Collections are listed and not yet editable, and the pane says so rather
 * than drawing a control that refuses: there is no `rename_collection` or
 * `remove_collection`, only `put_in_collection` and `take_out_of_collection`,
 * and inventing the missing half here would put the rule in the page.
 */
function labelsPane(p, people) {
  // Every collection this project's documents name, with how many are in each.
  // Derived from the documents rather than fetched: the names ARE the
  // membership, so a second reader would be a second thing to keep in step.
  const counts = new Map()
  for (const d of p.documents ?? []) {
    for (const c of d.collections ?? []) counts.set(c, (counts.get(c) ?? 0) + 1)
  }
  const collections = [...counts.entries()]
    .map(([name, n]) => ({ name, n }))
    .sort((a, b) => a.name.localeCompare(b.name))

  const labels = people.labels()
  return `
    <p class="t-lead setlead">The words you sort things by. Labels are yours to
      define; the office never invents one.</p>

    <div class="setlabels" data-saidwrap>
      <span class="t-label">Contact labels</span>
      <div class="setlabelrow">
        ${
          labels.length === 0
            ? `<span class="t-meta">None yet.</span>`
            : labels
                .map(
                  (l) => `<span class="chip ${esc(l.hue)}">${esc(l.name)}
            ${
              canWrite()
                ? `<button class="chipx" data-label-remove="${esc(l.id)}"
                     data-name="${esc(l.name)}" aria-label="Remove ${esc(l.name)}">×</button>`
                : ''
            }</span>`,
                )
                .join('')
        }
      </div>
      ${
        canWrite()
          ? `<span class="setadd">
               <input data-label-new placeholder="A new label" aria-label="A new label">
               <button class="btn small" data-label-add>Add</button>
             </span>`
          : ''
      }
      <span class="t-meta" data-said></span>
    </div>

    <!--
      Collections, LISTED now (#276, migration 0479).

      This block used to say, truthfully, that it could not list them: the
      studio payload carried a title, a kind and a state per document and
      nothing about which collection each was in, so a chip row built from what
      the page holds would have said "None yet" under a project that has one.
      0479 added the names to app.studio_documents, because a tag control
      cannot be built on a reader that does not know what is already set — and
      the list falls out of the same change.

      Read-only here on purpose. A collection is made by filing a document into
      one and unmade by taking the last one out, so the press belongs on the
      document, which is where you are when you decide. A Remove here would
      have to mean "take every document out of this", which is a different and
      much larger action wearing the same word.

      No backticks in this comment. Template literal.
    -->
    <div class="setlabels">
      <span class="t-label">Collections</span>
      <div class="setlabelrow">
        ${
          collections.length === 0
            ? '<span class="t-meta">None yet.</span>'
            : collections
                .map(
                  (c) =>
                    `<span class="chip">${esc(c.name)} <span class="t-meta">${c.n}</span></span>`,
                )
                .join('')
        }
      </div>
      <span class="t-meta">A collection is made by filing a document into one, and unmade
        by taking the last document out. Both are in <b>Documents</b>, on the document
        itself — which is where you are when you decide.</span>
    </div>`
}

// ---------------------------------------------------------------------------
// The project itself
// ---------------------------------------------------------------------------

function projectPane(p) {
  return `
    <div class="setproj">
      <div class="setblock" data-saidwrap>
        <span class="t-label">Name</span>
        <p class="t-meta">What this project is called, everywhere it appears. The address
          and everything inside it stay exactly as they are.</p>
        ${
          canWrite()
            ? `<form class="setadd" data-projrename-form="${esc(p.slug)}">
                 <input type="text" data-projname maxlength="80" value="${esc(p.name)}"
                   aria-label="Project name" autocomplete="off" spellcheck="false">
                 <button type="submit" class="btn small" data-projrename="${esc(p.slug)}">Save name</button>
               </form>`
            : `<span class="t-meta">Read-only — no token in this browser.</span>`
        }
        <span class="t-meta" data-said role="status" aria-live="polite"></span>
      </div>

      <div class="setblock" data-saidwrap>
        <span class="t-label">Take it with you</span>
        <p class="t-meta">Everything ${esc(p.name)} holds, as one file: the brief, the
          documents and their text, the tasks, the contacts, the sources, the team
          and every answer the office wrote. No identifiers of ours — it is meant
          to be readable somewhere else.</p>
        ${
          canWrite()
            ? `<button class="btn" data-export="${esc(p.id ?? '')}"
                 data-name="${esc(p.name)}">Export ${esc(p.name)}</button>`
            : `<span class="t-meta">Read-only — no token in this browser.</span>`
        }
        <span class="t-meta" data-said></span>
      </div>

      <!--
        Archive, and it is reversible. Nothing is detached and nothing is
        deleted — status changes and the automations stop — which is what
        makes the confirmation honest rather than ceremonial.

        There is no Delete and there will not be. project_delete refuses a
        project holding documents or jobs, which is nearly all of them, and
        ADR-0014's order is a thing a person at a terminal does having read it.

        No backticks in this comment. Template literal.
      -->
      <div class="setblock warnblock" data-saidwrap>
        <span class="t-label">Put it away</span>
        <p class="t-meta">${esc(p.name)} leaves your project list and stops running
          anything by itself. Everything it holds stays exactly where it is, and
          you can bring it back.</p>
        ${
          canWrite()
            ? `<button class="btn quiet" data-archive="${esc(p.slug)}"
                 data-name="${esc(p.name)}">Archive ${esc(p.name)}</button>`
            : `<span class="t-meta">Read-only — no token in this browser.</span>`
        }
        <span class="t-meta" data-said></span>
      </div>


      <div class="setblock">
        <span class="t-label">Elsewhere</span>
        <p class="t-meta">What this project reads from is in <b>Sources</b>, beside the
          documents it produced. How much the office does without asking is in the
          office <b>Settings</b> sheet, under Behaviour — it is one answer for
          everywhere, not one per project.</p>
      </div>
    </div>`
}

// ---------------------------------------------------------------------------
// The section
// ---------------------------------------------------------------------------

export function section(p, pane, people) {
  const state = held.get(p.slug) ?? { team: [], automations: [], loading: true }
  const which = PANES.some((x) => x.id === pane) ? pane : 'automations'

  const body = state.loading
    ? `<p class="t-meta setnone">Reading the office…</p>`
    : which === 'labels'
      ? labelsPane(p, people)
      : automationsPane(p, state)

  return `<div class="tabbody">
    <div class="subnav" role="tablist" aria-label="Settings for this project">
      ${PANES.map(
        (x) => `<button role="tab" class="subtab ${which === x.id ? 'on' : ''}"
          aria-selected="${which === x.id}" data-setpane="${x.id}">${esc(x.name)}</button>`,
      ).join('')}
    </div>
    ${body}
    ${projectFold(p)}
  </div>`
}

/** Rename, export and archive: what the Project tab held, kept reachable without a tab of its own. */
function projectFold(p) {
  return `<details class="setfold">
    <summary>Name, export and archive</summary>
    ${projectPane(p)}
  </details>`
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

/**
 * Turn a package into a file the browser saves.
 *
 * A blob and an object URL rather than a data: URI: the package is hundreds of
 * kilobytes and a data URI that long is refused by some browsers and truncated
 * in every address bar. Revoked immediately after the click, because an object
 * URL holds the whole thing in memory until it is.
 */
function download(name, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${name}.json`
  document.body.append(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/**
 * Wire everything on the pane.
 *
 * `redraw` after a write rather than patching the DOM: every one of these
 * changes what the OTHER controls should say — taking someone off removes them
 * from the automation form's Who list, and pausing an automation changes what
 * archiving will report. A page that patched one row would be right about that
 * row and wrong about the rest.
 */
export function wire(root, p, people, redraw, openLook, reload) {
  /*
    The picker is built in `app.js`, where the sheet and its 451 marks live, so
    it is handed in rather than imported - importing it here would make this
    module depend on the page that renders it.
  */
  for (const b of root.querySelectorAll('[data-open-look]')) {
    b.addEventListener('click', () => {
      openLook?.(b.dataset.openLook ?? '')
    })
  }

  const again = async () => {
    forget(p)
    await need(p, redraw)
  }

  for (const b of root.querySelectorAll('[data-set-staff]')) {
    b.addEventListener('click', async () => {
      const on = b.dataset.on === 'on'
      await attempt(
        b,
        on ? 'Putting them on…' : 'Taking them off…',
        () =>
          act('project_staff', {
            p_slug: p.slug,
            p_staff_slug: b.dataset.setStaff,
            p_on: on,
          }),
        `${b.dataset.name} is ${on ? 'on' : 'off'} this project.`,
      )
      await again()
    })
  }

  for (const b of root.querySelectorAll('[data-save-brief]')) {
    b.addEventListener('click', async () => {
      const box = root.querySelector(`[data-brief-for="${b.dataset.saveBrief}"]`)
      const text = box?.value ?? ''
      await attempt(
        b,
        'Saving…',
        () =>
          act('project_instruction', {
            p_slug: p.slug,
            p_staff_slug: b.dataset.saveBrief,
            p_instruction: text,
          }),
        // Two outcomes, said apart. "Saved" over an emptied box reads as though
        // the text is still there somewhere.
        text.trim() === '' ? 'Cleared — they work as usual here.' : 'Saved.',
      )
    })
  }

  for (const b of root.querySelectorAll('[data-auto-add]')) {
    b.addEventListener('click', async () => {
      const what = root.querySelector('[data-auto-what]')?.value ?? ''
      const who = root.querySelector('[data-auto-who]')?.value ?? ''
      const every = Number(root.querySelector('[data-auto-every]')?.value ?? 1440)
      const at = root.querySelector('[data-auto-at]')?.value ?? ''
      const made = await attempt(
        b,
        'Setting it going…',
        () =>
          act('automation_create', {
            p_slug: p.slug,
            p_instruction: what,
            p_every_minutes: every,
            // A time only means something on a daily or slower schedule, and
            // the RPC refuses the pair. Sent only when it can apply, so the
            // common case does not collect a refusal it never asked for.
            p_at_time: every >= 1440 ? at : '',
            p_who: who,
          }),
        (r) => `Set — ${r?.when ?? 'running'}.`,
      )
      if (made !== null) await again()
    })
  }

  for (const b of root.querySelectorAll('[data-auto-set]')) {
    b.addEventListener('click', async () => {
      const on = b.dataset.on === 'on'
      await attempt(
        b,
        on ? 'Resuming…' : 'Pausing…',
        () => act('automation_set', { p_automation: b.dataset.autoSet, p_on: on }),
        on ? 'Running again.' : 'Paused.',
      )
      await again()
    })
  }

  for (const b of root.querySelectorAll('[data-auto-remove]')) {
    b.addEventListener('click', async () => {
      // Removing an automation is the one thing on this pane that cannot be
      // undone by pressing the same button again.
      if (
        !(await sure(`“${b.dataset.what}” will be removed. Pausing it keeps it.`, 'Remove it', {
          title: 'Remove this automation?',
          danger: true,
        }))
      )
        return
      await attempt(
        b,
        'Removing…',
        () => act('automation_remove', { p_automation: b.dataset.autoRemove }),
        'Removed.',
      )
      await again()
    })
  }

  for (const b of root.querySelectorAll('[data-label-add]')) {
    b.addEventListener('click', async () => {
      const input = root.querySelector('[data-label-new]')
      const name = (input?.value ?? '').trim()
      if (name === '') {
        say(b, 'Give it a name first.', 'warn')
        return
      }
      await attempt(b, 'Adding…', () => people.addLabel(name), `Added ${name}.`)
      if (input) input.value = ''
      redraw()
    })
  }

  for (const b of root.querySelectorAll('[data-label-remove]')) {
    b.addEventListener('click', async () => {
      if (
        !(await sure(
          `Remove the label “${b.dataset.name}”? It comes off every contact carrying it.`,
          'Remove it',
          { title: 'Remove this label?', danger: true },
        ))
      ) {
        return
      }
      await attempt(b, 'Removing…', () => people.removeLabel(b.dataset.labelRemove), 'Removed.')
      redraw()
    })
  }

  for (const b of root.querySelectorAll('[data-export]')) {
    b.addEventListener('click', async () => {
      const was = b.disabled
      b.disabled = true
      say(b, 'Gathering everything…')
      try {
        const pkg = await read('project_export', b.dataset.export)
        download(p.slug, pkg)
        const n = (pkg?.documents ?? []).length
        say(b, `${n} document${n === 1 ? '' : 's'} and everything else — check your downloads.`)
      } catch (error) {
        say(b, error instanceof Error ? error.message : String(error), 'warn')
      } finally {
        b.disabled = was
      }
    })
  }

  /*
    RENAMING. The one field on the record a person is certain to want to change,
    and the only place in Team HQ that could. The office refuses a name another
    live project already answers to and says so in words; that sentence is shown
    as it came, because it names the project in the way.
  */
  for (const f of root.querySelectorAll('[data-projrename-form]')) {
    f.addEventListener('submit', async (e) => {
      e.preventDefault()
      const b = f.querySelector('[data-projrename]')
      const name = String(f.querySelector('[data-projname]')?.value ?? '').trim()
      if (b === null) return
      if (name === '') {
        say(b, 'A project needs a name.', 'warn')
        return
      }
      if (name === p.name) {
        say(b, 'That is already its name.')
        return
      }
      const done = await attempt(
        b,
        'Saving…',
        () => act('rename_project', { p_slug: f.dataset.projrenameForm, p_name: name }),
        'Renamed.',
      )
      if (done) await reload?.()
    })
  }

  for (const b of root.querySelectorAll('[data-archive]')) {
    b.addEventListener('click', async () => {
      if (
        !(await sure(
          `Archive “${b.dataset.name}”? ` +
            'It leaves your project list and stops running anything by itself. ' +
            'Nothing is deleted, and you can bring it back.',
          'Archive it',
          { title: 'Archive this project?' },
        ))
      ) {
        return
      }
      await attempt(
        b,
        'Putting it away…',
        () => act('project_archive', { p_slug: b.dataset.archive }),
        (r) =>
          `Archived${
            Number(r?.automations_stopped ?? 0) > 0
              ? `, and ${String(r.automations_stopped)} automation${
                  Number(r.automations_stopped) === 1 ? '' : 's'
                } stopped`
              : ''
          }.`,
      )
    })
  }
}
