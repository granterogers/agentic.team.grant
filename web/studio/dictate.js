/*
  Speaking a message, rather than placing a call (#196).

  The office already has voice and it is a CONVERSATION: "Call the team" opens
  a live call answered in about two seconds. This is the other thing, and #196
  exists because they are not the same act. Grant thinks out loud, often into a
  voice note, often while three other things are in flight:

    "The user should be able to voice ideas throughout the day, provide them to
     the development agent, and trust that they have been captured, organized
     and preserved without automatically destabilizing the current build."

  A call cannot do that. A call is answered immediately; an idea voiced at 07:40
  needs to be CAPTURED. So this produces TEXT into the composer, which he reads,
  edits and sends when he means to. Nothing here sends anything.

  Three decisions #196 left open, made here and recorded so they are not
  re-litigated:

  1. WHERE THE TRANSCRIPTION HAPPENS — the browser's own `SpeechRecognition`.
     The alternative is uploading audio to a transcription service, which is
     better and costs money, and this project is ~£0/month. The cost of the
     free choice is honest and stated in the UI: Chrome's implementation sends
     audio to Google's servers to transcribe it. Safari's is Apple's speech service; whether it stays on the device
     depends on the language and system settings the page cannot see, so the notice does not promise it.
     Neither is our server, so a person deserves to be told before they press
     it, which is why the button carries that sentence in its title and the
     panel says it in words.

  2. ONE MESSAGE OR SEVERAL — one. 0089 is the precedent and it points hard
     this way: six Telegram messages in forty-three seconds became six jobs and
     six unrelated answers, and the fix was to treat them as one conversation.
     A dictation is one continuous thought; it becomes one message.

  3. ADDRESSING BY VOICE — no. Saying "Emma, look at this" leaves the words
     "Emma, look at this" in the composer and the addressee is still chosen
     with #26's control. Parsing a name out of speech would be an adapter
     deciding, which §5 forbids, and it would do it on the least reliable input
     in the product.

  The privacy obligation is #102's, which was the one privacy defect in Grant's
  UX review: turning voice off did not stop the microphone. So `stop()` here
  really releases it, `active()` can be read by a check rather than believed,
  and nothing holds the microphone open between messages.
*/

/*
  Chrome and Edge expose it prefixed; Safari 14.1+ exposes it prefixed too.
  Firefox does not expose it at all, which is why the honest-degradation branch
  is not hypothetical.
*/
const Recognition =
  typeof window === 'undefined'
    ? null
    : (window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null)

export const supported = () => Recognition !== null

/*
  Why the browser cannot do it, in words a person can act on — #196 asks for
  "absent or disabled with a reason, never present and silently dead".

  A secure context is the second real cause and it is easy to hit: the API is
  refused outright over plain http, which is exactly how somebody testing the
  page on a phone against a laptop's IP address would meet it.
*/
export const why = () => {
  if (typeof window === 'undefined') return 'This browser cannot transcribe speech.'
  if (!window.isSecureContext) {
    return 'Dictation needs a secure connection. Open the studio over https.'
  }
  if (Recognition === null) {
    return 'This browser cannot transcribe speech. Chrome, Edge and Safari can.'
  }
  return ''
}

// What the button's title says before you press it. Named, not implied (#196).
export const disclosure = () =>
  'Dictate a message. Your browser transcribes the audio — in Chrome that means Google hears it, in Safari Apple’s speech service does. Nothing is sent to the team until you press Send.'

/*
  The same fact where a phone can see it. A title attribute is never shown on a touch screen, so the dock also says it in
  the status line while the microphone is open.
*/
export const listeningNotice = () =>
  'Listening… your browser transcribes the audio (Google in Chrome, Apple in Safari).'

/*
  The logic lives in dictation.js, a state machine with the recogniser injected so it can be tested without a
  microphone (8 October 2026). This file keeps the page-facing API the Chat page and the Team Chat dock both use.
*/
import { createDictation } from './dictation.js'

const machine = createDictation({
  Recognition,
  lang: typeof navigator === 'undefined' ? 'en-GB' : navigator.language || 'en-GB',
})

/**
 * True while the microphone is open. A CHECK reads this rather than trusting
 * a comment that says the microphone was released - #196 asks for exactly that
 * and #102 is why.
 */
export const active = () => machine.active()
export const state = () => machine.state()

/**
 * Start dictating into a textarea. `onchange(value, { settled, interim })` on every update, `onstate(state, reason)` on
 * every transition, `onstop(reason)` once, whatever ended it. No path leaves the microphone open or the button live.
 */
export const start = (box, hooks = {}) => machine.start(box, hooks)

/** Release the microphone now. Safe to call when nothing is running, so a page teardown can call it unasked. */
export const stop = () => machine.stop()

/** The composer was redrawn while dictating: keep writing into the new textarea. */
export const retarget = (box) => machine.retarget(box)
