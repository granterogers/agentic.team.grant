/*
  A VOICE NOTE — the thing you send, not the call you place.

  Grant, 23 September, drawing the line himself:

    "This microphone exists INSIDE THE NORMAL TEAM CHAT. Its purpose is
     equivalent to sending a voice message in a messaging application. It is
     NOT a live OpenAI Realtime conversation... This feature should feel like
     TELEGRAM / WHATSAPP STYLE VOICE MESSAGE, not like entering a telephone
     call."

  So: press, record, watch it record, stop, send or throw away. The words reach
  the team by the route a typed message takes, and the recording stays playable.

  ## What this module is and is not responsible for

  It records and it measures. It does NOT transcribe (the office does, at
  `/note`), it does NOT send (the page does, through the same `chat.send` and
  `chat.ask` that a typed message uses, which is the whole of Grant's "do not
  create a separate voice note conversation"), and it does not draw anything.

  ## Why it measures the sound

  Because the speech service cannot tell silence from speech. Three seconds of
  digital silence posted to it comes back as **"Thank you."** — a well-known
  hallucination, `no_speech_prob` 0, indistinguishable in the response from a
  real short sentence. Measured against real speech from the same run, the
  probability was identical, so there is nothing in the answer to key on.

  The one place that knows whether there was any sound is the browser, because
  the sound was there. An `AnalyserNode` on the live stream gives the peak, and
  a recording whose peak never rose above the floor is refused HERE, with a
  sentence, rather than being sent and coming back as words Grant never said.
  That is the same rule the rest of this product follows: you may say you could
  not hear; you may not invent what was said.

  The meter this produces is also the honest recording indicator — it moves
  because the microphone is hearing something, rather than because a timer is
  running.

  ## The microphone is released, always

  #102 was the one privacy defect in Grant's UX review: turning voice off did
  not stop the microphone. Every exit from here — stop, cancel, an error, the
  page navigating, the tab hiding — goes through `release()`, and `active()`
  can be READ by a check rather than believed.
*/

/** How loud, on a 0..1 scale, a recording must get to be worth sending. */
const HEARD_FLOOR = 0.035

/** Longest note. Past this it stops itself and keeps what it has. */
const MAX_SECONDS = 300

const state = {
  stream: null,
  recorder: null,
  context: null,
  analyser: null,
  chunks: [],
  startedAt: 0,
  peak: 0,
  level: 0,
  raf: 0,
  stopping: null,
}

/** Whether a microphone is open right now. Read by the page and by checks. */
export const active = () => state.stream !== null

/** How long the recording has been running, in whole seconds. */
export const seconds = () =>
  state.startedAt === 0 ? 0 : Math.floor((Date.now() - state.startedAt) / 1000)

/** The current sound level, 0..1, for the meter. */
export const level = () => state.level

/** The loudest this recording has been, 0..1. */
export const peak = () => state.peak

/**
 * What this browser can record, or '' when it cannot record at all.
 *
 * Safari produces `audio/mp4` and Chrome `audio/webm`; both are on the speech
 * service's accepted list, and the endpoint takes the extension from the type
 * rather than assuming one. Asked in order of preference and answered by the
 * browser rather than by sniffing its user agent.
 */
export const kind = () => {
  if (typeof MediaRecorder === 'undefined') return ''
  for (const t of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg']) {
    if (MediaRecorder.isTypeSupported(t)) return t
  }
  return ''
}

/** Whether this browser can do any of it. */
export const supported = () =>
  typeof navigator !== 'undefined' &&
  navigator.mediaDevices !== undefined &&
  typeof navigator.mediaDevices.getUserMedia === 'function' &&
  kind() !== ''

/**
 * Let go of everything.
 *
 * Safe to call at any time, including twice, including when nothing is open —
 * which matters because it is called from the failure paths as well as the
 * ordinary ones.
 */
export const release = () => {
  if (state.raf !== 0) {
    cancelAnimationFrame(state.raf)
    state.raf = 0
  }
  try {
    if (state.recorder !== null && state.recorder.state !== 'inactive') state.recorder.stop()
  } catch {
    /* already stopped */
  }
  for (const track of state.stream?.getTracks() ?? []) {
    try {
      track.stop()
    } catch {
      /* already stopped */
    }
  }
  try {
    void state.context?.close()
  } catch {
    /* already closed */
  }
  state.stream = null
  state.recorder = null
  state.context = null
  state.analyser = null
  state.startedAt = 0
  state.level = 0
  state.raf = 0
}

/**
 * Start recording.
 *
 * `onTick` is called about ten times a second with `{ seconds, level }` so the
 * page can draw the meter and the duration without polling.
 *
 * Throws with a sentence a person can act on. A refused permission and an
 * absent microphone are different things and are told apart, because "allow
 * the microphone" is useless advice to somebody who has not got one.
 */
export async function start(onTick) {
  if (active()) throw new Error('Already recording.')
  if (!supported()) {
    throw new Error('This browser cannot record audio. You can still type, or use the phone app.')
  }
  let stream
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    })
  } catch (e) {
    const name = e instanceof DOMException ? e.name : ''
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      throw new Error('The microphone is blocked for this site. Allow it and try again.')
    }
    if (name === 'NotFoundError' || name === 'OverconstrainedError') {
      throw new Error('No microphone was found.')
    }
    throw new Error('The microphone could not be opened.')
  }

  state.stream = stream
  state.chunks = []
  state.peak = 0
  state.level = 0
  state.startedAt = Date.now()

  const Ctx = window.AudioContext ?? window.webkitAudioContext
  if (Ctx !== undefined) {
    /*
      iOS suspends a context created outside a gesture. This is created inside
      the press that started the recording, and resumed as well, because Safari
      will hand back a suspended one even then.
    */
    state.context = new Ctx()
    if (state.context.state === 'suspended') await state.context.resume().catch(() => undefined)
    const source = state.context.createMediaStreamSource(stream)
    state.analyser = state.context.createAnalyser()
    state.analyser.fftSize = 1024
    source.connect(state.analyser)
  }

  const buf = state.analyser === null ? null : new Uint8Array(state.analyser.fftSize)
  const watch = () => {
    if (state.stream === null) return
    if (state.analyser !== null && buf !== null) {
      state.analyser.getByteTimeDomainData(buf)
      let loudest = 0
      for (const v of buf) {
        const away = Math.abs(v - 128) / 128
        if (away > loudest) loudest = away
      }
      state.level = loudest
      if (loudest > state.peak) state.peak = loudest
    }
    if (seconds() >= MAX_SECONDS) {
      void stop()
      return
    }
    onTick?.({ seconds: seconds(), level: state.level })
    state.raf = requestAnimationFrame(watch)
  }
  state.raf = requestAnimationFrame(watch)

  const recorder = new MediaRecorder(stream, { mimeType: kind() })
  state.recorder = recorder
  recorder.addEventListener('dataavailable', (e) => {
    if (e.data !== undefined && e.data.size > 0) state.chunks.push(e.data)
  })
  recorder.start(250)
  return true
}

/**
 * Stop, and hand back what was recorded.
 *
 * `{ blob, type, seconds, peak, heard }` — `heard` is false when the recording
 * never rose above the floor, and the caller must not send one of those.
 */
export async function stop() {
  if (state.recorder === null) throw new Error('Nothing is being recorded.')
  const recorder = state.recorder
  const took = seconds()
  const loudest = state.peak
  /*
    `stop()` is asynchronous and the last chunk arrives AFTER it: waiting for
    the recorder's own `stop` event is the only way to have the whole
    recording. A promise per stop, kept on the module, so two presses cannot
    produce two halves.
  */
  state.stopping ??= new Promise((resolve) => {
    recorder.addEventListener('stop', () => resolve(true), { once: true })
    try {
      if (recorder.state !== 'inactive') recorder.stop()
      else resolve(true)
    } catch {
      resolve(true)
    }
  })
  await state.stopping
  state.stopping = null
  const type = recorder.mimeType || kind() || 'audio/webm'
  const blob = new Blob(state.chunks, { type })
  state.chunks = []
  release()
  return { blob, type, seconds: took, peak: loudest, heard: loudest >= HEARD_FLOOR }
}

/** Throw the recording away and let the microphone go. */
export const cancel = () => {
  state.chunks = []
  state.stopping = null
  release()
}

/**
 * Ask the office what was said.
 *
 * The office transcribes, because the office is where the speech service is
 * configured — one service, one key, the same one the Telegram voice note has
 * used since #196's sibling. This sends the recording and gets words back; it
 * does not send anything to anybody.
 */
export async function words(blob, { endpoint, token, vocabulary = [] }) {
  const form = new FormData()
  const ext = blob.type.includes('mp4')
    ? 'mp4'
    : blob.type.includes('ogg')
      ? 'ogg'
      : blob.type.includes('wav')
        ? 'wav'
        : 'webm'
  form.append('audio', new File([blob], `note.${ext}`, { type: blob.type }))
  const hint = vocabulary.filter((v) => typeof v === 'string' && v !== '').join(', ')
  if (hint !== '') form.append('vocabulary', hint.slice(0, 400))
  const answered = await fetch(`${endpoint.replace(/\/$/, '')}/note`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  }).catch(() => null)
  if (answered === null) throw new Error('The office could not be reached.')
  const body = await answered.json().catch(() => ({}))
  if (!answered.ok || typeof body.heard !== 'string' || body.heard === '') {
    throw new Error(String(body.error ?? `The office returned ${String(answered.status)}.`))
  }
  return String(body.heard)
}
