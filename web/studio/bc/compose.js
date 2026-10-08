/*
  §21 — two materially different project-home compositions, built so they can
  be captured, compared and one of them chosen.

  This exists because the fix for §20 is not six better tiles: it is a
  different composition. Addressing the seventeen discrepancies one at a time
  inside the three-column equal-weight grid would be building against the
  layout that is being corrected.

  Both compositions render the SAME miniatures from the SAME real records. The
  grammars are not the experiment — §4 to §12 require them either way. The
  arrangement is the experiment, and the two arrangements differ structurally:

    A  THE BRIEFING. One column at the text measure, weighted top to bottom.
       The dominant tool is full width; two secondary tools share a row;
       activity closes the page as a full-width spine. Reads as a document
       about the project. The same order on a phone as on a desktop, so there
       is one thing to learn.

    B  THE WORKSPACE. Asymmetric two columns. The tools stack full width in
       the main column; a companion rail holds the things that are true of the
       project rather than of one tool — who is here, what was said, what has
       happened. The rail is persistent at desktop, so presence is never
       scrolled away. On a phone the rail breaks up and its parts are placed
       by §18's priority rather than kept together.

  Neither is the reference slice with better spacing, which is what "two
  experiments" would have meant if I had let it.

  How to see them: this is chosen per viewer, in localStorage, under
  `bc.compose`. Not a URL, because `keepUrl()` discards the query string and a
  path segment would mean teaching the router about an experiment that is
  meant to be deleted. Wrapped in try/catch and defaulting to the current
  build, because storage throws in a private window and a composition
  experiment must not be able to take the page down.

  A NOTE ON COMMENTS. Plain words only inside a returned template literal.
*/

import * as icons from '../icons.js'
import * as grid from './layout.js'
import * as live from './livevoice.js'
import { button, esc } from './parts.js'
import {
  calendarMini,
  cardsCount,
  cardsMini,
  chatMini,
  contactsMini,
  crewMini,
  docsMini,
  mineAndTeam,
  sourcesMini,
  needsYouLine,
  timelineMini,
  todosMini,
} from './miniatures.js'

let ctx = null
export const mount = (c) => {
  ctx = c
}

// Team HQ's addresses are the site's own (#382).
const at = (p = '') => (p === '' ? '/' : p)

/*
  A module that IS a tool takes the TOOL's name, from the one list `shell.js`
  keeps. The derived views - the board, the schedule - keep their own words,
  because they are not the tool: three miniatures come out of one to-do list
  and calling all three "To-dos" would say less, not more.
*/
const toolName = (id, fallback) =>
  (ctx?.tools ?? []).find((t) => t.id === id)?.name ?? fallback

/**
 * Which composition this viewer is looking at.
 *
 * B IS THE PROJECT HOME NOW - §21 chose it and the evidence is in the ledger.
 * The other two are kept reachable rather than deleted, because the comparison
 * is the argument: `bc.compose` set to `a` gives the briefing, and `grid`
 * gives the equal-weight build §20 is about, which is the single clearest
 * statement of what changed. Anything else, including nothing, is B.
 */
export const chosen = () => {
  try {
    const v = globalThis.localStorage?.getItem('bc.compose') ?? ''
    if (v === 'grid' || v === 'a' || v === 'b') return v
    return 'c'
  } catch {
    return 'c'
  }
}

export const choose = (v) => {
  try {
    globalThis.localStorage?.setItem('bc.compose', ['a', 'b', 'grid'].includes(v) ? v : 'c')
  } catch {
    /* A viewer who cannot store a preference still gets the chosen home. */
  }
}

/**
 * A module of the project home.
 *
 * §5's two-level pattern: the heading is the way to the full tool and the body
 * is the tool in miniature. The heading is the only navigation — the body is
 * content, and pressing content does what the content says rather than
 * navigating somewhere plausible.
 */
const mod = (p, { id, name, body, wide = false, slot = '', meta = '', rect = null }) => {
  /*
    THE WHOLE HEADER IS THE TARGET. Grant, 22 September:

      "At present, expanding some minimized panels requires clicking precisely
      on the title text... the entire module header/top section is the
      interaction target... Do not allow interactive controls within the
      header, such as three-dot menus, to accidentally trigger expansion."

    So the header carries the press and the title is a plain heading rather
    than a button. Two things follow, and both are in wire.js because they are
    behaviour rather than markup: the controls inside it stop the event before
    it reaches the header, and a press that MOVED is a drag rather than an
    expand - which is what lets one element be both without a separate grip.
    CLAUDE.md records what a separate grip costs: eighteen buttons inside a
    drag handle that looked fine and did nothing.
  */
  /*
    A PLACED MODULE IS A RECTANGLE IN LOGICAL PIXELS on a freeform stage
    (4 October): left, top, width, height and a stacking order, plus an
    optional tint hue. Nothing about the grid survives here.
  */
  const hue = rect === null ? '' : grid.tintHue(rect.tint)
  const style =
    rect === null
      ? ''
      : ` style="left:${String(rect.x)}px;top:${String(rect.y)}px;width:${String(rect.w)}px;height:${String(rect.h)}px;z-index:${String(rect.z ?? 1)}${hue === '' ? '' : `;--bc-tint:${hue}`}"`
  return `<section class="bcmod${wide ? ' bcmod--wide' : ''}${rect === null ? '' : ' bcmod--placed'}${hue === '' ? '' : ' bcmod--tinted'}" data-mod="${esc(id)}" data-slot="${esc(slot === '' ? id : slot)}"${style}>
    <!--
      THE HEADER IS STILL THE WHOLE POINTER TARGET (Grant, 22 September), but
      it is no longer pretending to be one button. As role=button it held
      other buttons - the Mine / The team's switch and the close cross - and
      a control inside a control is something a screen reader cannot present:
      axe flagged every module header as nested-interactive. The keyboard stop
      is a real button on the title; its keys bubble to the header's own
      handler, so Enter opens and Alt with the arrows still moves and resizes.
    -->
    <header class="bcmodhead" data-bc-expand="${esc(id)}">
      <h2 class="bcmodtitle"><button type="button" class="bcmodopen"
        aria-label="${esc(`Open ${name}`)}"
        aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight Alt+ArrowUp Alt+ArrowDown">${esc(name)}</button></h2>
      <!--
        THE META IS MARKUP NOW, not a string. It was escaped as text, which
        was right while it was a sentence and wrong the moment Mine and The
        team's became a pair of switches: escaping would have printed the
        buttons. Callers pass a string that is already safe, each composed
        from escaped values in miniatures.js. Plain words in this comment.
      -->
      ${meta === '' ? '' : `<span class="bcmodmeta">${meta}</span>`}
      ${
        rect === null
          ? ''
          : `<span class="bcmodctl">
              <button type="button" class="bcmodbtn" data-bc-tint="${esc(id)}"
                aria-label="${esc(`Colour of ${name}`)}" aria-haspopup="true" title="Colour">
                <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none"
                  stroke="currentColor" stroke-width="2" stroke-linecap="round">
                  <circle cx="12" cy="12" r="8"></circle><circle cx="12" cy="12" r="3.2" fill="currentColor" stroke="none"></circle>
                </svg>
              </button>
              <button type="button" class="bcmodbtn" data-bc-max="${esc(id)}"
                aria-label="${esc(`Maximise ${name}`)}" title="Maximise">
                <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none"
                  stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"></path>
                </svg>
              </button>
              <button type="button" class="bcmodbtn" data-bc-modoff="${esc(id)}"
                aria-label="${esc(`Take ${name} off this page`)}" title="Take it off this page">
                <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none"
                  stroke="currentColor" stroke-width="2" stroke-linecap="round">
                  <path d="M6 6l12 12M18 6L6 18"></path>
                </svg>
              </button>
            </span>`
      }
    </header>
    <div class="bcmodbody">${body}</div>
    ${
      rect === null
        ? ''
        : /*
            A focusable separator must say where it is (axe: aria-valuenow is
            required). The value is the module's width in board columns, and
            the keyboard resize on the header changes it.
          */
          `<span class="bcresize" data-bc-resize="${esc(id)}" role="separator"
            aria-label="${esc(`Resize ${name}`)}" tabindex="0" aria-orientation="vertical"
            aria-valuemin="${String(grid.MIN.w)}" aria-valuemax="1600" aria-valuenow="${esc(String(rect.w))}"
            aria-valuetext="${esc(`${String(rect.w)} pixels wide`)}">
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none"
              stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
              <path d="M13 6L6 13M13 10.5l-2.5 2.5"></path>
            </svg>
          </span>`
    }
  </section>`
}

/**
 * The project's own head.
 *
 * §16: the project dominates. The name is the largest thing on the page, the
 * people on it are faces rather than a comma-separated list, and the state
 * line sits directly under the name because it is the answer to the question
 * §2 says this page exists to answer.
 */
/*
  No presence cluster in the head either: project home v2 takes team imagery
  off this page entirely, and a row of monograms beside the project name was
  the most decorative instance of it.
*/
/*
  THE PROJECT'S OWN MARK, and its hue, on the page it belongs to.

  Grant, 23 September: *"Test project colour/accent, SVG icon, uploaded image
  if supported... Verify the correct identity persists and projects are
  immediately distinguishable. Make sure project-specific styling remains
  restrained rather than recolouring the whole application."*

  `app.hq_project_look` has stored an icon, a hue and an image since 0253, the
  default studio has a whole picker for it, and this experience drew none of
  it - every project's head was identical but for the words. So the mark is
  here, at the size of the title, and the hue tints the MARK and a single
  accent rule under the head. Nothing else changes colour: a project is
  recognised by its badge, not by repainting the product.
*/
export const projectMark = (p, size = 26) => {
  if (typeof p.image === 'string' && p.image.startsWith('data:image/')) {
    return `<img class="bcprojmark bcprojmark--img" src="${esc(p.image)}" alt="">`
  }
  const key = p.icon ?? ''
  if (icons.known(key)) {
    return `<span class="bcprojmark ${esc(p.iconHue ?? p.hue ?? '')}">${icons.svg(key, size)}</span>`
  }
  /* No icon chosen: the initial, in the project's hue, rather than nothing. */
  return `<span class="bcprojmark bcprojmark--letter ${esc(p.iconHue ?? p.hue ?? '')}">${esc(
    String(p.name ?? '?').trim().charAt(0).toUpperCase(),
  )}</span>`
}

/*
  IS THE PROJECT MENU OPEN.

  Held here rather than in the DOM, because the DOM is not where state
  survives: this experience redraws its whole shell for many reasons - a lazy
  read landing, the call painter ticking, a store filling - and each redraw
  REPLACES the menu's node with a fresh one that is hidden. So pressing the
  three dots and having the menu vanish half a second later is not a wiring
  defect, it is the panel being rebuilt, and it is most of "the settings
  control has disappeared".

  One flag, read by the markup and set by the wiring, so a redraw re-renders
  the menu in the state the person put it in.
*/
let menuOpen = false
export const pageMenuOpen = () => menuOpen
export const setPageMenuOpen = (want) => {
  menuOpen = want === true
}

/*
  THE HEADER SAYS WHAT IS HAPPENING, NOT WHAT THE PROJECT IS CALLED.

  Grant, 23 September: remove the redundant legacy project title area, the
  purpose sentence and the redundant Tasks summary, and let the workspace begin
  higher on the screen. Three things were stacked above the board and each was
  a repetition of something already on screen:

   - THE TITLE. The top bar's project chip names the project and is how you
     move between projects, so the page said "Legacy Coaching Course" twice,
     173 pixels apart. The MARK moved up there with the name rather than being
     deleted, because the colour, mark and picture somebody chose are the
     project's identity and deleting the only place they appear on this page
     would have undone the appearance controls.
   - THE PURPOSE. A project-level fact, restated at the top of every visit to
     the project's own home.
   - THE TASK COUNTS. Directly above a To-dos panel listing those to-dos. They
     are filters as well as counts, so they moved to the to-dos surface rather
     than being removed: a control deleted is a capability lost, and this
     office has paid for that often enough.

  What stays is the team's work waiting to be read, which is not a to-do count
  and is said nowhere else, and the two communication actions.

  Measured, signed in, with the prototype strip discounted because a page with
  a token does not carry one: the board began 283px down the desktop and 281px
  down a 844px phone, and begins at 205px and 217px. The header itself went
  from 151px to 73px, and from 185px to 121px on the phone, where the chip and
  the two communication actions legitimately wrap onto two lines - three
  controls of 44px do not fit across 390px beside a sentence.
*/
const head = (p, extra = '') => {
  return `<!--
      The page's name, for anyone navigating by headings. Grant took the
      VISIBLE title away (the top bar's chip already names the project), and
      that left the page with no level-one heading at all. Outside the header,
      which verify:basecamp-home reads to prove nothing is said twice.
    -->
    <h1 class="bcvh">${esc(p.name)}</h1>
    <header class="bchead" data-bc-hue="${esc(p.iconHue ?? p.hue ?? '')}" data-bc-livehost>
    <div class="bcheadrow">
      ${needsYouLine(p)}
      ${extra}
      <span class="bcheadacts">
        <!--
          CHAT WITH TEAM, and it is a TOGGLE. Grant: "Clicking it should open
          the team chat sidebar. Clicking the same button again should close
          the sidebar." So the label says what it opens and the control
          carries its own pressed state, painted from whether the dock is
          actually open rather than from a variable this page keeps.
        -->
        ${button('Chat with Team', { kind: 'primary', 'data-bc-dock': '1', 'aria-pressed': 'false' })}
        <!--
          THE MICROPHONE IS A SEPARATE CONTROL, and it starts the call rather
          than opening anything. Grant: do not introduce an intermediate screen
          or another custom chat interface when the microphone is clicked. So
          it presses the studio's own voice path, the same one the call panel
          uses, and nothing is drawn in between.

          A SIBLING OF CHAT WITH TEAM, not a footnote to it. Grant, 22
          September: "The microphone control should also have appropriate
          visual prominence. It currently feels undersized relative to Chat
          with Team... The two controls should clearly look like sibling
          primary communication actions... while remaining visually distinct
          enough that the user understands one is text chat and the other is
          immediate voice conversation." So it carries the same height and
          weight and a different shape: filled and round against a filled
          rectangle.
        -->
        <button type="button" class="bcbtn bcmic" data-bc-voice="1"
          aria-pressed="false" aria-label="Talk to the team out loud">
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none"
            stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
            <rect x="9" y="3" width="6" height="11" rx="3"></rect>
            <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0"></path>
            <path d="M12 18v3"></path>
          </svg>
        </button>
        <!--
          AND WHAT THE CALL IS DOING, where the call is started.

          Every sentence the voice path produces - connecting, asking for the
          microphone, a refusal, a dropped connection - was written into the
          call PANEL, which this experience never opens. So the mic was
          pressed, several things happened, and not one of them was on screen:
          which is the whole of "the microphone control appears to do
          nothing".

          IT NO LONGER ASKS call.js TO PAINT IT. The shared painter writes
          every sentence the call produces, routine progress included --
          Connecting, Listening, On a call with Claire -- and section 4 of the
          23 September review puts those on the icon and asks that the project
          screen stay visually unchanged. A line that appears to say what the
          microphone is already saying is the surface that section forbids,
          arriving one sentence at a time.

          So the attribute is this experience's own and the microphone's
          painter fills it, with the rule that the icon speaks while the call
          is up and the words speak when it is not: a refusal, a dropped
          connection, the browser declining the microphone. Changing the
          shared painter instead would have changed the default Team HQ, which
          this branch may not touch. Plain words in here: a backtick inside an
          HTML comment inside a template literal ends the string, and that is
          the seventh time in this repository.
        -->
        <span class="bccallsay" data-bc-callsay role="status" aria-live="polite" hidden></span>
        <!--
          A three-dot menu, which is where page-level things live now: how this
          page is arranged, where the material comes from, and the project's
          settings. Grant asked for the conventional control rather than a
          sentence, and for those two modules to stop occupying dashboard space.
        -->
        <span class="bcmenuwrap">
          <!--
            THE DOTS, AND NOT THE WORD.

            §12, 23 September: "Do not display the word Settings where the
            three-dot project menu is sufficient. Use the project-level
            three-dot control as the settings affordance."

            The word was added the day before, and for a real reason: the
            control was present and visible at every width and NOT findable -
            an unlabelled 38px icon whose only description was "More about
            this page", which is not a phrase anybody looking for settings
            would recognise. What fixed that was naming the thing, and the
            accessible name still does: it lists what the menu opens, so
            nothing is lost to anyone reading the page aloud. The title makes
            the same sentence available to a pointer. It is the WORD in the
            row that Grant no longer wants, not the findability.
          -->
          <button type="button" class="bcbtn bcicon bcpagemenu" data-bc-pagemenu="1"
            aria-haspopup="menu" aria-expanded="false"
            aria-label="Project menu: settings, how this project looks, sources and the team">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="currentColor">
              <circle cx="5" cy="12" r="1.7"></circle>
              <circle cx="12" cy="12" r="1.7"></circle>
              <circle cx="19" cy="12" r="1.7"></circle>
            </svg>

          </button>
          <div class="bcmenu" data-bc-pagemenu-panel role="menu"${menuOpen ? '' : ' hidden'}>
            <!--
              ARRANGE THIS PAGE IS GONE. §13: "Remove Arrange this page from
              project settings. The page already supports direct manipulation.
              Do not duplicate functionality." Panels are dragged, resized and
              hidden on the board itself; a second way in was a menu entry that
              opened a panel to do what the page does.
            -->
            <button type="button" role="menuitem" data-bc-look="1">How this project looks</button>
            <button type="button" role="menuitem" data-bc-style="1">Document style</button>
            <button type="button" role="menuitem" data-bc-expand="team">The team</button>
            <button type="button" role="menuitem" data-bc-sources="1">Sources</button>
            <button type="button" role="menuitem" data-bc-go="${esc(at(`/p/${p.slug}/settings`))}">Project settings</button>
            <!--
              THE OFFICE'S OWN SETTINGS ARE NOT IN HERE ANY MORE.

              §14: "PROJECT SETTINGS affect only the current project. GLOBAL /
              APPLICATION SETTINGS affect the application/user generally.
              Global settings should have their own three-dot control in the
              TOP-RIGHT, OUTSIDE the project window/container." So they live in
              the shell's own row now, beside Attention, where nothing about
              them is inside a project. A menu that offers both scopes is a
              menu that makes you guess which one you are editing.
            -->
          </div>
        </span>
      </span>
    </div>
    <!--
      THERE IS NO LIVE CONVERSATION PANEL ANY MORE.

      Section 4 of the 23 September review, after Grant used it: pressing the
      microphone must not open a window, a panel, a modal, a drawer or a
      transcript surface, must not rearrange the project and must not navigate
      away, and the project screen should remain visually unchanged. What was
      here was a strip under the head carrying a status line, a mute button, an
      end button and the last six turns of the conversation, which is four of
      those seven at once.

      Every state it carried is now carried by the microphone itself, and the
      one thing that genuinely needs words on the page - a refusal, a dropped
      connection, the browser declining the microphone - already had somewhere
      to go: the callsay line above, which is hidden until there is something
      to say and is one line rather than a surface.

      WHAT WENT WITH IT: mute. It was a button on the panel and there is now no
      panel to put it on, and inventing a second control beside the microphone
      would be the surface this section forbids by another name. Ending is a
      second press. If Grant wants mute back the smallest honest form is a
      long press, and that is his call to make rather than mine to assume.
    -->
  </header>`
}


/*
  THERE IS NO "ELSEWHERE ON THIS PROJECT" MODULE.

  Grant, 22 September: *"Remove the Elsewhere on this project style module.
  Its purpose is redundant because Project Settings already exists within the
  three-dot project menu."* He is right, and the thing it was written to
  prevent - a tool becoming unreachable because this experience has no surface
  for it - is prevented properly now: the three-dot menu names the team,
  Sources and Project settings, and verify:basecamp-preservation asserts every
  section of the default studio is reachable from this page by SOME press.
  A second list of the same links was duplicate navigation, which is what he
  called it.
*/

/* ======================================================================== *
 * §14 — adding, removing and reordering the tools on the home
 *
 * WHERE THIS IS KEPT, AND WHY IT IS NOT THE OFFICE YET.
 *
 * Grant was explicit about arrangements, and 0250 quotes him: *"Layout is per
 * person, per dashboard project, and persists. Not `localStorage`: he uses
 * more than one device and the whole point of arranging it is that it stays
 * arranged."* He is right, and this does not yet obey him.
 *
 * `public.dashboard_layouts` is keyed `(owner, project_id)` - ONE arrangement
 * per project - and `web/studio/panels.js` already owns that row for the
 * default Team HQ's board. The two vocabularies only partly overlap and the
 * stored array IS the whole arrangement, so writing this one there would
 * silently remove panels from his real dashboard. `hq_dashboard_layout_set`
 * takes no owner, so there is no namespace to escape into either.
 *
 * So it is kept on this device, and the panel SAYS it is kept on this device,
 * with the reason. A limitation stated on screen is a different thing from a
 * limitation discovered on the second laptop. Issue #299 carries the one
 * change that fixes it, and when it lands `save` gains a call and this comment
 * loses four paragraphs.
 *
 * REMOVING A TOOL CANNOT REMOVE ANYTHING ELSE. The whole mechanism is a list
 * of module ids. There is no delete path here to reach, by construction rather
 * than by care - which is §14's actual requirement and the reason it is a list
 * of ids and not a list of records.
 */

/*
  THE ARRANGEMENT IS A SET OF RECTANGLES NOW, and it lives in layout.js.

  Grant: *"Do not substitute crude up/down controls for genuine spatial
  rearrangement."* Up and Down are gone with the list they ordered; what is
  left here is the one thing dragging cannot express - putting a module back
  after it has been taken off the page - plus the reset.
*/
export const NAMES = {
  tasks: 'To-dos',
  board: 'Card Table',
  documents: 'Docs & Files',
  schedule: 'Schedule',
  contacts: 'People',
  activity: 'Latest Activity',
}

export const arrangement = (slug) => grid.layout(slug).map((m) => m.id)
export const arrangeReset = (slug) => {
  grid.reset(slug)
}

/*
  THE WORKSPACE DOCK.

  Grant, 4 October: a subtle Auto Arrange / Tidy, a Reset View, a visible
  "- 100% +" zoom with a reset, and layouts. They live in ONE small pill at the
  corner of the stage rather than in a header row, because the stage is the
  thing that must keep the room. It sits OUTSIDE the scaled stage so it does not
  shrink when somebody zooms out.

  The Layouts popover (presets, saved layouts, modules that are off the page)
  is built on demand in wire.js: it is transient, and a transient thing in the
  markup is a thing every redraw has to remember to close.
*/
const dock = (p) => {
  const z = grid.zoomOf(p.slug)
  const ic = (d) =>
    `<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor"
      stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`
  return `<div class="bcdock" role="toolbar" aria-label="Workspace">
    <button type="button" class="bcdockbtn" data-bc-tidy title="Lightly tidy the arrangement">
      ${ic('<path d="M4 6h7M4 12h16M13 18h7"/>')}<span>Tidy</span>
    </button>
    <button type="button" class="bcdockbtn" data-bc-layouts aria-haspopup="true" aria-expanded="false" title="Layouts and presets">
      ${ic('<rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="4" rx="1"/><rect x="13" y="10" width="7" height="10" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/>')}<span>Layouts</span>
    </button>
    <button type="button" class="bcdockbtn" data-bc-viewreset title="Reset the view. Notes and everything in the modules are kept"${grid.customised(p.slug) ? '' : ' data-quiet="1"'}>
      ${ic('<path d="M4 12a8 8 0 1 0 3-6.2M4 4v5h5"/>')}<span>Reset view</span>
    </button>
    <button type="button" class="bcdockbtn" data-bc-fit title="Bring everything into view">
      ${ic('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>')}<span>Fit</span>
    </button>
    <span class="bczoom" role="group" aria-label="Zoom">
      <button type="button" class="bcdockbtn bcdockicon" data-bc-zoom="out" aria-label="Zoom out">&minus;</button>
      <button type="button" class="bcdockbtn bczoomval" data-bc-zoom="reset" aria-label="Reset zoom to 100%" title="Reset zoom">${String(Math.round(z * 100))}%</button>
      <button type="button" class="bcdockbtn bcdockicon" data-bc-zoom="in" aria-label="Zoom in">+</button>
    </span>
  </div>`
}

/*
  WHAT IS NOT ON THE PAGE, said on the page. A module taken off is a module the
  person must be able to find the way back to without opening a menu: the
  chips sit at the left of the dock's row, appear only when something is
  actually off, and each one says what it will do. The same list is repeated in
  the Layouts popover, which is where a person looks when they are arranging.
*/
const offChips = (p) => {
  const off = grid.off(p.slug)
  if (off.length === 0) return '<span class="bcoffrow" aria-hidden="true"></span>'
  return `<span class="bcoffrow" role="group" aria-label="Not on this page">
    <span class="bcofflabel">Not on this page</span>
    ${off
      .map(
        (id) => `<button type="button" class="bcdockbtn bcoffchip" data-bc-arr-on="${esc(id)}"
          aria-label="${esc(`Put ${NAMES[id] ?? id} back on this page`)}" title="Taking a module off only hides it. Nothing in it is deleted.">+ ${esc(NAMES[id] ?? id)}</button>`,
      )
      .join('')}
  </span>`
}

/** One Post-it: a rectangle, a grip, and a text area that saves as you type. */
export const note = (n) => `<div class="bcpostit" data-bc-note-id="${esc(n.id)}"
    style="left:${String(n.x)}px;top:${String(n.y)}px;width:${String(n.w)}px;height:${String(n.h)}px;z-index:${String(n.z ?? 1)}">
    <div class="bcpostitbar" data-bc-note-grip tabindex="0" role="group" aria-label="Note handle: Alt and the arrow keys move this note, Alt Shift and the arrow keys resize it" aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight Alt+ArrowUp Alt+ArrowDown">
      <button type="button" class="bcpostitplus" data-bc-note-add="${esc(n.id)}" aria-label="Add another note next to this one" title="Add another note">
        <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true" fill="none" stroke="currentColor"
          stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
      </button>
      <button type="button" class="bcpostitx" data-bc-note-del="${esc(n.id)}" aria-label="Remove this note" title="Remove this note">
        <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true" fill="none" stroke="currentColor"
          stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
      </button>
    </div>
    <textarea class="bcpostittext" data-bc-note-text="${esc(n.id)}" aria-label="Note" spellcheck="true" maxlength="${grid.NOTE_MAX}"
      placeholder="Click and type">${esc(n.text)}</textarea>
    <span class="bcpostitresize" data-bc-note-resize="${esc(n.id)}" aria-hidden="true"></span>
  </div>`

/* ======================================================================== *
 * A — the briefing
 * ======================================================================== */

export const compositionA = (p) => `<div class="bchome bccomp bccomp--a">
    ${head(p)}
    ${mod(p, { id: 'tasks', name: toolName('tasks', 'To-dos'), body: todosMini(p, { lists: 3, per: 4 }), wide: true })}
    <div class="bcpair">
      ${mod(p, { id: 'schedule', name: toolName('schedule', 'Schedule'), body: calendarMini(p, { items: 4 }) })}
      ${mod(p, { id: 'board', name: 'Where the work is', body: cardsMini(p) })}
    </div>
    ${mod(p, {
      id: 'team',
      name: 'The team',
      /*
        A composes presence and speech into ONE block, because a briefing
        reads better with the room and what was said in it together. B keeps
        them apart in the rail. That is a compositional difference rather than
        a cosmetic one, and it is one of the things the comparison decides.
      */
      body: `${crewMini(p, { people: 4 })}${chatMini(p, { lines: 3 })}`,
      wide: true,
    })}
    ${mod(p, { id: 'documents', name: toolName('documents', 'Documents'), body: docsMini(p, { items: 4 }), wide: true })}
    <div class="bcpair">
      ${mod(p, { id: 'contacts', name: toolName('contacts', 'People'), body: contactsMini(p, { items: 3 }) })}
      ${mod(p, { id: 'sources', name: 'Where the material comes from', body: sourcesMini(p, { items: 3 }) })}
    </div>
    ${mod(p, { id: 'activity', name: 'What has happened', body: timelineMini(p, { items: 6 }), wide: true })}
  </div>`

/* ======================================================================== *
 * B — the workspace
 * ======================================================================== */

export const compositionB = (p) => `<div class="bchome bccomp bccomp--b">
    ${head(p)}
    <div class="bcwork">
      <div class="bcworkmain">
        ${mod(p, { id: 'tasks', name: toolName('tasks', 'To-dos'), body: todosMini(p, { lists: 3, per: 4 }) })}
        ${mod(p, { id: 'board', name: 'Where the work is', body: cardsMini(p) })}
        ${mod(p, { id: 'schedule', name: toolName('schedule', 'Schedule'), body: calendarMini(p, { items: 5 }) })}
        ${mod(p, { id: 'documents', name: toolName('documents', 'Documents'), body: docsMini(p, { items: 4 }) })}
      </div>
      <aside class="bcrail" aria-label="Who is here and what has happened">
        ${mod(p, { id: 'team', slot: 'crew', name: 'The team', body: crewMini(p, { people: 5 }) })}
        ${mod(p, { id: 'team', slot: 'chat', name: 'Chat', body: chatMini(p, { lines: 3 }) })}
        ${mod(p, { id: 'contacts', name: toolName('contacts', 'People'), body: contactsMini(p, { items: 4 }) })}
        ${mod(p, { id: 'sources', slot: 'sources', name: 'Where the material comes from', body: sourcesMini(p, { items: 4 }) })}
        ${mod(p, { id: 'activity', name: toolName('activity', 'Activity'), body: timelineMini(p, { items: 5 }) })}
      </aside>
    </div>
  </div>`


/* ======================================================================== *
 * C — the board of tools
 *
 * Grant's correction after seeing B: the project home must carry a Docs and
 * Files pane, and all five of To-dos, Card Table, Docs and Files, Schedule and
 * Chat must be understandable from the first screen without clicking through
 * navigation cards. His own Basecamp screenshot does that with a three-column
 * grid of panes above a full-width activity feed.
 *
 * SO THE GRID COMES BACK, and my §20 analysis was wrong about which half was
 * the defect. I blamed the equal-weight composition; the real fault was that
 * every tile was the same `row(title, meta)` primitive with different words in
 * it. Basecamp uses an even grid too. A grid of REAL MINIATURES and a grid of
 * navigation cards look alike in a wireframe and are not the same product, and
 * saying so is cheaper than defending the earlier reading.
 *
 * What survives from B: the state line under the title, the faces in the head,
 * and the phone order. What goes: the companion rail, because a rail can hold
 * three panes and this composition needs eight.
 * ======================================================================== */

/*
  HOW MUCH EACH PANE SHOWS, and it is a composition decision rather than a
  preference.

  The first pass let every pane take the room its content wanted. A grid row is
  as tall as its tallest cell, so a four-tile Docs pane made row one 580px, row
  two began at 900 - exactly the fold - and Schedule, Chat and the team were
  all below it. Which is the thing Grant asked to be fixed: the five tools have
  to be understandable from the first screen.

  So each pane is given the amount that fits a ~320px row, and the reference is
  the measure: Basecamp's own panes are about that tall and show three or four
  items apiece. This is not shrinking things until they are illegible - the
  type sizes are untouched - it is showing fewer things at full size.
*/
const boardMods = (p) => [
  /*
    §21's "Mine / Team" rides in the HEADER, where it costs no height. As a
    block above the lists it added 36px to the tallest pane in row one, and a
    grid row is as tall as its tallest cell - so a one-line summary pushed
    Schedule and Chat below the fold, which is the requirement it was added to
    satisfy. A summary belongs beside the heading anyway.
  */
  { id: 'tasks', name: toolName('tasks', 'To-dos'), meta: mineAndTeam(p), body: todosMini(p, { lists: 4, per: 6 }) },
  { id: 'board', name: 'Card Table', meta: cardsCount(p), body: cardsMini(p) },
  { id: 'documents', slot: 'documents', name: toolName('documents', 'Docs & Files'), body: docsMini(p, { items: 9 }) },
  { id: 'schedule', name: toolName('schedule', 'Schedule'), body: calendarMini(p, { items: 8 }) },
  /*
    NO CHAT MODULE. Grant: *"It is completely superfluous when the sidebar
    already provides this functionality."* The sidebar is the typed team chat,
    the Chat with Team button opens it, and nothing on the home repeats it.

    NO SOURCES MODULE either - *"not useful enough to occupy dashboard space"* -
    and NO AGENTIC TEAM PANEL: *"The standalone Agentic Team panel on the
    project homepage is superfluous. Remove it. Configuration/management of
    the agentic team belongs in Settings."* Both are in the three-dot menu,
    which is what keeps them REACHABLE while off the board - the distinction
    the preservation check exists to hold.
  */
  { id: 'contacts', name: toolName('contacts', 'People'), body: contactsMini(p, { items: 8 }) },
  /*
    Latest Activity is a module like any other now, rather than a full-width
    band welded under the board. Grant asked not to redesign it and this does
    not: the same renderer, the same rows, placed rather than pinned.
  */
  { id: 'activity', name: 'Latest Activity', slot: 'activity', body: timelineMini(p, { items: 12 }) },
]

/*
  ITEM COUNTS ARE DELIBERATELY LARGER THAN THE PANE.

  Grant: *"Remove patterns such as One More being used merely because
  additional content does not fit. Modules containing more data than their
  visible area should instead become internally scrollable."* A renderer that
  is handed exactly what fits can only ever produce the summary line he is
  objecting to. So each miniature is handed MORE than a default-sized pane
  shows, the body scrolls, and making the pane taller reveals more without
  re-rendering anything.
*/

export const compositionC = (p) => {
  /*
    THE STAGE IS MEASURED IN THE PAGE. Markup is a string and cannot know how
    big its container is, so the first draw uses an estimate from the window and
    wire.js re-measures and repaints the rectangles in place before the browser
    has painted anything. Once it has measured, the real size is reused.
  */
  const view = grid.viewOf(p.slug)
  if (!grid.stageMeasured() && typeof innerWidth === 'number') {
    grid.setStage(innerWidth - 170, innerHeight - 330)
  }
  const st = grid.stageSize()
  const place = grid.layout(p.slug)
  const by = new Map(boardMods(p).map((m) => [m.id, m]))
  return `<div class="bchome bccomp bccomp--c">
    ${head(p, `<div class="bcworkbar">${offChips(p)}${dock(p)}</div>`)}
    <div class="bcworkspace">
    <div class="bcpanes" data-bc-board="${esc(p.slug)}" style="height:${String(st.h)}px;--bc-gx:${String(view.x)}px;--bc-gy:${String(view.y)}px;--bc-gz:${String(view.zoom)}">
      <div class="bcstage" style="width:${String(st.w)}px;height:${String(st.h)}px;transform:translate(${String(view.x)}px, ${String(view.y)}px) scale(${String(view.zoom)})">
        ${place
          .map((r) => {
            const m = by.get(r.id)
            return m === undefined ? '' : mod(p, { ...m, rect: r })
          })
          .join('')}
        ${grid
          .postits(p.slug)
          .map((n) => note(n))
          .join('')}
        <div class="bcguides" aria-hidden="true"></div>
        ${grid.postits(p.slug).length === 0 ? '<button type="button" class="bcdockbtn bcnoteempty" data-bc-newnote title="Pull out a note">+ Note</button>' : ''}
      </div>
    </div>
    </div>
  </div>`
}

export const COMPOSITIONS = { a: compositionA, b: compositionB, c: compositionC }
