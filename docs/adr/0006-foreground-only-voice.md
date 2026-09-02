# ADR-0006 — Foreground-only voice; no native iOS app

**Status:** Accepted · **Date:** 2026-09-02
**Decided by:** Grant (decision D1).

## Context

The specification asked for ChatGPT-Voice-like conversation on mobile, with the
browser remaining open (Gate 1: 20+ minutes).

Research established this cannot be delivered on iOS as described. WebKit stops
microphone capture when a **home-screen web app** leaves the foreground, and the
documented remedy — `UIBackgroundModes: audio` in `Info.plist` — is available
only to native apps. WebKit bug 226620 is closed as `CONFIGURATION CHANGED` on
that basis. An installed PWA is therefore *worse* than a Safari tab, inverting
the usual assumption.

Foreground, screen-on conversation works.

## Decision

Grant's words: *"Foreground, screen-on mobile voice is sufficient for V1. I do
NOT require background or screen-locked microphone operation. Do not build a
native iOS application."*

Additionally, voice is reclassified as an **optional premium interface**. The
architecture stays provider-agnostic behind a voice adapter, and all model
identifiers are configuration.

## Consequences

- **Gate 1 is amended to "foreground, screen-on"** — it now tests something
  achievable rather than failing on a known platform limit.
- No native app scope enters the project. No App Store account, no review cycle,
  no second codebase.
- Away-from-screen coverage comes from Telegram voice notes, which the spec
  already provides for.
- The system is fully functional with voice disabled entirely.

## Still open

**D3 — whether to fund voice at all for V1** (~$24/mo on
`gpt-realtime-2.1-mini`). A genuinely free path (browser `SpeechRecognition` +
Chirp 3 TTS) is **unverified**: the research agent was killed by an account spend
limit before producing findings. It is recorded as unverified rather than
presented as an option, because barge-in almost certainly cannot be reproduced in
a hand-rolled loop.

Verified live on Grant's key: `gpt-realtime-2.1` and `gpt-realtime-2.1-mini` are
both present on the account. Re-verify immediately before Gate 1 regardless.
