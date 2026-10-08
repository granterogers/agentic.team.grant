/*
  The Team Chat dock's microphone: live dictation (8 October 2026).

  One press starts listening and the words appear in the composer as they are
  said; the next press, Send or Enter stops (the first of those only stops, it
  never sends half a sentence). The Chat page's own recorder, the call, and the
  live voice conversation are different features and are untouched.

  The dock repaints often (a reply arrives, the pulse ticks) and a repaint
  replaces the textarea. So the live state is held here, the new nodes are
  bound after every paint, and the machine is told about the new textarea.
*/
import * as dictate from '../dictate.js'

const cur = { btn: null, say: null, box: null }
let guarded = false

const paint = () => {
  const { btn, say } = cur
  if (btn === null) return
  const on = dictate.active()
  btn.setAttribute('aria-pressed', on ? 'true' : 'false')
  btn.classList.toggle('on', on)
  btn.setAttribute('aria-label', on ? 'Stop dictating' : 'Dictate a message')
  btn.title = on ? 'Stop dictating' : dictate.supported() ? dictate.disclosure() : dictate.why()
  if (say !== null && !on && say.dataset.keep !== '1') say.textContent = ''
}
const speak = (words, keep = false) => {
  if (cur.say === null) return
  cur.say.textContent = words
  cur.say.dataset.keep = keep ? '1' : '0'
}

/** Bind the freshly painted dock. Safe to call after every paint. */
export const wire = (dock) => {
  cur.btn = dock.querySelector('[data-dock-dictate]')
  cur.say = dock.querySelector('[data-dockdic]')
  cur.box = dock.querySelector('[data-docksay]')
  if (!guarded) {
    guarded = true
    /* A hidden tab must not keep a microphone open. */
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) dictate.stop()
    })
    globalThis.addEventListener('pagehide', () => {
      dictate.stop()
    })
  }
  if (cur.btn === null || cur.box === null) return
  if (dictate.active()) {
    dictate.retarget(cur.box)
    paint()
    return
  }
  paint()
  cur.btn.addEventListener('click', () => {
    if (dictate.active()) {
      dictate.stop()
      return
    }
    const box = cur.box
    if (box === null) return
    const began = dictate.start(box, {
      onchange: (_value, info) => {
        const live = info.interim === '' ? 'Listening…' : `Listening… ${info.interim}`
        speak(live)
        box.dispatchEvent(new Event('bc-dictated'))
        const live2 = cur.box
        if (live2 !== null) {
          live2.style.height = 'auto'
          live2.style.height = `${String(Math.min(live2.scrollHeight, 150))}px`
          live2.scrollTop = live2.scrollHeight
        }
      },
      onstate: (state) => {
        if (state === 'listening') speak(dictate.listeningNotice())
        paint()
      },
      onstop: (reason) => {
        speak(reason, reason !== '')
        paint()
        cur.box?.focus()
      },
    })
    if (!began) speak(dictate.supported() ? 'Dictation could not start. Try again.' : dictate.why(), true)
    paint()
  })
}

/** Release the microphone: the dock closed, or the project changed. */
export const release = () => {
  dictate.stop()
}
