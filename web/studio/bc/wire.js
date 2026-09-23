/*
  Wiring for the experimental Basecamp-inspired Team HQ.

  Separated from shell.js because the two answer different questions: shell.js
  says what the page looks like, this says what pressing it does. Keeping them
  apart is also what makes the "every control has an effect" rule checkable -
  a data attribute rendered over there with no handler here is a dead control,
  and both halves are short enough to read side by side.

  Every mutation goes through `attempt()` from office.js, which is already the
  pending / success / recoverable-failure contract §12 asks for: it disables
  the control, says what it is doing, says what happened and re-enables. A
  second mechanism would be a second set of words for one thing.
*/

import { act, attempt, canWrite, read, token } from '../office.js'
import * as session from '../session.js'
import { esc } from './parts.js'
import * as bcDrive from './drive.js'
import * as live from './livevoice.js'
import * as notes from './notestore.js'
import * as recorder from './voicenote.js'
import * as pdf from '../pdf.js'
import * as bcMini from './miniatures.js'
import {
  callAbout,
  callActivity,
  callPhase,
  callSays,
  callTurns,
  syncCallButtons,
  toggleCall,
} from '../call.js'
import * as compose from './compose.js'
import * as grid from './layout.js'
import * as contacts from './contacts.js'
import * as todos from './todos.js'
import * as jump from './jump.js'

let ctx = null
export const mount = (c) => {
  ctx = c
  /*
    ONE key listener for the whole experience, on the document, attached once.

    `render()` replaces everything inside #root on every paint, so a listener
    bound to a node in there dies at the first redraw - a control that works
    exactly once, which this repository has shipped three times in one file.
    The document survives every render, and the handler asks the experience
    flag rather than assuming.
  */
  document.addEventListener('keydown', (e) => {
    if (ctx.state.experience !== 'basecamp') return
    jump.onKey(e)
  })
}

/**
 * Wire one freshly-drawn shell.
 *
 * Called after every paint, on nodes that are new every time - so handlers are
 * attached per render rather than delegated. That matches how the default
 * studio works and keeps the two comparable.
 */
/*
  WHERE THE DIALOG WAS SCROLLED TO.

  Grant, 23 September: "Opening a contact full-screen and scrolling downward
  currently causes the view to jump back toward the top."

  It does, and this is why: `render()` replaces the shell's markup, so the
  dialog that comes back is a NEW element whose `scrollTop` is 0. Nothing was
  wrong with the scrolling - the thing being scrolled had been thrown away and
  rebuilt, several times a minute, by redraws that have nothing to do with the
  dialog.

  So the position is REMEMBERED CONTINUOUSLY, on every scroll, and put back
  after the redraw that replaced the node. CLAUDE.md's #197 is the same lesson
  in a different costume: anything you need to know about "before" has to have
  been recorded before.

  Keyed by address, so opening a different contact starts at the top rather
  than inheriting the last one's position.
*/
const dialogScroll = { at: '', top: 0 }

const rememberDialogScroll = (root) => {
  const box = root.querySelector('.bcexpbox')
  if (box === null) {
    /* No dialog: forget, so the next one opens at its own beginning. */
    dialogScroll.at = ''
    dialogScroll.top = 0
    return
  }
  const here = globalThis.location?.pathname ?? ''
  if (dialogScroll.at !== here) {
    dialogScroll.at = here
    dialogScroll.top = 0
  } else if (dialogScroll.top > 0) {
    /*
      AFTER LAYOUT, not during wiring.

      Setting `scrollTop` on a box whose content has not been laid out yet
      silently CLAMPS TO ZERO - there is nothing to scroll past - so the first
      version of this restored nothing and the dialog still jumped to the top.
      One frame later the content is measured and the same assignment takes.

      Applied immediately as well, so that when the content IS ready there is
      no visible jump to the top and back.
    */
    const to = dialogScroll.top
    box.scrollTop = to
    globalThis.requestAnimationFrame?.(() => {
      if (box.isConnected && box.scrollTop !== to) box.scrollTop = to
    })
  }
  box.addEventListener(
    'scroll',
    () => {
      dialogScroll.at = globalThis.location?.pathname ?? ''
      dialogScroll.top = box.scrollTop
    },
    { passive: true },
  )
}

export const wire = (root) => {
  rememberDialogScroll(root)

  // Navigation inside the experience.
  for (const b of root.querySelectorAll('[data-bc-go]')) {
    b.addEventListener('click', (e) => {
      e.preventDefault()
      ctx.goAnywhere(b.dataset.bcGo)
    })
  }

  /*
    ASKING THE TEAM — one path, whether the words were typed or spoken.

    The last line of this is why it exists. `chat.ask` reports its states
    through the callback (sending, then waiting) and writes the ANSWER after
    the last of them, so a page that redraws only from the callback keeps the
    waiting bubble for ever: the stored thread had Claire's reply in it while
    the screen showed an empty one. That was true of the typed Send button
    before the voice note was built, and it was found by building the voice
    note - two callers of one path, of which only one was being looked at.
  */
  const askTheTeam = async (project, text, { alreadySaid = false } = {}) => {
    if (!alreadySaid) ctx.chatSend?.(project, text)
    ctx.render()
    await ctx.chatAsk?.(project, text, () => {
      ctx.render()
    })
    ctx.render()
  }

  /*
    THE VOICE NOTE, end to end.

    Record -> stop -> listen back -> send. The words then take the ORDINARY
    typed path (`ctx.chatSend` and `ctx.chatAsk`, the same two calls the Send
    button makes), which is Grant's "do not create a separate voice note
    conversation" implemented rather than merely agreed with.

    The panel holds three states and draws them here rather than in the shell,
    because they change many times a second while recording and a shell redraw
    would take the microphone with it.
  */
  const notePanel = () => root.querySelector('[data-bc-notepanel]')
  const noteMic = () => root.querySelector('[data-bc-note]')
  const clock = (n) =>
    `${String(Math.floor(n / 60))}:${String(Math.floor(n % 60)).padStart(2, '0')}`
  const meter = (lvl) => {
    const bars = 14
    /* A square root, so an ordinary speaking voice fills most of the meter -
       a linear scale spends nine tenths of it on sounds nobody makes. */
    const lit = Math.min(bars, Math.round(Math.sqrt(Math.min(1, lvl)) * bars))
    let out = ''
    for (let i = 0; i < bars; i += 1) out += `<i class="bcnotebar" data-lit="${i < lit ? 1 : 0}"></i>`
    return `<div class="bcnotemeter" aria-hidden="true">${out}</div>`
  }
  const noteSay = (words, phase = '') => {
    const panel = notePanel()
    if (panel === null) return
    panel.hidden = false
    if (phase !== '') panel.dataset.bcNotephase = phase
    const line = panel.querySelector('.bcnotesaid')
    if (line !== null) line.textContent = words
  }
  const noteShut = () => {
    const panel = notePanel()
    if (panel !== null) {
      panel.hidden = true
      panel.innerHTML = ''
      delete panel.dataset.bcNotephase
    }
    const mic = noteMic()
    if (mic !== null) {
      mic.dataset.bcNote = 'idle'
      mic.querySelector('.bcnotemictxt').textContent = 'Voice note'
    }
  }

  let held = null

  const drawRecording = ({ seconds, level }) => {
    const panel = notePanel()
    if (panel === null) return
    const shown = panel.querySelector('.bcnoteclock')
    if (shown === null) {
      panel.hidden = false
      panel.dataset.bcNotephase = 'recording'
      panel.innerHTML =
        `<div class="bcnoterow">
          <span class="bcnoteclock">${clock(seconds)}</span>
          ${meter(level)}
          <button type="button" class="bcbtn bcbtn--primary" data-bc-notestop>Stop</button>
          <button type="button" class="bcbtn" data-bc-notecancel>Cancel</button>
        </div>
        <p class="bcnotesaid">Recording. Stop when you have finished and you can listen back before it goes.</p>`
      return
    }
    shown.textContent = clock(seconds)
    const bars = panel.querySelectorAll('.bcnotebar')
    const lit = Math.min(bars.length, Math.round(Math.sqrt(Math.min(1, level)) * bars.length))
    bars.forEach((b, i) => {
      b.dataset.lit = i < lit ? '1' : '0'
    })
  }

  const drawReview = async (kept) => {
    const panel = notePanel()
    if (panel === null) return
    held = kept
    const url = URL.createObjectURL(kept.blob)
    panel.hidden = false
    panel.dataset.bcNotephase = 'review'
    panel.innerHTML =
      `<div class="bcnoterow">
        <span class="bcnoteclock">${clock(kept.seconds)}</span>
        <audio class="bcnoteplayer" controls preload="metadata" src="${url}"
          data-bc-noteplayback></audio>
      </div>
      <div class="bcnoterow">
        <button type="button" class="bcbtn bcbtn--primary" data-bc-notesend>Send to the team</button>
        <button type="button" class="bcbtn" data-bc-noteagain>Record again</button>
        <button type="button" class="bcbtn" data-bc-notecancel>Delete</button>
      </div>
      <p class="bcnotesaid">The team is sent what you said, in words. The recording itself stays in this browser.</p>`
  }

  const startNote = async () => {
    const mic = noteMic()
    try {
      await recorder.start(drawRecording)
      if (mic !== null) {
        mic.dataset.bcNote = 'recording'
        mic.querySelector('.bcnotemictxt').textContent = 'Recording'
      }
      drawRecording({ seconds: 0, level: 0 })
    } catch (e) {
      noteShut()
      noteSay('', 'failed')
      const panel = notePanel()
      if (panel !== null) {
        panel.hidden = false
        panel.dataset.bcNotephase = 'failed'
        panel.innerHTML =
          `<p class="bcnotesaid">${esc(e instanceof Error ? e.message : String(e))}</p>
           <div class="bcnoterow">
             <button type="button" class="bcbtn" data-bc-noteagain>Try again</button>
             <button type="button" class="bcbtn" data-bc-notecancel>Close</button>
           </div>`
      }
    }
  }

  const stopNote = async () => {
    const mic = noteMic()
    if (mic !== null) {
      mic.dataset.bcNote = 'idle'
      mic.querySelector('.bcnotemictxt').textContent = 'Voice note'
    }
    const kept = await recorder.stop().catch(() => null)
    if (kept === null) {
      noteShut()
      return
    }
    /*
      NOTHING WAS HEARD, and this is where that is settled rather than at the
      speech service, which cannot tell: three seconds of digital silence comes
      back from it as "Thank you.", with the same no-speech probability as real
      speech. The browser measured the sound, so the browser is what knows.
    */
    if (!kept.heard) {
      const panel = notePanel()
      if (panel !== null) {
        panel.hidden = false
        panel.dataset.bcNotephase = 'failed'
        panel.innerHTML =
          `<p class="bcnotesaid">Nothing was picked up — the microphone stayed silent the whole
             time. Nothing has been sent.</p>
           <div class="bcnoterow">
             <button type="button" class="bcbtn bcbtn--primary" data-bc-noteagain>Record again</button>
             <button type="button" class="bcbtn" data-bc-notecancel>Close</button>
           </div>`
      }
      return
    }
    await drawReview(kept)
  }

  const sendNote = async () => {
    if (held === null) return
    const panel = notePanel()
    if (panel !== null) {
      panel.dataset.bcNotephase = 'sending'
      panel.innerHTML = '<p class="bcnotesaid">Working out what you said…</p>'
    }
    const project = ctx.state.project
    let heard = ''
    try {
      heard = await recorder.words(held.blob, {
        endpoint: ctx.voiceEndpoint?.() ?? '',
        token: ctx.officeToken?.() ?? '',
        /* A spelling hint only: the project's name and the team's. */
        vocabulary: [
          ctx.projectName?.(project) ?? '',
          ...(ctx.crew ?? []).map((c) => c.name ?? ''),
        ],
      })
    } catch (e) {
      if (panel !== null) {
        panel.dataset.bcNotephase = 'failed'
        panel.innerHTML =
          `<p class="bcnotesaid">${esc(e instanceof Error ? e.message : String(e))}
             Your recording is still here.</p>
           <div class="bcnoterow">
             <button type="button" class="bcbtn bcbtn--primary" data-bc-notesend>Try sending again</button>
             <button type="button" class="bcbtn" data-bc-notecancel>Delete it</button>
           </div>`
      }
      return
    }
    /*
      AND FROM HERE IT IS AN ORDINARY MESSAGE. Same two calls as the Send
      button, same thread, same office - the only difference is where the words
      came from.
    */
    const said = ctx.chatSend?.(project, heard) ?? []
    const mine = [...said].reverse().find((m) => (m.who ?? m.from) === 'grant')
    if (mine !== undefined) await notes.keep(mine.id, held.blob, { seconds: held.seconds })
    held = null
    noteShut()
    await askTheTeam(project, heard, { alreadySaid: true })
  }

  /*
    DELEGATED, on the form, because the panel replaces its own contents.

    Stop, Cancel, Send and Record again are all drawn by `drawRecording` and
    `drawReview` AFTER this runs, so a listener attached per button here would
    be attached to nothing - which is exactly what the first run of
    `verify:basecamp-voicenote` found: the meter moved, the clock ran, and
    pressing Stop did nothing at all. CLAUDE.md records this trap three times
    in one afternoon in one file; the cure is the same one: listen on the
    element that does NOT get replaced.
  */
  for (const form of root.querySelectorAll('[data-bc-sayform]')) {
    form.addEventListener('click', async (e) => {
      const pressed = e.target?.closest?.(
        '[data-bc-note], [data-bc-notestop], [data-bc-noteagain], [data-bc-notecancel], [data-bc-notesend]',
      )
      if (pressed === null || pressed === undefined) return
      e.preventDefault()
      if (pressed.hasAttribute('data-bc-notestop')) {
        await stopNote()
        return
      }
      if (pressed.hasAttribute('data-bc-noteagain')) {
        held = null
        await startNote()
        return
      }
      if (pressed.hasAttribute('data-bc-notecancel')) {
        held = null
        recorder.cancel()
        noteShut()
        return
      }
      if (pressed.hasAttribute('data-bc-notesend')) {
        await sendNote()
        return
      }
      /* The microphone itself: press to start, press again to stop. */
      if (recorder.active()) await stopNote()
      else await startNote()
    })
  }

  /*
    PLAYING ONE BACK. The control is only drawn for a message that HAS a
    recording, so it can never be the button that does nothing.
  */
  for (const b of root.querySelectorAll('[data-bc-noteplay]')) {
    b.addEventListener('click', async () => {
      const id = b.dataset.bcNoteplay ?? ''
      const src = await notes.url(id)
      if (src === '') return
      const existing = b.parentElement?.querySelector('[data-bc-noteaudio]')
      if (existing !== null && existing !== undefined) {
        void existing.play()
        return
      }
      const player = document.createElement('audio')
      player.className = 'bcnoteplayer'
      player.controls = true
      player.src = src
      player.dataset.bcNoteaudio = id
      b.parentElement?.append(player)
      void player.play()
    })
  }

  /*
    SIGNING IN.

    The token goes into this browser and the page asks the office again. It is
    VALIDATED BY USE rather than by shape - the office is the only thing that
    can say whether a token is good, and a page that guessed would either
    refuse a valid one or accept a dud and fail later with something vaguer.

    A token that does not work is removed again, so the browser is never left
    holding a credential the office has refused. That is the state that
    produced the original complaint: something stored, nothing accepted, and
    every message coming back "unauthorized".
  */
  for (const form of root.querySelectorAll('[data-bc-signinform]')) {
    const said = form.querySelector('[data-bc-signin-said]')
    const codeBox = form.querySelector('[data-bc-signin-code]')
    const digits = form.querySelector('[data-bc-signin-digits]')
    const tell = (words) => {
      if (said !== null) said.textContent = words
    }
    const done = async () => {
      /*
        Signed in: ask the office again and redraw. Nothing here judges the
        credential -- the read is the authority, and `office.js` clears one the
        office refuses, which is exactly the behaviour a browser that could not
        reach the office used to hide.
      */
      tell('Signed in.')
      await ctx.refresh()
      ctx.render()
    }

    /*
      ASKING. One press, then a code to compare and a wait.

      The button is disabled while an ask is live, because a second press would
      start a second request and put a second message on his phone -- and the
      code he is looking at would no longer be the one that works.
    */
    for (const b of form.querySelectorAll('[data-bc-signin-ask]')) {
      b.addEventListener('click', (e) => {
        e.preventDefault()
        void (async () => {
          b.disabled = true
          tell('Asking…')
          let asked
          try {
            asked = await session.begin()
          } catch (err) {
            b.disabled = false
            tell(err instanceof Error ? err.message : String(err))
            return
          }
          if (digits !== null) digits.textContent = asked.code
          if (codeBox !== null) codeBox.hidden = false
          tell('Check your Telegram. Tap the link if it shows this code.')
          const settled = await session.settle(asked.requestId, {
            onWait: () => {
              tell('Waiting for you to tap…')
            },
          })
          if (settled.ok) {
            if (codeBox !== null) codeBox.hidden = true
            await done()
            return
          }
          b.disabled = false
          if (codeBox !== null) codeBox.hidden = true
          tell(session.SAID[settled.reason] ?? 'That did not work. Try again.')
        })()
      })
    }

    /*
      THE FALLBACK, folded away behind a disclosure.

      A preview deployment gets its own hostname and is deliberately not on the
      sign-in allowlist, so it cannot ask -- and it is where this experiment is
      verified. Validated by USE, not by shape: the office is the only thing
      that can say whether a token is good, and a token it refuses is removed
      again so the browser is never left holding one.
    */
    const field = form.querySelector('#bc-token')
    const tryToken = async () => {
      const offered = String(field?.value ?? '').trim()
      if (offered === '') {
        tell('Put the token in first.')
        field?.focus()
        return
      }
      tell('Checking…')
      if (!token.set(offered)) {
        tell(session.SAID.private)
        return
      }
      try {
        await read('studio')
        if (field !== null) field.value = ''
        await done()
      } catch (e) {
        token.clear()
        tell(
          e instanceof Error && /not accepted|unauthorized/i.test(e.message)
            ? 'The office did not accept that token.'
            : `The office could not be reached: ${e instanceof Error ? e.message : String(e)}`,
        )
      }
    }
    for (const f of form.querySelectorAll('[data-bc-tokenform]')) {
      f.addEventListener('submit', (e) => {
        e.preventDefault()
        void tryToken()
      })
    }
    for (const b of form.querySelectorAll('[data-bc-signin]')) {
      b.addEventListener('click', (e) => {
        e.preventDefault()
        void tryToken()
      })
    }
  }

  /*
    ASKING THE OFFICE AGAIN, from the strip that says it did not answer.

    Drawn only in the two states where retrying can help, so this is never the
    control that cannot do its job - and it says what it is doing while it
    does it, because a button that looks unchanged for four seconds reads as a
    button that did nothing.
  */
  for (const b of root.querySelectorAll('[data-bc-retry-office]')) {
    b.addEventListener('click', async () => {
      const was = b.textContent
      b.disabled = true
      b.textContent = 'Trying…'
      try {
        await ctx.refresh()
      } finally {
        b.disabled = false
        b.textContent = was
      }
    })
  }

  /*
    Leaving the experience for the current Team HQ.

    A full page load rather than a router hop, deliberately: the two
    experiences put different attributes on the document root and the default
    studio expects to boot into its own shell. It is also the honest signal -
    you are going somewhere else, and the address bar says so.
  */
  for (const b of root.querySelectorAll('[data-bc-leave]')) {
    b.addEventListener('click', (e) => {
      e.preventDefault()
      window.location.assign(b.dataset.bcLeave)
    })
  }

  for (const b of root.querySelectorAll('[data-bc-jump]')) {
    b.addEventListener('click', () => {
      jump.show(b)
    })
  }

  /*
    CHAT WITH TEAM IS A TOGGLE, and it says which way it is set.

    `aria-pressed` is painted from the dock's own state rather than flipped on
    each press, so closing the dock by its own X leaves the button honest -
    which is the difference between a toggle and a button that counts its own
    presses.
  */
  for (const b of root.querySelectorAll('[data-bc-dock]')) {
    b.setAttribute('aria-pressed', ctx.dockIsOpen?.() === true ? 'true' : 'false')
    b.addEventListener('click', () => {
      const open = ctx.toggleDock?.() ?? ctx.openDock()
      b.setAttribute('aria-pressed', open === true ? 'true' : 'false')
    })
  }

  /*
    THE OFFICE'S OWN SETTINGS, WIRED AT THE SHELL (§14).

    This lived inside `wirePageMenu`, which returns early when the page has no
    project menu -- so on every project SUB-page, where the header is not
    drawn, the control in the top row was never given a listener. It looked
    right at every width and did nothing on four phone routes, which is what
    `verify:basecamp-controls` presses for and reading the code would not have
    shown. The control belongs to the shell, so the shell wires it.
  */
  for (const b of root.querySelectorAll('[data-bc-settings]')) {
    b.addEventListener('click', () => {
      ctx.openGlobalSettings?.()
    })
  }

  for (const b of root.querySelectorAll('[data-bc-attention]')) {
    b.addEventListener('click', () => {
      /*
        The attention queue is the team surface of whichever project has
        something waiting - §6.1 says this control must not become a permanent
        sidebar, and a control that opens the place the work actually is beats
        a panel that lists it a second time.
      */
      const p = ctx.projects().find((x) => (x.waiting ?? []).length > 0)
      ctx.goAnywhere(p === undefined ? '/basecamp/' : `/basecamp/p/${p.slug}/team`)
    })
  }

  wireTasks(root)
  wireOutputs(root)
  wireSearch(root)
  wireDocs(root)
  wireArrange(root)
  wireBoard(root)
  wireDocsWorkspace(root)
  wireCounts(root)
  wireSources(root)
  wireVoice(root)
  wireContacts(root)
  wireProjectSettings(root)
  wirePageMenu(root)
  wireExpanded(root)
}

/* ----------------------------------------------------------------- search */

const wireSearch = (root) => {
  const box = root.querySelector('#bc-search-q')
  if (box !== null) {
    /*
      Filters as you type (§7.1's "immediately"), and the caret is put back
      where it was: `render()` replaces every node, so a redraw on each
      keystroke would otherwise send the cursor to the start of the box after
      the first letter.
    */
    box.addEventListener('input', () => {
      const where = box.selectionStart
      ctx.state.bcQuery = box.value
      ctx.render()
      const again = document.querySelector('#bc-search-q')
      if (again !== null) {
        again.focus()
        if (where !== null) again.setSelectionRange(where, where)
      }
    })
  }
  for (const b of root.querySelectorAll('[data-bc-kind]')) {
    b.addEventListener('click', () => {
      ctx.state.bcKind = b.dataset.bcKind
      ctx.render()
    })
  }
  for (const b of root.querySelectorAll('[data-bc-only]')) {
    b.addEventListener('click', () => {
      const v = b.dataset.bcOnly
      ctx.state.bcOnly = v === '' ? null : v
      ctx.render()
    })
  }
}

/* ---------------------------------------------------------------- outputs */

/**
 * Add to project (§9, §17 phase 5).
 *
 * One action, `output_import`, which is the path the current Team HQ already
 * uses — not a second import. It is idempotent in the DATABASE, by a partial
 * unique index whose four migrations are recorded in CLAUDE.md, so the page's
 * job is not to enforce that but to stop offering a press that has already
 * happened, and to show the office's own words if it refuses.
 */
const wireOutputs = (root) => {
  for (const b of root.querySelectorAll('[data-bc-addtoproject]')) {
    b.addEventListener('click', async () => {
      const id = b.dataset.bcAddtoproject
      if (id === undefined || id === '') return
      const done = await attempt(
        b,
        'Adding…',
        /*
          The output and nothing else. The current Team HQ opens a sheet here
          and asks for a collection, tags, a task and a source — deliberately,
          because that is the only moment anybody chooses them. This
          experience does not yet have that sheet, so it imports with nothing
          chosen, which `import_output` accepts and which means "yes, and I
          have nothing to add". Offering the sheet is the next slice; offering
          a half-built sheet would be worse than offering none.
        */
        () => act('output_import', { p_output: id }),
        'Added to the project.',
      )
      if (done !== null) await ctx.refresh()
    })
  }
}

/* ------------------------------------------ the docs workspace (§21) ---- */

/*
  The view toggle, and adding a file.

  UPLOAD GOES THROUGH `document_upload`, which is the path the current Team HQ
  already uses (#126): the gateway takes base64, puts the bytes in the private
  bucket under `<project>/upload/<uuid>`, and records the document row. Nothing
  here invents a second way in.

  It refuses politely without a token rather than failing into nothing, and it
  says what it is doing while a large file encodes - a silent Add on a 4MB PDF
  reads as a control that did not work.
*/
const wireDocsWorkspace = (root) => {
  for (const b of root.querySelectorAll('[data-bc-docview]')) {
    b.addEventListener('click', () => {
      try {
        globalThis.localStorage?.setItem('bc.docsview', b.dataset.bcDocview ?? 'wall')
      } catch {
        /* A viewer who cannot store it still gets the default. */
      }
      ctx.render()
    })
  }

  const form = () => root.querySelector('[data-bc-uploadform]')
  /*
    WHERE THE FILE IS COMING FROM, and then from there.

    Delegated on the form, because the Drive panel replaces its own contents
    every time somebody walks into a folder or searches - the same trap that
    made the voice note's Stop button inert, which is now three times in this
    file and is why every panel in here is wired this way.
  */
  for (const f of root.querySelectorAll('[data-bc-uploadform]')) {
    f.addEventListener('click', async (e) => {
      const from = e.target?.closest?.('[data-bc-from]')
      if (from === null || from === undefined) return
      e.preventDefault()
      const which = from.dataset.bcFrom
      const fromComputer = f.querySelector('[data-bc-fromcomputer]')
      if (which === 'computer') {
        if (fromComputer !== null) fromComputer.hidden = false
        fromComputer?.querySelector('input')?.focus()
        return
      }
      if (fromComputer !== null) fromComputer.hidden = true
      await bcDrive.browse(read)
      ctx.render()
    })
  }

  /*
    THE DRIVE PANEL. Every press here is a question for the office: it lists,
    it walks in, it searches, and it picks. The page holds no credential and
    could not list Drive if it wanted to.
  */
  for (const panel of root.querySelectorAll('[data-bc-drivepanel]')) {
    panel.addEventListener('click', async (e) => {
      const pressed = e.target?.closest?.(
        '[data-bc-driveclose], [data-bc-driveback], [data-bc-drivesearch], [data-bc-drivein], [data-bc-drivepick]',
      )
      if (pressed === null || pressed === undefined) return
      e.preventDefault()
      if (pressed.hasAttribute('data-bc-driveclose')) {
        bcDrive.close()
        ctx.render()
        return
      }
      if (pressed.hasAttribute('data-bc-driveback')) {
        await bcDrive.back(read)
        ctx.render()
        return
      }
      if (pressed.hasAttribute('data-bc-drivesearch')) {
        const box = panel.querySelector('#bc-drive-q')
        await bcDrive.browse(read, { q: String(box?.value ?? '').trim() })
        ctx.render()
        return
      }
      if (pressed.hasAttribute('data-bc-drivein')) {
        await bcDrive.into(read, pressed.dataset.bcDrivein, pressed.dataset.bcDrivename ?? '')
        ctx.render()
        return
      }
      /* Picking one. The office refuses a folder, and the control is not
         offered on one, so this can only ever be a file. */
      const id = pressed.dataset.bcDrivepick ?? ''
      const was = pressed.textContent
      pressed.disabled = true
      pressed.textContent = 'Adding…'
      const done = await bcDrive.pick(act, ctx.projectId?.(ctx.state.project) ?? '', {
        id,
        name: pressed.dataset.bcDrivename ?? '',
        mime: pressed.dataset.bcDrivemime ?? '',
      })
      pressed.disabled = false
      pressed.textContent = was
      if (done !== null) {
        bcDrive.close()
        await ctx.refresh()
      }
      ctx.render()
    })
    /* Return in the search box searches, which is what a search box does. */
    const box = panel.querySelector('#bc-drive-q')
    box?.addEventListener('keydown', async (e) => {
      if (e.key !== 'Enter') return
      e.preventDefault()
      await bcDrive.browse(read, { q: String(box.value ?? '').trim() })
      ctx.render()
    })
  }

  for (const b of root.querySelectorAll('[data-bc-upload]')) {
    b.addEventListener('click', () => {
      const f = form()
      if (f === null) return
      f.hidden = false
      f.querySelector('input')?.focus()
    })
  }
  for (const b of root.querySelectorAll('[data-bc-uploadcancel]')) {
    b.addEventListener('click', () => {
      const f = form()
      if (f === null) return
      f.reset()
      f.hidden = true
      root.querySelector('[data-bc-upload]')?.focus()
    })
  }
  for (const b of root.querySelectorAll('[data-bc-uploadsave]')) {
    b.addEventListener('click', async () => {
      const f = form()
      if (f === null) return
      const input = f.querySelector('#bc-upload-file')
      const file = input?.files?.[0]
      if (file === undefined || file === null) {
        showFieldError(f, 'bc-upload-file', 'Choose a file first.')
        return
      }
      clearFieldError(f, 'bc-upload-file')
      if (!canWrite()) {
        showFieldError(f, 'bc-upload-file', 'This browser is read-only — sign in to add a file.')
        return
      }
      const done = await attempt(
        b,
        'Adding…',
        async () => {
          const base64 = await asBase64(file)
          return act('document_upload', {
            p_project_id: ctx.projects().find((x) => x.slug === ctx.state.project)?.id,
            p_name: file.name,
            p_base64: base64,
          })
        },
        'Added to the project.',
      )
      if (done !== null) {
        f.reset()
        f.hidden = true
        await ctx.refresh()
      }
    })
  }
}

/*
  Base64 without loading the whole file into a string twice.

  `readAsDataURL` gives `data:<mime>;base64,<payload>` and the gateway wants
  the payload, so the prefix is cut at the first comma rather than by a regex
  over several megabytes of text.
*/
const asBase64 = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => {
      reject(new Error('that file could not be read'))
    }
    reader.onload = () => {
      const out = String(reader.result ?? '')
      const at = out.indexOf(',')
      resolve(at < 0 ? out : out.slice(at + 1))
    }
    reader.readAsDataURL(file)
  })

/* ---------------------------------- expanded views, as modals (v2) ------ */

/*
  Open, close, Escape, and the click on the backdrop. The focus goes into the
  dialog on open and back to what opened it on close, because a modal that
  leaves the keyboard behind the thing it covers is not a modal - the
  keyboard audit has a name for that and this repository has already paid for
  it once on the document viewer.
*/
const wireExpanded = (root) => {
  for (const b of root.querySelectorAll('[data-bc-expand]')) {
    b.addEventListener('click', () => {
      lastOpener = b.dataset.bcExpand ?? ''
      ctx.openExpanded?.(b.dataset.bcExpand)
    })
  }
  for (const b of root.querySelectorAll('[data-bc-expclose]')) {
    b.addEventListener('click', () => {
      ctx.closeExpanded?.()
      /*
        Back to the control that opened it. `render()` has replaced every node,
        so the one to focus is found by what it opens rather than by a
        reference captured before the redraw - #197's lesson, which cost four
        attempts the first time.
      */
      document.querySelector(`[data-bc-expand="${lastOpener}"]`)?.focus()
    })
  }
  const box = root.querySelector('.bcexpbox')
  if (box !== null) box.querySelector('button, a, input, select')?.focus()
}

let lastOpener = ''

/* ----------------------------- the page menu, and the voice button ------ */

/*
  THE MICROPHONE STARTS A CALL AND NOTHING ELSE.

  Grant: *"Clicking the microphone should immediately activate the OpenAI voice
  interface / pure voice mode... Do not introduce an unnecessary intermediate
  screen or another custom chat interface."* So it calls `toggleCall`, which is
  the studio's own path - the one the existing call panel drives - and draws
  nothing of its own. Toggle rather than start, because a microphone that
  cannot stop the call it began is a control with no way out.
*/
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return
  if (document.querySelector('[data-bc-expanded]') === null) return
  ctx?.closeExpanded?.()
  document.querySelector(`[data-bc-expand="${lastOpener}"]`)?.focus()
})

/*
  The microphone beside Chat, and the state it has to show itself.

  `syncCallButtons()` paints every element carrying `data-call`, which this
  button deliberately does not: the default studio wires the FIRST such
  element to its own handler, so borrowing the attribute would have given the
  mic two handlers and made one press two toggles. The consequence was that
  pressing it changed the call and nothing on screen said so - a control the
  audit correctly read as dead. So it paints itself from the same source of
  truth the shared painter uses.
*/
const paintMic = (b) => {
  const phase = callPhase()
  b.classList.toggle('ringing', phase === 'live')
  b.classList.toggle('connecting', phase === 'connecting')
  b.setAttribute('aria-pressed', phase === 'idle' ? 'false' : 'true')
  const label =
    phase === 'live'
      ? 'End the call'
      : phase === 'connecting'
        ? 'Connecting the call — press to cancel'
        : 'Talk to the team out loud'
  b.setAttribute('aria-label', label)
  b.title = label
}

/*
  PROJECT SETTINGS, WIRED BY ITS OWN MODULE.

  The pane's controls belong to `project-settings.js` and are wired by it, so
  the experiment hands it the root rather than re-implementing a single
  handler - which is what keeps "preserve existing settings functionality"
  true by construction rather than by care. The tab strip is the one thing the
  experiment wires itself, because the pane is a state of this experience's
  own render.
*/
const wireProjectSettings = (root) => {
  if (root.querySelector('.bcsetframe') === null) return
  const p = ctx.projects().find((x) => x.slug === ctx.state.project)
  if (p === undefined) return
  ctx.wireProjectSettings?.(root, p)
  for (const b of root.querySelectorAll('[data-setpane]')) {
    b.addEventListener('click', () => {
      ctx.setPane?.(b.dataset.setpane)
    })
  }
}

/*
  THE COUNTS AT THE TOP OF THE PROJECT, and the Mine / The team's switch.

  Each one opens the to-dos under its own filter. The filter is state and an
  address, so Back closes it and a reload keeps it - which is what stops a
  count being a claim the page cannot honour a second later.
*/
const wireCounts = (root) => {
  for (const b of root.querySelectorAll('[data-bc-filter]')) {
    b.addEventListener('click', () => {
      ctx.openFiltered?.(b.dataset.bcFilter)
    })
  }
  for (const b of root.querySelectorAll('[data-bc-filter-off]')) {
    b.addEventListener('click', () => {
      ctx.clearFilter?.()
      ctx.setMine?.(null)
    })
  }
  for (const b of root.querySelectorAll('[data-bc-mine]')) {
    b.addEventListener('click', () => {
      ctx.setMine?.(b.dataset.bcMine)
    })
  }
  /*
    "Needs you" is the team's finished work, which lives on the team surface -
    so it opens that rather than a to-do filter that would be empty.
  */
  for (const b of root.querySelectorAll('[data-bc-waiting]')) {
    b.addEventListener('click', () => {
      ctx.openExpanded?.('team')
    })
  }
}

/*
  SOURCES: opening one, adding one, and what a service tile honestly does.
*/
const wireSources = (root) => {
  for (const b of root.querySelectorAll('[data-bc-source]')) {
    b.addEventListener('click', () => {
      ctx.openSource?.(b.dataset.bcSource)
    })
  }
  for (const b of root.querySelectorAll('[data-bc-source-add]')) {
    b.addEventListener('click', () => {
      ctx.openSourceAdd?.()
    })
  }
  for (const b of root.querySelectorAll('[data-bc-source-close]')) {
    b.addEventListener('click', () => {
      ctx.closeSource?.()
    })
  }
  /*
    A LINK IS THE PROJECT'S OWN, and `reference_add` has been at the gateway
    since #35. Validated with the same rule the contact editor uses, so a bare
    domain is completed rather than refused.
  */
  for (const b of root.querySelectorAll('[data-bc-source-save]')) {
    b.addEventListener('click', async () => {
      const field = root.querySelector('#bc-src-url')
      const said = root.querySelector('[data-bc-source-said]')
      const v = contacts.check('website', field?.value ?? '')
      if (!v.ok || v.value === '') {
        if (said !== null) said.textContent = v.ok ? 'An address, first.' : v.why
        field?.focus()
        return
      }
      if (canWrite() !== true) {
        if (said !== null) {
          said.textContent =
            'There is no office token in this browser, so nothing was sent. Signed in, this adds the link to the project.'
        }
        return
      }
      const done = await attempt(
        b,
        'Adding…',
        () => act('reference_add', { p_slug: ctx.state.project, p_url: v.value }),
        'Added.',
      )
      if (done !== null) {
        ctx.closeSource?.()
        await ctx.refresh()
      }
    })
  }
  /*
    A SERVICE IS CONNECTED ONCE FOR THE WHOLE OFFICE, so the tile opens the
    place that does it rather than offering a connection this page cannot
    make. An offer may only promise what the press can perform.
  */
  for (const b of root.querySelectorAll('[data-bc-service]')) {
    b.addEventListener('click', () => {
      ctx.openGlobalSettings?.('connections')
    })
  }
}

const wireVoice = (root) => {
  const said = root.querySelector('[data-callsay]')
  if (said !== null) {
    /*
      A RENDER LOSES WHAT THE CALL SAID, because the element is new every
      paint - so the sentence is put back from the call's own memory rather
      than waiting for the next thing to happen. #197's rule: anything that
      must survive a redraw has to be put back after it.
    */
    const words = callSays()
    said.textContent = words
    said.hidden = words === ''
  }
  /*
    THE LIVE CONVERSATION'S OWN CONTROLS - mute and end - delegated on the head,
    which is not replaced while the panel inside it redraws.
  */
  live.wire(root, { redraw: () => ctx.render() })

  for (const b of root.querySelectorAll('[data-bc-voice]')) {
    paintMic(b)
    b.addEventListener('click', () => {
      /*
        WHICH PROJECT THIS CALL IS ABOUT, said before it starts.

        The surface is the only thing that knows what Grant is looking at, and
        §8 of the brief is explicit that a call opened inside project A must
        not become a conversation about project B. `call.js` sends it to the
        office, which looks it up and tells Claire what "this project" means.
      */
      callAbout(ctx.state.project ?? '')
      toggleCall()
      syncCallButtons()
      paintMic(b)
      /*
        The phases that follow arrive over several seconds - minting, the
        permission prompt, the SDP exchange - and none of them repaints this
        page. A short poll is what keeps the button honest without making
        call.js know about this experience; it stops as soon as the call
        settles either way.
      */
      /*
        AND THE PANEL WITH IT. The call's own states - connecting, listening,
        the team answering, a transcript landing - arrive over the data channel
        and nothing repaints this page, so the panel would freeze on whatever
        it said when it was drawn. The poll runs for as long as the call does
        and stops the moment it ends, which is what makes the conversation feel
        live rather than logged.
      */
      let ticks = 0
      let was = ''
      const watch = globalThis.setInterval(() => {
        ticks += 1
        paintMic(b)
        const now = `${callPhase()}:${callActivity()}:${String(callTurns().length)}:${callSays()}`
        if (now !== was) {
          was = now
          ctx.render()
        }
        /* An hour at 400ms, which is longer than any call, and it stops on
           idle rather than on a tick count so a long conversation is not
           silently abandoned by its own painter. */
        if (callPhase() === 'idle' && ticks > 6) globalThis.clearInterval(watch)
        if (ticks > 9000) globalThis.clearInterval(watch)
      }, 400)
    })
  }
}

/* --------------------------------------------------------------- contacts */
/*
  v2: *"Clicking a contact should show useful information/details"* and *"the
  user should be able to add a new contact directly from the miniature"*. Both
  presses open the Contacts tool over the home rather than navigating away,
  which is what makes the miniature and the expanded view one tool.
*/
/*
  WRITING WITHOUT A TOKEN.

  `attempt()` refuses before it runs anything when there is no token - "Read
  only, no token in this browser" - which is right for a call that would reach
  the office and wrong for one that never leaves the browser. The tick already
  took this branch; the contact editor did not, so every save in the deployed
  preview did nothing at all and said nothing either, which is precisely the
  shape Grant reported about the checkboxes.

  A key beginning `p:` names a row with no record behind it, so the write is
  local by construction and the gate does not apply to it.
*/
const localKey = (key) => String(key ?? '').startsWith('p:')
const saidIn = (el, words) => {
  const say = el?.closest('form')?.querySelector('[data-bc-contact-said]')
  if (say !== null && say !== undefined) say.textContent = words
}

const wireContacts = (root) => {
  for (const b of root.querySelectorAll('[data-bc-contact]')) {
    b.addEventListener('click', () => {
      ctx.openContact(b.dataset.bcContact)
    })
  }
  for (const b of root.querySelectorAll('[data-bc-contact-add]')) {
    b.addEventListener('click', () => {
      ctx.openContactAdd()
    })
  }
  for (const b of root.querySelectorAll('[data-bc-contact-close]')) {
    b.addEventListener('click', () => {
      ctx.closeContact()
    })
  }
  for (const b of root.querySelectorAll('[data-bc-contactadd-go]')) {
    b.addEventListener('click', async () => {
      const val = (id) => String(root.querySelector(`#${id}`)?.value ?? '').trim()
      const name = val('bc-c-name')
      const say = root.querySelector('[data-bc-contact-said]')
      if (name === '') {
        if (say !== null) say.textContent = 'A name, at least.'
        root.querySelector('#bc-c-name')?.focus()
        return
      }
      /*
        VALIDATED BEFORE IT IS SENT, by the port's own rules rather than by a
        second copy of them here. An email that is refused by the office after
        a round trip is an error message about a form the person has already
        left.
      */
      const fields = { name, role: val('bc-c-role'), org: val('bc-c-org') }
      for (const key of ['email', 'phone']) {
        const v = contacts.check(key, val(`bc-c-${key}`))
        if (!v.ok) {
          if (say !== null) say.textContent = v.why
          root.querySelector(`#bc-c-${key}`)?.focus()
          return
        }
        fields[key] = v.value
      }
      if (canWrite() !== true) {
        await contacts.add(ctx.state.project, fields)
        saidIn(b, `${name} is on this project.`)
        ctx.closeContact()
        return
      }
      const done = await attempt(
        b,
        'Adding…',
        () => contacts.add(ctx.state.project, fields),
        `${name} is on this project.`,
      )
      if (done !== null) {
        ctx.closeContact()
        await ctx.refresh()
      }
    })
  }

  /*
    CORRECTING ONE. Every field on the record is read, validated and sent as a
    PATCH - only what changed - so editing the notes sends the notes.
  */
  for (const b of root.querySelectorAll('[data-bc-contact-save]')) {
    b.addEventListener('click', async () => {
      const key = b.dataset.bcContactSave ?? ''
      const form = b.closest('[data-bc-contactedit]')
      if (form === null) return
      const say = form.querySelector('[data-bc-contact-said]')
      const patch = {}
      for (const el of form.querySelectorAll('[data-bc-ctfield]')) {
        const field = el.dataset.bcCtfield
        const v = contacts.check(field, el.value)
        if (!v.ok) {
          if (say !== null) say.textContent = v.why
          el.focus()
          return
        }
        patch[field] = v.value
      }
      if (String(patch.name ?? '').trim() === '') {
        if (say !== null) say.textContent = 'A contact needs a name.'
        return
      }
      if (localKey(key)) {
        await contacts.save(ctx.state.project, key, patch)
        saidIn(b, 'Saved.')
        ctx.render()
        return
      }
      const done = await attempt(b, 'Saving…', () => contacts.save(ctx.state.project, key, patch), 'Saved.')
      if (done !== null) {
        ctx.render()
        await ctx.refresh()
      }
    })
  }

  /*
    A FACE. Downscaled in the browser before it is sent - see contacts.shrink,
    and 0534's 400KB cap, which is that decision made a rule.
  */
  for (const f of root.querySelectorAll('[data-bc-contact-image]')) {
    f.addEventListener('change', async () => {
      const key = f.dataset.bcContactImage ?? ''
      const file = f.files?.[0]
      const say = f.closest('form')?.querySelector('[data-bc-contact-said]')
      if (file === undefined) return
      try {
        const image = await contacts.shrink(file)
        if (localKey(key)) {
          await contacts.save(ctx.state.project, key, { image })
          ctx.render()
          return
        }
        const done = await attempt(
          f,
          'Adding the image…',
          () => contacts.save(ctx.state.project, key, { image }),
          'Image added.',
        )
        if (done !== null) {
          ctx.render()
          await ctx.refresh()
        }
      } catch (e) {
        if (say !== null) say.textContent = e instanceof Error ? e.message : 'That image could not be read.'
      }
    })
  }
  for (const b of root.querySelectorAll('[data-bc-contact-image-off]')) {
    b.addEventListener('click', async () => {
      const key = b.dataset.bcContactImageOff ?? ''
      if (localKey(key)) {
        await contacts.save(ctx.state.project, key, { image: '' })
        ctx.render()
        return
      }
      const done = await attempt(
        b,
        'Removing…',
        () => contacts.save(ctx.state.project, key, { image: '' }),
        'Image removed.',
      )
      if (done !== null) {
        ctx.render()
        await ctx.refresh()
      }
    })
  }
}

/*
  The three-dot menu that replaced "Change this page".

  Closes on Escape and on a press outside, because a menu that can only be
  closed by pressing the thing that opened it is a menu people leave open.
*/
const wirePageMenu = (root) => {
  const panel = root.querySelector('[data-bc-pagemenu-panel]')
  const trigger = root.querySelector('[data-bc-pagemenu]')
  if (panel === null || trigger === null) return

  const shut = () => {
    panel.hidden = true
    compose.setPageMenuOpen(false)
    trigger.setAttribute('aria-expanded', 'false')
  }
  trigger.addEventListener('click', (e) => {
    e.stopPropagation()
    panel.hidden = !panel.hidden
    /* Remembered across redraws: the shell rebuilds this node for reasons that
       have nothing to do with the menu, and a rebuilt panel is a hidden one. */
    compose.setPageMenuOpen(!panel.hidden)
    trigger.setAttribute('aria-expanded', String(!panel.hidden))
    if (!panel.hidden) panel.querySelector('button')?.focus()
  })
  panel.addEventListener('click', (e) => {
    e.stopPropagation()
    /* Choosing something closes the menu - otherwise it is still hanging open
       over whatever the choice just opened. */
    if (e.target?.closest?.('[role="menuitem"]') !== null) shut()
  })
  document.addEventListener('click', shut)
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !panel.hidden) {
      shut()
      trigger.focus()
    }
  })

  /*
    Where the material comes from, which used to be a module. It opens as an
    expanded view rather than a page, which is the specification's rule for
    every expanded thing now.
  */
  for (const b of root.querySelectorAll('[data-bc-sources]')) {
    b.addEventListener('click', () => {
      shut()
      ctx.openExpanded?.('sources')
    })
  }

  /*
    The office's settings, in the sheet that already holds them - restyled
    under this experience rather than rebuilt in it. The sheet lives outside
    the render root and survives every repaint, which is exactly why it is the
    right thing to reuse.
  */
  for (const b of root.querySelectorAll('[data-bc-look]')) {
    b.addEventListener('click', () => {
      shut()
      ctx.openLook?.()
    })
  }

}

/* ------------------------------------------- arranging the home (§14) --- */

/*
  THE BOARD IS DRAGGED AND RESIZED, not reordered by buttons.

  Grant, 22 September: *"Implement proper drag-and-drop module repositioning;
  dynamic module resizing; sensible minimum sizes; sensible maximum sizes;
  collision prevention; responsive rearrangement; persistence... Do not
  substitute crude up/down controls for genuine spatial rearrangement."*

  Three decisions here are worth stating because each of them is a trap this
  repository has already paid for:

  1. **The header is both the press and the drag handle.** A separate grip is
     what CLAUDE.md records as eighteen buttons that looked fine and did
     nothing - they sat inside the handle, a drag began, and the DOM the click
     was travelling towards no longer existed. Here a pointer that MOVES more
     than four pixels becomes a drag and the click is suppressed; a pointer
     that does not is an ordinary press and opens the module. One element,
     two meanings, decided by what the person actually did.

  2. **Pointer events, captured.** `setPointerCapture` keeps the gesture with
     the module even when the pointer leaves it, which is most of a drag; it
     also gives touch and pen the same path as the mouse for nothing.

  3. **The preview is the real grid.** Dragging writes the rectangle into the
     live layout and repaints the board's inline styles directly, without a
     render - so what is under the pointer is the actual arrangement, including
     the modules that have been pushed down, rather than a ghost that tells
     the truth only when it lands.
*/

/** Where the pointer is, in grid units, relative to a board element. */
const gridAt = (board, clientX, clientY) => {
  const box = board.getBoundingClientRect()
  const cols = grid.COLS
  const gap = Number.parseFloat(getComputedStyle(board).gap) || 0
  const colW = (box.width - gap * (cols - 1)) / cols
  const rowH = grid.ROW + gap
  return {
    col: Math.round((clientX - box.left) / (colW + gap)),
    row: Math.round((clientY - box.top) / rowH),
    colW,
    rowH,
  }
}

/** Paint one module's rectangle without a render. */
const paintRect = (board, list) => {
  for (const m of list) {
    const el = board.querySelector(`[data-mod="${m.id}"]`)
    if (el === null) continue
    el.style.gridColumn = `${String(m.x + 1)}/span ${String(m.w)}`
    el.style.gridRow = `${String(m.y + 1)}/span ${String(m.h)}`
  }
  board.style.setProperty(
    '--bc-rows',
    String(list.reduce((n, m) => Math.max(n, m.y + m.h), 0)),
  )
}

const wireBoard = (root) => {
  const board = root.querySelector('[data-bc-board]')
  if (board === null) return
  const slug = board.dataset.bcBoard ?? ctx.state.project

  /*
    ONE POINTER GESTURE AT A TIME, and the element it belongs to. Held on the
    closure rather than on the module, because a drag that starts on one
    header and ends over another is the ordinary case.
  */
  let live = null

  const begin = (kind, el, e) => {
    const mod = el.closest('[data-mod]')
    if (mod === null) return
    const id = mod.dataset.mod
    const start = grid.layout(slug).find((m) => m.id === id)
    if (start === undefined) return
    live = { kind, id, mod, startX: e.clientX, startY: e.clientY, rect: start, moved: false }
    el.setPointerCapture?.(e.pointerId)
  }

  const during = (e) => {
    if (live === null) return
    const dx = e.clientX - live.startX
    const dy = e.clientY - live.startY
    if (!live.moved && Math.hypot(dx, dy) < 4) return
    if (!live.moved) {
      live.moved = true
      board.classList.add('bcpanes--moving')
      live.mod.classList.add('bcmod--dragging')
    }
    const { colW, rowH } = gridAt(board, e.clientX, e.clientY)
    const dCol = Math.round(dx / (colW + (Number.parseFloat(getComputedStyle(board).gap) || 0)))
    const dRow = Math.round(dy / rowH)
    const want =
      live.kind === 'move'
        ? { x: live.rect.x + dCol, y: Math.max(0, live.rect.y + dRow) }
        : { w: live.rect.w + dCol, h: live.rect.h + dRow }
    paintRect(board, grid.place(slug, live.id, want))
    e.preventDefault()
  }

  const finish = (e) => {
    if (live === null) return
    const was = live
    live = null
    board.classList.remove('bcpanes--moving')
    was.mod.classList.remove('bcmod--dragging')
    if (!was.moved) return
    /*
      SUPPRESS THE CLICK THAT FOLLOWS A DRAG. A pointerup after a real gesture
      is still followed by a click on the header, which would open the module
      the person has just finished moving.
    */
    const swallow = (c) => {
      c.stopPropagation()
      c.preventDefault()
    }
    was.mod.addEventListener('click', swallow, { capture: true, once: true })
    globalThis.setTimeout(() => {
      was.mod.removeEventListener('click', swallow, { capture: true })
    }, 350)
    ctx.render()
    e?.preventDefault?.()
  }

  for (const h of board.querySelectorAll('.bcmodhead')) {
    h.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return
      /*
        A CONTROL INSIDE THE HEADER IS NOT THE HEADER. Grant asked for exactly
        this: "Do not allow interactive controls within the header, such as
        three-dot menus, to accidentally trigger expansion."
      */
      if (e.target.closest('button, a, input, select, [data-bc-modoff]') !== null) return
      begin('move', h, e)
    })
    h.addEventListener('pointermove', during)
    h.addEventListener('pointerup', finish)
    h.addEventListener('pointercancel', finish)
  }
  for (const r of board.querySelectorAll('[data-bc-resize]')) {
    r.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return
      e.stopPropagation()
      begin('size', r, e)
    })
    r.addEventListener('pointermove', during)
    r.addEventListener('pointerup', finish)
    r.addEventListener('pointercancel', finish)
    r.addEventListener('click', (e) => {
      e.stopPropagation()
    })
  }

  /*
    THE KEYBOARD CAN MOVE AND RESIZE TOO, because a workspace only a mouse can
    arrange is a workspace half the people cannot arrange. Alt with an arrow
    moves; Alt and Shift resizes. Held on the header, which is already the
    focusable thing.
  */
  for (const h of board.querySelectorAll('.bcmodhead')) {
    h.addEventListener('keydown', (e) => {
      const id = h.closest('[data-mod]')?.dataset.mod
      if (id === undefined) return
      if ((e.key === 'Enter' || e.key === ' ') && !e.altKey) {
        e.preventDefault()
        ctx.openExpanded?.(id)
        return
      }
      if (!e.altKey) return
      const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[
        e.key
      ]
      if (step === undefined) return
      e.preventDefault()
      const now = grid.layout(slug).find((m) => m.id === id)
      if (now === undefined) return
      const want = e.shiftKey
        ? { w: now.w + step[0], h: now.h + step[1] }
        : { x: now.x + step[0], y: Math.max(0, now.y + step[1]) }
      grid.place(slug, id, want)
      ctx.render()
      document.querySelector(`[data-mod="${id}"] .bcmodhead`)?.focus()
    })
  }

  /* Taking a module off the page, from the cross on its header. */
  for (const b of board.querySelectorAll('[data-bc-modoff]')) {
    b.addEventListener('click', (e) => {
      e.stopPropagation()
      grid.remove(slug, b.dataset.bcModoff)
      ctx.render()
    })
    b.addEventListener('pointerdown', (e) => {
      e.stopPropagation()
    })
  }
}

/*
  The panel that puts a module back and resets the page. Everything it used to
  do with Up, Down and Remove is done on the board itself now.
*/
const wireArrange = (root) => {
  const panel = root.querySelector('[data-bc-arrange-panel]')
  const slug = ctx.state.project

  for (const b of root.querySelectorAll('[data-bc-arrange]')) {
    b.addEventListener('click', () => {
      if (panel === null) return
      panel.hidden = !panel.hidden
      b.setAttribute('aria-expanded', String(!panel.hidden))
      if (!panel.hidden) panel.querySelector('button')?.focus()
    })
  }
  for (const b of root.querySelectorAll('[data-bc-arr-close]')) {
    b.addEventListener('click', () => {
      if (panel !== null) panel.hidden = true
      root.querySelector('[data-bc-arrange]')?.focus()
    })
  }

  /*
    The panel is inside the thing being redrawn, so a press closes it unless it
    is reopened - and a control that undoes itself on every use reads as
    broken. #197's lesson in miniature: anything that must survive a redraw has
    to be put back after it.
  */
  const reopen = () => {
    const again = document.querySelector('[data-bc-arrange-panel]')
    if (again !== null) again.hidden = false
  }

  for (const b of root.querySelectorAll('[data-bc-arr-on]')) {
    b.addEventListener('click', () => {
      grid.add(slug, b.dataset.bcArrOn)
      ctx.render()
      reopen()
    })
  }
  for (const b of root.querySelectorAll('[data-bc-arr-reset]')) {
    b.addEventListener('click', () => {
      grid.reset(slug)
      ctx.render()
      reopen()
    })
  }
}

/* ------------------------------------------------------- docs and files */

/*
  §21 — THE REAL FIRST PAGE, AND A NEW TAB.

  Two jobs, both against machinery that already exists:

  PAINTING. `pdf.js` renders page one of a PDF to a canvas with a self-hosted
  pdf.mjs (#23). Its `paint()` is additive by contract - the drawn page is
  already on screen and the real one replaces it once it has decoded - so a
  file that 404s, will not parse, or has no worker leaves the drawing in place
  rather than a broken image. Nothing here needs a try/catch around that;
  `paint` swallows its own failure on purpose.

  OPENING. The storage bucket is private, so a document's URL is signed for ten
  minutes and minted per request (#96). That means the link CANNOT be an href
  written at render time: it would be stale before most people pressed it. The
  press fetches a fresh one and opens it, which is what the gateway's own
  comment says the page should do.

  A document the office wrote has no file at all. Its content is real text, so
  it opens as a blob in a new tab rather than being refused - the alternative
  is a thumbnail you cannot click, which is the dead control this repository
  keeps paying for.
*/
const wireDocs = (root) => {
  for (const host of root.querySelectorAll('[data-bc-thumb]')) {
    const ref = host.dataset.bcThumb ?? ''
    /*
      AN OBJECT TILE IS NOT NECESSARILY FINISHED. This skipped every tile that
      had a glyph on it, which included every document known to be a PICTURE -
      so a photograph showed the outline of a photograph for ever, and the one
      thumbnail in the gallery that could have been the thing itself never was.
      A tile with nothing to paint is decided in `paintThumb`, where the real
      media type is known, rather than guessed from a class here.
    */
    if (ref === '') continue
    void paintThumb(host, ref)
  }

  /*
    EVERY DOCUMENT PRESSES. What the press DOES depends on what exists behind
    it, and that decision is in `openDoc` rather than here, so the gallery and
    the list cannot disagree about what a given file does.
  */
  for (const b of root.querySelectorAll('[data-bc-doc-open]')) {
    b.addEventListener('click', (e) => {
      e.stopPropagation()
      const fig = b.closest('[data-bc-doc]')
      void openDoc(
        b.dataset.bcDocOpen ?? '',
        b.dataset.bcDocTitle ?? fig?.dataset.bcDocTitle ?? 'document',
      )
    })
  }
  /*
    And the whole row or tile is still a target, for the person who presses the
    thumbnail rather than the words - as long as they did not press the button
    inside it, which has already handled it.
  */
  for (const fig of root.querySelectorAll('[data-bc-doc]')) {
    const ref = fig.dataset.bcDoc ?? ''
    if (ref === '') continue
    fig.addEventListener('click', (e) => {
      if (e.target.closest('[data-bc-doc-open]') !== null) return
      void openDoc(ref, fig.dataset.bcDocTitle ?? 'document')
    })
  }

  /* The detail view's own two actions. */
  for (const b of root.querySelectorAll('[data-bc-doc-tab]')) {
    b.addEventListener('click', () => {
      openInTab(b.dataset.bcDocTab ?? '')
    })
  }
  for (const b of root.querySelectorAll('[data-bc-doc-save]')) {
    b.addEventListener('click', () => {
      const href = b.dataset.bcDocSave ?? ''
      if (href === '') return
      /*
        A DOWNLOAD IS A LINK WITH A `download` ATTRIBUTE. Fetching the bytes
        and making a blob would work and would also pull the whole file
        through this tab's memory for no reason; the attribute asks the
        browser to save what it was going to stream anyway.
      */
      const a = document.createElement('a')
      a.href = href
      a.download = (b.dataset.bcDocTitle ?? 'file').replace(/[\\/:*?"<>|]+/g, ' ').trim()
      a.style.display = 'none'
      document.body.append(a)
      a.click()
      a.remove()
    })
  }
}

/** Audio, by what the reference actually is rather than by the row's label. */
const isAudioRef = (ref) => /\.(wav|mp3|m4a|ogg|oga|aac|flac|opus|weba)(\?|$)/i.test(ref)

/** The file a reference points at, or null. Never throws. */
const fileFor = async (ref) => {
  if (!ref.startsWith('id:')) return { url: ref, mime: /\.pdf$/i.test(ref) ? 'application/pdf' : '' }
  try {
    const full = await read('document', ref.slice(3))
    if (full === null || full === undefined || full.error) return null
    return {
      url: full.url ?? '',
      mime: String(full.mime_type ?? ''),
      content: full.content ?? '',
      title: full.title ?? '',
      /* Where it really lives, when it lives somewhere else (0539). */
      connector: String(full.connector ?? ''),
      ref: String(full.ref ?? ''),
      kind: String(full.kind ?? ''),
    }
  } catch {
    return null
  }
}

/*
  THE FACE, CORRECTED BY WHAT THE FILE TURNED OUT TO BE.

  Render time has the kind and the title; this has the media type the gateway
  reports for the actual bytes. Where they disagree the bytes win - which is
  the whole of the spreadsheet defect: `app.studio_documents` calls everything
  that is not audio, a PDF or written by the team a `doc`, so an .xlsx arrived
  with fake lines of text drawn on it and kept them.
*/
const dressObject = (host, face) => {
  if (face === undefined) return
  host.classList.add('bcthumb--object', `bcthumb--${face.tone}`)
  host.innerHTML = bcMini.glyphFor(face)
}

const paintThumb = async (host, ref) => {
  const file = await fileFor(ref)
  if (file === null) return
  const face = bcMini.faceFor(file.mime ?? '', file.url === '' ? (file.title ?? '') : file.url)
  /* Something with no first page stops pretending to have one. */
  if (face !== undefined && face.glyph !== 'image') {
    dressObject(host, face)
    return
  }
  if (file.url === '') return
  const isPdf = file.mime === 'application/pdf' || /\.pdf$/i.test(file.url)
  if (isPdf) {
    await pdf.paint(host, file.url, 220)
    return
  }
  if (face === undefined) return
  /*
    A PICTURE, AND A DELIBERATE FALLBACK WHEN IT WILL NOT LOAD. The `load`
    listener stood alone, so a file that 404s or will not decode left the
    drawn page in place - this office asserting that a photograph is a page of
    writing, which is the failure the fallback exists to prevent.
  */
  const img = document.createElement('img')
  img.className = 'realpage'
  img.alt = ''
  img.decoding = 'async'
  img.addEventListener('load', () => {
    host.classList.remove('bcthumb--object', 'bcthumb--i')
    host.replaceChildren(img)
    /* The same marker `pdf.paint` sets, so "the real thing arrived" is one
       signal rather than one per painter. */
    host.classList.add('has-real')
  })
  img.addEventListener('error', () => {
    dressObject(host, bcMini.faceFor('image/*', ''))
  })
  img.src = file.url
}

/*
  A REAL LINK, CLICKED, rather than `window.open`.

  `window.open(url, '_blank', 'noopener')` opened a tab whose location came
  back as ":" - the feature string makes Chromium treat the call differently
  and the navigation never happened, so the press produced an empty tab. An
  anchor with `target` and `rel` is what a link IS: it navigates, it is not
  caught by a popup blocker the way a scripted open can be, and `noopener`
  stays a real attribute rather than a string that has to be parsed.
*/
const openInTab = (href) => {
  const a = document.createElement('a')
  a.href = href
  a.target = '_blank'
  a.rel = 'noopener noreferrer'
  a.style.display = 'none'
  document.body.append(a)
  a.click()
  a.remove()
}

const openDoc = async (ref, title) => {
  /*
    FOUR ANSWERS, one of which used to be silence.

    A reference beginning `d:` names a document with no file and no record -
    there is nothing to fetch and nothing to open, and the honest answer is
    the details rather than nothing happening. That silence was most of
    Grant's *"some PDFs can be clicked while other assets cannot"*.
  */
  if (ref === '' || ref.startsWith('d:')) {
    ctx.openDocDetail?.(ref, title)
    return
  }
  if (isAudioRef(ref)) {
    /* A recording plays HERE, with the project still around it. */
    ctx.openDocDetail?.(ref, title)
    return
  }
  const file = await fileFor(ref)
  if (file === null) {
    ctx.openDocDetail?.(ref, title)
    return
  }
  /*
    A DOCUMENT THAT LIVES SOMEWHERE ELSE OPENS THERE.

    Grant's §25: clicking it should open the actual Drive, Docs, Sheets or
    Slides document, normally in a new tab. The office holds a reference rather
    than a copy, so there is no file here to show - and showing its details
    instead would be the product losing the one thing the link was for.

    The address is derived in `drive.js`, in one place, from the id and the
    kind. A connector this does not know returns '' and falls through to the
    ordinary handling below, which is the honest answer rather than a guessed
    URL.
  */
  const elsewhere = bcDrive.opensAt(file)
  if (elsewhere !== '') {
    globalThis.open(elsewhere, '_blank', 'noopener')
    return
  }
  if (file.url !== '') {
    if (isAudioRef(file.url) || String(file.mime ?? '').startsWith('audio/')) {
      ctx.openDocDetail?.(ref, title)
      return
    }
    openInTab(file.url)
    return
  }
  /*
    No file, but real words. A blob is the honest way to put them in a tab:
    it is the document's own content, not a rendering of it, and it needs no
    route this experience has not built.
  */
  const text = String(file.content ?? '')
  if (text === '') {
    ctx.openDocDetail?.(ref, title)
    return
  }
  const blob = new Blob([`${title}\n\n${text}`], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  openInTab(url)
  globalThis.setTimeout(() => {
    URL.revokeObjectURL(url)
  }, 60_000)
}

/* ------------------------------------------------------------------ tasks */

/*
  THE FORM IN THE SAME LIST, not the first one on the page.

  §6 gave the surface a form per list, because §10.2's "expands in place" is
  only true if the place is the list you pressed. `root.querySelector` would
  have opened the first list's form whichever list was pressed - the kind of
  defect that works perfectly with one list on screen and is wrong with two,
  which is exactly the shape a prototype with one list hides.
*/
/*
  AND THE HEAD'S Add a Task IS NOT INSIDE ANY LIST, so `closest` finds nothing
  for it. It names the list it means in its own attribute, which is the only
  thing that works for a control that sits above all of them - the fallback to
  "the first form on the page" is kept for the empty state, where there is
  exactly one.
*/
const form = (el, root) => {
  const inside = el.closest('[data-bc-tasklist]')?.querySelector('[data-bc-taskform]')
  if (inside !== null && inside !== undefined) return inside
  const named = el.dataset?.bcAddtask
  if (named !== undefined && named !== '') {
    const owner = root.querySelector(`[data-bc-tasklist="${named}"] [data-bc-taskform]`)
    if (owner !== null) return owner
  }
  return root.querySelector('[data-bc-taskform]')
}

const wireTasks = (root) => {
  for (const b of root.querySelectorAll('[data-bc-addtask]')) {
    b.addEventListener('click', () => {
      const f = form(b, root)
      if (f === null || f === undefined) return
      f.hidden = false
      // §10.2: inline Add expands in place and focuses the name field.
      f.querySelector('input')?.focus()
    })
  }

  for (const b of root.querySelectorAll('[data-bc-taskcancel]')) {
    b.addEventListener('click', () => {
      const f = form(b, root)
      if (f === null || f === undefined) return
      /*
        §10.2: Cancel restores the collapsed state and the previous focus
        WITHOUT creating a record. Clearing the fields matters as much as
        hiding them - a reopened form holding the abandoned text is a record
        half-created.
      */
      for (const i of f.querySelectorAll('input')) i.value = ''
      f.hidden = true
      b.closest('[data-bc-tasklist]')?.querySelector('[data-bc-addtask]')?.focus()
    })
  }

  for (const b of root.querySelectorAll('[data-bc-tasksave]')) {
    b.addEventListener('click', async () => {
      const f = form(b, root)
      if (f === null || f === undefined) return
      const key = String(f.dataset.bcTaskform ?? '')
      const titleField = `bc-task-title-${key}`
      const title = String(f.querySelector(`#${titleField}`)?.value ?? '').trim()
      if (title === '') {
        /*
          §11.3: validation appears by the field. The message is placed rather
          than thrown into a toast, and focus moves to what has to be fixed.
        */
        showFieldError(f, titleField, 'Say what needs doing.')
        return
      }
      clearFieldError(f, titleField)
      const due = String(f.querySelector(`#bc-task-due-${key}`)?.value ?? '').trim()
      const who = String(f.querySelector(`#bc-task-who-${key}`)?.value ?? '').trim()
      /*
        WITHOUT A TOKEN THE PROTOTYPE KEEPS IT. Same branch as the tick and the
        contact editor: `attempt` refuses before it runs anything when there is
        no office to write to, which is correct for a call that would leave
        the browser and useless for a person judging the preview. The row has
        no id, so nothing that writes to the office can ever be handed it.
      */
      if (canWrite() !== true) {
        todos.addLocal(ctx.state.project, { title, list: key, due, assignee: who })
        for (const i of f.querySelectorAll('input')) i.value = ''
        /*
          AND IT SAYS WHERE IT WENT. A local row that appears exactly as a real
          one would is the prototype quietly claiming to be the office, which
          is the one thing this repository has spent a certification campaign
          refusing to do. The form stays open with the sentence in it; nothing
          was sent anywhere.
        */
        ctx.render()
        return
      }
      const done = await attempt(
        b,
        'Adding…',
        async () => {
          const made = await act('task_add', {
            p_project: ctx.state.project,
            p_title: title,
            p_due_on: due === '' ? null : due,
            p_assignee: who === '' ? null : who,
            p_milestone: false,
          })
          /*
            TWO CALLS, because `hq_task_add` takes no parent and
            `hq_task_update` does. Only when the form belongs to a real list:
            `loose` is the group for work that is in none, and nothing there
            should be given a parent.

            If the second call fails the task EXISTS and is unlisted, which is
            visible on this very screen under "Not in a list" and is the
            recoverable direction. The alternative was not offering it.
          */
          const id = made?.id ?? made?.task_id ?? ''
          if (key !== 'loose' && key !== '' && id !== '') {
            await act('task_update', { p_task_id: id, p_parent: key })
          }
          return made
        },
        'Added.',
      )
      if (done !== null) {
        for (const i of f.querySelectorAll('input')) i.value = ''
        f.hidden = true
        await ctx.refresh()
      }
    })
  }

  /* ------------------------------------------------------- saying (§7) --- */

  /*
    ONE SEND PATH, the studio's own. `chatSend` puts the message on screen
    immediately and `chatAsk` asks the office; both come from `chat.js`, which
    already owns the optimistic tail, the retry row and the rule that the
    office's copy wins when it lands. Re-implementing either here would be the
    second copy that drifts.

    The draft is cleared on send, which #197 established, and the answer
    arrives through the same repaint the default Team HQ uses.
  */
  for (const b of root.querySelectorAll('[data-bc-say]')) {
    b.addEventListener('click', async () => {
      const f = root.querySelector('[data-bc-sayform]')
      if (f === null) return
      const box = f.querySelector('#bc-say')
      const text = String(box?.value ?? '').trim()
      if (text === '') {
        showFieldError(f, 'bc-say', 'Say something first.')
        return
      }
      clearFieldError(f, 'bc-say')
      if (!canWrite()) {
        showFieldError(f, 'bc-say', 'This browser is read-only — sign in to ask the team.')
        return
      }
      if (box !== null) box.value = ''
      await askTheTeam(ctx.state.project, text)
    })
  }

  /* ----------------------------------------------------- a list (§6) ----- */

  const listForm = () => root.querySelector('[data-bc-listform]')

  for (const b of root.querySelectorAll('[data-bc-addlist]')) {
    b.addEventListener('click', () => {
      const f = listForm()
      if (f === null) return
      f.hidden = false
      f.querySelector('#bc-list-name')?.focus()
    })
  }

  for (const b of root.querySelectorAll('[data-bc-listcancel]')) {
    b.addEventListener('click', () => {
      const f = listForm()
      if (f === null) return
      for (const i of f.querySelectorAll('input')) i.value = ''
      f.hidden = true
      root.querySelector('[data-bc-addlist]')?.focus()
    })
  }

  for (const b of root.querySelectorAll('[data-bc-listsave]')) {
    b.addEventListener('click', async () => {
      const f = listForm()
      if (f === null) return
      const name = String(f.querySelector('#bc-list-name')?.value ?? '').trim()
      if (name === '') {
        showFieldError(f, 'bc-list-name', 'Give the list a name.')
        return
      }
      clearFieldError(f, 'bc-list-name')
      /*
        A LIST IS A MILESTONE TASK. `p_milestone: true` is the whole of it -
        0171's own comment says a milestone is "a task with no work of its own
        that others hang off, rather than a separate table", and 0287 taught
        `hq_task_add` to create one. No new contract, no second table.
      */
      const done = await attempt(
        b,
        'Adding…',
        () =>
          act('task_add', {
            p_project: ctx.state.project,
            p_title: name,
            p_milestone: true,
          }),
        'List added.',
      )
      if (done !== null) {
        for (const i of f.querySelectorAll('input')) i.value = ''
        f.hidden = true
        await ctx.refresh()
      }
    })
  }

  /*
    §10: MOVING A CARD IS CHANGING THE TO-DO.

    One writer, `task_state`, which is the same one the tick uses - ADR-0041's
    "one set of writers". The select is put back to what the office still
    believes when the write fails, for the reason the tick is: a card that
    stays where you dropped it after a failed write is the product lying about
    canonical state.

    `blocked` is not in the options, because `hq_task_state` refuses it
    without a reason and an offer may only promise what the press can perform.
  */
  /*
    ONE MOVE, TWO GESTURES. `moveCard` is what both the select and the drag
    call, so a card cannot end up somewhere the record does not agree with.
    A row with an id writes to the office; one without is the prototype's own
    memory, exactly as the tick is.
  */
  const moveCard = async (key, wanted, cardEl, control, reason = '') => {
    if (key === undefined || key === '') return false
    cardEl?.classList.add('bcitem--pending')
    if (key.startsWith('p:')) {
      todos.rememberStage(ctx.state.project, key, wanted)
      cardEl?.classList.remove('bcitem--pending')
      ctx.render()
      return true
    }
    const done = await attempt(
      control ?? cardEl,
      'Moving…',
      () => todos.setStage(key, wanted, reason),
      'Moved.',
    )
    cardEl?.classList.remove('bcitem--pending')
    if (done === null) return false
    await ctx.refresh()
    return true
  }

  for (const sel of root.querySelectorAll('[data-bc-move]')) {
    const was = sel.value
    sel.addEventListener('change', async () => {
      const ok = await moveCard(sel.dataset.bcMove, sel.value, sel.closest('[data-bc-card]'), sel)
      if (!ok) sel.value = was
    })
  }

  /*
    DRAGGING A CARD BETWEEN COLUMNS.

    The native drag-and-drop API rather than the pointer gesture the module
    board uses, and the difference is deliberate: a module is moved to a
    POSITION, which needs continuous geometry, and a card is moved to a
    COLUMN, which is a drop target the browser can hit-test for nothing. It
    also gives the cursor, the drag image and the Escape-to-cancel behaviour
    people already know.

    The column under the pointer says so, because a drop target that looks
    identical to every other column is a gesture taken on faith.
  */
  for (const c of root.querySelectorAll('[data-bc-card]')) {
    /*
      A DRAG MUST NOT ALSO OPEN THE CARD.

      Grant, 23 September: *"Prevent accidental opening/clicking while
      dragging."* It matters on the miniature, where a card is a BUTTON that
      opens its to-do: without this, dragging one to another column moved it
      and then opened it, so the board you were arranging disappeared behind a
      record you did not ask for.

      A flag rather than `preventDefault`, because the click arrives after
      `dragend` and there is nothing left to prevent by then. Cleared on a
      timer so the next honest press is unaffected.
    */
    let dragged = false
    c.addEventListener('dragstart', (e) => {
      dragged = true
      e.dataTransfer?.setData('text/plain', c.dataset.bcCard ?? '')
      if (e.dataTransfer !== null && e.dataTransfer !== undefined) {
        e.dataTransfer.effectAllowed = 'move'
      }
      c.classList.add('bcbcard--dragging')
    })
    c.addEventListener('dragend', () => {
      c.classList.remove('bcbcard--dragging')
      for (const col of root.querySelectorAll('[data-bc-drop]')) {
        col.classList.remove('bcbcol--over')
      }
      globalThis.setTimeout(() => {
        dragged = false
      }, 0)
    })
    c.addEventListener(
      'click',
      (e) => {
        if (!dragged) return
        e.preventDefault()
        e.stopImmediatePropagation()
      },
      /* Capture, so it runs before the open handler on the same element. */
      true,
    )
  }
  for (const col of root.querySelectorAll('[data-bc-drop]')) {
    col.addEventListener('dragover', (e) => {
      e.preventDefault()
      if (e.dataTransfer !== null && e.dataTransfer !== undefined) {
        e.dataTransfer.dropEffect = 'move'
      }
      col.classList.add('bcbcol--over')
    })
    col.addEventListener('dragleave', (e) => {
      /*
        `dragleave` fires when the pointer crosses into a CHILD as well, which
        made the column flicker and, worse, lose its highlight while the
        pointer was still inside it. Asking where the pointer actually is
        settles it.
      */
      if (col.contains(e.relatedTarget)) return
      col.classList.remove('bcbcol--over')
    })
    col.addEventListener('drop', async (e) => {
      e.preventDefault()
      col.classList.remove('bcbcol--over')
      const key = e.dataTransfer?.getData('text/plain') ?? ''
      const wanted = col.dataset.bcDrop ?? ''
      const cardEl = root.querySelector(`[data-bc-card="${key}"]`)
      /*
        A DROP INTO THE COLUMN IT CAME FROM IS NOT A MOVE. Writing it anyway
        would spend a round trip and, on a real record, put a state change in
        the ledger that nothing changed.
      */
      if (cardEl?.dataset.stage === wanted) return
      /*
        STUCK IS A COLUMN LIKE THE OTHERS.

        It used to open the task editor instead of moving the card, because
        the office refuses `blocked` without a reason -- correct, and answered
        in the wrong place. §8: "DRAG, DROP INTO STUCK, STATE CHANGES, NO CARD
        OPEN. Do not allow drag-end/click propagation to trigger open/edit."

        The reason the drop supplies is true and says where it came from. Grant
        can say more on the task, which is where there is room for it; what he
        should not have to do is answer a question before the card will move.
      */
      const why = wanted === 'blocked' ? 'Moved to Stuck on the board' : ''
      await moveCard(key, wanted, cardEl, null, why)
    })
  }

  for (const b of root.querySelectorAll('[data-bc-task-open]')) {
    b.addEventListener('click', () => {
      ctx.openTask(b.dataset.bcTaskOpen)
    })
  }

  for (const b of root.querySelectorAll('[data-bc-tasksave-edit]')) {
    b.addEventListener('click', async () => {
      const id = b.dataset.bcTasksaveEdit
      if (String(id ?? '').startsWith('p:')) {
        /* A prototype row: the browser remembers it, as everywhere else. */
        todos.rememberPatch(ctx.state.project, id, {
          who: String(root.querySelector('#bc-edit-who')?.value ?? '').trim(),
          due: String(root.querySelector('#bc-edit-due')?.value ?? '').trim(),
        })
        ctx.render()
        return
      }
      const who = String(root.querySelector('#bc-edit-who')?.value ?? '').trim()
      const due = String(root.querySelector('#bc-edit-due')?.value ?? '').trim()
      /*
        `p_clear` is how the office is told to EMPTY a field, because null
        means "leave it alone" to `hq_task_update` — so clearing the assignee
        by sending null would silently do nothing and look like a failed save.
      */
      const clear = []
      if (who === '') clear.push('assignee')
      if (due === '') clear.push('due_on')
      const done = await attempt(
        b,
        'Saving…',
        () =>
          act('task_update', {
            p_task_id: id,
            p_assignee: who === '' ? null : who,
            p_due_on: due === '' ? null : due,
            p_clear: clear,
          }),
        'Saved.',
      )
      if (done !== null) await ctx.refresh()
    })
  }

  /*
    GIVING AN UNDATED TO-DO A DATE, from the schedule, where the absence is.
    The same two paths as every other write: the office where there is a
    record, this browser where there is not.
  */
  for (const f of root.querySelectorAll('[data-bc-setdue]')) {
    f.addEventListener('change', async () => {
      const key = f.dataset.bcSetdue ?? ''
      const due = String(f.value ?? '').trim()
      if (key === '' || due === '') return
      if (key.startsWith('p:')) {
        todos.rememberPatch(ctx.state.project, key, { due })
        ctx.render()
        return
      }
      const done = await attempt(f, 'Saving…', () => todos.update(key, { due }), 'Dated.')
      if (done !== null) await ctx.refresh()
    })
  }

  for (const b of root.querySelectorAll('[data-bc-taskdone]')) {
    b.addEventListener('click', async () => {
      const key = b.dataset.bcTaskdone ?? ''
      if (key.startsWith('p:')) {
        todos.rememberDone(ctx.state.project, key, b.dataset.bcWant === 'done')
        ctx.render()
        return
      }
      const done = await attempt(
        b,
        'Saving…',
        () => todos.setDone(key, b.dataset.bcWant === 'done'),
        b.dataset.bcWant === 'done' ? 'Done.' : 'Put back.',
      )
      if (done !== null) await ctx.refresh()
    })
  }

  /*
    THE TICK, and the one decision that makes it work everywhere.

    `data-bc-tick` carries the port's KEY, not the office's id — so a row with
    a record behind it writes to the office, and a row without one is
    remembered by the prototype. Which of the two it is, is decided by the key
    itself rather than by a flag, because the key IS the office's id whenever
    there is one.

    The optimistic contract is unchanged: mark the row pending, reconcile,
    and roll the box back VISIBLY if the write did not happen. A tick that
    survives a failed write is the product lying about canonical state.
  */
  for (const c of root.querySelectorAll('[data-bc-tick]')) {
    c.addEventListener('change', async () => {
      const key = c.dataset.bcTick ?? ''
      if (key === '') return
      const wanted = c.checked
      const rowEl = c.closest('.bcitem') ?? c.closest('.bctask')
      rowEl?.classList.add('bcitem--pending')
      if (key.startsWith('p:')) {
        todos.rememberDone(ctx.state.project, key, wanted)
        rowEl?.classList.remove('bcitem--pending')
        ctx.render()
        return
      }
      const done = await attempt(
        c,
        'Saving…',
        () => todos.setDone(key, wanted),
        wanted ? 'Done.' : 'Put back.',
      )
      rowEl?.classList.remove('bcitem--pending')
      if (done === null) {
        c.checked = !wanted
        return
      }
      await ctx.refresh()
    })
  }

  for (const c of root.querySelectorAll('[data-bc-mytick]')) {
    c.addEventListener('change', async () => {
      const id = c.dataset.bcMytick
      if (id === '') return
      const wanted = c.checked
      const rowEl = c.closest('.bcitem')
      rowEl?.classList.add('bcitem--pending')
      /*
        THE SAME WRITER as the project task above, and that is deliberate.

        The first draft of this called `my_task_state`, reasoning that two
        domains need two writers. There is no such action: the gateway would
        have refused it, so the tick on a personal task could never have
        worked - an offer promising what no press can perform, which is the
        defect this repository keeps paying for.

        ADR-0041 decided the opposite and says why: a personal task IS a row
        in `public.tasks` with `assigned_to_human = true`, so there is no
        second id space and no second set of writers. What stays distinct is
        OWNERSHIP and LIFECYCLE - whose list it is on, who may change it, and
        which surface it appears on - and §2.4 asks for exactly that, not for
        a duplicated write path. `task_state` already does both kinds.
      */
      const done = await attempt(
        c,
        'Saving…',
        () => act('task_state', { p_task_id: id, p_state: wanted ? 'done' : 'todo' }),
        wanted ? 'Done.' : 'Put back.',
      )
      rowEl?.classList.remove('bcitem--pending')
      if (done === null) {
        c.checked = !wanted
        return
      }
      await ctx.refresh()
    })
  }
}

const showFieldError = (f, id, message) => {
  const field = f.querySelector(`#${id}`)
  if (field === null) return
  field.setAttribute('aria-invalid', 'true')
  let err = f.querySelector(`#${id}-live-err`)
  if (err === null) {
    err = document.createElement('span')
    err.className = 'bcerror'
    err.id = `${id}-live-err`
    field.after(err)
    field.setAttribute('aria-describedby', `${id}-live-err`)
  }
  err.textContent = message
  field.focus()
}

const clearFieldError = (f, id) => {
  const field = f.querySelector(`#${id}`)
  field?.removeAttribute('aria-invalid')
  f.querySelector(`#${id}-live-err`)?.remove()
}

export const readOnly = () => !canWrite()
