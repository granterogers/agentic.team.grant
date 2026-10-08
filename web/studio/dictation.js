/*
  LIVE DICTATION: the state machine (8 October 2026).

  Grant: click the microphone, speak, watch the words appear in the composer as
  you say them, stop, edit, press Send. No recording step, no upload, no modal.
  The transcription is the browser's own streaming SpeechRecognition, which the
  office already used on the Chat page (dictate.js); it costs nothing, needs no
  new provider and no audio is kept by us. In Chrome the audio goes to Google to
  be transcribed, and the button says so before it is pressed.

  This file is the logic only, with the recogniser injected, so every branch is
  decided without a microphone: tests/studio/dictation.test.ts drives it with a
  fake. Real capture is checked separately and said to be separate.

  States:  idle -> starting -> listening -> stopping -> idle
                                  \-> error (then idle on the next start)

  The rules, each one a defect somewhere else:
   * The text is REBUILT from the recogniser's whole result list on every event,
     never accumulated from deltas, so a revised partial replaces itself and no
     word is written twice (the classic repeated-words bug on Android).
   * Text typed before dictation starts is kept, and dictation is appended to it.
   * If the person types or edits while listening, that edit becomes the new
     base and results already heard are not written again.
   * Browsers end a continuous session on silence or a network blip. If the
     person has not stopped it, it is restarted, up to a limit with no words in
     between, and what was heard so far is kept. A refusal (permission, no
     microphone) is never retried.
   * stop() aborts: it releases the microphone now rather than waiting for one
     more result. active() can be read by a check, which is #102's lesson.
   * Nothing here sends anything. The caller decides what Send does.
*/

export const STATES = ['idle', 'starting', 'listening', 'stopping', 'error']

const MAX_SILENT_RESTARTS = 4
const RESTART_DELAY_MS = 250

const REASONS = {
  'not-allowed': 'The microphone was refused. Allow it for this site in the browser, then try again.',
  'service-not-allowed': 'Dictation is switched off for this site or browser. Allow the microphone and try again.',
  'audio-capture': 'No microphone was found. Connect one and try again.',
  network: 'Dictation needs the network and could not reach it. What was heard is kept.',
  'language-not-supported': 'This browser cannot transcribe that language.',
}
const FATAL = new Set(['not-allowed', 'service-not-allowed', 'audio-capture', 'language-not-supported'])

/** Join two pieces of speech with exactly one space where neither side supplies it. */
export const join = (a, b) => {
  if (a === '') return b
  if (b === '') return a
  const gap = /\s$/.test(a) || /^\s/.test(b) ? '' : ' '
  return `${a}${gap}${b}`
}

/** The text of a recogniser's result list from `from` on, and how much of it is still provisional. */
export const readResults = (results, from = 0) => {
  let text = ''
  let settled = ''
  for (let i = from; i < results.length; i += 1) {
    const alt = results[i]?.[0]
    if (alt === undefined) continue
    text = join(text, alt.transcript.replace(/^\s+/, ''))
    if (results[i].isFinal) settled = text
  }
  return { text, settled, interim: text.slice(settled.length).replace(/^\s+/, '') }
}

export const createDictation = ({
  Recognition,
  lang = 'en-GB',
  setTimer = (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimer = (t) => globalThis.clearTimeout(t),
} = {}) => {
  let state = 'idle'
  let rec = null
  let wanted = false
  let box = null
  let hooks = {}
  let base = ''
  let committed = ''
  let offset = 0
  let seen = 0
  let lastWritten = ''
  let silent = 0
  let timer = null
  let reason = ''

  const set = (next, why = '') => {
    state = next
    reason = why
    hooks.onstate?.(state, why)
  }

  const write = (heard) => {
    const whole = join(join(base, committed), heard.text)
    box.value = whole
    lastWritten = whole
    hooks.onchange?.(whole, { settled: heard.settled, interim: heard.interim })
  }

  const onInput = () => {
    if (box === null || box.value === lastWritten) return
    /* The person edited while listening: their text is the base now, and what was already heard is not written again. */
    base = box.value
    committed = ''
    offset = seen
    lastWritten = box.value
  }

  const spawn = () => {
    const r = new Recognition()
    rec = r
    r.continuous = true
    r.interimResults = true
    r.lang = lang
    seen = 0
    offset = 0
    r.onstart = () => {
      if (rec !== r) return
      silent += 1
      set('listening')
    }
    r.onresult = (e) => {
      if (rec !== r || !wanted) return
      silent = 0
      seen = e.results.length
      write(readResults(e.results, offset))
    }
    r.onerror = (e) => {
      if (rec !== r) return
      const code = e?.error ?? ''
      if (code === 'aborted') return
      if (FATAL.has(code)) {
        wanted = false
        reason = REASONS[code]
        return
      }
      if (code === 'network') {
        reason = REASONS.network
        /* One quick retry happens through the ordinary end path; a second failure in a row stops. */
        silent += 2
      }
    }
    r.onend = () => {
      if (rec !== r) return
      rec = null
      if (wanted && silent <= MAX_SILENT_RESTARTS) {
        /* The box already holds everything heard, provisional words included. It becomes the base of the next session. */
        base = box.value === '' ? '' : `${box.value.replace(/\s+$/, '')} `
        committed = ''
        lastWritten = box.value
        timer = setTimer(() => {
          timer = null
          if (wanted) begin()
        }, RESTART_DELAY_MS)
        return
      }
      finish(reason !== '' ? reason : wanted ? 'Nothing was heard. Press the microphone to try again.' : '')
    }
    return r
  }

  const begin = () => {
    try {
      spawn().start()
    } catch {
      /* start() throws if a session is somehow already running; never claim the microphone is open when it is not. */
      rec = null
      wanted = false
      finish('Dictation could not start. Try again.')
    }
  }

  const finish = (why = reason) => {
    wanted = false
    if (timer !== null) {
      clearTimer(timer)
      timer = null
    }
    box?.removeEventListener('input', onInput)
    set(why === '' ? 'idle' : 'error', why)
    hooks.onstop?.(why)
  }

  return {
    supported: () => typeof Recognition === 'function',
    state: () => state,
    reason: () => reason,
    /** True while the microphone is, or is about to be, open. A check reads this rather than a comment. */
    active: () => wanted || rec !== null,
    start(target, h = {}) {
      if (typeof Recognition !== 'function' || wanted || rec !== null) return false
      box = target
      hooks = h
      base = box.value === '' ? '' : `${box.value.replace(/\s+$/, '')} `
      committed = ''
      lastWritten = box.value
      silent = 0
      reason = ''
      wanted = true
      box.addEventListener('input', onInput)
      set('starting')
      begin()
      return wanted
    },
    /** The composer was redrawn: carry on writing into the new box. Called by the page after every dock repaint. */
    retarget(target) {
      if (!wanted || target === box) return
      box?.removeEventListener('input', onInput)
      box = target
      box.addEventListener('input', onInput)
      lastWritten = box.value
    },
    stop() {
      if (!wanted && rec === null) return
      wanted = false
      set('stopping')
      const r = rec
      rec = null
      try {
        r?.abort()
      } catch {
        /* already gone */
      }
      finish('')
    },
  }
}
