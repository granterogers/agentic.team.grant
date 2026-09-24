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
import { callActivity, callMuted, callPhase } from '../call.js'

/**
 * WHAT THE MICROPHONE SHOULD BE SAYING, in one word and one sentence.
 *
 * This module used to draw a panel. Section 4 of the 23 September review
 * removed it: pressing the microphone must not open a window, a panel, a
 * modal, a drawer or a transcript surface, and the states belong on the icon.
 *
 * So what survives is the part that was always the useful half -- the mapping
 * from what the call is doing to words a person understands -- and the mapping
 * lives here rather than in the painter, because the painter is in `wire.js`
 * and the vocabulary is this module's whole subject. §5 still holds: nothing
 * here says session, token, WebRTC or realtime.
 *
 * `state` is what the call layer can actually distinguish. It does not report
 * Grant speaking, so nothing here claims to know it -- a status light that
 * lies about who is talking is worse than one that says "listening" and means
 * "your turn".
 */
export const state = () => {
  const phase = callPhase()
  if (phase === 'idle') return 'idle'
  if (phase === 'connecting') return 'connecting'
  if (callMuted()) return 'muted'
  return callActivity() === 'answering' ? 'answering' : 'listening'
}

/** The accessible name and tooltip for the microphone, per state. */
export const SAID = {
  idle: 'Talk to the team out loud',
  connecting: 'Connecting you — your browser will ask for the microphone. Press to cancel',
  listening: 'Listening — just talk. Press to end the call',
  answering: 'The team is talking — speak over them to change tack. Press to end the call',
  muted: 'Muted — they cannot hear you. Press to end the call',
}

/**
 * WHAT A FAILED CALL SAYS, in words a person can act on.
 *
 * call.js is the studio's and is shared, so it hands over whatever it has -
 * including a raw exception message. On a network failure that was "Failed to
 * fetch", under the microphone, as the whole explanation. It also says "press
 * the phone", which is the studio's control; here the control is a
 * microphone. This translates at this experience's edge and leaves call.js
 * alone. `tone` is 'problem' for anything that stopped a call Grant wanted,
 * 'ended' for an ordinary hang-up.
 */
export const plainly = (raw) => {
  const s = String(raw ?? '').trim()
  if (s === '') return { words: '', tone: '' }
  const mic = (t) => t.replace(/press the phone/gi, 'press the microphone')
  if (/^call ended/i.test(s)) return { words: 'Call ended.', tone: 'ended' }
  if (/microphone was refused/i.test(s)) return { words: mic(s), tone: 'problem' }
  if (/dropped/i.test(s)) return { words: mic(s), tone: 'problem' }
  if (/failed to fetch|networkerror|load failed|network|offline/i.test(s)) {
    return {
      words: "Couldn't reach the team's voice line. Check your connection, then press the microphone to try again.",
      tone: 'problem',
    }
  }
  if (/\b(401|403)\b|sign in|not signed/i.test(s)) {
    return { words: 'Talking live needs you signed in. Sign in, then press the microphone again.', tone: 'problem' }
  }
  if (/would not connect|\b5\d\d\b/i.test(s)) {
    return { words: "The voice line didn't connect. Press the microphone to try again.", tone: 'problem' }
  }
  /* A sentence call.js composed for a person passes through; anything that
     does not read as one is replaced rather than shown raw. */
  if (/[.!?]$/.test(s) && /\s/.test(s)) return { words: mic(s), tone: 'problem' }
  return { words: "The call couldn't start. Press the microphone to try again.", tone: 'problem' }
}
