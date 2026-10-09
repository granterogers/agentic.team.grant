# iPhone acceptance sequence for Team HQ (about 10 minutes)

**Status: NOT YET RUN on a real iPhone.** Nothing below has been observed on a device. Everything on the preview has been checked in desktop Chromium
emulating a phone, which does not prove the iPhone's microphone, keyboard, touch or Safari behaviour.

Use: **Safari**, in a normal tab (not a Home Screen app: that may not offer speech recognition at all), on https://team-hq-ux-review.vercel.app.
Before you start: iOS Settings, Siri (or Keyboard), **Dictation switched on**; Settings, Safari, Microphone not set to Deny.
Screenshots: https://team-hq-ux-review.vercel.app/review/ shows what to expect.

## A. Open it (1 minute)
1. Open the address. You should see the sign-in page with **Explore the Sample Office**. Press it. A strip says *Sample Office, a made-up café, so changes are not saved*.
2. Press the **three-line menu** (top left). Pick **Riverside Café Launch**. You get a single column of panels (an iPhone shows a list, not the pannable canvas).

## B. Backgrounds (3 minutes)
3. Press the **three dots** at the top right of the project, then **How this project looks**. **Canvas background** is the first thing in the sheet.
4. Press a few materials. After the first press the sheet drops to the lower part of the screen and the page behind it shows the material: that is the preview. Nothing is kept yet.
5. Press **Cancel**: the page goes back to plain. Pick **Warm walnut** (or any), press **Apply**, close the sheet, then pull to reload: the choice should still be there.
6. Optional: **Upload background** and choose a photo from your library. It should say it is optimising, show the size (it shrinks it to 2560px), preview it, and keep it on **Apply**. It stays on this phone only.
   On the Sample the choice is local to this browser and sends nothing to the office, by design.

## C. Live dictation (4 minutes). Where the microphone control is
There are TWO microphone-looking controls. Do not confuse them:
- **The red round microphone beside "Chat with Team" at the top of the project is the live voice CALL** (a different feature). Leave it alone for this test.
- **Dictation is inside the chat.** Press **Chat with Team**. The chat fills the screen. At the bottom is a text box, and to the right of it, beside **Send**, a **small microphone button**. That one is dictation.

7. Press the dictation microphone. Safari asks to allow the microphone: **Allow**. The button turns red and the line under the box reads *Listening... your browser transcribes the audio (Google in Chrome, Apple in Safari)*. The orange dot appears in the status bar.
8. Say: **"Can we get the first five interviews booked this week"**. **Words must appear in the box while you speak**, not after you stop.
9. Keep talking for 30 seconds with a pause or two. **Note any phrase that appears twice** (the thing most worth watching on iPhone, which may end a session after a pause).
10. Type "Hello team." first, then dictate: your typed text must stay and dictation continue after it.
11. Press **Send once**: it should only stop listening and NOT send. Press **Send again** to send (the Sample may say changes are not saved; that is expected).
12. Press the microphone again to stop: the red goes and the orange status-bar dot goes within a second. Lock the phone or switch app while listening: it must stop too.

## D. Touch
13. The canvas pinch-zoom exists only on a wide screen (a tablet or larger); on an iPhone the board is a list. If you have an **iPad**, open the same project, pinch with two fingers on empty canvas and drag with one: it should zoom about your fingers and pan.
14. Everything you press should respond at once, with no accidental page zoom when you tap the chat box (inputs are 16px so Safari does not zoom).

## What to tell me
For each numbered step: works, or what happened (and a screenshot). In particular: did words appear live (step 8), did anything repeat (9), did Send-while-listening behave (11), did the dot go away (12), and the iOS and Safari version. Any failure is a defect to be filed against #439; a pass is the first real-device evidence there is.
