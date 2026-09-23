/*
  TALKING TO THE TEAM — the other microphone, and deliberately not the one in
  the chat.

  Grant, 23 September:

    "The prominent microphone at the top of the project interface is for: TALK
     LIVE TO MY TEAM... press prominent microphone, enter/open live voice mode,
     microphone becomes live, Grant speaks naturally, AI hears him, AI responds
     naturally by voice, Grant hears response, Grant can continue talking,
     conversation flows... It should feel like TALKING WITH THE TEAM, not
     exchanging audio attachments."

  ## What this module is

  A panel, and only a panel. Every piece of the call itself - the ephemeral
  credential, the microphone, the peer connection, the SDP exchange, the
  remote audio, the transcripts, the interruption handling - is
  `web/studio/call.js`, which the default Team HQ has used since #214 and which
  already handles the hard parts properly: the server decides what counts as an
  interruption, and buffered audio is dropped only when it says it has really
  cut her off. Rebuilding any of that here would be the third conversational
  system Grant's brief forbids.

  So this draws what is happening and offers the two controls a conversation
  needs, and asks `call.js` for everything else.

  ## The words on it

  §5 of the brief: *"Avoid developer terminology. Do not expose SDP, peer
  connection, realtime event names, token terminology."* Nothing here says
  session, token, WebRTC or realtime. It says connecting, listening, thinking,
  speaking, muted and ended, because those are the six things a person waiting
  on a conversation actually needs to know.
*/
import { esc } from './parts.js'
import {
  callActivity,
  callMuted,
  callPhase,
  callSays,
  callTurns,
  endCall,
  setCallMuted,
} from '../call.js'

/*
  WHAT IS HAPPENING, in a sentence and a word.

  The word drives the dot; the sentence is what somebody reads. They come from
  one place so they can never disagree - a status light that says one thing
  while the line beneath it says another is worse than either alone.
*/
const SAYS = {
  connecting: {
    dot: 'connecting',
    line: 'Connecting you…',
    under: 'Your browser will ask for the microphone.',
  },
  listening: {
    dot: 'listening',
    line: 'Listening',
    under: 'Just talk. Interrupt whenever you like.',
  },
  answering: {
    dot: 'answering',
    line: 'The team is talking',
    under: 'Speak over them if you want to change tack.',
  },
  muted: {
    dot: 'muted',
    line: 'Muted',
    under: 'They cannot hear you until you unmute.',
  },
  idle: { dot: 'idle', line: 'Not on a call', under: '' },
}

/**
 * The panel, as a string, or '' when there is no call to draw.
 *
 * Drawn only while a call is up, because a conversation surface with no
 * conversation on it is furniture. The one exception is a call that has just
 * failed: the sentence saying why outlives the call by design, and is drawn by
 * the head's own line rather than here.
 */
export const panel = (project) => {
  const phase = callPhase()
  if (phase === 'idle') return ''
  const activity = callActivity()
  const mood = SAYS[activity] ?? SAYS.idle
  const said = callSays()
  const turns = callTurns().slice(0, 6)
  return `<section class="bclive" data-bc-live="${esc(activity)}" aria-live="polite">
    <div class="bcliverow">
      <span class="bclivedot" data-dot="${esc(mood.dot)}" aria-hidden="true"></span>
      <div class="bclivewhat">
        <strong class="bcliveline">${esc(mood.line)}</strong>
        <span class="bcliveunder">${esc(mood.under)}</span>
      </div>
      <div class="bcliveacts">
        <button type="button" class="bcbtn" data-bc-livemute
          aria-pressed="${callMuted() ? 'true' : 'false'}">
          ${callMuted() ? 'Unmute' : 'Mute'}
        </button>
        <button type="button" class="bcbtn bcbtn--danger" data-bc-liveend>End</button>
      </div>
    </div>
    ${
      project === '' || project === undefined
        ? ''
        : `<p class="bclivewhere">About ${esc(project)}. Say another project's name to
            move to it.</p>`
    }
    ${
      said === '' || phase !== 'connecting'
        ? ''
        : `<p class="bclivesaid">${esc(said)}</p>`
    }
    <!--
      WHO IS SPEAKING, which is the one place in this product where a name and
      a face belong. Grant's rule is that the roster, presence and workload
      stay out of the interface; inside a conversation, knowing who said a
      thing is the whole point.
    -->
    ${
      turns.length === 0
        ? `<p class="bclivehint">What is late? What needs me? What is happening with the
            newsletter? Ask it the way you would ask a person.</p>`
        : `<ol class="bcliveturns">${turns
            .map(
              (t) => `<li class="bcliveturn${t.who === 'You' ? ' bcliveturn--mine' : ''}">
                <span class="bcliveturnwho">${esc(t.who)}</span>
                <span class="bcliveturntext">${esc(t.text)}</span>
              </li>`,
            )
            .join('')}</ol>`
    }
  </section>`
}

/**
 * Wire the panel's two controls.
 *
 * Delegated on a container that is not replaced, because the panel redraws
 * itself several times a call - the trap that made the voice note's Stop
 * button inert on its first run.
 */
export const wire = (root, { redraw }) => {
  for (const host of root.querySelectorAll('[data-bc-livehost]')) {
    host.addEventListener('click', (e) => {
      const pressed = e.target?.closest?.('[data-bc-livemute], [data-bc-liveend]')
      if (pressed === null || pressed === undefined) return
      e.preventDefault()
      if (pressed.hasAttribute('data-bc-liveend')) {
        endCall('')
        redraw()
        return
      }
      setCallMuted()
      redraw()
    })
  }
}
