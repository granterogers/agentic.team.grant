# OpenAI Realtime API as the primary live-voice layer for a mobile-first PWA

Phase 0 feasibility research. Researched **2026-09-02**. All figures verified against
`developers.openai.com` (the old `platform.openai.com/docs/*` URLs now 301-redirect there).

---

## Verdict

**Yes, with caveats — but the spec's model names are wrong and its iOS assumptions are the real risk.**

The core architecture the spec assumes is valid and is exactly what OpenAI documents today:
a browser-side WebRTC peer connection, an ephemeral client secret minted server-side so the
permanent API key never reaches the client, tools declared on the session, and server-side
barge-in handling. Sessions run up to 60 minutes, which comfortably covers a 30-minute
conversation, and the 128k context window on the current models means a 30-minute session
never even approaches truncation.

Three caveats, in order of severity:

1. **`gpt-realtime` and `gpt-realtime-mini` are deprecated.** They were announced for
   deprecation on 2026-07-20 and are **removed from the API on 2027-01-20**. The current
   models are `gpt-realtime-2.1` and `gpt-realtime-2.1-mini`. Any spec naming
   `gpt-realtime`/`gpt-realtime-mini` is targeting models that die within ~5 months of
   this writing. `gpt-4o-realtime-preview` is long gone (shut down 2026-05-07).
2. **iOS Safari is the binding constraint, not the API.** A PWA added to the home screen
   behaves *worse* than a Safari tab for this use case: there is a long-standing WebKit
   issue where microphone capture is stopped when a home-screen web app leaves the
   foreground, and the documented fix (`UIBackgroundModes: audio` in `Info.plist`) is only
   available to native apps wrapping a `WKWebView` — **a PWA cannot declare it**. Plan for
   voice to be foreground-only, screen-on.
3. **Cost is not trivially "audio minutes × rate."** Realtime is stateful and re-sends
   accumulated conversation context as input on every turn. Prompt caching absorbs most of
   this, but the naive floor estimate understates real spend by ~30-35%. See the cost
   section.

Recommended model: **`gpt-realtime-2.1-mini`** as the default (~$24/month at the target
volume, ~2.4x cheaper than full), with `gpt-realtime-2.1` reserved for flows that need
stronger instruction-following or reasoning effort.

---

## 1. Current realtime-capable models

The realtime family listed in the models catalog today, exactly as named:

| Model | Status |
|---|---|
| `gpt-realtime-2.1` | Current, GA. "Reasoning model with tool use." |
| `gpt-realtime-2.1-mini` | Current, GA. "Reasoning model with tool use." |
| `gpt-realtime-2` | Available (superseded by 2.1) |
| `gpt-realtime-1.5` | Available. "The best voice model for audio in, audio out." |
| `gpt-realtime-mini` | **Explicitly flagged "(Deprecated)" in the catalog** |
| `gpt-realtime-translate` | Streaming speech-to-speech translation |
| `gpt-realtime-whisper`, `gpt-live-transcribe`, `gpt-transcribe` | Transcription, not speech-to-speech |

**Answers to the specific questions:**

- **Are `gpt-realtime` / `gpt-realtime-mini` the current names?** No. `gpt-realtime-mini` is
  marked Deprecated in the catalog; `gpt-realtime` no longer appears in the catalog listing at
  all (only 1.5, 2, and 2.1 do), though its model detail page is still served.
- **GA or preview?** `gpt-realtime-2.1` is generally available. The realtime guide references
  "Beta to GA migration" and advises migrating any beta implementation "to the GA interface
  before moving forward with new work" — the preview/beta era is over.
- **Are the older `gpt-4o-realtime-preview` names deprecated?** Yes, and already **shut down**.
  Announced 2025-09-15, shutdown **2026-05-07**. Mapping: `gpt-4o-realtime-preview`,
  `gpt-4o-realtime-preview-2025-06-03`, and `gpt-4o-realtime-preview-2024-12-17` → `gpt-realtime-1.5`;
  `gpt-4o-mini-realtime-preview` → `gpt-realtime-mini`.
- **Newer model that supersedes them?** Yes. `gpt-realtime-2.1` and `gpt-realtime-2.1-mini`,
  released **2026-07-06**. Announcement claims "reduced p95 latency by at least 25% across
  Realtime voice models through improved caching," plus "improved alphanumeric recognition,
  silence and noise handling, and interruption behavior" over `gpt-realtime-2`.
- **Deprecation schedule to plan against** (announced 2026-07-20, **shutdown 2027-01-20**):
  - `gpt-realtime` → `gpt-realtime-2.1`
  - `gpt-4o-realtime` → `gpt-realtime-2.1`
  - `gpt-realtime-mini` → `gpt-realtime-2.1-mini`
  - `gpt-4o-mini-realtime` → `gpt-realtime-2.1-mini`
  - `gpt-audio`, `gpt-4o-audio`, `gpt-audio-mini`, `gpt-4o-mini-audio` → `gpt-audio-1.5`

Sources:
- https://developers.openai.com/api/docs/models
- https://developers.openai.com/api/docs/models/gpt-realtime-2.1
- https://developers.openai.com/api/docs/deprecations
- https://community.openai.com/t/new-realtime-models-on-the-api-gpt-realtime-2-1-and-gpt-realtime-2-1-mini/1385896

---

## 2. Recommended browser connection method and exact flow

**WebRTC, and the SDP exchange happens at `POST /v1/realtime/calls`.** The realtime guide says
of WebRTC: "Use for browser and mobile clients that capture or play audio directly." WebSocket
remains supported but is positioned for server-side use; SIP exists for telephony.

`/v1/realtime/calls` is the current "unified interface" and is what replaced the older
beta pattern of creating a session and connecting to `/v1/realtime?model=...`.

There are two documented flows.

### Flow A — Unified interface (documented as *recommended*)

The API key never leaves your server, and the SDP is proxied through it:

1. Browser creates an `RTCPeerConnection`, attaches the mic track from `getUserMedia`, and
   creates an SDP offer.
2. Browser POSTs that raw SDP to **your** server (e.g. `/session`).
3. Your server sends the SDP plus session config to OpenAI as a multipart form,
   authenticated with `Authorization: Bearer ${process.env.OPENAI_API_KEY}`. Session config
   looks like:
   ```json
   {
     "type": "realtime",
     "model": "gpt-realtime-2.1",
     "audio": { "output": { "voice": "marin" } }
   }
   ```
4. OpenAI returns the SDP answer; your server relays it to the browser, which calls
   `setRemoteDescription`.
5. Events flow bidirectionally over a WebRTC data channel named **`oai-events`**, JSON-serialized,
   for both client and server events.

### Flow B — Ephemeral token (browser talks to OpenAI directly)

1. Browser requests a token from your server (e.g. `/token`).
2. Server calls `POST https://api.openai.com/v1/realtime/client_secrets` with
   `Authorization: Bearer ${apiKey}` and `OpenAI-Safety-Identifier: <hashed-user-id>`.
3. Server returns only the ephemeral `value` to the browser.
4. Browser POSTs its SDP offer directly to `/v1/realtime/calls` using the ephemeral token
   as its bearer credential.

**Recommendation for this project:** Flow A. It keeps session configuration (instructions,
tools, voice, truncation policy) server-authoritative and un-tamperable by the client, which
matters because tools will presumably touch real data. Flow B is preferable only if you want
to avoid your server sitting in the connection-setup path.

Note for mobile networks: a browser↔OpenAI WebRTC connection can require TURN relay on
restrictive carrier/corporate NATs. This is standard WebRTC territory and worth a connectivity
spike, but is not something OpenAI's docs address.

Sources:
- https://developers.openai.com/api/docs/guides/realtime-webrtc
- https://developers.openai.com/api/docs/guides/realtime

---

## 3. Ephemeral / short-lived client credentials

**Endpoint:** `POST https://api.openai.com/v1/realtime/client_secrets`
(in the API reference, pathed as `POST /realtime/client_secrets`).

**Request body** — both fields optional:

```json
{
  "expires_after": { "anchor": "created_at", "seconds": 600 },
  "session": {
    "type": "realtime",
    "model": "gpt-realtime-2.1",
    "instructions": "You are a friendly assistant."
  }
}
```

- `expires_after.anchor` — currently only `"created_at"` is supported.
- `expires_after.seconds` — **defaults to 600 (10 minutes)**; valid range **10 to 7200**
  (2 hours).
- Expiry governs how long the secret can be used to *start* a session. Per the reference,
  the session itself may continue past that time once started — so a short TTL does not
  cap conversation length.
- `session` accepts a full `RealtimeSessionCreateRequest` (or a transcription-session variant),
  so instructions/tools/voice/truncation can all be baked in server-side.

**Response shape** — three top-level fields:

```json
{
  "value": "ek_68af296e8e408191a1120ab6383263c2",
  "expires_at": 1755555555,
  "session": {
    "id": "...", "type": "realtime", "model": "...", "object": "...",
    "audio": { "input": { }, "output": { } },
    "instructions": "...", "tools": [], "tool_choice": "auto",
    "max_output_tokens": null, "output_modalities": ["audio"],
    "tracing": null, "truncation": { }, "prompt": null
  }
}
```

Ephemeral keys carry the `ek_` prefix. Only `value` should ever be handed to the browser.

**Has this API changed recently?** Yes — this endpoint *is* the change. It replaced the earlier
beta pattern of `POST /v1/realtime/sessions` returning a `client_secret` object. Ephemeral keys
now come from `/v1/realtime/client_secrets` while SDP is exchanged at `/v1/realtime/calls`. Any
spec or tutorial referencing `/v1/realtime/sessions` for token minting is stale. I found **no
changes to `client_secrets` in 2026** — the 2026 changelog has no entries touching
`client_secrets`, `/v1/realtime/calls`, or session-duration parameters, so the shape above
appears settled.

**Operational note:** the docs specify setting `OpenAI-Safety-Identifier` (a hashed, stable
per-user id) on the *server-side* request that mints the secret. Do this — it is how abuse
is attributed back to a user rather than to your whole org.

Sources:
- https://developers.openai.com/api/reference/resources/realtime/subresources/client_secrets/methods/create
- https://developers.openai.com/api/docs/guides/realtime-webrtc
- https://developers.openai.com/api/docs/changelog

---

## 4. Current pricing

Realtime is billed **per token, not per minute**. From the cost guide: "Realtime API costs are
accrued when a Response is created, and is charged based on the numbers of input and output
tokens." (Exception: *streaming translation and streaming transcription* sessions are billed by
audio duration.)

**Audio↔token conversion rates** (these are the load-bearing numbers for any cost model):

- **User (input) audio: 1 token per 100 ms** → **600 tokens per minute**
- **Assistant (output) audio: 1 token per 50 ms** → **1,200 tokens per minute**

Note the asymmetry: output audio is twice as token-dense *and* twice the unit price, so
assistant speech costs roughly 4x user speech per second.

### Current models (per 1M tokens)

| | `gpt-realtime-2.1` | `gpt-realtime-2.1-mini` |
|---|---|---|
| Audio input | **$32.00** | **$10.00** |
| Cached audio input | **$0.40** | **$0.30** |
| Audio output | **$64.00** | **$20.00** |
| Text input | $4.00 | $0.60 |
| Text output | $24.00 | $2.40 |
| Context window | 128,000 | 128,000 |
| Max output tokens | 32,000 | 32,000 |

> **Independently corroborated 2026-09-02** (primary session, second fetch of
> <https://developers.openai.com/api/docs/pricing>): the six current-model audio
> figures above are confirmed verbatim against the official pricing table —
> `gpt-realtime-2.1` audio in **$32.00** / cached **$0.40** / out **$64.00**, and
> `gpt-realtime-2.1-mini` audio in **$10.00** / cached **$0.30** / out **$20.00**.
> The cost arithmetic in §"Cost estimate" below therefore rests on verified
> numbers, not on third-party trackers. Note that a web search for mini pricing
> returns self-contradictory results (quoting both $0.60 and $10.00 for audio
> input, having conflated the text and audio rows) — **use the official pricing
> table, not search snippets, when revising the budget.**

### Deprecated models, for spec comparison (per 1M tokens)

| | `gpt-realtime` | `gpt-realtime-mini` |
|---|---|---|
| Audio input | $32.00 | **UNVERIFIED** |
| Cached audio input | $0.40 | **UNVERIFIED** |
| Audio output | $64.00 | **UNVERIFIED** |
| Text input | $4.00 | $0.60 |
| Cached text input | $0.40 | $0.06 |
| Text output | $16.00 | $2.40 |
| Context window | 32,000 | 32,000 |
| Max output tokens | 4,096 | 4,096 |

**UNVERIFIED:** the `gpt-realtime-mini` model page states its input modalities include audio
but **does not publish separate audio-input / cached-audio-input / audio-output prices** — only
the text rates. I attempted `https://developers.openai.com/api/pricing` (404) and
`https://openai.com/api/pricing/` (403 Forbidden — bot-blocked, not fetchable by this tool).
Third-party trackers report $10 / $20 audio in/out for the mini tier, matching
`gpt-realtime-2.1-mini`, but I could not confirm this on an OpenAI-owned page. Since the model
is deprecated and dies 2027-01-20, this gap is not worth resolving — do not build on it.

**Does cached input pricing exist?** **Yes, and it is dramatic.** Cached audio input is
$0.40/1M on the full model versus $32.00 fresh — a **80x** reduction (98.75% cheaper) — and
$0.30 vs $10.00 on mini (33x). Caching is applied automatically: the cost guide says prompt
caching "can dramatically reduce the costs of input tokens during multi-turn sessions." This
is not optional or opt-in, and the 2.1 release specifically credits "improved caching" for its
latency win. Any cost model that ignores caching will be badly wrong in the pessimistic
direction.

**Note on the pricing page URL:** the canonical human-readable pricing page
(`https://openai.com/api/pricing/`) returns **403 to automated fetches**. Every figure in the
tables above was instead taken from the per-model documentation pages, which are fetchable and
which I consider the more authoritative source anyway:
- https://developers.openai.com/api/docs/models/gpt-realtime-2.1
- https://developers.openai.com/api/docs/models/gpt-realtime-2.1-mini
- https://developers.openai.com/api/docs/models/gpt-realtime
- https://developers.openai.com/api/docs/models/gpt-realtime-mini
- https://developers.openai.com/api/docs/guides/realtime-costs

---

## 5. Session limits, context window, and long conversations

- **Maximum session duration: 60 minutes.** Stated flatly in the realtime conversations guide:
  "The maximum duration of a Realtime session is 60 minutes." This was raised from 30 minutes —
  the developer notes confirm "Sessions now extend to 60 minutes (previously 30)." Azure's
  hosted variant still documents a 30-minute cap, so if you ever route through Azure OpenAI,
  re-check that number.
- **Context window: 128,000 tokens** on `gpt-realtime-2.1` and `gpt-realtime-2.1-mini`
  (32,000 max output). This is a large jump from the deprecated `gpt-realtime`, which had a
  32,768-token window — the developer notes describe that older model as "allowing maximum
  28,672 input tokens after reserving 4,096 for responses."
- **What happens at 20+ minutes: nothing, and truncation is automatic if it ever triggers.**
  Two things to understand:

  **Truncation is automatic by default, and the caller may tune or disable it.** When a
  conversation approaches the token ceiling the API automatically drops the oldest messages.
  This is configurable via a `truncation` field on `session.update`:

  ```json
  {
    "type": "session.update",
    "session": {
      "truncation": { "type": "retention_ratio", "retention_ratio": 0.8 }
    }
  }
  ```

  `retention_ratio` **defaults to 1.0**, meaning "truncation will remove only the items
  necessary." Setting **0.8** retains 80% of the maximum and drops an extra 20% in one go —
  the developer notes recommend this specifically to protect prompt-caching efficiency,
  because trimming a little on every single turn invalidates the cache prefix repeatedly. You
  can also set `"truncation": "disabled"`, but then hitting the ceiling raises an **error**
  instead of degrading gracefully.

  **For a 30-minute conversation, truncation will not fire.** Do the arithmetic: 30 minutes
  split evenly between speakers is 15 min × 600 + 15 min × 1,200 ≈ **27,000 audio tokens** of
  accumulated conversation. Against a 128,000-token window that is ~21% utilization. Even a
  full 60-minute session (~54,000 tokens) stays under half. So on the current models, the
  60-minute session cap binds long before the context window does. (On the deprecated
  `gpt-realtime` with its 28,672 usable input tokens, a 30-minute conversation would have been
  right at the edge — another reason the spec's model choice mattered.)

- **Other session-lifecycle controls worth knowing:**
  - `idle_timeout_ms` on `server_vad` fires an automatic model response after user silence —
    the intended use is an "Are you still there?" nudge, which also guards against VAD failure.
  - Setting `response.conversation` to `"none"` produces **out-of-band responses** that do not
    accumulate into conversation state — useful for classification or side-channel calls that
    shouldn't pollute context or cost.
  - You can hand-build context per response via the `input` array on `response.create`,
    selectively including conversation items.
  - **Sideband connections** let a client and your server attach to the *same* session in
    parallel, so business logic and tool handling stay server-side while audio flows
    peer-to-peer. This is a strong fit for this project's trust model.
  - There is **no server-side "cap this session at N minutes"** parameter below the 60-minute
    ceiling; enforcing a shorter budget is the caller's job (client timer plus server-side
    refusal to mint new secrets).

Sources:
- https://developers.openai.com/api/docs/guides/realtime-conversations
- https://developers.openai.com/blog/realtime-api
- https://developers.openai.com/api/docs/models/gpt-realtime-2.1

---

## 6. iOS Safari specifics

This is the highest-risk area of the whole feasibility question, and the honest summary is
that **iOS constrains a voice PWA more than the Realtime API does.** Findings, with confidence
levels marked, because a lot of the widely-cited material here is stale.

### Autoplay / user-gesture requirement — confirmed, and it applies to WebRTC audio

**"A user gesture is required to initiate any audio playback – WebRTC or otherwise."** WebKit
defines a user gesture narrowly: the JavaScript "must have directly resulted from a handler for
a `touchend`, `click`, `doubleclick`, or `keydown` event." A `pointerdown`, a timer callback, or
a promise continuation several `await`s deep does **not** count.

Practical consequence: the "Start talking" button must be the thing that both calls
`getUserMedia()` and starts the remote audio element / `AudioContext`. You cannot pre-warm the
connection on page load and begin playing assistant audio later without a fresh tap.

Helpful nuance: once the page is already capturing media or playing audio, that state itself
satisfies the gesture requirement for subsequent playback — so mid-conversation audio does not
need repeated taps. It is the *initial* unlock that matters.

### `getUserMedia` restrictions — one active call at a time

iOS permits only **one active `getUserMedia()` call**. A subsequent request for an
already-requested media type will **permanently mute** the earlier tracks, with no programmatic
way to unmute. The documented workaround is to capture a single stream once, early, and then
manipulate it with `clone()`, `addTrack()`, and `removeTrack()` rather than re-calling
`getUserMedia`.

Also: WebKit only exposes real device labels *after* access is granted, so you must call
`getUserMedia()` before `enumerateDevices()` if you want to build a microphone picker.

### Backgrounding and screen lock — this is the blocker

**Microphone capture stops when the app leaves the foreground.** WebKit bug **226620**,
"Microphone stopped/paused when application goes to background," is `RESOLVED /
CONFIGURATION CHANGED`: WebKit engineer Youenn Fablet's position is that this is *expected*
behavior, and the remedy is for the embedding app to include `audio` in `UIBackgroundModes`.

**The remedy is unavailable to a PWA.** `UIBackgroundModes` is an `Info.plist` key — it belongs
to a native app binary. A home-screen web app has no `Info.plist` you control. This is the
crux, and it is corroborated in two directions:

- A 2024 comment on that same WebKit bug reports the issue **persists specifically for web apps
  installed via "Add to Home Screen," where the microphone works in Safari but fails in the
  installed app version.**
- On the Apple Developer Forums, developers wrapping a `WKWebView` natively report
  `microphoneCaptureState` flipping to muted shortly after `applicationDidEnterBackground`
  (incoming audio survives briefly, outgoing mic dies; Control Center "Mic mode" flips from
  Standard to Off and cannot be toggled back while backgrounded; calling
  `setMicrophoneCaptureState(active)` in the background does not help). The community-validated
  fix on iOS 17.5.1+ is exactly `UIBackgroundModes: audio` — which "enables background audio to
  work the same as Safari."

**Audio playback also stops when a standalone web app leaves the foreground** — WebKit bug
**198277**, "Audio stops playing when standalone web app is no longer in foreground." Related
Apple Forums reports describe lock-screen PWA audio working only until paused for ~30 seconds,
after which it stops until the PWA is foregrounded again.

**Design conclusion:** treat live voice as a **foreground, screen-on** activity. Concretely:
hold a `WakeLock` (`navigator.wakeLock.request('screen')`) for the duration of a conversation;
listen for `visibilitychange` and `pagehide` and cleanly tear down the peer connection with a
user-visible "conversation paused" state rather than letting it half-die; on return to
foreground, re-establish rather than attempting to resume. Do **not** ship a UX that implies
the user can lock their phone and keep talking.

### PWA (home screen) vs Safari tab — they differ, and the tab is better here

- **Microphone in the background:** worse in the installed PWA. Works in Safari, reported
  failing in the home-screen app (WebKit 226620, 2024 comment).
- **Audio in the background:** WebKit 198277 is filed specifically against *standalone* web apps.
- **Permission persistence:** camera/mic permission is generally re-requested per session.
  I could **not** find an authoritative statement that persistence differs between installed
  PWA and tab — **UNVERIFIED**. I checked the WebKit blog, the referenced WebKit bugs, and a
  2026 PWA-limitations survey; the survey explicitly says it does not make that comparison.
  Test this on device before relying on either behavior.
- **Background execution generally:** Background Sync, Periodic Background Sync, and Background
  Fetch are all unavailable on iOS in both contexts. No background reconnection strategy is
  possible.
- **EU regulatory wrinkle:** on iOS 17.4+ in the EU, PWAs reportedly do not run in standalone
  mode at all — they open as Safari tabs, and push notifications don't work. If the product has
  EU users, "installed PWA" is not a uniform target.

### Open iOS 26 audio bug — flagged, not fully confirmed

There are active reports (MacRumors thread; Apple Developer Forums) of **broken audio in PWAs
on iOS 26**, described as not fixed in 26.1 or 26.2 though "much better," with a pattern of
working correctly once after install and then breaking. Separately, an Apple Forums thread
reports iOS 26.1 beta Safari returning **"No AVAudioSessionCaptureDevice device"** from
`getUserMedia({audio:true})`. **I am marking the current status of these as UNVERIFIED** — they
are user bug reports, not Apple release notes, and I could not establish which iOS builds are
affected today. Given the target is a mobile-first voice PWA, **a device-matrix smoke test
across current iOS point releases should be a Phase 1 gate**, not a Phase 3 discovery.

### One widely-cited claim that is now FALSE

Older Safari/WebRTC guides state that "WebRTC APIs remain completely unavailable in `WKWebView`
containers or alternative iOS browsers," requiring Safari proper. **This is out of date.**
`getUserMedia` gained full support in web views in iOS 14.5. Do not let a stale source talk you
out of the architecture — but note that WebRTC-in-webview support is precisely *why* the
`UIBackgroundModes` discussion above exists at all.

Sources:
- https://webkit.org/blog/6784/new-video-policies-for-ios/ (user-gesture definition)
- https://webrtchacks.com/guide-to-safari-webrtc/ (gesture requirement, single-`getUserMedia`, `pagehide`; note: the WKWebView claim is stale)
- https://bugs.webkit.org/show_bug.cgi?id=226620 (microphone stopped in background; PWA-specific 2024 comment)
- https://bugs.webkit.org/show_bug.cgi?id=198277 (audio stops for standalone web app out of foreground)
- https://developer.apple.com/forums/thread/689182 (`microphoneCaptureState` muted on background; `UIBackgroundModes` fix)
- https://developer.apple.com/forums/thread/802555 (iOS 26.1 beta `getUserMedia` audio failure)
- https://forums.macrumors.com/threads/ios-26-audio-issues-in-pwa-web-apps-not-fixed-in-26-1-or-26-2-but-much-better.2466839/
- https://www.magicbell.com/blog/pwa-ios-limitations-safari-support-complete-guide (background APIs, EU standalone change)
- https://firt.dev/ios-14.5/ (`getUserMedia` in web views, iOS 14.5)

---

## 7. Tool / function calling during a realtime session

### Declaration

Tools are configured **at the session level or the individual response level** via the `tools`
property, alongside `tool_choice`:

```json
{
  "type": "session.update",
  "session": {
    "tools": [
      {
        "type": "function",
        "name": "function_name",
        "description": "What the function does",
        "parameters": {
          "type": "object",
          "properties": { },
          "required": [ ]
        }
      }
    ],
    "tool_choice": "auto"
  }
}
```

`parameters` is standard JSON Schema. Because `tools` can be set inside the `session` object
passed to `/v1/realtime/client_secrets`, tool declarations can be pinned server-side and made
un-editable by the client.

### Handling flow

1. **Detect.** Listen for `response.done` containing an item with `"type": "function_call"`,
   plus the function `name`, `arguments` (a JSON *string*, so parse it), and a `call_id`.
2. **Execute** your own code with those arguments.
3. **Return** the result with `conversation.item.create`:
   ```json
   {
     "type": "conversation.item.create",
     "item": {
       "type": "function_call_output",
       "call_id": "call_id_from_response",
       "output": "{\"result\": \"data\"}"
     }
   }
   ```
4. **Prompt** the model to speak the result by sending `response.create`.

### Long-running tools (30+ seconds)

**Current guidance: use asynchronous function calling, which the GA models support — and this
is a genuine reason not to build on the older models.**

The developer notes state that asynchronous function calling "allows sessions to continue while
awaiting responses," and that on the GA model "long-running function calls will no longer
disrupt the flow of a session." Critically, the GA model also emits **automatic placeholder
responses** so it doesn't hallucinate: rather than fabricating a result, the model tells the
user it is "still waiting on" the pending function result.

By contrast, on the older beta behavior a `function_call` event paused execution until the
function returned, producing long dead-air gaps. OpenAI also notes that "because the beta model
lacks async function calling, pending MCP tool calls without an output may not be treated well
by the model," and explicitly **recommends using the GA model with MCP**.

**Caveat on documentation quality:** the dedicated function-calling guide page
(`/api/docs/guides/realtime-function-calling`) documents only the **synchronous** flow and
contains **no guidance on async or long-running tools**. The async behavior is documented in
the developer-notes blog post, not the reference guide. So the *behavior* is verified, but the
**exact wire-level mechanics of async tool calls — whether any explicit field marks a call as
async, and how to opt out — is UNVERIFIED.** I searched the function-calling guide, the
conversations guide, and the changelog; the guide is silent, and the only opt-out discussion
I found was a community thread titled "Disabling asynchronous tool calling with gpt-realtime,"
which suggests developers have had to ask rather than read it. **Recommended practice for
Phase 1: build a 30-second tool against `gpt-realtime-2.1` and observe the event stream
directly**, rather than trusting either the guide or this document.

**Design recommendation regardless:** for any tool over ~2 seconds, do not rely solely on
model-generated filler. Return an immediate acknowledgement item, do the work out-of-band on
your server (sideband connection is ideal here), and inject the real result as a
`function_call_output` when it lands. This keeps you insulated from changes in the model's
placeholder behavior.

Sources:
- https://developers.openai.com/api/docs/guides/realtime-function-calling
- https://developers.openai.com/blog/realtime-api
- https://developers.openai.com/api/docs/guides/realtime-conversations

---

## 8. Interruption / barge-in

**Good news for this project: on WebRTC, barge-in is essentially free.**

### Built in (server-side)

- **Voice activity detection cancels the in-flight response.** Server VAD automatically detects
  user speech and cancels the ongoing response.
- **On WebRTC and SIP, the server truncates unplayed audio itself.** Quoting the conversations
  guide: "The server will automatically truncate unplayed audio when there's a user
  interruption." This is the key asymmetry with WebSocket, and a real argument for WebRTC
  beyond latency: the server knows what the client has actually played, so the conversation
  transcript stays consistent with what the user heard — which matters because unheard audio
  you were billed for should not remain in context as though the user heard it.
- `gpt-realtime-2.1` specifically claims **improved "silence and noise handling, and
  interruption behavior"** over `gpt-realtime-2`.

### The client must implement

- **On WebRTC:** relatively little. Stop/flush local playback promptly on interruption so the
  user isn't hearing a tail of audio the server has already discarded, and keep the mic track
  live rather than gating it while the assistant speaks (gating the mic defeats barge-in
  entirely). Echo cancellation is on you: without it the assistant's own output will trip VAD
  and it will interrupt itself. Rely on `getUserMedia` constraints
  (`echoCancellation: true`, `noiseSuppression: true`, `autoGainControl: true`) — and note that
  on iOS these are most reliable when audio is routed through the standard WebRTC path rather
  than a hand-rolled `AudioContext` graph.
- **On WebSocket:** substantially more. Clients "must manually stop audio playback and send
  `conversation.item.truncate` events specifying the `item_id`, `content_index`, and
  `audio_end_ms` to remove unplayed portions." Getting `audio_end_ms` right requires the client
  to track its own playback position accurately — this is a well-known source of bugs and is a
  strong reason to prefer WebRTC for a browser client.
- **Push-to-talk** (if desired) is done by disabling VAD entirely with `"turn_detection": null`
  and driving turns manually. Worth keeping as a fallback UX for noisy environments, and it
  also sidesteps echo-cancellation problems.
- **Silence handling:** `idle_timeout_ms` on `server_vad` triggers an automatic model response
  after user silence, intended for "Are you still there?" checks and as a guard against VAD
  failing to fire.

Sources:
- https://developers.openai.com/api/docs/guides/realtime-conversations
- https://developers.openai.com/blog/realtime-api
- https://developers.openai.com/api/docs/models/gpt-realtime-2.1

---

## Cost estimate: ~30 minutes of voice per day

### Assumptions (stated explicitly so they can be challenged)

- 30 minutes of *conversation* per day, 30 days/month.
- Speaking time splits evenly: **15 min user audio in, 15 min assistant audio out**.
- Token conversion, per the cost guide: user audio **1 token / 100 ms** = 600 tok/min;
  assistant audio **1 token / 50 ms** = 1,200 tok/min.
- Delivered as one ~30-minute session per day (so caching stays warm). Splitting into many
  short sessions increases uncached input.
- Text tokens (instructions, tool arguments/results, transcripts) excluded — see caveats.

### Step 1 — daily audio token volume

```
user audio in:      15 min × 600 tok/min   =  9,000 tokens/day
assistant audio out:15 min × 1,200 tok/min = 18,000 tokens/day
accumulated context at end of session       = 27,000 tokens
```

### Step 2 — naive floor (ignores context re-send)

This is the number most specs write down, and it is **too low**:

**`gpt-realtime-2.1`**
```
audio in:   9,000 × $32/1,000,000 = $0.288/day
audio out: 18,000 × $64/1,000,000 = $1.152/day
                             day  = $1.440
                    × 30 = $43.20/month
```

**`gpt-realtime-2.1-mini`**
```
audio in:   9,000 × $10/1,000,000 = $0.090/day
audio out: 18,000 × $20/1,000,000 = $0.360/day
                             day  = $0.450
                    × 30 = $13.50/month
```

### Step 3 — realistic estimate (accounts for context re-send + caching)

Realtime is **stateful**: every turn re-submits the accumulated conversation as input. Only the
*new* user audio is fresh; the rest hits the cache.

Assume ~10 s of user speech + ~10 s of assistant speech per turn → 20 s/turn →
**~90 turns** in 30 minutes. Average context carried at each turn ≈ half the final 27,000 ≈
**13,500 tokens**.

```
total input tokens submitted/day ≈ 90 turns × 13,500 = 1,215,000 tokens
  of which fresh (new user audio)                    =     9,000 tokens
  of which cached                                    ≈ 1,206,000 tokens
```

**`gpt-realtime-2.1`**
```
fresh audio in:     9,000 × $32.00/1M = $0.288
cached audio in: 1,206,000 × $0.40/1M = $0.482
audio out:         18,000 × $64.00/1M = $1.152
                                  day = $1.922
                     × 30 ≈ $57.66/month
```

**`gpt-realtime-2.1-mini`**
```
fresh audio in:     9,000 × $10.00/1M = $0.090
cached audio in: 1,206,000 × $0.30/1M = $0.362
audio out:         18,000 × $20.00/1M = $0.360
                                  day = $0.812
                     × 30 ≈ $24.36/month
```

### Summary

| Model | Naive floor | Realistic (with context re-send + caching) |
|---|---|---|
| `gpt-realtime-2.1` | $43.20/mo | **≈ $58/mo** |
| `gpt-realtime-2.1-mini` | $13.50/mo | **≈ $24/mo** |

Roughly **$0.064/min** (full) and **$0.027/min** (mini) all-in at this usage shape.
Mini is about **2.4x cheaper**. Independent third-party estimates in the same ballpark
(~$0.05/min full, ~$0.016/min mini) corroborate the order of magnitude; the difference is
mostly whether context re-send is modeled.

**Note how much caching matters:** without it, that 1,206,000 tokens of re-sent context would
cost $38.59/day on the full model — about **$1,158/month**, a 20x blowup. Caching is the only
reason conversational realtime is affordable at all, which makes the `retention_ratio: 0.8`
tuning discussed in section 5 a *cost* lever, not just a context lever.

### Caveats on these numbers

- **Assistant talk-time dominates.** Output audio is ~60% of realistic cost on the full model
  and ~44% on mini. The single highest-leverage cost control is prompting for **shorter, less
  chatty replies** — cutting assistant speech from 15 to 10 min/day saves ~$11.5/mo on full.
  This beats any model-tier optimization at the margin.
- **Text tokens excluded.** System instructions, tool schemas, tool arguments/results, and any
  text output are billed on top. A verbose system prompt re-sent every turn is cached after the
  first hit, but tool-heavy flows will add real cost. Budget +10-20% headroom.
- **Turn count is a guess.** 90 turns is an assumption, not a measured figure, and cached-input
  cost scales roughly linearly with it. A conversation with many short exchanges costs more
  than one with few long ones, at identical audio minutes.
- **Session shape matters.** 30 minutes as six 5-minute sessions costs more than one 30-minute
  session, because each new session starts with a cold cache.
- **OpenAI's own recommendation is to measure, not model.** The cost guide declines to publish
  per-minute figures and instead advises: "use the Realtime Playground with your intended
  prompts and functions, and measure the token usage over a sample session." Treat everything
  above as a planning envelope and replace it with a measured figure in Phase 1.

---

## Risks and open questions

### High

1. **The spec targets deprecated models.** `gpt-realtime` and `gpt-realtime-mini` are removed
   from the API on **2027-01-20**. Update the spec to `gpt-realtime-2.1` /
   `gpt-realtime-2.1-mini` before any code is written. Secondary benefit: the 2.1 models have a
   **128k** context window versus 32k, which is what makes long conversations safe.
2. **iOS backgrounding breaks live voice, and a PWA cannot fix it.** The WebKit-sanctioned
   remedy (`UIBackgroundModes: audio`) requires a native `Info.plist`. If "keep talking with
   the screen locked" or "keep talking while switching apps" is a product requirement, a PWA
   **cannot** deliver it and the project needs a native/Capacitor shell. **This needs a product
   decision in Phase 0, not an engineering workaround in Phase 3.**
3. **Home-screen PWA is worse than a Safari tab for microphone reliability**, per the 2024
   comment on WebKit 226620. If "Add to Home Screen" is the intended distribution, validate mic
   capture in *standalone display mode specifically* on real hardware — a Safari-tab test will
   pass and mislead you.
4. **Possible active iOS 26 PWA audio regressions (UNVERIFIED).** Multiple credible user
   reports, no Apple confirmation, unclear which builds are affected. Gate Phase 1 on a device
   smoke test across current iOS point releases.

### Medium

5. **Async tool-call mechanics are under-documented.** Behavior is confirmed in the developer
   notes; the wire format and opt-out are not in the reference guide. Verify empirically before
   designing around it.
6. **Cost is sensitive to assistant verbosity and turn count**, both of which are prompt-design
   choices rather than infrastructure choices. Instrument token usage per session from day one
   so the estimate can be replaced with a measurement.
7. **TURN relay may be needed** on restrictive mobile/corporate networks. Not covered by
   OpenAI's docs; budget a connectivity spike and possibly a TURN provider.
8. ~~**`gpt-realtime-mini` audio pricing is UNVERIFIED**~~ — **RESOLVED as a
   non-risk, 2026-09-02.** The gap applies only to the *deprecated* mini, which
   dies 2027-01-20 and must not be built on. All six audio figures for the two
   *current* models were independently re-verified against the official pricing
   table (see the corroboration note in section 4), so the budget arithmetic
   rests on verified numbers. No action needed.
9. **Echo cancellation on iOS** is the practical make-or-break for barge-in quality. Untested
   here. If the assistant interrupts itself, barge-in feels broken even though the API is
   working correctly.
10. **EU PWA standalone-mode divergence** (iOS 17.4+) means "installed PWA" is not a uniform
    platform if there are EU users.

### Open questions to resolve in Phase 1

- Does mic permission persist across launches in standalone display mode? (**UNVERIFIED**;
  test on device.)
- What is the actual measured token usage for a representative 30-minute session with the real
  system prompt and tool set? (Replaces the whole cost model above.)
- Does async tool calling expose any explicit wire-level marker, and can it be disabled?
- Is `retention_ratio: 0.8` beneficial at this session length, or irrelevant given that a
  30-minute session uses only ~21% of a 128k window? (Likely irrelevant — verify, then drop it
  from scope if so.)
- Flow A (server-proxied SDP) vs Flow B (ephemeral token direct): measure the added
  connection-setup latency of proxying through our own server on mobile networks.
- Does a sideband connection cleanly cover the "tools run server-side, audio flows
  peer-to-peer" requirement?

---

## Sources

**OpenAI official documentation**
- Realtime and audio guide — https://developers.openai.com/api/docs/guides/realtime
- Realtime with WebRTC — https://developers.openai.com/api/docs/guides/realtime-webrtc
- Realtime conversations (session limits, truncation, interruption, VAD) — https://developers.openai.com/api/docs/guides/realtime-conversations
- Realtime function calling — https://developers.openai.com/api/docs/guides/realtime-function-calling
- Managing realtime costs (token conversion rates, caching) — https://developers.openai.com/api/docs/guides/realtime-costs
- Deprecations — https://developers.openai.com/api/docs/deprecations
- Changelog — https://developers.openai.com/api/docs/changelog
- Models catalog — https://developers.openai.com/api/docs/models
- `gpt-realtime-2.1` model page (pricing, 128k context) — https://developers.openai.com/api/docs/models/gpt-realtime-2.1
- `gpt-realtime-2.1-mini` model page (pricing) — https://developers.openai.com/api/docs/models/gpt-realtime-2.1-mini
- `gpt-realtime` model page (deprecated) — https://developers.openai.com/api/docs/models/gpt-realtime
- `gpt-realtime-mini` model page (deprecated) — https://developers.openai.com/api/docs/models/gpt-realtime-mini
- Create client secret API reference — https://developers.openai.com/api/reference/resources/realtime/subresources/client_secrets/methods/create
- Developer notes on the Realtime API (60-min sessions, retention_ratio, async tools, sideband) — https://developers.openai.com/blog/realtime-api
- `gpt-realtime-2.1` release announcement, 2026-07-06 — https://community.openai.com/t/new-realtime-models-on-the-api-gpt-realtime-2-1-and-gpt-realtime-2-1-mini/1385896

**Apple / WebKit**
- New `<video>` policies for iOS (user-gesture definition) — https://webkit.org/blog/6784/new-video-policies-for-ios/
- WebKit bug 226620 — Microphone stopped/paused when application goes to background — https://bugs.webkit.org/show_bug.cgi?id=226620
- WebKit bug 198277 — Audio stops playing when standalone web app is no longer in foreground — https://bugs.webkit.org/show_bug.cgi?id=198277
- Apple Developer Forums 689182 — WKWebView getUserMedia microphone gets muted in background — https://developer.apple.com/forums/thread/689182
- Apple Developer Forums 802555 — iOS 26.1 beta Safari audio input broken — https://developer.apple.com/forums/thread/802555
- Apple Developer Forums 762582 — iOS audio lockscreen problem in PWA — https://developer.apple.com/forums/thread/762582

**Third-party / corroborating (used only where marked)**
- Guide to WebRTC with Safari in the Wild, webrtcHacks — https://webrtchacks.com/guide-to-safari-webrtc/ (note: WKWebView-unsupported claim is stale)
- iOS 14.5 / Safari 14.1 for PWAs, firt.dev — https://firt.dev/ios-14.5/
- PWA iOS Limitations and Safari Support (2026), MagicBell — https://www.magicbell.com/blog/pwa-ios-limitations-safari-support-complete-guide
- iOS 26 audio issues in PWA web apps, MacRumors — https://forums.macrumors.com/threads/ios-26-audio-issues-in-pwa-web-apps-not-fixed-in-26-1-or-26-2-but-much-better.2466839/
- OpenAI Realtime API over WebRTC: when you need TURN — https://medium.com/@jamesbordane57/openai-realtime-api-over-webrtc-how-it-works-when-you-need-turn-2a3abcdda451
- OpenAI Realtime API Pricing 2026: cost-per-minute math (corroborating order of magnitude) — https://www.layer3labs.io/guides/openai-realtime-api-pricing

**Could not be fetched**
- `https://openai.com/api/pricing/` — HTTP 403 Forbidden to automated fetch. All pricing above
  taken from per-model documentation pages instead.
- `https://developers.openai.com/api/pricing` — HTTP 404.
