# Slack "Internal Office" + Telegram "Pager" — Phase 0 Feasibility

Research date: **2 September 2026**. Every number below was fetched live from official
documentation on that date; anything not confirmed against a primary source is marked
**UNVERIFIED**.

---

## Verdict

**Per-staff Slack identities: FEASIBLE on the Free plan, with conditions.**

Two viable routes, and the recommended one is a hybrid:

1. **8 separate custom Slack apps is technically possible** — the Free plan cap is **10
   third-party or custom app installations per workspace**, so 8 staff bots fit with 2 slots
   spare. But it consumes 80% of the workspace's app budget, and each app must be created by
   hand in the Slack UI at least once (see #3), so it is 8 manual creations and 8 token/secret
   sets to manage.
2. **1 app + `chat:write.customize` per-message `username`/`icon_url` overrides works and is
   not deprecated** — this is the cheap path to 8 visual identities. Caveat: every message
   still renders as a bot message with Slack's **APP** badge and all 8 identities collapse to
   one app in the workspace's app list, one set of DMs, and one set of `@mentions`.

**The deciding factor is not the app cap — it is whether staff need to be individually
mentionable/DM-able.** Overrides give appearance only; separate apps give real, addressable
bot users. Recommended architecture below splits the difference.

**Per-staff Telegram bots: FEASIBLE.** No documented Bot API or BotFather cap is published by
Telegram, and the widely-reported practical BotFather limit (20 bots per account, 40 for
Premium) is comfortably above 8. As of **Bot API 9.4 (9 Feb 2026)** even the **profile photo is
now API-settable** (`setMyProfilePhoto`) — so a Telegram staff bot can be fully provisioned
programmatically *except* for the initial `/newbot` creation in BotFather.

**Biggest spec assumption that proved wrong:** the long-standing "you must set a bot's avatar
manually in BotFather" rule is **obsolete**. `setMyProfilePhoto` / `removeMyProfilePhoto` were
added in Bot API 9.4. Second wrong assumption: the May 2025 Slack rate-limit crackdown does
**not** apply here — internal custom apps are explicitly exempt.

---

## SLACK

### 1. Free plan current limits

Fetched from the Slack Help Center on 2026-09-02:

- **Message history: 90 days.** "Limited to the most recent 90 days." Data older than one year
  is permanently deleted from free workspaces.
- **Apps/integrations: 10.** Verbatim: *"You'll be limited to 10 third-party or custom app
  installations."* To add an 11th you must uninstall one.
- **Custom vs marketplace: no distinction for the cap.** The wording is "third-party **or
  custom**", so an app you build yourself consumes a slot exactly like a Marketplace app.
  There is no separate, larger allowance for self-built apps on Free.
- Also gone on Free: Workflow Builder, custom user groups, Slack Connect, canvases/lists
  (read-only), channel email addresses, custom retention. File storage is 5 GB workspace-wide.

The 90-day history limit matters for an "internal office": **agent conversation history older
than 90 days is invisible via Slack search/API.** Any long-term memory must be persisted
outside Slack.

Source: https://slack.com/help/articles/27204752526611-Slack-Free-plan-limits

### 2. Can one workspace host 8 separate custom apps on Free?

**Yes.** 8 ≤ 10. The 10-app ceiling is per workspace and counts custom apps, so 8 staff apps
leaves 2 slots for anything else (e.g. a GitHub integration and one spare). There is no
documented lower cap that applies specifically to unpublished/internal apps.

**UNVERIFIED:** whether Slack imposes a limit on how many *apps a single developer account may
create* (as opposed to install). I searched Slack's docs and help center and found no
published per-developer app-creation limit. Treat "no limit" as unconfirmed rather than
guaranteed.

Sources:
- https://slack.com/help/articles/27204752526611-Slack-Free-plan-limits
- https://docs.slack.dev/app-manifests/configuring-apps-with-app-manifests

### 3. App Manifest automation — can Claude Code create Slack apps programmatically?

**Almost, but there is one unavoidable manual step.**

Current, live methods (all present in docs as of 2026-09-02):

| Method | Purpose |
|---|---|
| `apps.manifest.create` | Create a brand-new app from a manifest |
| `apps.manifest.update` | Update an existing app's manifest |
| `apps.manifest.export` | Export an existing app's manifest |
| `apps.manifest.validate` | Validate a manifest against the schema |

**Token requirements:** all four require an **app configuration access token** (`xoxe.xoxp-…`),
which is *not* a bot or user token and is not obtained via OAuth.

**How it is obtained — the manual step:** you must click **"Generate Token"** in the *Your Apps*
settings page in the Slack UI, per workspace. There is no documented API to mint the first app
configuration token. Slack's own docs describe it as created "through the app settings page".

**Expiry and non-interactive refresh:** the access token **expires 12 hours** after generation.
It is issued together with an `xoxe-…` **refresh token**, and `tooling.tokens.rotate` exchanges
the refresh token for a fresh 12-hour access token plus a *new* refresh token (the old one is
replaced — you must persist the rotated value). Slack advises refreshing proactively rather
than waiting for the expiry error.

**Practical answer for Claude Code:** the bootstrap is one human action per workspace (generate
the first config token pair). After that, creating all 8 apps, setting their names, icons,
scopes, event subscriptions and request URLs *is* fully programmatic via
`apps.manifest.create`/`update`, and the token can be kept alive indefinitely and
non-interactively via `tooling.tokens.rotate`. **Installing** each app into the workspace and
retrieving its bot token still goes through the OAuth install flow (or the "Install to
Workspace" button), which is a second per-app manual/browser step.

Sources:
- https://docs.slack.dev/app-manifests/configuring-apps-with-app-manifests
- https://docs.slack.dev/reference/methods/tooling.tokens.rotate

### 4. Distinct identities WITHOUT separate apps — `username` / `icon_url` / `icon_emoji`

**Status: alive, supported, not deprecated.** Confirmed on the current `chat.postMessage`
reference page (2026-09-02).

- `username`, `icon_url`, `icon_emoji` are still documented arguments on `chat.postMessage`.
- They **require the `chat:write.customize` scope** in addition to `chat:write`. This is a
  current bot scope, not a legacy/classic-app artifact (the *legacy* thing here is `as_user`,
  which docs still describe as existing for classic apps but "not recommended" for modern apps).
- **Not deprecated**, but explicitly guard-railed. The docs frame it as ethically constrained:
  *"This is a powerful ability and must only be used when the user themselves gives permission
  to do so."* Guidance: use it in response to explicit user action, signpost it in advance, and
  never surprise a user that a message was posted on their behalf.

**Important limitation for identity design:** the message is still a bot message from one app.
Slack renders the **APP** badge, and the overridden name/icon are cosmetic — they do not create
a bot user, so an overridden identity is **not mentionable, not DM-able, and does not appear in
the member list**. `username` overrides are also known to interfere with file display in
messages (files silently not rendering in-channel when `username` is set).

Read the docs' "permission" language carefully in context: it targets impersonating *humans*.
Presenting a clearly-labelled fictional AI staff member ("Ada — Research") from your own
internal app, in your own workspace, with the APP badge visible, is a materially different act
from posting as a real coworker. It is still worth an explicit in-workspace notice.

Sources:
- https://docs.slack.dev/reference/methods/chat.postMessage
- https://github.com/slackapi/node-slack-sdk/issues/1595 (files + `username` interaction)

### 5. Slack policy: proactive messages and impersonation

From the **Slack App Developer Policy** (fetched 2026-09-02). Verbatim clauses:

Under **Law and Safety**, prohibited:
> "Allowing impersonation of Users or otherwise allowing for false representations within the
> Application"

> "Spamming, harassing, stalking, intimidating or threatening Users"

Under **User Experience**, prohibited:
> "Displaying inappropriate communications through your Application. The purpose of the
> Application and User expectations must be clear and transparent and match Slack requirements
> and expectations"

From **`chat.postMessage`** reference, on the customize parameters:
> "This is a powerful ability and must only be used when the user themselves gives permission
> to do so."

The **Slack API Terms of Service** does not itself contain impersonation/spam language; it
incorporates the Developer Policy and Acceptable Use Policy by reference:
> "Your license to access our APIs is limited and subject to compliance with the Slack
> Application Developer Policy and Slack's Brand Guidelines."

**Compliance flags for this project:**

- ✅ **Fictional AI staff identities are not "impersonation of Users."** The prohibition is on
  impersonating *Users* (real people) and on "false representations". Named AI personas that are
  visibly bots (APP badge) and disclosed as AI are defensible.
- 🚩 **Never give a persona the name, avatar, or handle of a real person** on the team or
  elsewhere. That crosses directly into the quoted clause.
- 🚩 **Proactive messages are not banned, but "Spamming… Users" is.** Slack publishes no
  numeric definition of spam for internal apps; the practical guardrails are the rate limits
  (#7) and the "clear and transparent" purpose requirement. Agents should not initiate
  unsolicited DMs to workspace members who have not opted in.
- ✅ **Transparency obligation is satisfiable cheaply**: pin a channel canvas/message naming
  every persona, stating it is AI, and naming the single underlying app.
- Note the Developer Policy is written primarily for *distributed/Marketplace* apps. For a
  single-workspace internal app the enforcement surface is essentially the workspace owner's
  own consent — which you have. It still binds you contractually via the API ToS.

Sources:
- https://docs.slack.dev/developer-policy/
- https://slack.com/terms-of-service/api
- https://docs.slack.dev/reference/methods/chat.postMessage

### 6. Socket Mode vs Events API (HTTP) for serverless/edge

**Use HTTP (Events API). Socket Mode is wrong for serverless — confirmed.**

Slack's own comparison page states:
> "To have the highest possible reliability for application connectivity, we recommend using
> HTTP for production applications."

and, on Marketplace:
> "if you intend to submit your app to be available in the Slack Marketplace, using HTTP is a
> requirement."

- **Socket Mode requires a persistently connected process** — it is a long-lived WebSocket, so
  the process must stay running to hold the connection. A free serverless/edge host with no
  always-on worker **cannot** sustain it.
- Socket Mode's documented use cases are local development, corporate firewalls, and on-prem
  integrations with no inbound HTTP — not production hosting.
- HTTP request URLs are atomic and stateless, which matches serverless request/response.
- **Events API delivery cap:** 30,000 event deliveries per workspace per app per 60 minutes;
  exceeding it fires an `app_rate_limited` event. With 8 apps each subscribed to workspace
  events, budget this per app, and subscribe each app to the *narrowest* event set possible.

Sources:
- https://docs.slack.dev/apis/events-api/comparing-http-socket-mode
- https://docs.slack.dev/apis/events-api/
- https://docs.slack.dev/apis/rate-limits

### 7. Rate limits, including the 2025 non-Marketplace tightening

**Standard tiers** (current):

| Tier | Budget |
|---|---|
| Tier 1 | 1+ / minute |
| Tier 2 | 20+ / minute |
| Tier 3 | 50+ / minute |
| Tier 4 | 100+ / minute |

Bursts are allowed; Slack deliberately does not publish burst sizes.

**`chat.postMessage` special limit:** **1 message per second per channel**, with limited burst
tolerance, plus a workspace-level ceiling described as "several hundred messages per minute".
Sustained violation can get an app disconnected or permanently disabled.

**429 handling:** Slack returns `HTTP 429 Too Many Requests` with a `Retry-After` header; honour
it.

**The 2025 change — and why it does not bite here.** Effective **29 May 2025**, Slack cut
`conversations.history` and `conversations.replies` to **1 request per minute with a maximum of
15 objects per request**. Verbatim on who is affected:

> "applications that are commercially distributed outside of the Marketplace (also called
> 'unlisted' apps)"

and verbatim on the exemption:

> "Internal customer-built applications are not impacted by these changes. For Custom apps, the
> `conversations.history` and `conversations.replies` API methods are limited to 50+ requests per
> minute. The maximum and default values for the `limit` parameter are 1,000 objects."

A follow-up clarification changelog (3 June 2025) reiterates that internal customer-built apps
keep their existing rate limits. Marketplace-approved apps were also unchanged. New unlisted
distributed apps and their new installs were hit immediately from 29 May 2025; existing
installs of unlisted distributed apps were brought in from **2 September 2025**.

**Conclusion:** 8 internal, single-workspace, undistributed custom apps retain **Tier 3 (50+/min,
1,000 objects)** on history reads. **Do not distribute these apps** (do not enable public
distribution / "Manage Distribution") or they reclassify as unlisted-distributed and drop to
1 req/min with 15 objects — which would cripple an agent that reads channel history.

Sources:
- https://docs.slack.dev/apis/rate-limits
- https://docs.slack.dev/changelog/2025/05/29/rate-limit-changes-for-non-marketplace-apps/
- https://docs.slack.dev/changelog/2025/06/03/rate-limits-clarity/

---

## TELEGRAM

### 8. Running 8+ bots for one user

- **Official docs publish no bot-count limit.** The Telegram Bots FAQ does not state how many
  bots one account may create. Verified by fetching the FAQ on 2026-09-02.
- **Community-verified practical limit: 20 bots per account, 40 with Telegram Premium.** The
  BotFather refusal text reported is: *"Sorry, you can't add more than 40 bots. To create a new
  bot, delete one of your bots or transfer ownership of one of your bots to a different
  person."* This is **UNVERIFIED against official documentation** — the only sources are the
  Telegram-Limits tracker and community reports. I tried the official Bots FAQ and Bot API docs;
  neither documents a cap.
- **8 bots is therefore safely under even the non-Premium figure.**
- **No limit found on how many bots one user can be in conversation with.** Not documented, and
  no practical reports of a cap. **UNVERIFIED** — searched the Bots FAQ and Bot API docs.
- Each bot has its own token, own chat with the user, own `/commands`, own avatar and own name.
  This is the cleanest per-staff identity story available on either platform.

Sources:
- https://core.telegram.org/bots/faq
- https://github.com/tginfo/Telegram-Limits/issues/288 (community, unofficial)

### 9. Programmatic setup: webhook and bot metadata

**Bot API version at time of writing: 10.3 (24 August 2026).**

**`setWebhook` — fully API-settable.** Verbatim from the current reference:
> "Use this method to specify a URL and receive incoming updates via an outgoing webhook.
> Whenever there is an update for the bot, we will send an HTTPS POST request to the specified
> URL, containing a JSON-serialized Update."

Parameters: `url` (required, HTTPS; empty string removes the webhook), `certificate`,
`ip_address`, `max_connections` (1–100, **default 40**), `allowed_updates`,
`drop_pending_updates`, `secret_token` (1–256 chars; delivered back in the
`X-Telegram-Bot-Api-Secret-Token` header — **use it, it is the only authentication on your
webhook endpoint**).

**Metadata — what is API-settable (all verified in current docs):**

| Field | Method | Constraint |
|---|---|---|
| Name | `setMyName` | `name`, 0–64 chars, optional `language_code` |
| Description (empty-chat blurb) | `setMyDescription` | `description`, 0–512 chars |
| Short description (profile page / share link) | `setMyShortDescription` | `short_description`, 0–120 chars |
| Commands | `setMyCommands` | `commands` array, **max 100**, optional `scope` + `language_code` |
| **Profile photo** | **`setMyProfilePhoto`** | `photo: InputProfilePhoto` (required) |
| Remove profile photo | `removeMyProfilePhoto` | no parameters |
| Menu button | `setChatMenuButton` | optional `chat_id`, `menu_button` |

`InputProfilePhoto` is one of `InputProfilePhotoStatic` (`.JPG`) or `InputProfilePhotoAnimated`.
Note: *"Profile photos can't be reused and can only be uploaded as a new file"* — so you must
`attach://` a fresh multipart upload each time, not pass a `file_id`.

**Correcting the old assumption:** `setMyProfilePhoto` and `removeMyProfilePhoto` were **added in
Bot API 9.4, 9 February 2026**, described in the changelog as *"allowing bots to manage their
profile picture."* Avatars are therefore **no longer** a BotFather-only manual step. Any
guide/spec that says otherwise is out of date.

**What still requires BotFather manually:**
- **Creating the bot** (`/newbot`) and receiving the initial token. There is no Bot API method to
  create a bot. This is the one unavoidable manual step per staff bot — 8 short BotFather
  exchanges, once.
- Username changes, token revocation, inline mode toggles, privacy mode, group-admin defaults,
  paid broadcast enablement, and deletion also live in BotFather.

Sources:
- https://core.telegram.org/bots/api
- https://core.telegram.org/bots/api-changelog

### 10. Current Bot API rate limits and 429 handling

Verbatim from the Bots FAQ ("My bot is hitting limits, how do I avoid this?"):

> "By default, bots are able to message their users **at no cost** – but have limitations on the
> number of messages they can broadcast in a single interval."

- **Per chat:** "avoid sending more than one message per second". Short bursts may be tolerated,
  but sustained excess yields 429s.
- **Per group:** "bots are not be able to send more than 20 messages per minute" *(sic — the
  typo is in the source)*.
- **Bulk/global broadcast:** "bots are not able to broadcast more than about 30 messages per
  second, unless they enable paid broadcasts".
- **Paid broadcasts:** enabled in @BotFather, raises the ceiling to **1,000 messages/second**;
  messages beyond the free 30/s cost **0.1 Stars** each. Eligibility requires **≥100,000 Stars
  balance and ≥100,000 monthly active users** — irrelevant for an 8-bot internal pager.

**429 handling — the correct pattern.** On flood control, Telegram returns `ok: false` with an
`error_code` and a `parameters` object of type `ResponseParameters` containing:
> `retry_after` — "In case of exceeding flood control, the number of seconds left to wait before
> the request can be repeated"

So: parse `parameters.retry_after`, sleep **exactly** that many seconds (plus small jitter), then
retry the *same* request. Do **not** use a blind exponential backoff that ignores `retry_after`,
and do **not** retry immediately — repeated violations escalate the penalty. Maintain a
per-chat 1 msg/s token bucket and a global ~25–30 msg/s bucket per bot to stay under the limits
proactively rather than reacting to 429s.

For a pager: 8 bots × 1 msg/s per chat is ample. The real risk is a fan-out storm (all 8 staff
paging simultaneously about the same incident) — coalesce those upstream.

Sources:
- https://core.telegram.org/bots/faq
- https://core.telegram.org/bots/api

### 11. Webhook retry semantics and callback idempotency

Verbatim from `setWebhook`:
> "In case of an unsuccessful request (a request with response HTTP status code different from
> 2XY), we will repeat the request and give up after a reasonable amount of attempts."

That is the *entire* documented retry contract. Telegram publishes **no** retry count, no backoff
schedule, no delivery-ordering guarantee, and no at-most-once guarantee. The separate webhooks
guide (https://core.telegram.org/bots/webhooks) covers only TLS/domain/port setup and says
nothing about retries — verified by fetching and searching the full page.

**Implications — this is the "pressing Undo twice" problem, and it is real:**

1. **Deliveries are at-least-once.** A handler that times out, 500s, or returns any non-2xx will
   be re-delivered. A handler that *succeeds slowly* and gets cut off by the host's timeout will
   also be re-delivered even though the side effect already happened.
2. **Therefore: acknowledge first, act second.** Return `200 OK` as fast as possible, then do the
   work — or better, make the work idempotent (below). On serverless this means the ack must not
   wait on the agent's reasoning.
3. **`max_connections` defaults to 40**, so up to 40 concurrent deliveries can hit your endpoint
   at once. Two deliveries of the same update can therefore be in flight *simultaneously* — a
   naive "have I seen this before?" check without a lock races.
4. **Idempotency keys.** Every `Update` carries a unique `update_id`; every `CallbackQuery`
   carries a unique `id`. Persist processed ids (with TTL) in a store with a **conditional /
   compare-and-set write** and drop duplicates. Prefer the *action* being idempotent over the
   *delivery* being deduplicated: model Undo as "set state to X" (absolute), never "reverse the
   last operation" (relative) — an absolute write applied twice is harmless, a relative one is a
   double-undo bug.
5. **`answerCallbackQuery` must be called** for every callback query, and callback query ids
   expire — a retried delivery may carry an already-expired id, which errors. Treat that error as
   benign.
6. **Consider `drop_pending_updates: true`** when re-registering a webhook after an outage, to
   avoid a thundering herd of stale button presses being replayed against current state.
7. **No ordering guarantee** means two rapid button presses can arrive out of order. Include a
   monotonic version/sequence in the callback payload and reject stale ones.

Sources:
- https://core.telegram.org/bots/api (`setWebhook`, `Update`, `CallbackQuery`, `answerCallbackQuery`)
- https://core.telegram.org/bots/webhooks

### 12. Voice notes — `sendVoice` requirements

Verbatim from the current Bot API reference:

> "Use this method to send audio files, if you want Telegram clients to display the file as a
> playable voice message. For this to work, your audio must be in an .OGG file encoded with
> OPUS, or in .MP3 format, or in .M4A format (other formats may be sent as Audio or Document).
> On success, the sent Message is returned. Bots can currently send voice messages of up to
> **50 MB** in size, this limit may be changed in the future."

Notes for implementation:
- **OGG/Opus is the native, correct choice** — it renders as a true voice note with a waveform,
  and it is what Telegram clients record. MP3/M4A are now accepted too (a relaxation from the
  historical OGG/Opus-only rule), but Opus is smallest and safest.
- Anything else silently degrades to an `Audio` or `Document` attachment — no waveform, no
  voice-note UI. That is the failure mode to watch for.
- Useful optional params on `sendVoice`: `duration` (seconds — set it, clients show it before
  download), `caption`, `parse_mode`, `disable_notification`, `reply_parameters`,
  `business_connection_id`.
- 50 MB ceiling is irrelevant for short notes (an Opus voice note runs roughly 0.5–1 KB/s).
- Practical encode: `ffmpeg -i in.wav -c:a libopus -b:a 32k -ar 48000 -ac 1 out.ogg`
  (mono, 48 kHz, ~32 kbps is well above speech-quality sufficiency). **UNVERIFIED:** Telegram
  does not document a required sample rate, channel count or bitrate for `sendVoice`; the above
  is a conventional, safe encode rather than a documented requirement.

Source: https://core.telegram.org/bots/api

---

## FREE TTS — ~8 distinct voices for short voice notes

### Google Cloud Text-to-Speech — **RECOMMENDED PRIMARY**

Verified on the live pricing page and voice list, 2026-09-02.

**Free tier is monthly and perpetual** (not a trial credit). Pricing page: *"Text-to-Speech is
priced based on the number of characters sent to the service to be synthesized into audio each
month. You must enable billing to use Text-to-Speech, and will be automatically charged if your
usage exceeds the number of free characters allowed per month."*

| Voice family | Free per month | Price after |
|---|---|---|
| Standard | 4,000,000 chars | $4 / 1M chars |
| WaveNet | 4,000,000 chars | $4 / 1M chars |
| Neural2 | 1,000,000 chars | $16 / 1M chars |
| Studio | 1,000,000 chars | $160 / 1M chars |
| **Chirp 3: HD** | **1,000,000 chars** | $30 / 1M chars |
| Gemini 2.5 Flash TTS | none | $0.50/1M in, $10/1M out tokens |

**Distinct voices: far more than 8.** Counted from the official voice list: **30 distinct
`en-US-Chirp3-HD-*` voices** (Achernar, Achird, Algenib, Algieba, Alnilam, Aoede, Autonoe,
Callirrhoe, Charon, Despina, Enceladus, Erinome, Fenrir, Gacrux, Iapetus, Kore, Laomedeia, Leda,
Orus, Puck, Pulcherrima, Rasalgethi, Sadachbia, Sadaltager, Schedar, Sulafat, Umbriel,
Vindemiatrix, Zephyr, Zubenelgenubi), plus 9 `en-US-Neural2-*` and 10 `en-US-Standard-*`.

**Emits OGG/Opus directly.** `audioEncoding: OGG_OPUS` is a documented option on
`text:synthesize`, and the response includes the container header. **This is the decisive
advantage: Google → `sendVoice` needs no transcoding step at all.**

- **ToS risk: none.** First-party API, commercial use permitted under Google Cloud terms.
- **Container: yes** — plain HTTPS REST call, no model weights, no GPU, negligible image size.
- **Cost realism:** 1M Chirp3-HD chars/month ≈ ~19 hours of speech. For 8 agents sending short
  pager notes this is effectively unlimited free. Standard/WaveNet gives 4M/month if you want
  more headroom at lower quality.
- **Gotcha:** requires a billing-enabled GCP project, so a runaway loop *can* incur charges past
  the free allowance. Set a **budget alert and a hard quota cap** on the TTS API.

Sources:
- https://cloud.google.com/text-to-speech/pricing
- https://cloud.google.com/text-to-speech/docs/list-voices-and-types
- https://cloud.google.com/text-to-speech/docs/reference/rest/v1/text/synthesize

### Kokoro-82M — **RECOMMENDED FALLBACK**

- **License: Apache 2.0** (verified on the model card). Genuinely free for commercial use, no
  usage restrictions imposed by the licence.
- **82M parameters**, StyleTTS2 lineage. Model card lists **"8 & 54"** — 8 language groups, 54
  voices — which covers 8 distinct staff voices comfortably.
- **Container: yes**, and this is the point — it is fully self-hosted, so there is no quota, no
  billing, no network dependency and no ToS surface at all. Small enough to be practical on CPU;
  the model card's own examples reference GPU, and **UNVERIFIED:** the card does not itself
  document CPU throughput. Third-party reports of "~5× real-time on Apple Silicon CPU" are
  community claims, not vendor-documented.
- **Costs:** container image size (ONNX/PyTorch + weights) and cold-start latency. Outputs raw
  audio, so you **must transcode to OGG/Opus with ffmpeg** for `sendVoice` — one extra step
  versus Google.

Source: https://huggingface.co/hexgrad/Kokoro-82M

### Others evaluated — and why not

**Microsoft Edge TTS via `edge-tts` — DO NOT USE. Highest ToS risk of anything here.**
- Library is alive: **PyPI `edge-tts` 7.2.8, released 2026-03-22**. No release since March 2026.
  **UNVERIFIED:** whether the underlying endpoint still functions in September 2026 — I did not
  execute the library, and Microsoft can break or gate it without notice. Its history is one of
  periodic breakage when Microsoft rotates the endpoint.
- **This reverse-engineers a consumer product's private endpoint.** It calls the same
  undocumented service Edge's Read Aloud uses, with no Azure subscription and no agreement. The
  maintainer's own discussion thread confirms no affiliation with Azure. A Microsoft Q&A answer
  on commercial use of these voices states that using them without a valid Azure subscription
  violates Microsoft's terms.
- **Honest assessment:** for a company-deployed system this is unacceptable. It is
  unauthenticated use of a paid service via an undocumented interface, with zero availability
  guarantee, zero support, and a live ToS violation for anything commercial. The fact that it is
  popular and technically works does not change that. It is also fragile in exactly the way a
  production pager must not be. **Excluded on both ToS and reliability grounds.** If you have an
  Azure subscription, use the real Azure Speech API instead (its free tier is 500,000 chars/month
  — **UNVERIFIED**, I did not fetch the Azure pricing page this session).

Sources: https://github.com/rany2/edge-tts/discussions/261 ·
https://learn.microsoft.com/en-au/answers/questions/5925556/commercial-use-of-edge-read-aloud-voices-via-edge ·
https://pypi.org/project/edge-tts/

**Piper — usable but licence-encumbered; a distant third.**
- **The project moved and relicensed.** `rhasspy/piper` was archived read-only in October 2025
  under MIT. Active development is **`OHF-Voice/piper1-gpl`** under **GPL-3.0** (Open Home
  Foundation), latest releases through 2026.
- **The engine is GPL-3.0**, and it embeds **espeak-ng**, itself GPL. Linking a GPL engine into a
  proprietary internal service is a real licence question — for purely internal use it is
  generally tolerable, but it is a constraint Kokoro's Apache-2.0 simply does not have.
- **Verbatim from Piper's own VOICES.md:** *"The `MODEL_CARD` file for each voice contains
  important licensing information. Piper is intended for personal use and text to speech
  research only; we do not impose any additional restrictions on voice models. Some voices may
  have restrictive licenses, however, so please review them carefully!"* Each of your 8 chosen
  voices would need its MODEL_CARD checked individually.
- Runs excellently on CPU in a container, and is the lightest option. But between GPL, the
  stated personal-use/research intent, and per-voice licence review, **Kokoro is the better
  self-hosted pick.**

Sources: https://github.com/OHF-Voice/piper1-gpl ·
https://github.com/OHF-Voice/piper1-gpl/blob/main/docs/VOICES.md

**ElevenLabs free tier — unusable for this.**
- **10,000 credits/month**, and critically **no commercial-use licence on the Free plan** —
  commercial rights begin at the paid Starter tier. **UNVERIFIED:** whether Free includes API
  (as opposed to web UI) access; the pricing page did not state it plainly.
- 10k credits is a handful of short notes. Excluded on quota *and* licence.
- Source: https://elevenlabs.io/pricing

**Deepgram Aura — good, but a credit grant, not a free tier.**
- Reported **$200 in free credits, no credit card, no expiry**, ≈6M characters of Aura-2 at
  $0.030/1k chars. That is generous but **finite** — once spent, there is no recurring free
  allowance, unlike Google's monthly reset. Fine as a burst/backup; wrong as the standing
  primary. **UNVERIFIED at source:** figures are from pricing-aggregator articles; I did not
  successfully fetch deepgram.com/pricing directly this session.
- Source: https://deepgram.com/pricing (figures via https://texttolab.com/blog/deepgram-pricing)

**Cartesia — excluded.**
- Free plan reported as **20,000 credits ≈ 27 minutes of TTS, no commercial use allowed.** Both
  the quota and the licence rule it out. **UNVERIFIED at source** — figures from comparison
  articles, not fetched from Cartesia's own pricing page this session.
- Source: https://cartesia.ai/pricing (figures via https://www.cekura.ai/blogs/elevenlabs-alternative)

### TTS recommendation

**Primary: Google Cloud TTS, Chirp 3: HD voices, `audioEncoding: OGG_OPUS`.** 1M chars/month
free forever, 30 distinct en-US voices, first-party terms, zero ToS risk, no transcoding, tiny
container. Assign one Chirp3-HD voice per staff member and pin it in config. Set a GCP budget
alert and a hard API quota so an agent loop cannot spend money.

**Fallback: Kokoro-82M self-hosted**, Apache-2.0, 54 voices, no quota and no vendor dependency —
the right answer if you ever need to sever the Google dependency or run fully offline. Budget an
ffmpeg transcode to OGG/Opus.

**Explicitly rejected: `edge-tts`.** It works, it is free, and it is an unauthorised use of a
consumer endpoint. Not appropriate for a company system.

---

## Recommended identity architecture

**Slack: one app per staff member, with `chat:write.customize` as the escape hatch — but start
with fewer apps than 8.**

The honest recommendation is a **tiered hybrid**, because the two Slack routes have different
costs and the 10-app cap is a hard, non-negotiable ceiling on Free:

1. **Tier 1 — real bot users (separate apps): the 3–5 staff who must be individually
   `@mentionable` and DM-able.** These get their own custom app, own bot token, own name and
   avatar, own event subscriptions. Only separate apps produce addressable bot users; overrides
   never will. Keep this list as short as the workflow genuinely requires.
2. **Tier 2 — presentation-only identities (one shared "Staff" app + `chat:write.customize`):**
   the remaining staff post through a single app with per-message `username` + `icon_url`. They
   look distinct in-channel, cost one app slot for all of them, and are trivially added or
   renamed with no new app, no new install, no new secret.
3. **Reserve at least 3 of the 10 slots.** Do not build to 8 apps + 2 spare; the Free cap will
   bite the moment you want a GitHub or calendar integration, and uninstalling a staff app loses
   its identity and DM history.

Why not all-8-separate-apps: 8 manual app creations, 8 OAuth installs, 8 bot tokens to rotate
and store, 8 sets of scopes to keep in sync, 8 Events API budgets — and only 2 slots left. Why
not all-overrides: nobody can `@mention` or DM a specific staff member, which is the single most
useful affordance of an "internal office".

**Implementation notes:**
- Automate Tier 1 with `apps.manifest.create` from one templated manifest per staff member,
  parameterised by name/icon/scopes. One human action bootstraps the config token; a stored
  refresh token plus `tooling.tokens.rotate` (every <12h) keeps it running unattended.
- **Never enable public distribution on any of these apps** — that reclassifies them as
  "unlisted distributed" and drops `conversations.history` to 1 req/min / 15 objects.
- Per-channel posting is capped at 1 msg/s *per channel*, and that cap is per app. Tier 2's
  shared app therefore shares one 1 msg/s channel budget across all its personas — throttle
  centrally.
- Pin a disclosure message/canvas listing every persona, marking them AI, and naming the
  underlying app(s). This discharges the Developer Policy's transparency requirement and
  forecloses any impersonation reading.
- Persist all agent memory externally. **Slack Free deletes history past 90 days**; Slack is a
  presentation and interaction layer here, not the system of record.

**Telegram: one bot per staff member. Unambiguous — do all 8.**

Telegram is strictly better than Slack for per-staff identity, and it is the reason the pager
role should carry the identity weight:
- Real per-bot name, avatar, description, short description and command list — **all
  API-settable** (`setMyName`, `setMyDescription`, `setMyShortDescription`, `setMyCommands`,
  `setMyProfilePhoto` since Bot API 9.4).
- Each bot is its own chat thread with the user, so 8 staff = 8 conversations = natural
  separation of concerns, and per-bot notification settings and mute controls for free.
- 8 is far under the practical BotFather ceiling.
- Cost: 8 `/newbot` exchanges in BotFather, once, by hand. Everything after that is scripted.

**Implementation notes:**
- One provisioning script per bot: `setWebhook` (with a distinct `secret_token` per bot),
  `setMyName`, `setMyShortDescription`, `setMyDescription`, `setMyCommands`,
  `setMyProfilePhoto`. Idempotent, re-runnable, config-driven.
- **Validate `X-Telegram-Bot-Api-Secret-Token` on every request.** It is the only authentication
  your webhook has.
- Set `max_connections` low (e.g. 5–10) per bot on a free serverless host to limit concurrency.
- Treat every update as at-least-once: dedupe on `update_id` / `CallbackQuery.id` with a
  conditional write, and model all button actions as **absolute state writes**, never relative
  reversals.
- Voice notes: Google Chirp3-HD → `OGG_OPUS` → `sendVoice` with `duration` set. One voice pinned
  per staff member, matching the Slack persona.

**The shape that falls out of this:** Slack is the *office* — durable channel discussion, a few
individually-addressable senior agents, everyone else presenting via overrides. Telegram is the
*pager* — 8 fully-distinct, individually-muteable, avatar-bearing bots that reach the user
wherever they are, with voice. Identity fidelity is highest exactly where identity matters most
(the interruption), and cheapest where it matters least (a line in a channel).

---

## Risks

**Hard blockers / must-design-around**

| Risk | Detail | Mitigation |
|---|---|---|
| Slack 10-app cap | Hard ceiling on Free; 8 staff apps leaves 2 slots | Tiered hybrid; reserve ≥3 slots |
| Slack 90-day history | Agent conversation history vanishes from Slack search/API | External system of record; Slack is presentation only |
| Socket Mode ≠ serverless | Needs an always-on process a free serverless host cannot give | Use Events API over HTTP; Slack recommends HTTP for production anyway |
| Telegram at-least-once webhooks | Undocumented retry policy, no ordering guarantee, `max_connections` 40 default | Ack fast; dedupe on `update_id`/callback id with CAS; absolute-state Undo |
| Manual bootstrap | Slack: generate config token + OAuth install per app. Telegram: `/newbot` per bot | Accept it; it is one-time. Script everything downstream |

**Cliff-edge risks**

- **Enabling Slack app distribution** silently drops `conversations.history` from 50+/min/1000
  objects to **1/min/15 objects**. This would break history-reading agents. Keep all apps
  internal, and document this so nobody flips the switch later.
- **GCP billing must be enabled** for TTS, so the free tier is a *discount*, not a wall. A
  runaway agent loop can spend real money. Budget alert **and** hard API quota, not just one.
- **Slack `chat.postMessage` 1 msg/s per channel** is per app. Tier 2's shared app funnels all
  its personas through one budget; a multi-agent burst will 429. Central token bucket required.
- **Events API 30,000 deliveries/workspace/app/hour** — with several apps subscribed broadly this
  is reachable. Subscribe each app to the narrowest event set.

**Policy / compliance risks**

- **Impersonation clause.** Prohibited: *"Allowing impersonation of Users or otherwise allowing
  for false representations."* Fictional, disclosed, APP-badged AI personas are defensible; a
  persona wearing a real colleague's name or face is not. Hard rule: **no persona may resemble a
  real person.**
- **Spam clause.** *"Spamming, harassing… Users"* is prohibited with no numeric definition.
  Proactive agent DMs to non-consenting workspace members are the exposure. Opt-in only.
- **`chat:write.customize` guidance** — *"must only be used when the user themselves gives
  permission to do so"* — is aimed at posting as humans, but the safe posture is an explicit,
  pinned, in-workspace disclosure of the persona scheme.
- **edge-tts** would be an ongoing ToS violation for commercial use. Excluded. Flagging it
  because it is the obvious tempting shortcut and it should be declined on principle, not just
  on reliability.
- **Piper's GPL-3.0 + espeak-ng GPL + per-voice MODEL_CARD licences + "personal use and text to
  speech research only"** make it the wrong self-hosted default despite its quality.

**Unverified items carried forward** (do not treat as settled)

- Telegram's bot-count-per-account limit (20/40) — community-sourced only; Telegram publishes
  none. Tried: Bots FAQ, Bot API docs.
- Any limit on how many bots one user may converse with — no source found.
- Any Slack limit on apps *created* (vs installed) per developer — no source found.
- `sendVoice` sample rate / bitrate / channel requirements — undocumented; the ffmpeg recipe
  given is convention.
- Whether the `edge-tts` endpoint still functions in Sept 2026 — not executed.
- Azure Speech free-tier character allowance — not fetched.
- Deepgram and Cartesia free-tier figures — from aggregator articles, not vendor pages.
- Kokoro CPU throughput — not vendor-documented.
- ElevenLabs Free API (vs UI) access — not stated on the pricing page.

---

## Sources

**Slack**
- Free plan limits — https://slack.com/help/articles/27204752526611-Slack-Free-plan-limits
- App manifests / configuration tokens — https://docs.slack.dev/app-manifests/configuring-apps-with-app-manifests
- `tooling.tokens.rotate` — https://docs.slack.dev/reference/methods/tooling.tokens.rotate
- `chat.postMessage` — https://docs.slack.dev/reference/methods/chat.postMessage
- App Developer Policy — https://docs.slack.dev/developer-policy/
- API Terms of Service — https://slack.com/terms-of-service/api
- Socket Mode vs HTTP — https://docs.slack.dev/apis/events-api/comparing-http-socket-mode
- Events API — https://docs.slack.dev/apis/events-api/
- Rate limits — https://docs.slack.dev/apis/rate-limits
- Rate limit changes for non-Marketplace apps (29 May 2025) — https://docs.slack.dev/changelog/2025/05/29/rate-limit-changes-for-non-marketplace-apps/
- Rate limit clarification (3 Jun 2025) — https://docs.slack.dev/changelog/2025/06/03/rate-limits-clarity/
- `username` + files interaction — https://github.com/slackapi/node-slack-sdk/issues/1595

**Telegram**
- Bot API reference (v10.3, 24 Aug 2026) — https://core.telegram.org/bots/api
- Bot API changelog (`setMyProfilePhoto` in 9.4, 9 Feb 2026) — https://core.telegram.org/bots/api-changelog
- Bots FAQ (rate limits, paid broadcasts) — https://core.telegram.org/bots/faq
- Webhooks guide — https://core.telegram.org/bots/webhooks
- Bot-count limit (community, unofficial) — https://github.com/tginfo/Telegram-Limits/issues/288

**TTS**
- Google Cloud TTS pricing — https://cloud.google.com/text-to-speech/pricing
- Google Cloud TTS voice list — https://cloud.google.com/text-to-speech/docs/list-voices-and-types
- Google Cloud TTS `text:synthesize` (OGG_OPUS) — https://cloud.google.com/text-to-speech/docs/reference/rest/v1/text/synthesize
- Kokoro-82M — https://huggingface.co/hexgrad/Kokoro-82M
- Piper (current repo, GPL-3.0) — https://github.com/OHF-Voice/piper1-gpl
- Piper voice licensing — https://github.com/OHF-Voice/piper1-gpl/blob/main/docs/VOICES.md
- edge-tts PyPI (7.2.8, 2026-03-22) — https://pypi.org/project/edge-tts/
- edge-tts Azure affiliation discussion — https://github.com/rany2/edge-tts/discussions/261
- Microsoft Q&A on commercial use of Edge Read Aloud voices — https://learn.microsoft.com/en-au/answers/questions/5925556/commercial-use-of-edge-read-aloud-voices-via-edge
- ElevenLabs pricing — https://elevenlabs.io/pricing
- Deepgram pricing — https://deepgram.com/pricing
- Cartesia pricing — https://cartesia.ai/pricing
