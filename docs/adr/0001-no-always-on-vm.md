# ADR-0001 — No always-on VM

**Status:** Accepted · **Date:** 2026-09-02
**Supersedes:** the Oracle Always Free ARM VM recommendation in the first draft
of `docs/architecture.md`.

## Context

The first architecture draft placed the Python Notebook worker on an Oracle
Cloud Always Free ARM VM, with Hetzner CAX11 (~€6/mo) as fallback, on the
assumption that Notebook automation required Playwright and a persistent
browser process.

**That assumption contradicted this project's own research.** The Notebook
research pass had already established that `notebooklm-py` in master-token mode
is **pure HTTP — no Playwright, no Chromium, no browser at runtime**. The
hosting research was briefed with the earlier, stale assumption and duly
recommended infrastructure to host a browser that is never launched.

The contradiction survived because the two passes ran concurrently and were not
reconciled. Grant caught it.

## Decision

**No always-on VM.**

The 10-minute Notebook sync is a handful of HTTP calls completing in seconds —
a serverless invocation, not a persistent process. It runs as a **Vercel Python
function** (runtime GA; 3.12 default, 3.13, 3.14 available), alongside the app.

## Consequences

- Oracle and Hetzner are removed from the architecture and prerequisites.
- One less provider, one less account, one less failure mode. Oracle's idle
  reclamation and ARM capacity lottery disappear as risks.
- Infrastructure cost for this component: **$0**.
- Vercel Hobby's fair-use guideline of ~4 Active-CPU-hours/month must be
  **measured** in Phase 1. Active CPU is real CPU time, not wall-clock wait, and
  an HTTP-bound sync is nearly all waiting — but this is to be measured, not
  assumed.

## What would reverse this

**Gate 2 showing master-token authentication is unusable**, forcing a fallback to
browser-driven automation. That is the POC's job to determine. Per the addendum's
rule against building ahead around unproven dependencies, the VM is **not**
provisioned in advance against that possibility.

## Lesson recorded

Concurrent research passes must be reconciled against each other before their
conclusions enter an architecture document. A briefing written before a finding
lands will faithfully produce a stale recommendation.
