import { projectIdOf } from './chat.js'
import { presented } from './office.js'
import * as visitor from './session.js'
/*
  The voice call, moved out of the page it is replacing.

  Issue #68, ADR-0019, and the last thing keeping `web/hq/index.html` alive: the
  studio's "Call the team" was a stub that said "Calling Claire…" and did
  nothing, so deleting the old page would have removed the capability rather
  than moved it — the failure ADR-0019 explicitly forbids.

  This is a FAITHFUL port. The WebRTC handling, the barge-in, the tool bridge
  and the hang-up are copied rather than rewritten, because every comment in
  here marks a bug that was found the hard way — the speaker element that was a
  `const` inside the connect block and made "stop talking" not work, the
  `response.cancel` that errors when nothing is running and surfaced to Grant as
  "something went wrong" every time he took a breath, and the CORS
  misconfiguration that left the call dead for weeks while every server-side
  probe passed (a `fetch` from a server sends no Origin).

  What changed since the port: the four element handles are queried from the
  studio's markup instead of by id, and then #101 and #102 changed the shape of
  the whole module, because they are the same bug seen from two ends.

  Every piece of call state used to live inside `wireCall`, which runs afresh
  every time the sheet is opened. So closing the sheet did not hang up — it
  threw away the only reference to a LIVE MICROPHONE. The tracks were never
  stopped, the browser kept recording, and the next press built a second
  closure with `stream = null` and asked for another one. No code path existed
  that could stop the first.

  So the state is module-level and there is exactly one call. The panel is a
  VIEW onto it, not the owner of it: opening the sheet attaches to whatever is
  already running, closing the sheet leaves it running, and the call survives
  navigation — which is what #101 asks for. `endCall()` is exported so anything
  can stop it, and `callIsLive()` so any button can show the truth.
*/

import { HQ_API as API, UNCONFIGURED, VOICE, VOICE_TOKEN as MINT } from './backend.js'
const KEY = 'hq.token'

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  )

/* -- the one call ---------------------------------------------------------- */

let pc = null
let stream = null
let channel = null
let onCall = false
// The element her voice comes out of. It used to be a `const` inside the
// connect block, which is the whole of the "stop talking doesn't work" bug —
// see `hangUp`.
let speaker = null
// Whether there is a response in flight to cancel. `response.cancel` with
// nothing running comes back as an error event, which would surface to Grant
// as "something went wrong on the call" every time he took a breath.
let answering = false

/*
  The generation guard, and the second half of #102.

  Connecting is five awaits long: mint a token, ask for the microphone, offer,
  exchange SDP, set the remote description. Pressing the button again during
  any of them used to run `hangUp` against state that had not been assigned
  yet — `stream` was still null, so nothing was stopped — and then the awaits
  carried on and assigned a live microphone to a call that had been hung up.
  A recording device with no UI and no owner.

  Every connect takes a ticket. After each await it checks whether it is still
  the current one, and a stale connect tears down what it has just built
  instead of publishing it.
*/
let gen = 0

// One session per visit. It groups the turns of a conversation in
// `origin_ref`, which is what conversation memory reads. Shared between the
// call and the typing box on purpose: they are one conversation.
let session = 's' + Math.random().toString(36).slice(2, 12)

/*
  The conversation outlives the panel.

  `render()` replaces the whole tree, and the sheet is rebuilt from scratch
  each time it opens. Keeping the turns only in the DOM meant that navigating
  away mid-call and back again showed an empty transcript of a call that was
  still running.
*/
const turns = []

/** The panel currently showing this call, or null when nobody is looking. */
let view = null

/** Stop a media stream properly. Anything less keeps the microphone open. */
const stopTracks = (s) => {
  if (!s) return
  for (const t of s.getTracks()) {
    try { t.stop() } catch (e) { /* already stopped */ }
  }
}

/*
  WHICH PROJECT A CALL IS ABOUT.

  Set by the surface before it starts one, because the surface is the only
  thing that knows what Grant is looking at. Held here rather than passed to
  `startCall` so that every caller - the rail, the project head, a keyboard
  shortcut - answers the question the same way instead of three of them
  forgetting to.
*/
let onProject = ''
export function callAbout(slug) {
  onProject = typeof slug === 'string' ? slug : ''
}
export function callProject() { return onProject }

/*
  MUTED, and it is the MICROPHONE TRACK that is muted rather than a flag.

  A mute that only stops the meter is a privacy defect wearing a control, and
  #102 is this repository's most expensive privacy lesson: disabling the track
  is what actually stops audio reaching the session.
*/
let muted = false
export function callMuted() { return muted }
export function setCallMuted(want) {
  const to = want === undefined ? !muted : want === true
  for (const t of stream?.getAudioTracks() ?? []) t.enabled = !to
  muted = to
  /* Nothing can be muted when there is no call, so the flag never survives one. */
  if (!onCall) muted = false
  return muted
}

/*
  WHAT IS HAPPENING RIGHT NOW, for a surface that wants to say it in words.

  Finer than `callPhase`, which answers idle/connecting/live and is all a
  button needs. A conversation surface needs to distinguish the team thinking
  from the team speaking from nobody speaking at all, because those are the
  three things a person is actually waiting on.
*/
export function callActivity() {
  if (!onCall) return 'idle'
  if (pc === null) return 'connecting'
  if (muted) return 'muted'
  return answering ? 'answering' : 'listening'
}

/** The turns of this call, newest first, for a surface that shows them. */
export function callTurns() { return turns.slice() }

/** True while a call is connected or connecting. */
export function callIsLive() { return onCall }

/*
  WHICH OF THE THREE STATES the call is in, for a surface that paints itself.

  `syncCallButtons` computes this and keeps it, so anything drawing its own
  control had to guess - and "connecting" is the state that matters most to
  guess right: it is several seconds long, it involves a permission prompt,
  and painting it as either of its neighbours is a status light that lies.
*/
export function callPhase() {
  if (!onCall) return 'idle'
  return pc === null ? 'connecting' : 'live'
}

/*
  Where the call's state is said.

  The panel, when it is open. And ALWAYS the call buttons themselves, because
  since #214 the ordinary way to place a call is to press the microphone in the
  rail and never open a panel at all - so if this only wrote into the panel, a
  call that refused to connect would be completely silent. The person would
  press Call the team, nothing would happen, and nothing anywhere would say why.
  That is the exact failure the modal was hiding.

  `data-callsay` is painted on any element that asks for it, and the button's
  own title and accessible name carry the sentence as a fallback that needs no
  markup at all.
*/
let lastSaid = ''

const say = (text) => {
  lastSaid = String(text ?? '')
  if (view?.state) view.state.textContent = lastSaid
  if (typeof document === 'undefined') return
  for (const el of document.querySelectorAll('[data-callsay]')) {
    el.textContent = lastSaid
    el.hidden = lastSaid === ''
  }
}

/** The last thing the call said about itself, for a surface drawn afterwards. */
export function callSays() { return lastSaid }

const show = (who, text, cls) => {
  turns.unshift({ who, text, cls: cls || '' })
  // Long calls should not grow without bound; the panel shows recent turns.
  if (turns.length > 200) turns.length = 200
  if (view?.turns) paint(view.turns)
}

const paint = (host) => {
  host.innerHTML = turns
    .map((t) => '<div class="turn ' + esc(t.cls) + '"><b>' + esc(t.who) +
      '</b><span>' + esc(t.text) + '</span></div>')
    .join('')
}

/*
  Every button that represents the call shows the same thing.

  There are two — the rail's and the sheet's — and after #101 the rail's has
  to keep saying "live" while he is somewhere else entirely. Painting them
  from one place is what stops the two disagreeing, which is the state where a
  person believes the microphone is off.
*/
export function syncCallButtons() {
  /*
    Three states, not two (#214).

    `onCall` goes true the instant the button is pressed and the peer connection
    is published several seconds later, after a microphone permission prompt and
    an SDP exchange. Painting those seconds as "on a call" is a status light
    that lies, and painting them as "not on a call" invites a second press that
    hangs up the connection being made. So connecting is its own state and says
    so.
  */
  const connecting = onCall && pc === null
  const live = onCall && pc !== null
  const label = live ? 'End the call'
    : connecting ? 'Connecting the call — press to cancel'
    : 'Call the team'
  for (const b of document.querySelectorAll('[data-call]')) {
    b.classList.toggle('ringing', live)
    b.classList.toggle('connecting', connecting)
    b.setAttribute('aria-pressed', String(onCall))
    b.setAttribute('aria-label', label)
    b.title = live ? 'End the call'
      : connecting ? 'Connecting. Press again to cancel.'
      : 'Start a voice call with the team'
    /*
      The words change too, where there are words. Colour alone is not a state:
      a green microphone and a blue microphone are the same microphone to anyone
      who cannot tell them apart, and section 32 asks for states to be
      distinguishable semantically, not only visually.
    */
    const lbl = b.querySelector('.lbl')
    if (lbl !== null) lbl.textContent = live ? 'End the call' : connecting ? 'Connecting…' : 'Call the team'
  }
}

/* -- stopping, and meaning it ---------------------------------------------- */

/*
  Stop, and mean it.

  Grant: *"also stop talking doesnt work"*.

  Closing the peer connection stops audio ARRIVING. It does nothing about the
  audio already handed to the `<audio>` element, which happily plays out its
  buffer — several seconds of Claire finishing her sentence after he pressed
  stop. And the element was a `const` scoped inside the connect block, so
  nothing outside it could have paused it even if it had thought to.

  So: cancel the response at the server, clear the audio the server has
  already sent (`output_audio_buffer.clear` is the WebRTC-specific event for
  exactly this), then tear down, then silence the element locally. In that
  order — the local pause is the backstop, not the mechanism, because a
  backstop alone leaves the server still generating.
*/
const emit = (event) => {
  try {
    if (channel?.readyState === 'open') channel.send(JSON.stringify(event))
  } catch (e) { /* the channel is going away anyway */ }
}

/*
  Throw away audio the server has already sent us.

  WebRTC-specific: `output_audio_buffer.clear` stops what is queued for
  playback. It does NOT stop the server generating — that is `response.cancel`,
  and the two are kept apart deliberately. See the note on `speech_started`
  below for what happens when they are not.
*/
const dropBufferedAudio = () => { emit({ type: 'output_audio_buffer.clear' }) }

const silence = () => {
  if (answering) emit({ type: 'response.cancel' })
  dropBufferedAudio()
  answering = false
}

export function endCall(why) {
  const wasLive = onCall
  onCall = false
  /* A mute belongs to a call and must not outlive one: the next call would
     open with the microphone off and nothing on screen saying why. */
  muted = false
  // Invalidate any connect still working its way through its awaits.
  gen += 1
  silence()
  try { channel?.close() } catch (e) { /* already gone */ }
  try { pc?.close() } catch (e) { /* already gone */ }
  stopTracks(stream)
  if (speaker !== null) {
    speaker.pause()
    speaker.srcObject = null
    speaker.src = ''
    speaker = null
  }
  pc = null; stream = null; channel = null
  /*
    A class, not the text.

    The old page's button WAS an emoji, so hanging up rewrote its content. The
    studio's is an SVG microphone, and setting textContent on it deletes the
    icon — the button would end the call and then disappear.
  */
  syncCallButtons()
  if (wasLive || why) {
    say(why || 'Call ended. Press the phone to call again.')
  }
}

/*
  A tab being closed is a hang-up.

  Without this, navigating away from the studio with a call running leaves the
  peer connection to time out on its own and — on some browsers, in a
  bfcache-restored page — the recording indicator lit. `pagehide` fires where
  `beforeunload` does not, notably on iOS.
*/
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => { endCall() })
}

/* -- talking to the office ------------------------------------------------- */

/*
  Looking something up, which is a different thing from asking for work.

  Grant: *"the voice doesn't seem to have access to any of the project data..
  this is critical … it should be the true voice of 'claire' fully aware of
  everything."*

  She had one tool and it delegated, so a question of fact came back as "I have
  put that to the team, the answer appears in Slack" — on a phone call, about
  something one select away. `/look` is a read of canonical state and returns
  in about a second, which is what makes it usable mid-sentence.
*/
/*
  A TOKEN THE OFFICE WILL NOT ACCEPT, said in words.

  Both calls below present the browser's bearer token, and with none - which is
  every browser on this hostname until somebody signs in, because storage is per
  origin - the office answers 401 `unauthorized`. That word then travelled all
  the way to Claire as a tool result and she said it out loud, which is what
  "Talk to Team returns unauthorized" was.

  The credential is cleared on the way past for the same reason `office.js` and
  `chat.js` clear it: a browser holding a token the office has refused will fail
  identically for ever, and the page can only offer a way back in once it knows
  it is signed out.
*/
const refused = (r) => {
  if (r.status !== 401) return null
  /* Both, because either could be what the office refused. */
  try { localStorage.removeItem(KEY); localStorage.removeItem('hq.session') } catch (e) { /* private window */ }
  return new Error('This browser is not signed in to the office. Sign in and try again.')
}

const lookUp = async (about) => {
  if (VOICE === '') throw new Error(UNCONFIGURED)
  const r = await fetch(VOICE + '/look', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + presented(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ about }),
  })
  const no = refused(r)
  if (no !== null) throw no
  const body = await r.json()
  if (!r.ok) throw new Error(body.error || ('The office returned ' + r.status))
  return body.found
}

const askOffice = async (said) => {
  if (VOICE === '') throw new Error(UNCONFIGURED)
  const r = await fetch(VOICE + '/turn', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + presented(),
      'Content-Type': 'application/json',
    },
    /*
      The project the call was opened on, stated the way the Chat states its
      own (#373): a call started on a project's page is about that project,
      so what it hands the team is filed there rather than under Unnamed.
    */
    body: JSON.stringify({ said, session, project: projectIdOf(onProject) }),
  })
  const no = refused(r)
  if (no !== null) throw no
  const body = await r.json()
  if (!r.ok) throw new Error(body.error || ('The office returned ' + r.status))
  return body
}

const send = async (said) => {
  say('Thinking…')
  try {
    const body = await askOffice(said)
    show('The team', body.speak, body.did === 'delegated' ? 'delegated' : '')
    say(body.did === 'delegated'
      ? 'Put to the team — the answer will be on the Team page, and in Slack or Telegram if you have connected them.'
      : 'Ask another.')
  } catch (e) {
    show('The team', 'I could not reach the office: ' + e.message, 'bad')
    say('Ask another.')
  }
}

/*
  A tool call from Claire.

  She says what she is doing before she calls it, so by the time this runs
  Grant has already heard "right, I will put that to Emma" — which is why the
  delay of a real office round trip is tolerable in a conversation. The result
  goes back as a function_call_output and she is asked to respond; without that
  second `response.create` she calls the tool and then says nothing, which
  sounds exactly like a crash.
*/
const runTool = async (callId, name, argsJson) => {
  let args = {}
  try { args = JSON.parse(argsJson) || {} } catch (e) { args = {} }

  let result
  if (name === 'look_up') {
    // Instant, and she keeps talking through it — so the status line says what
    // she is doing rather than the page going quiet.
    say('Looking that up…')
    try {
      result = { ok: true, found: await lookUp(String(args.about || '')) }
    } catch (e) {
      result = { ok: false, error: e.message }
    }
    say(onCall ? 'On a call with Claire.' : 'Ask another.')
  } else {
    const said = String(args.said || '')
    if (said !== '') show('Claire → the team', said, 'delegated')
    say('Claire is putting that to the team…')
    try {
      const body = await askOffice(said)
      result = { ok: true, did: body.did, answer: body.speak }
    } catch (e) {
      result = { ok: false, error: e.message }
    }
    say(onCall ? 'On a call with Claire.' : 'Ask another.')
  }

  channel?.send(JSON.stringify({
    type: 'conversation.item.create',
    item: { type: 'function_call_output', call_id: callId, output: JSON.stringify(result) },
  }))
  channel?.send(JSON.stringify({ type: 'response.create' }))
}

const onEvent = (ev) => {
  switch (ev.type) {
    // Both spellings. The GA API renamed these from `response.audio_*` to
    // `response.output_audio_*` and still emits the old ones on some
    // deployments; listening for one name is how a transcript silently stops
    // appearing after an upstream release.
    case 'response.audio_transcript.done':
    case 'response.output_audio_transcript.done':
      if (ev.transcript) show('Claire', ev.transcript)
      break
    case 'conversation.item.input_audio_transcription.completed':
      if (ev.transcript) show('You', ev.transcript)
      break
    case 'response.function_call_arguments.done':
      runTool(ev.call_id, ev.name, ev.arguments)
      break
    case 'response.created':
      answering = true
      break
    case 'response.done':
      answering = false
      break
    case 'input_audio_buffer.speech_started':
      /*
        Grant: *"its cutting out a lot when she talks"*.

        This used to call `silence()` — cancel the response and dump the audio
        — on every one of these events. Which sounds right and is badly wrong,
        because `speech_started` is the VAD's *suspicion* that someone has
        begun speaking, not a fact. On a call played through a speaker it fires
        on her own voice getting past echo cancellation, on a breath, on a
        chair. Every false positive chopped her off mid-word, which is exactly
        what he heard, and it was me who put it there an hour earlier.

        Deciding whether an interruption really happened is the server's job:
        it has both audio streams and `interrupt_response: true` says to act on
        it. So this now only reports what is happening, and the audio is
        dropped on `conversation.item.truncated` — the server saying it HAS cut
        her off, rather than a guess that it might.
      */
      say('Listening…')
      break
    case 'conversation.item.truncated':
      // She really was interrupted. Now the queued audio is stale, and playing
      // it out is the several-seconds-behind effect.
      dropBufferedAudio()
      answering = false
      break
    case 'input_audio_buffer.speech_stopped':
      say('On a call with Claire.')
      break
    case 'error':
      show('Claire', 'Something went wrong on the call: ' +
        (ev.error?.message || JSON.stringify(ev.error)), 'bad')
      break
  }
}

/* -- starting -------------------------------------------------------------- */

export async function startCall() {
  if (onCall) return
  /*
    A SAMPLE VISITOR DOES NOT PLACE CALLS. A call is a metered realtime session minted for a signed-in person, and the
    office refuses to mint one for a visitor. It is said here, before anything is asked, because the refusal below clears
    the stored session, which would sign the visitor out of the sample in the middle of looking around.
  */
  if (visitor.isSample()) {
    say('Calling the team needs your own office. Create one to try it for real.')
    return
  }
  onCall = true
  const mine = ++gen
  // True the moment this connect stops being the current one — because the
  // button was pressed again, or something else called `endCall`.
  const stale = () => mine !== gen
  syncCallButtons()
  say('Connecting…')

  // Anything this attempt built before it went stale, torn down here rather
  // than published. `stream` in particular: a microphone assigned to a call
  // nobody is on is the whole of #102.
  let mic = null
  let conn = null
  const abandon = () => {
    stopTracks(mic)
    try { conn?.close() } catch (e) { /* nothing to close */ }
  }

  try {
    /*
      THE PROJECT IN VIEW goes with the request. The office decides what to do
      with it - it looks the project up and tells Claire that "this project"
      means that one. Sent as a hint and nothing else: an adapter that narrowed
      the call to one project would be an adapter deciding, which §5 forbids.
    */
    /*
      AND NO OFFICE NAMED IS NOT A CALL THAT FAILED TO START.

      An empty MINT resolves against the page's own origin, so the browser asks
      Vercel to mint a realtime credential and the error a person sees is about
      a status code rather than about a deployment nobody configured. Same door
      as office.js and chat.js, closed the same way (ADR-0048).
    */
    if (MINT === '') throw new Error(UNCONFIGURED)
    // Minting needs a signed-in session (#400): the office will not hand a stranger a metered call.
    const minted = await fetch(MINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + presented() },
      body: JSON.stringify({ project: onProject }),
    })
    if (stale()) return abandon()
    if (minted.status === 401) {
      throw refused(minted)
    }
    if (!minted.ok) throw new Error('the office would not start a call (' + minted.status + ')')
    const { client_secret, model, degraded } = await minted.json()
    if (stale()) return abandon()
    if (degraded) show('Claire', 'I am on a stripped-down session and cannot reach the team ' +
      'on this call — worth telling whoever looks after this.', 'bad')

    /*
      SIGNED OUT IS WORTH SAYING BEFORE THE CALL, not after every tool fails.

      Minting a credential needs no office token, so a call CONNECTS perfectly
      well while signed out - and then everything Claire tries to look up or put
      to the team comes back unauthorized, which sounds like a broken assistant
      rather than a browser that is not signed in.
    */
    if (presented() === '') {
      show('Claire', 'This browser is not signed in to the office, so I cannot look ' +
        'anything up or put work to the team on this call. Sign in and call me back.', 'bad')
    }

    say('Asking for the microphone…')
    mic = await navigator.mediaDevices.getUserMedia({
      // Echo cancellation is what makes barge-in possible on a speaker. Asked
      // for explicitly so this is the browser doing its best rather than
      // whatever the default happens to be.
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    })
    // The window where the old code leaked a microphone: the user pressed stop
    // while this promise was in flight, so there was nothing to stop, and then
    // it resolved into a variable nobody would ever read again.
    if (stale()) return abandon()

    conn = new RTCPeerConnection()
    const out = new Audio()
    out.autoplay = true
    // `out`, not `speaker`: the track can arrive before this attempt has
    // published itself, and `speaker` is still whatever the last call left.
    conn.ontrack = (e) => { out.srcObject = e.streams[0] }
    conn.addTrack(mic.getTracks()[0])
    // A dropped connection must not leave the button saying "on a call".
    conn.onconnectionstatechange = () => {
      if (onCall && (conn?.connectionState === 'failed' || conn?.connectionState === 'disconnected')) {
        endCall('The call dropped. Press the phone to try again.')
      }
    }

    const ch = conn.createDataChannel('oai-events')
    ch.onmessage = (e) => { try { onEvent(JSON.parse(e.data)) } catch (err) { /* not ours */ } }

    const offer = await conn.createOffer()
    if (stale()) return abandon()
    await conn.setLocalDescription(offer)
    if (stale()) return abandon()

    // SDP exchange at /v1/realtime/calls. Anything citing
    // /v1/realtime/sessions for this is stale (§4).
    const sdp = await fetch('https://api.openai.com/v1/realtime/calls?model=' +
      encodeURIComponent(model), {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + client_secret, 'Content-Type': 'application/sdp' },
      body: offer.sdp,
    })
    if (stale()) return abandon()
    if (!sdp.ok) throw new Error('the call would not connect (' + sdp.status + ')')
    const answer = await sdp.text()
    if (stale()) return abandon()
    await conn.setRemoteDescription({ type: 'answer', sdp: answer })
    if (stale()) return abandon()

    // Published only now that it is real and still wanted.
    stream = mic
    pc = conn
    channel = ch
    speaker = out
    // Connecting -> live. Nothing else calls this on the happy path, so without
    // it the button would say "Connecting…" for the length of the call.
    syncCallButtons()
    say('On a call with Claire. Talk over her whenever you like.')
  } catch (e) {
    abandon()
    if (stale()) return
    const why = e.name === 'NotAllowedError'
      ? 'The microphone was refused. Allow it for this site, then press the phone again.'
      : String(e.message || e)
    endCall(why)
  }
}

export function toggleCall() {
  if (onCall) endCall()
  else void startCall()
}

/* -- the panel ------------------------------------------------------------- */

/*
  Attach a panel to the call that is already running, or to the one that is
  not. This is now the ONLY thing `wireCall` does — it holds no state, so
  opening the sheet twice cannot produce two calls, and closing it cannot
  strand one.
*/
export function wireCall(root) {
  const form = root.querySelector('[data-callform]')
  if (form === null) return
  view = {
    btn: root.querySelector('[data-call]'),
    box: root.querySelector('[data-calltext]'),
    state: root.querySelector('[data-callstate]'),
    turns: root.querySelector('[data-callturns]'),
  }

  if (view.turns) paint(view.turns)
  syncCallButtons()
  say(onCall
    ? 'On a call with Claire. Talk over her whenever you like.'
    : 'Press to call, or type below.')

  form.onsubmit = (e) => {
    e.preventDefault()
    const said = view.box.value.trim()
    if (said === '') return
    view.box.value = ''
    show('You', said)
    void send(said)
  }

  if (view.btn) view.btn.onclick = () => { toggleCall() }
}

/** The panel is going away. The call is not. */
export function unwireCall() { view = null }
