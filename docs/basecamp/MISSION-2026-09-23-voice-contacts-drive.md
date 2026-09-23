# Mission — voice, contacts, Drive (23 September 2026)

**Branch `claude/basecamp-team-hq`. Do NOT merge. Do not disturb the default
Team HQ.** This file exists so the mission survives a context compaction: read
it, then the ledger at the bottom, then continue from the first row that is not
**done**.

## Grant's priority order, verbatim in substance

```
P0 — CHAT VOICE NOTES
P0 — LIVE NATURAL VOICE CONVERSATION
P1 — REAL CONTACTS BACKEND / CONTACT UX
P1 — GOOGLE DRIVE DOCUMENT INTEGRATION
P2 — associated QA, architecture cleanup and remaining defects
```

> *"Do not stop after completing P0."* · *"Do not stop the autonomous run
> merely to ask Grant to test."*

## The distinction that must not be lost

| | Chat microphone | Top-level microphone |
|---|---|---|
| **Is** | send a voice note | enter a live conversation |
| **Feels like** | Telegram / WhatsApp voice message | talking on the phone to the team |
| **Shape** | record → stop → send → transcribed → normal chat message | continuous session, barge-in, spoken replies |

> *"Do not make one microphone ambiguously switch between both."*

Agent name and avatar MAY appear inside conversational UI. The roster, presence,
workload and status strips stay gone.

## What the repository already has — traced 23 September, before writing code

**This is the answer to "trace the existing implementation first". Do not
re-derive it.**

| Piece | Where | State |
|---|---|---|
| Live realtime credential | `supabase/functions/voice-token/index.ts` | mints `POST /v1/realtime/client_secrets`; model from `VOICE_MODEL` (`gpt-realtime-2.1-mini`), voice from `VOICE_NAME` (`marin`); session instructions and the `look_up` / `ask_the_team` tools are minted SERVER side on purpose |
| CORS allowlist | `VOICE_ALLOWED_ORIGIN`, set by `scripts/deploy/voice.ts` from `PAGE_ORIGINS` | **held only `https://ai-team-hq.vercel.app`** — the basecamp preview origin was not on it, so live voice from `/basecamp` could never have worked on the deployed preview |
| Conversational endpoint | `supabase/functions/voice/index.ts` — `/turn`, `/look`, `/health` | writes `inbound_commands`, asks `app.voice_answer`, enqueues when it is work. §5: it translates, it never decides |
| **The studio's ordinary chat already posts to this same `/turn`** | `web/studio/chat.js` | so anything routed through `/turn` IS the canonical conversation, by construction |
| Transcription | `src/voice/inbound.ts` — `readTranscriber`, `transcribeOverApi` | OpenAI-shaped, `fetch` only, written to be runnable on the edge |
| Transcriber configuration | `app.voice_transcriber()` | **live**: mode `api`, Groq `whisper-large-v3-turbo`, key present in the vault |
| Browser dictation | `web/studio/dictate.js` | `SpeechRecognition` → TEXT into the composer (#196). **Not** a voice note: no audio is kept, nothing is uploaded, nothing is sent |
| Live client | `web/studio/call.js` | WebRTC, SDP, remote audio, `callPhase()` |
| Edge functions are single-file | every one of the eight is `index.ts` alone | so shared code cannot be imported into one; anything duplicated needs a check that the two agree |

## Decisions made here, so they are not re-litigated

1. **The voice note transcribes and then takes the ordinary typed path.** The
   new endpoint returns TEXT and nothing else; the page then calls the same
   `chat.send` / `chat.ask` a typed message uses. No second conversational
   system, which is what §4 of the brief forbids.
2. **Transcription happens on the edge**, against the configuration
   `app.voice_transcriber()` already holds, because it is the same
   configuration the Telegram path uses and a second key or service would be a
   second thing to rot.
3. **The duplicated request shape is checked**, not trusted: a unit test reads
   both the Deno endpoint and `src/voice/inbound.ts` and asserts they send the
   same fields to the same path.

## Ledger

Three words only, each meaning exactly one thing.
**built** = written · **verified** = driven, with evidence named ·
**blocked** = cannot be done from here, with the reason and the handoff.

| # | Requirement | State | Evidence |
|---|---|---|---|
| V1 | Trace the existing voice architecture before writing any of it | **verified** | the table above; nothing was written until it was filled in |
| V2 | The preview origin can mint a live credential at all | **verified** | `VOICE_ALLOWED_ORIGIN` held only the Team HQ origin, so live voice from `/basecamp` was refused by the browser before any JavaScript saw it. Added to `PAGE_ORIGINS`, deployed, and preflighted over the network from three origins: the preview is echoed its own, Team HQ is echoed its own, a stranger's is refused |
| V3 | A voice note is recorded, measured, stopped, reviewed and sent | **verified** | `verify:basecamp-voicenote`, 36 checks, with Chromium given a WAV file as its capture device - so the stream, the meter, the encoder and the silence guard are all real |
| V4 | The words are transcribed by the office | **verified with real media** | `verify:voice-note-live` posts synthesised speech over the network to the DEPLOYED `/note` and asserts the meaning came back. Not a human voice |
| V5 | The transcript takes the ordinary typed path | **verified** | one `askTheTeam` used by the Send button and the voice note alike; the suite asserts `/turn` is reached and the answer appears in the project thread |
| V6 | Silence is refused where it can be detected | **verified** | three seconds of digital silence comes back from the speech service as "Thank you.", `no_speech_prob` 0 - identical to real speech, so the answer cannot be keyed on. The browser measured the sound, so the browser refuses it; the suite records a silent WAV and proves nothing is sent |
| V7 | The recording stays playable | **verified** | kept in IndexedDB against the message id, offered only where one exists, still there after a reload. It is LOCAL and the panel says so |
| V8 | The microphone is released on every exit | **verified** | stop, cancel, error and navigation all go through `release()`; the suite asserts no live track survives a cancel and that recording can start again |
| V9 | Transcription failure is honest | **verified** | the office's own words on screen, nothing put into the conversation, the recording still there to retry |
| L1 | The live microphone opens a real conversation | **verified at the protocol** | `verify:basecamp-livevoice`, 25 checks, with a SECOND peer connection in the page answering the offer - so the offer, the answer, ICE, the remote audio track and the `oai-events` data channel are all real, and the suite speaks as the team by sending the events the Realtime API sends |
| L2 | Multi-turn, and it flows | **verified** | two full exchanges, each continuing the same conversation rather than starting one |
| L3 | Barge-in | **verified** | the team speaking, an interruption, the response truncated, and what he said over her heard - driven through the same events the server sends. `call.js` already had the hard half right: the SERVER decides what counts as an interruption |
| L4 | Simple, conversational UI with no developer words | **verified** | six states (connecting, listening, the team talking, muted, ended, and what went wrong), mute and end. Asserted that nothing on it says session, token, SDP, realtime or WebRTC |
| L5 | Mute really mutes | **verified** | the microphone TRACK is disabled, not a label changed, and the suite asserts the track |
| L6 | Cleanup | **verified** | every microphone the page was ever handed is `ended` after the call; a second call can be started and mints its own credential |
| L7 | The call knows which project it is about | **verified against the deployed mint** | the page sends the slug, the office looks it up and tells Claire that "this project" means that one. `verify:voice-note-live` asserts over the network that a call with a project carries the brief and one without does not |
| L8 | A real conversation with OpenAI | **BLOCKED — needs a person** | everything up to the model is proved. No human has spoken into a microphone and heard the team answer. The shortest test Grant can run is in the acceptance report |
| C1 | Reconcile before touching the database | **verified** | production is at 566 applied; `main` and this branch carry 533; the other 33 belong to `claude/human-simulation-harness` and **not one of them touches `public.contacts`** — checked file by file, not assumed |
| C2 | The smallest safe change | **verified** | one migration, `0534_a_contact_can_be_corrected.sql`, additive and idempotent: two columns, three writers, three wrappers, and the reader spliced from its LIVE definition with a refusal if either anchor is missing |
| C3 | Why it is numbered 0534 | **recorded in the file** | this branch's only legal number, and it is also used by that workstream's own 0534. `app.schema_migrations` keys on the NAME so both coexist; a `sequence/duplicate` surfaces when the branches meet and the fix is to rename this file, which is safe because every statement is idempotent. Importing their 33 files was TRIED and reverted — their branch carries two files numbered 0543, so it turned this branch's gate red on somebody else's defect |
| C4 | Applied | **verified** | `npm run migrate` refuses from this branch, correctly, because the repository cannot describe a database 33 migrations ahead of it. `npm run migrate:one` applies one named file and records it with the same name and SHA-256 the runner would — it does not skip the checks that are about the file itself |
| C5 | Create, edit every field, notes, persistence | **REAL BACKEND VERIFIED** | `verify:contacts-live`, 29 checks over the network to the DEPLOYED gateway, reading back through the same reader the page uses rather than through the writer's answer |
| C6 | The photograph | **REAL BACKEND VERIFIED** | the browser downscales, the gateway stores the bytes in the private `files` bucket under the project's prefix, the DATABASE holds a path, the page is handed a ten-minute signed URL, and the suite fetches that URL and gets the image back |
| C7 | Archive rather than delete | **verified** | put away, gone from the list, still in the table so anything that referred to the person still can, and brought back |
| C8 | Failure paths | **verified** | no name, no such contact, over 2 MB, not an image — each refused in a sentence |
| C9 | The page's own field map was wrong | **fixed** | it mapped `image` to an argument `hq_contact_update` has never had, and PostgREST answers an unknown argument by saying the FUNCTION does not exist — so every save carrying a photograph would have failed while saying something untrue |
| D1 | Trace the Drive integration before writing one | **verified** | `src/google/drive.ts`, the OAuth function and a live `drive.readonly` grant already existed; a listing of Grant's real Drive came back on the first attempt. Nothing here is a new integration |
| D2 | Browse and search Drive from the page | **REAL BACKEND VERIFIED** | the gateway mints a Google token server-side exactly as `google-oauth` does, lists, walks into folders and searches. `verify:drive-live` asserts over the network that it is really Drive — every item carries a Google id and a Google link — and that nothing credential-shaped comes back with it |
| D3 | A pick is a reference, not a copy | **REAL BACKEND VERIFIED** | `hq_document_link`; the row has no content, Drive keeps the file, and picking the same file twice leaves one document |
| D4 | Provider identity | **verified** | the Google kind is kept in `doc_type` in the office's own words, because `documents_file_is_complete` forbids a mime without stored bytes. A Doc stays a Doc, a Sheet stays a Sheet |
| D5 | A Drive document opens the real thing | **verified** | 0539 taught the reader to say where a document lives; the URL is DERIVED in one place from the id and the kind, pinned by a unit test whose control proves two kinds never produce one address |
| D6 | The picker in Docs and Files | **verified** | `verify:basecamp-drive`, 20 checks: the source chooser, the panel, walking in, going back, searching, picking — and that the page never held a credential and never asked Google directly |
| D7 | No fake integrations offered | **verified** | two sources, both of which work. The tile list grows when a connector does |
| D8 | Four defects found by driving it | **recorded** | an invented `origin` word, a mime the schema forbids on a reference, a null that defeats a unique index, and an index created before the duplicates it was meant to prevent were swept. None was visible in the SQL |

