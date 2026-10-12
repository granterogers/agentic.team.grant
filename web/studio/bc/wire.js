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

import { act, alreadyAnswered, attempt, canWrite, read, readFile, say, token } from '../office.js'
import * as session from '../session.js'
import { signOut } from '../signout.js'
import { esc } from './parts.js'
import * as bcDrive from './drive.js'
import * as live from './livevoice.js'
import * as stopping from './stopping.js'
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
import * as cal from './calendar.js'
import * as docview from './docview.js'
import * as docthumbs from './docthumbs.js'
import * as styleForm from './style.js'
import * as expand from './expand.js'
import { wireStage } from './stage.js'
import * as contacts from './contacts.js'
import * as todos from './todos.js'
import * as docorder from './docorder.js'
import * as jump from './jump.js'
import * as menu from './menu.js'
import * as account from './account.js'
import * as activity from './activity.js'

let ctx = null
export const mount = (c) => {
  ctx = c
  c.jumpRefresh = jump.refresh
  /*
    ONE key listener for the whole experience, on the document, attached once.

    `render()` replaces everything inside #root on every paint, so a listener
    bound to a node in there dies at the first redraw - a control that works
    exactly once, which this repository has shipped three times in one file.
    The document survives every render, and the handler asks the experience
    flag rather than assuming.
  */
  document.addEventListener('pointerdown', (e) => {
    if (ctx.state.experience !== 'basecamp' || !menu.isOpen()) return
    if (e.target instanceof Element && e.target.closest('.bcmenupanel, [data-bc-menu], [data-bc-menu-open]')) return
    menu.closeAnimated(() => c.render())
  })
  document.addEventListener('keydown', (e) => {
    if (ctx.state.experience !== 'basecamp') return
    jump.onKey(e)
    if (e.key === 'Escape' && menu.isOpen()) {
      menu.closeAnimated(() => {
        c.render()
        document.querySelector('[data-bc-menu]')?.focus()
      })
    }
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

const askTheTeam = async (project, text, { alreadySaid = false } = {}) => {
  if (!alreadySaid) ctx.chatSend?.(project, text)
  /* Both: the Chat page lives in #root and the dock outside it, and a render
     of the one does not repaint the other. */
  const redraw = () => {
    ctx.render()
    ctx.repaintDock?.()
  }
  redraw()
  await ctx.chatAsk?.(project, text, redraw)
  redraw()
}

/*
  ONE VOICE NOTE PER SCOPE: the Chat page's composer, or the dock. `scope`
  holds the microphone and the panel; the returned handler is attached to it.
*/
/*
  WHICH INSTANCE HOLDS THE MICROPHONE. The recorder is one module for the
  whole page; the Chat page's composer and the dock each drive it, and only
  one can be recording.
*/
let micOwner = null

const voiceNote = (getScope, projectOf = () => ctx.state.project) => {
  const scopeNow = () => getScope() ?? null
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
  const notePanel = () => scopeNow()?.querySelector('[data-bc-notepanel]') ?? null
  const noteMic = () => scopeNow()?.querySelector('[data-bc-note]') ?? null
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
  const noteShut = () => {
    shown = null
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
  /*
    WHAT THE PANEL IS SHOWING, remembered here rather than read off the panel.
    A render replaces the Chat page's composer, so the panel node that said
    "Working out what you said" is gone the moment an answer lands, and the
    old resync read the NEW node's missing phase as "draw the review again" -
    which put Send back on screen mid-transcription (a second press sent the
    note twice) and dropped a failure written into the detached node. The
    panel is now always drawn through paint(), and resync restores exactly
    what was last painted.
  */
  let shown = null
  let heldUrl = ''
  let sending = false
  const paint = (phase, html) => {
    shown = { phase, html }
    const panel = notePanel()
    if (panel === null) return
    panel.hidden = false
    panel.dataset.bcNotephase = phase
    panel.innerHTML = html
  }
  const letGo = () => {
    if (heldUrl !== '') URL.revokeObjectURL(heldUrl)
    heldUrl = ''
    held = null
  }

  const drawRecording = ({ seconds, level }) => {
    const panel = notePanel()
    if (panel === null) return
    const clockEl = panel.querySelector('.bcnoteclock')
    if (clockEl === null) {
      shown = null
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
    clockEl.textContent = clock(seconds)
    const bars = panel.querySelectorAll('.bcnotebar')
    const lit = Math.min(bars.length, Math.round(Math.sqrt(Math.min(1, level)) * bars.length))
    bars.forEach((b, i) => {
      b.dataset.lit = i < lit ? '1' : '0'
    })
  }

  const drawReview = async (kept) => {
    if (notePanel() === null) return
    if (held !== kept) {
      letGo()
      held = kept
      heldUrl = URL.createObjectURL(kept.blob)
    }
    const url = heldUrl
    paint(
      'review',
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
      <p class="bcnotesaid">The team is sent what you said, in words. The recording itself stays in this browser.</p>`,
    )
  }

  const startNote = async () => {
    const mic = noteMic()
    try {
      await recorder.start(drawRecording)
      micOwner = self
      if (mic !== null) {
        mic.dataset.bcNote = 'recording'
        mic.querySelector('.bcnotemictxt').textContent = 'Recording'
      }
      drawRecording({ seconds: 0, level: 0 })
    } catch (e) {
      noteShut()
      paint(
        'failed',
        `<p class="bcnotesaid">${esc(e instanceof Error ? e.message : String(e))}</p>
         <div class="bcnoterow">
           <button type="button" class="bcbtn" data-bc-noteagain>Try again</button>
           <button type="button" class="bcbtn" data-bc-notecancel>Close</button>
         </div>`,
      )
    }
  }

  const stopNote = async () => {
    const mic = noteMic()
    if (mic !== null) {
      mic.dataset.bcNote = 'idle'
      mic.querySelector('.bcnotemictxt').textContent = 'Voice note'
    }
    const kept = await recorder.stop().catch(() => null)
    micOwner = null
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
      paint(
        'failed',
        `<p class="bcnotesaid">Nothing was picked up — the microphone stayed silent the whole
           time. Nothing has been sent.</p>
         <div class="bcnoterow">
           <button type="button" class="bcbtn bcbtn--primary" data-bc-noteagain>Record again</button>
           <button type="button" class="bcbtn" data-bc-notecancel>Close</button>
         </div>`,
      )
      return
    }
    await drawReview(kept)
  }

  const sendNote = async () => {
    if (held === null || sending) return
    sending = true
    paint('sending', '<p class="bcnotesaid">Working out what you said…</p>')
    const project = projectOf()
    const note = held
    let heard = ''
    try {
      heard = await recorder.words(note.blob, {
        endpoint: ctx.voiceEndpoint?.() ?? '',
        token: ctx.officeToken?.() ?? '',
        /* A spelling hint only: the project's name and the team's. */
        vocabulary: [
          ctx.projectName?.(project) ?? '',
          ...(ctx.crew ?? []).map((c) => c.name ?? ''),
        ],
      })
    } catch (e) {
      sending = false
      /* paint() resolves the panel NOW, so a redraw during the wait cannot
         leave this sentence in a node that is no longer on screen. */
      paint(
        'failed',
        `<p class="bcnotesaid">${esc(e instanceof Error ? e.message : String(e))}
           Your recording is still here.</p>
         <div class="bcnoterow">
           <button type="button" class="bcbtn bcbtn--primary" data-bc-notesend>Try sending again</button>
           <button type="button" class="bcbtn" data-bc-notecancel>Delete it</button>
         </div>`,
      )
      return
    }
    sending = false
    /*
      AND FROM HERE IT IS AN ORDINARY MESSAGE. Same two calls as the Send
      button, same thread, same office - the only difference is where the words
      came from.
    */
    const said = ctx.chatSend?.(project, heard) ?? []
    const mine = [...said].reverse().find((m) => (m.who ?? m.from) === 'grant')
    if (mine !== undefined) await notes.keep(mine.id, note.blob, { seconds: note.seconds })
    letGo()
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
  /*
    DELEGATED, on the scope, because the panel replaces its own contents.

    Stop, Cancel, Send and Record again are all drawn by `drawRecording` and
    `drawReview` AFTER wiring, so a listener attached per button would be
    attached to nothing - which is exactly what the first run of
    `verify:basecamp-voicenote` found: the meter moved, the clock ran, and
    pressing Stop did nothing at all. Listen on the element that does NOT get
    replaced.
  */
  /*
    AFTER EVERY RENDER, AGREE WITH THE PAGE. A render replaces the composer,
    so a recording in progress had its panel drawn into a node that was no
    longer on screen - and when the composer was gone altogether (Grant left
    the Chat page, or closed the dock) the MICROPHONE KEPT RECORDING with
    nothing anywhere to show it or stop it. That is the one state this
    control must never be in. So: if the composer is still here, put the
    recording or review back on it; if it is not, stop the microphone.
  */
  const resync = () => {
    const panel = notePanel()
    const mine = micOwner === self && recorder.active()
    if (panel === null) {
      if (mine) {
        recorder.cancel()
        micOwner = null
      }
      /* A transcription already under way finishes and sends; only an
         unsent recording with nowhere to live is let go. */
      if (!sending) {
        letGo()
        shown = null
      }
      return
    }
    if (mine) {
      const mic = noteMic()
      if (mic !== null) {
        mic.dataset.bcNote = 'recording'
        const t = mic.querySelector('.bcnotemictxt')
        if (t !== null) t.textContent = 'Recording'
      }
      if (panel.querySelector('.bcnoteclock') === null) drawRecording({ seconds: 0, level: 0 })
      return
    }
    if (shown !== null && panel.dataset.bcNotephase !== shown.phase) {
      panel.hidden = false
      panel.dataset.bcNotephase = shown.phase
      panel.innerHTML = shown.html
    }
  }
  const press = async (e) => {
    const pressed = e.target?.closest?.(
      '[data-bc-note], [data-bc-notestop], [data-bc-noteagain], [data-bc-notecancel], [data-bc-notesend]',
    )
    if (pressed === null || pressed === undefined) return
    e.preventDefault()
    if (pressed.hasAttribute('data-bc-notestop')) {
      await stopNote()
      return
    }
    /* One recorder, two composers: while the other one is recording, this
       one does not reach into it. */
    if (micOwner !== null && micOwner !== self && recorder.active()) return
    if (pressed.hasAttribute('data-bc-noteagain')) {
      letGo()
      await startNote()
      return
    }
    if (pressed.hasAttribute('data-bc-notecancel')) {
      letGo()
      recorder.cancel()
      micOwner = null
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
  }
  const self = { press, resync }
  return self
}

/* One instance for the Chat page's composer, resolved live every time. */
const pageNote = voiceNote(() => document.querySelector('#root [data-bc-sayform]'))

/*
  The dock's microphone is live dictation now (bc/dockdictate.js, 8 October 2026): the record-upload-transcribe voice note
  this file wired onto the dock was replaced by it. The Chat page keeps its own voice note (pageNote above).
*/

/*
  Whether the reader is at the end of the thread is REMEMBERED on every
  scroll, because by the time a render has run the page has already moved
  (#197: anything you need to know about "before" has to be recorded before).
*/
let chatAtEnd = true
let chatLastId = ''
globalThis.addEventListener?.(
  'scroll',
  () => {
    const d = document.documentElement
    chatAtEnd = d.scrollHeight - (d.scrollTop + innerHeight) < 160
  },
  { passive: true },
)
const followChat = (root) => {
  const thread = root.querySelector('.bcchat--full')
  if (thread === null) {
    chatLastId = ''
    return
  }
  const rows = thread.querySelectorAll('.bcsaid')
  const last = rows[rows.length - 1]
  const id = `${String(rows.length)}:${last?.textContent?.length ?? 0}:${last?.className ?? ''}`
  const changed = chatLastId !== '' && id !== chatLastId
  chatLastId = id
  if (!changed || !chatAtEnd) return
  requestAnimationFrame(() => {
    globalThis.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' })
    chatAtEnd = true
  })
}

export const wire = (root) => {
  // The entry and set-up screens are their own world; the rest of the wiring has nothing to attach to there.
  account.wire(root)
  if (account.mode() !== 'app') return
  expand.play(root)
  cal.wire(root)
  docview.wire(root, ctx, fileFor)
  activity.wire(root)
  for (const b of root.querySelectorAll('[data-bc-actf]')) {
    b.addEventListener('click', () => {
      ctx.state.bcActFilter = b.dataset.bcActf
      ctx.render()
    })
  }
  for (const b of root.querySelectorAll('[data-bc-actr]')) {
    b.addEventListener('click', () => {
      ctx.state.bcActRange = b.dataset.bcActr
      if (b.dataset.bcActf !== undefined) ctx.state.bcActFilter = b.dataset.bcActf
      ctx.render()
    })
  }
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
  /*
    THE CHAT PAGE FOLLOWS THE CONVERSATION. A new answer, a working row or a
    failure with its Try again landed at the foot of the thread - which is
    under the sticky composer, below the fold - and the page stayed where it
    was: an answer had arrived and nothing on screen said so. When the last
    message changes and the reader was at the end of the thread (or has just
    sent), the page follows it. Someone scrolled back to read older messages
    is left where they are.
  */
  followChat(root)
  /* Asking again, from a slow or failed answer on the Chat page. */
  for (const b of root.querySelectorAll('[data-bc-chatretry]')) {
    b.addEventListener('click', async () => {
      b.disabled = true
      b.textContent = 'Asking again…'
      await ctx.chatRetry?.(ctx.state.project, b.dataset.bcChatretry, () => {
        ctx.render()
      })
      ctx.render()
    })
  }
  for (const form of root.querySelectorAll('[data-bc-sayform]')) {
    form.addEventListener('click', (e) => {
      void pageNote.press(e)
    })
  }
  pageNote.resync()

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
    const field = form.querySelector('#bc-email')
    const tell = (words) => {
      if (said !== null) said.textContent = words
    }
    /*
      ANYTHING THE LINK BROUGHT BACK. A redirect that failed says so in the
      fragment, and a page that swallowed it would leave somebody pressing the
      same button and getting the same nothing.
    */
    if (session.landed.problem !== '') tell(session.landed.problem)

    const ask = async () => {
      const email = String(field?.value ?? '').trim()
      if (email === '') {
        tell('Your email address first.')
        field?.focus()
        return
      }
      tell('Asking…')
      try {
        tell(await session.askForLink(email))
      } catch (e) {
        tell(e instanceof Error ? e.message : String(e))
      }
    }
    form.addEventListener('submit', (e) => {
      e.preventDefault()
      void ask()
    })
    for (const b of form.querySelectorAll('[data-bc-signin]')) {
      b.addEventListener('click', (e) => {
        e.preventDefault()
        void ask()
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

  /* The project menu (hamburger). Its state is on bc/menu.js so a redraw does not lose it. */
  for (const b of root.querySelectorAll('[data-bc-menu], [data-bc-menu-open]')) {
    b.addEventListener('click', () => {
      const wasOpen = menu.isOpen()
      const opening = b.hasAttribute('data-bc-menu-open') || !wasOpen
      const settle = () => {
        if (b.hasAttribute('data-bc-menu-open') && !canWrite()) menu.setMaking(false)
        ctx.render()
        if (menu.isOpen()) root.ownerDocument.querySelector('.bcmenuitem')?.focus()
        else root.ownerDocument.querySelector('[data-bc-menu]')?.focus()
      }
      if (opening) {
        menu.setOpen(true)
        settle()
      } else menu.closeAnimated(settle)
    })
  }
  /* The menu is a role=menu, so the arrow keys, Home and End move between its entries. */
  for (const panel of root.querySelectorAll('.bcmenupanel')) {
    panel.addEventListener('keydown', (e) => {
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return
      const items = [...panel.querySelectorAll('.bcmenuitem:not(:disabled)')]
      if (items.length === 0) return
      const at = items.indexOf(root.ownerDocument.activeElement)
      const next =
        e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
      e.preventDefault()
      items[next].focus()
    })
  }
  for (const b of root.querySelectorAll('[data-bc-menu-new]')) {
    b.addEventListener('click', () => {
      menu.setMaking(true)
      ctx.render()
      root.ownerDocument.querySelector('.bcmenupanel input[name=name]')?.focus()
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

  for (const b of root.querySelectorAll('[data-bc-signout]')) {
    b.addEventListener('click', () => {
      b.disabled = true
      signOut()
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
      ctx.goAnywhere(p === undefined ? '/' : `/p/${p.slug}/team`)
    })
  }

  wireTasks(root)
  wireOutputs(root)
  wireSearch(root)
  wireDocs(root)
  wireStage(root, ctx)
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
      Search runs as you type, so Enter has nothing left to do. Left alone it submitted the form, which reloaded the page
      and threw the query away: the one key a person presses to say "go" cleared what they had written.
    */
    box.closest('form')?.addEventListener('submit', (e) => e.preventDefault())
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
      /*
        Choosing a module from the project menu closes that menu first (M13). Left open, its own pointer handler re-renders the
        shell on the NEXT press, so the close control of the maximised module was replaced between pointer-down and pointer-up
        and its click never arrived. Measured: the same press that closed the module through the DOM did nothing with a real
        pointer.
      */
      if (menu.isOpen()) menu.setOpen(false)
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
      const back = document.querySelector(`[data-bc-expand="${lastOpener}"]`)
      /* A module header is not focusable; its title button is. */
      ;(back?.querySelector?.('.bcmodopen') ?? back)?.focus()
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
/*
  THE CONNECTION, AS THE BROWSER REPORTS IT. Going offline redraws so the
  strip says so at once; coming back asks the office again rather than
  waiting for the next scheduled read, so the page stops saying "offline"
  the moment it can prove otherwise.
*/
for (const [ev, then] of [
  ['offline', () => ctx?.render?.()],
  /* Only a signed-in page has an office to re-ask; a visitor's page is the
     example projects, and asking with no credential would relabel it as an
     outage. */
  ['online', () => { ctx?.render?.(); if (canWrite()) void ctx?.refresh?.() }],
]) {
  globalThis.addEventListener?.(ev, () => {
    if (document.documentElement.dataset.experience !== 'basecamp') return
    then()
  })
}

/*
  A FACE THAT DOES NOT LOAD IS A PERSON, NOT A BROKEN IMAGE.

  Every face in this experience draws the person's initial underneath the
  photograph so that a missing photo still reads as somebody. But a failed
  image still paints Chromium's broken-image glyph over the initial - alt=""
  notwithstanding - which is what the settings roster, the dock and the chat
  showed whenever a photo was deleted, the connection dropped or the storage
  host was unreachable. `error` does not bubble, so this listens in the
  capture phase, once, for the whole document; it hides the image rather than
  removing it, so a redraw that brings a good photo back simply shows it.
  Scoped to this experience: the default studio is not this branch's to change.
*/
document.addEventListener(
  'error',
  (e) => {
    const img = e.target
    if (!(img instanceof HTMLImageElement)) return
    if (document.documentElement.dataset.experience !== 'basecamp') return
    if (img.closest('.bcface, .setface, .face, .bcmateface, .dock') === null) return
    img.hidden = true
  },
  true,
)

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return
  if (document.querySelector('[data-bc-expanded]') === null) return
  ctx?.closeExpanded?.()
  const back = document.querySelector(`[data-bc-expand="${lastOpener}"]`)
  ;(back?.querySelector?.('.bcmodopen') ?? back)?.focus()
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
/*
  THE MICROPHONE IS THE WHOLE INTERFACE NOW (§4).

  It used to say three things -- idle, connecting, live -- because a panel
  underneath said the rest. The panel is gone, so the icon carries all of it:
  connecting, listening, the team talking, muted. `data-bc-mic` is what the
  stylesheet reads, and the accessible name says the same thing in words,
  because a state expressed only as a colour is a state a screen reader
  cannot report. Both come from `live.state()` and `live.SAID` so the two can
  never disagree -- a light that says one thing while the label says another is
  worse than either alone.
*/
const paintMic = (b) => {
  const state = live.state()
  b.setAttribute('data-bc-mic', state)
  /*
    The two classes stay because the shared stylesheet and the default studio
    both know them. Removing them here would be changing a control the other
    experience draws, which this branch may not do.
  */
  b.classList.toggle('ringing', state === 'listening' || state === 'answering')
  b.classList.toggle('connecting', state === 'connecting')
  b.setAttribute('aria-pressed', state === 'idle' ? 'false' : 'true')
  const label = live.SAID[state] ?? live.SAID.idle
  b.setAttribute('aria-label', label)
  b.title = label
  /*
    AND THE WORDS, WHICH SPEAK ONLY WHEN THE ICON CANNOT.

    While a call is up the icon says what is happening, so a line repeating it
    is the surface §4 forbids, appearing one sentence at a time and shifting
    the header as it goes. What the icon cannot say is why a call did not
    happen -- a refusal, a dropped connection, the browser declining the
    microphone -- and those arrive when the call is over, which is exactly
    when this shows them.
  */
  for (const el of document.querySelectorAll('[data-bc-callsay]')) {
    const said = state === 'idle' ? live.plainly(callSays()) : { words: '', tone: '' }
    el.textContent = said.words
    el.dataset.tone = said.tone
    el.hidden = said.words === ''
  }
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

  /*
    WAITING FOR YOU, ANSWERED (§18).

    Opening is ordinary. Answering is the part with a rule in it: the office
    refuses an answer the blocker did not offer, so the page sends one of the
    options VERBATIM rather than anything it composed. A blocker with no
    options takes words, and an empty box is not an answer -- refusing it here
    is kinder than a round trip that comes back rejected.
  */
  /*
    CONFIGURING THE TEAM (§16).

    Every one of these presses a function the office already had. Nothing here
    keeps a frontend model of a specialist: the form is filled from the roster
    the office returned and its values go straight back through
    `hq_staff_update`, whose `p_skills` writes `staff.expertise` -- the column
    routing matches on. That is the difference between configuring the team and
    editing a profile, and it is the whole of §16.

    After every write the assignment is FORGOTTEN rather than patched, so the
    next draw asks the office. A local patch would be a second copy of the
    roster, and this repository has a rule about the copy being the one that
    rots.
  */
  const afterStaffWrite = async () => {
    ctx.forgetAssigned?.(ctx.state.project)
    await ctx.refresh?.()
    ctx.render()
  }

  for (const b of root.querySelectorAll('[data-bc-person-edit]')) {
    b.addEventListener('click', () => ctx.openPerson?.(b.dataset.bcPersonEdit ?? ''))
  }
  for (const b of root.querySelectorAll('[data-bc-hire]')) {
    b.addEventListener('click', () => ctx.openHire?.())
  }
  for (const b of root.querySelectorAll('[data-bc-person-cancel]')) {
    b.addEventListener('click', () => ctx.closePerson?.())
  }

  for (const b of root.querySelectorAll('[data-bc-person-on], [data-bc-person-off]')) {
    b.addEventListener('click', async () => {
      const on = b.dataset.bcPersonOn !== undefined
      const who = (on ? b.dataset.bcPersonOn : b.dataset.bcPersonOff) ?? ''
      if (who === '') return
      const done = await attempt(
        b,
        on ? 'Putting them on…' : 'Taking them off…',
        () =>
          act('project_staff', {
            p_slug: ctx.state.project,
            p_staff_slug: who,
            p_on: on,
          }),
        on ? 'On this project.' : 'Off this project.',
      )
      if (done === null) return
      await afterStaffWrite()
    })
  }

  for (const b of root.querySelectorAll('[data-bc-person-save]')) {
    b.addEventListener('click', async () => {
      const form = b.closest('[data-bc-personform]')
      const slug = form?.dataset.bcPersonform ?? ''
      if (form === null || slug === '') return
      const field = (n) => (form.querySelector(`[name="${n}"]`)?.value ?? '').trim()
      const said = form.querySelector('[data-bc-person-said]')
      /*
        EVERY FIELD IN ONE CALL. `hq_staff_update` takes them all and leaves
        alone whatever is null, so sending the form as it stands is both the
        simplest thing and the one that cannot half-apply.
      */
      const done = await attempt(
        b,
        'Saving…',
        () =>
          act('staff_update', {
            p_slug: slug,
            p_name: field('name'),
            p_title: field('title'),
            p_pronouns: field('pronouns'),
            p_remit: field('remit'),
            p_skills: field('skills'),
            p_style: field('style'),
          }),
        'Saved.',
      )
      if (done === null) return
      if (said !== null) said.textContent = ''
      ctx.closePerson?.()
      await afterStaffWrite()
    })
  }

  for (const b of root.querySelectorAll('[data-bc-person-retire]')) {
    b.addEventListener('click', async () => {
      const who = b.dataset.bcPersonRetire ?? ''
      if (who === '') return
      const done = await attempt(
        b,
        'Standing them down…',
        () => act('staff_retire', { p_slug: who, p_active: false }),
        'Stood down.',
      )
      if (done === null) return
      ctx.closePerson?.()
      await afterStaffWrite()
    })
  }

  for (const b of root.querySelectorAll('[data-bc-hire-save]')) {
    b.addEventListener('click', async () => {
      const form = b.closest('[data-bc-hireform]')
      if (form === null) return
      const field = (n) => (form.querySelector(`[name="${n}"]`)?.value ?? '').trim()
      const said = form.querySelector('[data-bc-person-said]')
      /*
        REFUSED HERE RATHER THAN ROUND-TRIPPED. The RPC requires a name, a
        title and a justification, so sending an empty one is a refusal the
        person has to wait for.
      */
      if (
        field('name') === '' ||
        field('title') === '' ||
        field('why') === '' ||
        field('until') === ''
      ) {
        if (said !== null) {
          said.textContent = 'A first name, a role, what they are for, and until when.'
        }
        return
      }
      const done = await attempt(
        b,
        'Bringing them in…',
        () =>
          act('staff_hire', {
            p_name: field('name'),
            p_title: field('title'),
            p_justification: field('why'),
            /*
              END OF THAT DAY, not the start of it. A bare date parses as
              midnight UTC, so "until the 30th" would stand them down as the
              30th begins -- a day short of what the words say.
            */
            p_expires_at: `${field('until')}T23:59:59Z`,
          }),
        'They are in the office.',
      )
      if (done === null) return
      ctx.closePerson?.()
      await afterStaffWrite()
    })
  }

  /*
    STOPPING WORK THAT IS RUNNING (§20.2).

    `stop_job` has been a gateway action all along with nothing pressing it --
    CLAUDE.md records twenty-seven of those, and this is the one the team
    surface was apologising for. It REQUESTS a stop rather than killing a job:
    `request_stop` stamps the row and the worker notices, which is the only
    honest thing a button in a browser can do to work running somewhere else.
    So the confirmation says asked, not stopped.
  */
  for (const b of root.querySelectorAll('[data-bc-stopjob]')) {
    b.addEventListener('click', async () => {
      const id = b.dataset.bcStopjob ?? ''
      if (id === '') return
      const done = await attempt(
        b,
        'Asking it to stop…',
        () => act('stop_job', { p_job: id }),
        'Asked it to stop.',
      )
      if (done === null) return
      stopping.remember(id)
      await ctx.refresh?.()
      ctx.render()
    })
  }

  for (const b of root.querySelectorAll('[data-bc-waitopen]')) {
    b.addEventListener('click', () => {
      const id = b.dataset.bcWaitopen ?? ''
      if (id === '') return
      ctx.openWaiting?.(id)
    })
  }
  for (const b of root.querySelectorAll('[data-bc-waitclose]')) {
    b.addEventListener('click', () => {
      ctx.closeWaiting?.()
    })
  }

  const answer = async (el, id, text) => {
    const said = root.querySelector('[data-bc-waitsaid]')
    const done = await attempt(
      el,
      'Sending your answer…',
      () => act('answer_blocker', { p_blocker_id: id, p_answer: text }),
      (r) => alreadyAnswered(r) ?? 'Answered. The team has it.',
    )
    if (done === null) return
    /* Answered somewhere else first: the sentence above says so, and closing
       the record would take it off the screen before it could be read. */
    if (alreadyAnswered(done) !== null) return
    /*
      Close only AFTER the office has taken it. Closing first would show the
      list without the item and imply a resolution that had not happened yet --
      and if the office refuses, the person is left looking at a page that says
      nothing went wrong.
    */
    await ctx.refresh?.()
    ctx.closeWaiting?.()
    if (said !== null) said.textContent = ''
  }

  for (const b of root.querySelectorAll('[data-bc-waitanswer]')) {
    b.addEventListener('click', () => {
      const id = b.closest('[data-bc-waitform]')?.dataset.bcWaitform ?? ''
      const text = b.dataset.bcWaitanswer ?? ''
      if (id === '' || text === '') return
      void answer(b, id, text)
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
        /*
          THE WORD TOKEN DOES NOT BELONG IN FRONT OF A PERSON.

          This said "There is no office token in this browser". The 24
          September correction is explicit that the normal user should never
          see, paste, copy, receive or understand an office token, and the
          sign-in that replaced it went in the same night -- and this sentence
          survived, on the one path that tells somebody why their press did
          nothing. What is true for them is simply that they are not signed in.
        */
        if (said !== null) {
          said.textContent = 'Sign in first and this adds the link to the project.'
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
  /*
    A RENDER LOSES WHAT THE CALL SAID, because the element is new every paint
    - so the sentence is put back rather than waiting for the next thing to
    happen. #197's rule: anything that must survive a redraw has to be put
    back after it.

    `paintMic` is what puts it back now, because the rule for WHEN there
    should be words at all belongs with the rule for what the icon is saying:
    two places deciding that is two places to disagree, and this one used to
    restore a routine sentence the icon had already made redundant.
  */
  /*
    THE LIVE PANEL'S OWN CONTROLS ARE GONE WITH THE PANEL (§4). Mute and End
    were delegated here; neither renders any more, so the delegation was a
    listener bound to attributes no renderer emits -- the dead-control shape
    with the sign reversed, and this file removed two of those this morning.
    Ending a call is a second press on the microphone.
  */

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
        AND THE ICON WITH IT. The call's own states - connecting, listening,
        the team answering - arrive over the data channel and nothing repaints
        this page, so the microphone would freeze on whatever it said when it
        was drawn.

        IT NO LONGER RE-RENDERS ON EVERY TURN. It used to, because a panel
        under the head was showing the last six of them, and the key it
        compared included the turn count and the status sentence. With the
        panel gone (§4) that is a full redraw of the project every time
        somebody finishes a sentence -- on a screen the section says must
        remain visually unchanged, and a redraw is what takes the keyboard
        with it. Painting the icon needs no render at all, and the one
        remaining reason to redraw is the PHASE changing, which is what the
        rest of the head reads.
      */
      /*
        LOOK THE BUTTON UP LIVE, do not paint the one captured at wiring time.

        A render REPLACES the header, so the node this handler closed over is
        detached the first time the phase changes -- and painting a detached
        node changes nothing while looking exactly like a state machine that
        stopped working. The suite caught it as "the team is speaking" never
        arriving. #197 is the same lesson in four attempts: anything consulted
        after a redraw has to be looked up after the redraw.
      */
      let ticks = 0
      let was = ''
      const watch = globalThis.setInterval(() => {
        ticks += 1
        const mic = document.querySelector('[data-bc-voice]')
        if (mic !== null) paintMic(mic)
        const now = callPhase()
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
      // A contact row on the home grows into its record; inside an open Contacts sheet it is a step, not a growth.
      if (!ctx.state.bcExpanded) ctx.rememberOrigin?.(b)
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
    TAKING ONE OFF THE PROJECT. `contacts.putAway` existed and nothing pressed
    it, so a contact added by mistake could never leave. Two presses, like
    removing a task, because it is the one thing on this record that cannot be
    done by correcting a field. The office keeps the row and offers an undo, so
    "removed" here means put away, and the words say so.
  */
  for (const b of root.querySelectorAll('[data-bc-contact-away]')) {
    let armed = false
    b.addEventListener('click', async () => {
      if (!armed) {
        armed = true
        b.textContent = 'Press again to remove'
        setTimeout(() => {
          armed = false
          if (b.isConnected) b.textContent = 'Remove contact'
        }, 6000)
        return
      }
      const key = b.dataset.bcContactAway ?? ''
      if (localKey(key)) {
        await contacts.putAway(ctx.state.project, key, true)
        ctx.closeContact()
        return
      }
      const done = await attempt(
        b,
        'Removing…',
        () => contacts.putAway(ctx.state.project, key, true),
        'Removed. The office keeps it, and Undo brings it back.',
      )
      if (done !== null) {
        ctx.closeContact()
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
    if (e.target?.closest?.('.bcmenuitem') !== null) shut()
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
  for (const b of root.querySelectorAll('[data-bc-style]')) {
    b.addEventListener('click', () => {
      shut()
      const p = ctx.projects().find((q) => q.slug === ctx.state.project)
      if (p !== undefined) void styleForm.open(p)
    })
  }
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
        fig?.dataset.bcDocproject ?? '',
        fig ?? b,
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
      void openDoc(ref, fig.dataset.bcDocTitle ?? 'document', fig.dataset.bcDocproject ?? '', fig)
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

/*
  A REAL FIRST PAGE FOR A DOCUMENT NOBODY HAS OPENED.

  Read through the same authenticated gateway call the viewer uses (document_preview_file), so no thumbnail URL is ever
  public and nothing new is stored on a server: the small picture is kept on this device by docthumbs, keyed to the source's
  modified time. One at a time, a few per session, and silent on any failure: the tile's own fallback stays. A file that is
  neither a PDF nor a picture is left alone.
*/
const WARM = { busy: false, queue: [], done: 0, tried: new Set() }
const WARM_MAX = 16
const warmThumb = (host, id) => {
  /* Only what has a first page to draw: a PDF or a picture. */
  if (!/pdf|image|png|jpe?g|webp|gif/i.test(host.dataset.bcThumbtype ?? '')) return
  /* document_preview_file is for documents read on demand from a connected source; a file Team HQ holds is drawn from its own URL and the office refuses this call for it. */
  if ((host.dataset.bcThumbext ?? '') !== '1') return
  if (WARM.tried.has(id) || WARM.tried.size >= WARM_MAX) return
  WARM.tried.add(id)
  WARM.queue.push({ host, id })
  void warmNext()
}
const warmNext = async () => {
  if (WARM.busy) return
  const job = WARM.queue.shift()
  if (job === undefined) return
  WARM.busy = true
  try {
    const mod = job.host.dataset.bcThumbmod ?? ''
    if (docthumbs.get(job.id, mod) === null) {
      const blob = await readFile('document_preview_file', job.id, ctx.state.project ? { project: ctx.state.project } : undefined)
      const url = URL.createObjectURL(blob)
      try {
        let src = null
        if (blob.type === 'application/pdf') src = (await pdf.pages(url, 220, 1)).pages[0]?.src ?? null
        else if (blob.type.startsWith('image/')) src = url
        if (src !== null) {
          const small = await docthumbs.shrink(src, 220)
          if (small && docthumbs.put(job.id, mod, small)) {
            /* The tile may have been redrawn while the page was read, so paint whichever tiles exist NOW. */
            for (const h of document.querySelectorAll('[data-bc-thumb]')) {
              if (h.dataset.bcThumb !== `id:${job.id}`) continue
              const img = document.createElement('img')
              img.className = 'realpage'
              img.alt = ''
              img.src = small
              h.classList.remove('bcthumb--object', 'bcthumb--i')
              h.replaceChildren(img)
              h.classList.add('has-real')
            }
          }
        }
      } finally {
        URL.revokeObjectURL(url)
      }
    }
  } catch {
    /* The tile keeps its fallback. */
  } finally {
    WARM.busy = false
    void warmNext()
  }
}

const paintThumb = async (host, ref) => {
  /*
    A THUMBNAIL KEPT ON THIS DEVICE (docthumbs.js): the viewer made it from the first page or the picture while the
    document was open, keyed to the source's modified time. It is checked first, so a tile for an external document that
    Team HQ does not hold needs no request at all, and a source that changed shows none rather than an old one.
  */
  if (ref.startsWith('id:')) {
    const kept = docthumbs.get(ref.slice(3), host.dataset.bcThumbmod ?? '')
    if (kept !== null) {
      const img = document.createElement('img')
      img.className = 'realpage'
      img.alt = ''
      img.decoding = 'async'
      img.src = kept
      await img.decode().catch(() => {})
      host.classList.remove('bcthumb--object', 'bcthumb--i')
      host.replaceChildren(img)
      host.classList.add('has-real')
      return
    }
  }
  const file = await fileFor(ref)
  if (file === null || file.url === '') {
    /* A document Team HQ reads on demand and nobody has opened yet: make its first-page picture ourselves (below). */
    if (ref.startsWith('id:')) void warmThumb(host, ref.slice(3))
  }
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

const openDoc = async (ref, title, project = '', from = null) => {
  /*
    EVERY PRESS OPENS THE DOCUMENT HERE (4 October). Routine viewing must not
    send a person to Google Drive: the record draws the preview, the details and
    the version history beside it, and the two ways out - Open source and Open
    the file - are buttons on it. What used to be here opened a new tab (and, for
    a Drive document, Drive itself); that is now a choice rather than the default.
  */
  /*
    A document listed under ALL PROJECTS belongs to the project named on it, and the record is drawn for the project
    you are in. So a press on another project's document goes to that project first, then opens the record there.
  */
  const elsewhere = project !== '' && project !== ctx.state.project
  if (elsewhere) ctx.go?.(`/p/${project}/documents`)
  // A tile that is on THIS page grows into the viewer and the viewer settles back onto it; a document from another
  // project has no tile here, so it simply opens.
  if (!elsewhere && !ctx.state.bcExpanded) ctx.rememberOrigin?.(from)
  ctx.openDocDetail?.(ref, title)
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
  /*
    THE FORM NEVER SUBMITS ITSELF. It had no submit listener, so Enter in the
    field did a native form submission: the page reloaded and the message was
    gone, with nothing on screen to say so. Enter now presses Send; Shift+Enter
    is left to the textarea, which makes a new line.
  */
  for (const f of root.querySelectorAll('[data-bc-sayform]')) {
    f.addEventListener('submit', (e) => {
      e.preventDefault()
      f.querySelector('[data-bc-say]')?.click()
    })
    const box = f.querySelector('#bc-say')
    box?.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return
      e.preventDefault()
      f.querySelector('[data-bc-say]')?.click()
    })
  }
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

        What the drop supplies is PROVENANCE, not an explanation. Grant, §10:
        "The automatically supplied reason must be truthful... Do NOT invent
        substantive explanations such as Waiting on dependency, Blocked by
        client, Technical problem unless that information actually exists. The
        system must distinguish USER MARKED THIS STUCK from WHY IT IS STUCK."

        So it records that he marked it, where, and that nobody has said why
        yet -- every word of which is true -- and he can say more on the task,
        which is where there is room for it.
      */
      const why = wanted === 'blocked' ? 'Marked stuck on the board — no reason given yet' : ''
      await moveCard(key, wanted, cardEl, null, why)
    })
  }

  /* ------------------------------------------- ordering documents (§§25-38) */
  /*
    ONE CONTROL, TWO SURFACES, and the same handler for both. The select says
    how to show them; a drag says what the order IS. Choosing a mode never
    writes an order, which is §32 -- the whole reason returning to Custom
    returns to what he arranged.
  */
  for (const pick of root.querySelectorAll('[data-bc-docsort]')) {
    pick.addEventListener('change', () => {
      docorder.setMode(pick.dataset.bcDocsort, pick.value)
      ctx.render()
    })
  }

  /*
    DRAGGING A DOCUMENT.

    The same mechanism as the Card Table, for the same reason: the browser's
    own drag events, so a gesture that becomes a drag never delivers a click
    and §35 is satisfied by construction rather than by a timer.

    A drop always arranges what is CURRENTLY DRAWN -- so dragging while sorted
    by name takes the list he can see and makes it his, which is what a person
    means by moving something, and it switches the view to Custom because that
    is now what he is looking at.
  */
  for (const holder of root.querySelectorAll('[data-bc-docdrop]')) {
    const slug = holder.dataset.bcDocdrop
    const each = () => [...holder.querySelectorAll('[data-bc-docid]')]

    for (const card of each()) {
      card.addEventListener('dragstart', (e) => {
        e.dataTransfer?.setData('text/plain', card.dataset.bcDocid ?? '')
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
        card.classList.add('bcdoc--lifting')
      })
      card.addEventListener('dragend', () => {
        card.classList.remove('bcdoc--lifting')
        for (const other of each()) other.classList.remove('bcdoc--over')
      })
      card.addEventListener('dragover', (e) => {
        e.preventDefault()
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
        card.classList.add('bcdoc--over')
      })
      card.addEventListener('dragleave', () => {
        card.classList.remove('bcdoc--over')
      })
      card.addEventListener('drop', (e) => {
        e.preventDefault()
        card.classList.remove('bcdoc--over')
        const moved = e.dataTransfer?.getData('text/plain') ?? ''
        const onto = card.dataset.bcDocid ?? ''
        if (moved === '' || onto === '' || moved === onto) return
        const drawn = each().map((el) => ({ id: el.dataset.bcDocid }))
        if (docorder.moveWithin(slug, drawn, moved, onto) === null) return
        /*
          A hand-made order IS the custom order, so the view follows it rather
          than showing him a date sort that no longer describes what he did.
        */
        docorder.setMode(slug, 'custom')
        ctx.render()
      })

      /*
        AND A WAY THAT IS NOT A DRAG (§52).

        "Custom document ordering must have an accessible interaction strategy
        where practical; do not make drag-and-drop the only possible mechanism
        for users who cannot drag." Alt with an arrow moves the focused
        document one place, which needs no pointer and no sustained gesture.
      */
      card.addEventListener('keydown', (e) => {
        if (!e.altKey) return
        const by = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : 0
        if (by === 0) return
        e.preventDefault()
        const drawn = each().map((el) => ({ id: el.dataset.bcDocid }))
        if (docorder.nudge(slug, drawn, card.dataset.bcDocid ?? '', by) === null) return
        docorder.setMode(slug, 'custom')
        ctx.render()
        /* Follow it, or the keyboard is left where the document used to be. */
        root
          .querySelector(`[data-bc-docid="${CSS.escape(card.dataset.bcDocid ?? '')}"] button, [data-bc-docid="${CSS.escape(card.dataset.bcDocid ?? '')}"]`)
          ?.focus?.()
      })
    }
  }

  for (const b of root.querySelectorAll('[data-bc-output-open]')) {
    b.addEventListener('click', () => {
      ctx.openOutput?.(b.dataset.bcOutputOpen)
    })
  }
  for (const b of root.querySelectorAll('[data-bc-output-close]')) {
    b.addEventListener('click', () => {
      ctx.closeOutput?.()
    })
  }

  for (const b of root.querySelectorAll('[data-bc-task-open]')) {
    b.addEventListener('click', () => {
      if (!ctx.state.bcExpanded) ctx.rememberOrigin?.(b)
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
        /*
          The redraw replaced the button that was pressed, so the confirmation
          goes on its successor, and focus with it: without this the save
          looked like nothing had happened and the keyboard landed on Close.
        */
        const again = document.querySelector(`[data-bc-tasksave-edit="${CSS.escape(String(id))}"]`)
        if (again instanceof HTMLElement) {
          again.focus()
          say(again, 'Saved in this browser.')
          again.parentElement?.querySelector('[data-said]')?.setAttribute('role', 'status')
        }
        return
      }
      const who = String(root.querySelector('#bc-edit-who')?.value ?? '').trim()
      const due = String(root.querySelector('#bc-edit-due')?.value ?? '').trim()
      const title = String(root.querySelector('#bc-edit-title')?.value ?? '').trim()
      if (title === '') {
        say(b, 'A task needs words. What needs doing?', 'warn')
        return
      }
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
            p_title: title,
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
    REMOVING A TASK. Two presses, because removing is the one thing on this form that is not a save: the first press says
    what the second will do. It is a cancellation, not a deletion, so it is kept for history and can be taken back from
    the undo strip that every write offers.
  */
  for (const b of root.querySelectorAll('[data-bc-taskremove]')) {
    let armed = false
    b.addEventListener('click', async () => {
      if (!armed) {
        armed = true
        b.textContent = 'Press again to remove'
        setTimeout(() => {
          armed = false
          if (b.isConnected) b.textContent = 'Remove task'
        }, 6000)
        return
      }
      const done = await attempt(
        b,
        'Removing…',
        () => act('task_state', { p_task_id: b.dataset.bcTaskremove, p_state: 'cancelled' }),
        'Removed.',
      )
      if (done !== null) {
        await ctx.refresh()
        ctx.goAnywhere(`/p/${ctx.state.project}/tasks`)
      }
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
      // The kept lists are behind after a tick (a repeating reminder has just moved to its next time): read them again.
      await (ctx.refreshMyTasks?.() ?? ctx.refresh())
    })
  }

  /*
    ENDING A RECURRING REMINDER (owner decision, 7 October 2026; migration 1051 in this repository).

    Ticking a series off completes THAT time only, so the series has its own, separate press. It asks first the way every other
    destructive press in this surface does (press again within six seconds), because it stops every later reminder. The writer
    is the gateway's reminder_series_stop, which cancels the row through the same path the rest of the product uses, so the
    office's undo offer comes back in the answer. Drawn for a series only (shell.js myTasks).
  */
  for (const b of root.querySelectorAll('[data-bc-mystopseries]')) {
    let armed = false
    const label = b.textContent
    b.addEventListener('click', async () => {
      const id = b.dataset.bcMystopseries ?? ''
      if (id === '') return
      if (!armed) {
        armed = true
        b.textContent = 'Press again to stop'
        setTimeout(() => {
          armed = false
          if (b.isConnected) b.textContent = label
        }, 6000)
        return
      }
      const done = await attempt(
        b,
        'Stopping…',
        () => act('reminder_series_stop', { p_task_id: id }),
        'Stopped.',
      )
      armed = false
      if (done === null) {
        b.textContent = label
        return
      }
      await (ctx.refreshMyTasks?.() ?? ctx.refresh())
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
