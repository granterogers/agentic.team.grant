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

  What changed: the four element handles are queried from the studio's markup
  instead of by id, and the three module-level values it used to close over are
  declared here.
*/

const API =
  window.HQ_API || 'https://baujwlzcziasnfhhkchg.supabase.co/functions/v1/hq-api'
const KEY = 'hq.token'
const MINT = API.replace(/\/hq-api$/, '/voice-token')

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  )

export function wireCall(root) {
  const form = root.querySelector('[data-callform]')
  if (form === null) return
  const callBtn = root.querySelector('[data-call]')
  const box = root.querySelector('[data-calltext]')
  const state = root.querySelector('[data-callstate]')
  const turns = root.querySelector('[data-callturns]')
  // One session per visit to this view. It groups the turns of a conversation
  // in `origin_ref`, which is what conversation memory reads. Shared between
  // the call and the typing box on purpose: they are one conversation.
  const session = 's' + Math.random().toString(36).slice(2, 12)

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

  const show = (who, text, cls) => {
    const el = document.createElement('div')
    el.className = 'turn ' + (cls || '')
    el.innerHTML = `<b>${esc(who)}</b><span>${esc(text)}</span>`
    turns.prepend(el)
    return el
  }

  /*
    One turn through the office.

    The same call the typing box makes and the same call Claire's tool makes,
    because they are the same thing: something was said, and the office
    answers or takes it on. Two implementations would drift, and the one that
    drifted would be the voice one, which is the one nobody reads the logs of.
  */
  const VOICE = API.replace(/\/hq-api$/, '/voice')

  /*
    Looking something up, which is a different thing from asking for work.

    Grant: *"the voice doesn't seem to have access to any of the project
    data.. this is critical … it should be the true voice of 'claire' fully
    aware of everything."*

    She had one tool and it delegated, so a question of fact came back as "I
    have put that to the team, the answer appears in Slack" — on a phone call,
    about something one select away. `/look` is a read of canonical state and
    returns in about a second, which is what makes it usable mid-sentence.
  */
  const lookUp = async (about) => {
    const r = await fetch(VOICE + '/look', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + (localStorage.getItem(KEY) || ''),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ about }),
    })
    const body = await r.json()
    if (!r.ok) throw new Error(body.error || ('The office returned ' + r.status))
    return body.found
  }

  const askOffice = async (said) => {
    const r = await fetch(VOICE + '/turn', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + (localStorage.getItem(KEY) || ''),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ said, session }),
    })
    const body = await r.json()
    if (!r.ok) throw new Error(body.error || ('The office returned ' + r.status))
    return body
  }

  // --- typing ---------------------------------------------------------------

  const send = async (said) => {
    state.textContent = 'Thinking…'
    try {
      const body = await askOffice(said)
      show('The team', body.speak, body.did === 'delegated' ? 'delegated' : '')
      state.textContent =
        body.did === 'delegated'
          ? 'Put to the team — the answer comes back in Slack and Telegram.'
          : 'Ask another.'
    } catch (e) {
      show('The team', 'I could not reach the office: ' + e.message, 'bad')
      state.textContent = 'Ask another.'
    }
  }

  form.onsubmit = (e) => {
    e.preventDefault()
    const said = box.value.trim()
    if (said === '') return
    box.value = ''
    show('You', said)
    send(said)
  }

  // --- the call -------------------------------------------------------------

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
    playback. It does NOT stop the server generating — that is
    `response.cancel`, and the two are kept apart deliberately. See the note on
    `speech_started` below for what happens when they are not.
  */
  const dropBufferedAudio = () => { emit({ type: 'output_audio_buffer.clear' }) }

  const silence = () => {
    if (answering) emit({ type: 'response.cancel' })
    dropBufferedAudio()
    answering = false
  }

  const hangUp = (why) => {
    onCall = false
    silence()
    try { channel?.close() } catch (e) { /* already gone */ }
    try { pc?.close() } catch (e) { /* already gone */ }
    stream?.getTracks().forEach((t) => t.stop())
    if (speaker !== null) {
      speaker.pause()
      speaker.srcObject = null
      speaker = null
    }
    pc = null; stream = null; channel = null
    /*
      A class, not the text.

      The old page's button WAS an emoji, so hanging up rewrote its content.
      The studio's is an SVG microphone, and setting textContent on it deletes
      the icon — the button would end the call and then disappear.
    */
    callBtn.classList.remove('ringing')
    callBtn.setAttribute('aria-label', 'Call Claire')
    callBtn.title = 'Start a voice call with Claire'
    state.textContent = why || 'Call ended. Press the phone to call again.'
  }

  /*
    A tool call from Claire.

    She says what she is doing before she calls it, so by the time this runs
    Grant has already heard "right, I will put that to Emma" — which is why
    the delay of a real office round trip is tolerable in a conversation. The
    result goes back as a function_call_output and she is asked to respond;
    without that second `response.create` she calls the tool and then says
    nothing, which sounds exactly like a crash.
  */
  const runTool = async (callId, name, argsJson) => {
    let args = {}
    try { args = JSON.parse(argsJson) || {} } catch (e) { args = {} }

    let result
    if (name === 'look_up') {
      // Instant, and she keeps talking through it — so the status line says
      // what she is doing rather than the page going quiet.
      state.textContent = 'Looking that up…'
      try {
        result = { ok: true, found: await lookUp(String(args.about || '')) }
      } catch (e) {
        result = { ok: false, error: e.message }
      }
      state.textContent = onCall ? 'On a call with Claire.' : 'Ask another.'
    } else {
      const said = String(args.said || '')
      if (said !== '') show('Claire → the team', said, 'delegated')
      state.textContent = 'Claire is putting that to the team…'
      try {
        const body = await askOffice(said)
        result = { ok: true, did: body.did, answer: body.speak }
      } catch (e) {
        result = { ok: false, error: e.message }
      }
      state.textContent = onCall ? 'On a call with Claire.' : 'Ask another.'
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
      // deployments; listening for one name is how a transcript silently
      // stops appearing after an upstream release.
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

          This used to call `silence()` — cancel the response and dump the
          audio — on every one of these events. Which sounds right and is
          badly wrong, because `speech_started` is the VAD's *suspicion* that
          someone has begun speaking, not a fact. On a call played through a
          speaker it fires on her own voice getting past echo cancellation, on
          a breath, on a chair. Every false positive chopped her off
          mid-word, which is exactly what he heard, and it was me who put it
          there an hour earlier.

          Deciding whether an interruption really happened is the server's
          job: it has both audio streams and `interrupt_response: true` says
          to act on it. So this now only reports what is happening, and the
          audio is dropped on `conversation.item.truncated` — the server
          saying it HAS cut her off, rather than a guess that it might.
        */
        state.textContent = 'Listening…'
        break
      case 'conversation.item.truncated':
        // She really was interrupted. Now the queued audio is stale, and
        // playing it out is the several-seconds-behind effect.
        dropBufferedAudio()
        answering = false
        break
      case 'input_audio_buffer.speech_stopped':
        state.textContent = 'On a call with Claire.'
        break
      case 'error':
        show('Claire', 'Something went wrong on the call: ' +
          (ev.error?.message || JSON.stringify(ev.error)), 'bad')
        break
    }
  }

  callBtn.onclick = async () => {
    if (onCall) { hangUp(); return }
    onCall = true
    callBtn.classList.add('ringing')
    callBtn.setAttribute('aria-label', 'End the call')
    callBtn.title = 'End the call'
    state.textContent = 'Connecting…'

    try {
      const minted = await fetch(MINT, { method: 'POST' })
      if (!minted.ok) throw new Error('the office would not start a call (' + minted.status + ')')
      const { client_secret, model, degraded } = await minted.json()
      if (degraded) show('Claire', 'I am on a stripped-down session and cannot reach the team ' +
        'on this call — worth telling whoever looks after this.', 'bad')

      state.textContent = 'Asking for the microphone…'
      stream = await navigator.mediaDevices.getUserMedia({
        // Echo cancellation is what makes barge-in possible on a speaker.
        // Asked for explicitly so this is the browser doing its best rather
        // than whatever the default happens to be.
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })

      pc = new RTCPeerConnection()
      speaker = new Audio()
      speaker.autoplay = true
      pc.ontrack = (e) => { if (speaker !== null) speaker.srcObject = e.streams[0] }
      pc.addTrack(stream.getTracks()[0])
      // A dropped connection must not leave the button saying "on a call".
      pc.onconnectionstatechange = () => {
        if (onCall && (pc?.connectionState === 'failed' || pc?.connectionState === 'disconnected')) {
          hangUp('The call dropped. Press the phone to try again.')
        }
      }

      channel = pc.createDataChannel('oai-events')
      channel.onmessage = (e) => { try { onEvent(JSON.parse(e.data)) } catch (err) { /* not ours */ } }

      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)

      // SDP exchange at /v1/realtime/calls. Anything citing
      // /v1/realtime/sessions for this is stale (§4).
      const sdp = await fetch('https://api.openai.com/v1/realtime/calls?model=' +
        encodeURIComponent(model), {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + client_secret, 'Content-Type': 'application/sdp' },
        body: offer.sdp,
      })
      if (!sdp.ok) throw new Error('the call would not connect (' + sdp.status + ')')
      await pc.setRemoteDescription({ type: 'answer', sdp: await sdp.text() })

      state.textContent = 'On a call with Claire. Talk over her whenever you like.'
    } catch (e) {
      const why = e.name === 'NotAllowedError'
        ? 'The microphone was refused. Allow it for this site, then press the phone again.'
        : String(e.message || e)
      hangUp(why)
    }
  }
}
