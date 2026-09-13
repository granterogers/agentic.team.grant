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
     audio to Google's servers to transcribe it. Safari's runs on the device.
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
  'Dictate a message. Your browser transcribes the audio — in Chrome that means Google hears it. Nothing is sent until you press Send.'

let session = null

/**
 * True while the microphone is open. A CHECK reads this rather than trusting
 * a comment that says the microphone was released — #196 asks for exactly that
 * and #102 is why.
 */
export const active = () => session !== null

/**
 * Start dictating into a textarea.
 *
 * `onchange` is called on every update so the caller can resize the box and
 * keep its draft in step; `onstop` is called once, whatever ended it — the
 * user pressing stop, the browser timing out, an error, or silence. There is
 * no path that leaves the microphone open and no path that leaves the button
 * looking live.
 */
export const start = (box, { onchange = () => {}, onstop = () => {} } = {}) => {
  if (Recognition === null || session !== null) return false

  const r = new Recognition()
  r.continuous = true
  r.interimResults = true
  r.lang = navigator.language || 'en-GB'

  /*
    The text that was already in the box is kept and dictation is appended to
    it. Somebody who typed half a sentence and then picked up their phone
    should not lose the half they typed.

    `settled` is what has been finalised; the interim words are painted after
    it on every event and replaced by the next one, so the box shows the
    sentence forming without ever double-writing a word.
  */
  const before = box.value === '' ? '' : `${box.value.replace(/\s+$/, '')} `
  let settled = ''

  r.addEventListener('result', (e) => {
    let interim = ''
    for (let i = e.resultIndex; i < e.results.length; i += 1) {
      const alt = e.results[i][0]
      if (alt === undefined) continue
      if (e.results[i].isFinal) settled += alt.transcript
      else interim += alt.transcript
    }
    box.value = `${before}${settled}${interim}`
    onchange(box.value)
  })

  /*
    Every ending goes through one place.

    `end` fires for all of them — stopped on purpose, stopped by the browser
    after a silence, stopped by an error — and the error handler below does not
    stop anything itself, it only records WHY, because doing both would run the
    teardown twice.
  */
  let reason = ''
  r.addEventListener('error', (e) => {
    reason =
      e.error === 'not-allowed' || e.error === 'service-not-allowed'
        ? 'The microphone was refused. Allow it for this site and try again.'
        : e.error === 'no-speech'
          ? 'Nothing was heard.'
          : e.error === 'network'
            ? 'Transcription needs the network and it could not be reached.'
            : ''
  })
  r.addEventListener('end', () => {
    session = null
    onstop(reason)
  })

  session = r
  try {
    r.start()
  } catch {
    // `start()` throws if it is already running, which the guard above makes
    // impossible — but a throw here must not leave `session` claiming the
    // microphone is open when it is not.
    session = null
    return false
  }
  return true
}

/**
 * Release the microphone. Safe to call when nothing is running, which is what
 * lets a caller wire it to a page teardown without asking first.
 *
 * `abort()` rather than `stop()`: `stop()` asks for one last result and can sit
 * holding the microphone while it waits. #102's defect was a microphone that
 * stayed open after being switched off, so this ends it now and the words
 * already in the box are the ones that were captured.
 */
export const stop = () => {
  const r = session
  if (r === null) return
  session = null
  try {
    r.abort()
  } catch {
    /* already gone */
  }
}
