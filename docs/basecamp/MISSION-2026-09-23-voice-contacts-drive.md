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

