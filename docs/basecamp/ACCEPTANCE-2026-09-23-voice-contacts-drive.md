# Voice, contacts and Drive — acceptance, 23 September 2026

Branch `claude/basecamp-team-hq`. **Not merged. The default Team HQ is
untouched.** Evidence first; anything not proved is named as not proved.

| | |
|---|---|
| **Live URL** | https://agentic-team-hq-basecamp-agentic-team-grant.vercel.app |
| **Deployed HEAD** | `1208a94` — every one of the 78 files byte-identical to the working tree by sha256 |
| **Default Team HQ preserved** | yes — `verify:ui` 54/54, `verify:layouts` 64 states 0 findings, `verify:wired` 77 attributes no dead controls |
| **Main untouched** | yes — no merge, no PR |

---

## VOICE NOTE (the microphone inside Chat)

| | |
|---|---|
| **Built** | yes — record, live level meter, elapsed time, stop, listen back, send or delete |
| **Deployed** | yes — page and the `/note` endpoint on the voice function |
| **Real recording** | yes — `verify:basecamp-voicenote` gives Chromium a WAV file as its capture device, so the stream, the meter, the encoder and the silence guard are all real (36 checks) |
| **Real transcription** | **yes, against the deployed endpoint** — `verify:voice-note-live` synthesises speech and posts it over the network; the office transcribes with the same Groq service the Telegram voice note has always used, and the words come back |
| **Canonical Chat** | yes — the transcript goes through `askTheTeam`, the *same* two calls the Send button makes. There is no second conversation |
| **Persistence** | yes — the recording is kept in IndexedDB against the message id and is still playable after a reload |
| **Remaining limitation** | the recording is kept **in that browser**, not in the office, and the panel says so. No human has spoken into a real microphone |

The silence guard is the part worth knowing about: three seconds of digital
silence comes back from the speech service as **"Thank you."**, with the same
no-speech probability as real speech — so nothing in the answer can be keyed
on. The browser measured the sound, so the browser refuses it, and nothing is
sent.

---

## LIVE VOICE (the microphone on the project head)

| | |
|---|---|
| **Built** | yes — connecting, listening, the team talking, muted, ended; mute and end; the turns so far |
| **Deployed** | yes — page, `voice` and `voice-token` |
| **OpenAI Realtime** | the existing implementation, reused: ephemeral credential at `/v1/realtime/client_secrets`, WebRTC, SDP at `/v1/realtime/calls`, remote audio, `oai-events` |
| **Real microphone** | **not by a person.** `verify:basecamp-livevoice` opens a real `getUserMedia` stream and a real peer connection |
| **Real transcription** | not proved — the far end is a loopback, not a model |
| **AI response** | not proved — same reason |
| **Audible response** | a real remote audio track arrives and is attached; it carries a test tone, not speech |
| **Multi-turn** | yes — two full exchanges continuing one conversation (25 checks) |
| **Interruption** | yes — the team speaking, an interruption, the response truncated, and what he said over her heard |
| **iPhone readiness** | the 44px floors, the 16px input floor, safe areas and reduced motion are enforced by `verify:basecamp-touch` in an emulated touch context. **Safari itself has not been used** |
| **Remaining physical test** | one person, one microphone, one call |

**The single most valuable thing found here:** `voice-token` takes no
authentication, so its origin allowlist is the whole of its security — and it
held one origin, Team HQ's. **Live voice from `/basecamp` could never have
worked**, however good the client was. The experiment's origin is on it now,
deployed, and preflighted over the network from three origins: the preview and
Team HQ are each echoed their own, a stranger's is refused.

### The shortest test Grant can run

1. Open https://agentic-team-hq-basecamp-agentic-team-grant.vercel.app and sign
   in (the token is the one Team HQ uses).
2. Open any project. Press the **round microphone** at the top right.
3. Allow the microphone when Safari or Chrome asks.
4. Say: *"What's late on this project?"* — and wait for a spoken answer.
5. Talk over her mid-sentence to check barge-in.
6. Press **End**.

Then, separately: open **Chat**, press **Voice note**, say a sentence, press
**Stop**, listen back, press **Send to the team**. The words should appear as
your own message and the team should answer them.

---

## CONTACTS

| | |
|---|---|
| **Real backend** | **yes** — `verify:contacts-live`, 29 checks over the network to the deployed gateway, read back through the same reader the page uses |
| **Add** | yes |
| **Edit** | yes — every field Grant listed, in one save; null leaves a field alone and an empty string clears it |
| **Photo** | yes — the browser downscales, the gateway stores the bytes in the **private `files` bucket** under the project's prefix, the database holds a **path**, the page is handed a ten-minute signed URL, and the suite fetches that URL and gets the image back |
| **Notes** | yes — persisted and read back |
| **Persistence** | yes — every assertion is after a re-read, never from the writer's answer |
| **Remaining limitation** | the migration is applied to the database but is numbered 0534 on this branch, which the other workstream also used. See below |

Archive rather than delete: a contact who has been corresponded with is
referred to by things that happened, and deleting the row makes that history
anonymous. Put away, brought back, and still in the table.

**The numbering, stated plainly.** Production is at 566 applied migrations;
`main` and this branch carry 533. The other 33 belong to
`claude/human-simulation-harness`, are not on main, and **none of them touches
`public.contacts`** — checked file by file. Importing them here was tried and
reverted: that branch carries two files numbered 0543, which turns this gate red
on somebody else's defect. So `npm run migrate` refuses from here, correctly,
and `npm run migrate:one` applies one named file and records it with the same
name and SHA-256 the runner would. **When the branches meet, rename 0534–0539 to
the next free numbers; every one of them is idempotent, so re-applying under a
new name changes nothing.**

---

## GOOGLE DRIVE

| | |
|---|---|
| **Connected** | yes — already was. A `drive.readonly` grant and a refresh token in the vault; a listing of Grant's real Drive came back on the first attempt |
| **Picker/selection** | yes — browse, walk into folders, go back, search; **19 checks against Grant's real Drive**, 26 in a browser |
| **Project association** | yes — a picked file becomes a project document that knows which file it is |
| **Thumbnail/preview** | Drive's own icons and thumbnails are passed through; nothing is faked, and a kind is shown in words ("Google Sheet") rather than a MIME type |
| **Open real document** | yes — the address is derived from the id and the kind, so a Sheet opens as a Sheet; pinned by a unit test whose control proves two kinds never produce one address |
| **Persistence** | yes — and picking the same file twice leaves one document, not two |
| **Remaining limitation** | it is a **reference**: the office does not index a linked file's contents, so it is not searchable text until the existing Drive sync reads it |

**A security observation, unprompted:** the top-level Drive folder
`Agentic_Team` contains files named `notion_key.txt`, `github_agentic_team_key.txt`,
`agentic_Groq.txt` and `telegram_Bot_list.txt`. Nothing here opened them and
nothing here will. If those are live credentials in plain files, they are worth
moving into the vault.

---

## What is still NOT VERIFIED

1. **A real conversation with OpenAI.** Everything up to the model is proved;
   the model is not. One person, one microphone.
2. **Safari on a physical iPhone.** All mobile evidence is an emulated touch
   context in Chromium.
3. **A voice note recorded by a person.** The audio in every check is
   synthesised or a WAV file played into a fake capture device.
4. **Contact photographs at scale.** One image, uploaded, signed, fetched back
   and removed. Nothing has tested fifty contacts with photographs on one page.
5. **A linked Drive file's contents.** A reference is not indexed, so asking the
   office about what is *inside* a linked file will not find it.
6. **`shell.js` is 2,676 lines.** Voice, Drive and the live panel went into
   their own modules (`voicenote.js`, `notestore.js`, `livevoice.js`,
   `drive.js`), which is what Grant asked for, but the shell itself has not been
   split.

## The gates behind all of it

| | |
|---|---|
| `basecamp:gate` | green — journey, preservation, routes, controls, coverage, measure |
| `basecamp:gate2` | **16 suites, 375 checks, 0 failures**, against the deployed bytes |
| Live, over the network | voice 15/15 · contacts 29/29 · Drive 19/19 |
| `npm test` | 2,247 |
| lint · typecheck · secrets · migrations · templates | all clean |
| Default Team HQ | `verify:ui` 54/54 · `verify:layouts` 64 states 0 findings · `verify:wired` no dead controls |

Nine defects were found by building this, and every one was found by driving
something rather than by reading it: a reply written to the thread and never
drawn, a raw ISO instant on every message, a field map pointing at an argument
that never existed, an invented `origin` word, a mime the schema forbids on a
reference, a null that defeats a unique index, an index created before the
duplicates it was meant to prevent were swept, a failed read reporting its
status code instead of the office's own sentence, and a route pattern that
blocked the page's own modules.
