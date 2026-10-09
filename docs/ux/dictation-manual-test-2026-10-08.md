# Live dictation: manual acceptance test (8 October 2026, #439)

## What is and is not verified

| Layer | Verified how | Result |
|---|---|---|
| State machine (interim to final, no repeated words, typed text kept, edit mid-session, restart after silence, fatal errors, release on stop, start watchdog) | `tests/studio/dictation.test.ts` (19, fake recogniser; the start watchdog test fails without the fix) | pass |
| Page wiring (dock button, Send while listening only stops, repaint while listening, release on close, permission denial sentence) | `npm run verify:chat-dock` (30, fake recogniser in real Chromium) | pass |
| Microphone capture path | Chromium with `--use-fake-device-for-media-stream`: `getUserMedia` returns one audio track and releases it | the browser can open a (fake) microphone |
| **The browser's real speech engine** | Chromium in this sandbox: `webkitSpeechRecognition` exists, `start()` is accepted, and **no `start`, `error` or `end` event ever arrives** (its Google service is unreachable here). | **cannot be verified here** |
| Chrome desktop, Safari macOS, Safari iPhone, Android Chrome with a real voice | not run | **MANUAL, below** |

The no-event finding was real and produced a fix: the machine now gives up after 8 seconds in `starting`, says
"Dictation did not start. The browser did not answer. Check the connection and try again." and lets go of the
microphone, instead of sitting in "starting" for ever.

No paid service is involved. Chrome sends the audio to Google and Safari to Apple's speech service; the button's title and,
on a phone where a title is never shown, the status line while listening both say so.

## Known browser behaviour to expect (from vendor documentation, NOT yet observed here)

- Safari (macOS 14.1+, iOS 14.5+) exposes the prefixed `webkitSpeechRecognition`. It needs Siri and Dictation switched on
  (System Settings, or iOS Settings > Siri > Dictation); otherwise `service-not-allowed` arrives and the page says
  "Dictation is switched off for this site or browser".
- iOS Safari ignores `continuous` and may end a session after a pause. The machine restarts up to 4 times in silence and
  rebuilds the text from the whole results list each time, so words should not repeat. This is the thing most worth
  watching on an iPhone.
- A web app added to the iPhone Home Screen may not expose speech recognition at all; the button is then disabled with the
  reason.
- Firefox has no recogniser: the button is disabled with the reason.
- The page must be https (a secure context); over plain http the API is refused.

## Procedure (about 10 minutes per browser)

Use a real project in the Sample Office or an office of your own, never a customer's. Open the Team chat dock.

For each of: **Chrome desktop**, **Safari macOS**, **iPhone Safari** (in a normal tab, not the Home Screen), **Android Chrome**:

1. **Disclosure.** Hover (desktop) the microphone button: the title names Chrome/Google and Safari/Apple. Press it: the
   line under the box says "Listening... your browser transcribes the audio (Google in Chrome, Apple in Safari)".
2. **Permission prompt.** First press asks for the microphone. Allow. The button turns red and says "Stop dictating".
3. **Live words.** Say "Can we get the first five interviews booked this week". Words appear in the box as you speak
   (provisional text may change), not after you stop.
4. **No repeats.** Keep talking for 30 seconds with a pause or two. No phrase is written twice.
5. **Typed text kept.** Type "Hello team." first, then dictate. Your text is still there and the dictation continues after it.
6. **Edit while listening.** Fix a word by hand mid-session. Your correction stays; later speech continues after it.
7. **Send while listening.** Press Send once: it stops listening and does NOT send. Press Send again: it sends.
8. **Stop.** Press the microphone again: the red goes, the browser's recording indicator (the tab's red dot or the iOS
   orange dot) goes within a second. Nothing keeps listening.
9. **Close the dock while listening** (the x): the recording indicator goes.
10. **Switch tab or lock the phone while listening:** dictation stops and the indicator goes.
11. **Silence.** Start and say nothing for about 20 seconds: it stops with "Nothing was heard. Press the microphone to try again."
12. **Denial.** Block the microphone for the site in the browser, press the button: the sentence says to allow it for this
    site, and the button is idle (not stuck red). Re-allow and confirm it works again.
13. **Offline.** Turn the network off, press the button: an error sentence within about 10 seconds, no stuck state.
14. **Voice conversation untouched.** Press the call button (the real-time voice conversation): it behaves as before. It is a
    different feature and must not have changed.

Record for each browser: pass or fail per step, the browser and OS version, and any text that was written twice or lost.
Any failure is a defect: open an issue and link it to #439.
