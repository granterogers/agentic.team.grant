# ADR-0002 — Vercel Hobby is permissible; schedule externally

**Status:** Accepted · **Date:** 2026-09-02
**Supersedes:** "Vercel is unusable on two independent grounds".

## Context

Vercel was rejected on two grounds: its Hobby commercial-use prohibition, and
its cron frequency cap. Grant challenged the first as an unexamined assumption
about his actual use, and asked whether the second really disqualifies Vercel
rather than merely Vercel Cron.

He was right on both counts.

### Ground 1 — commercial use

Current Fair Use Guidelines (last updated 2026-07-29) restrict Hobby to
"non-commercial personal use only" and define commercial usage as any Deployment
"used for the purpose of financial gain of anyone involved in any part of the
production of the project". The five enumerated examples are: requesting or
processing payment from visitors; advertising the sale of a product or service;
receiving payment to create, update or host the site; affiliate linking as
primary purpose; and including advertisements. Donations also count.

**The actual case** is a personal, single-user, non-monetized tool. **None of
the five examples match.** Every example concerns monetizing the deployment
itself, not the subject matter of private data held inside it.

The original rejection quoted the broad definition clause and stopped, without
testing it against the examples or the facts.

### Ground 2 — cron

Verified verbatim: Hobby is limited to **once per day** with per-hour precision
(±59 min); expressions running more frequently **fail at deploy time**. Pro
allows once per minute.

But this constrains **Vercel's own scheduler**, not inbound HTTP. Nothing
prevents an external scheduler from calling a Vercel route every ten minutes.

## Decision

1. **Vercel Hobby is viable** for the app and the Python sync function.
2. **Do not use Vercel Cron.** Schedule from an external free trigger:
   Cloudflare Workers Cron (primary), GitHub Actions or Supabase
   `pg_cron` + `pg_net` (fallback).
3. **Recommend Grant email Vercel Support** to settle the residual ambiguity
   permanently — Vercel's own stated remedy for uncertainty.

## Consequences

- Vercel returns as the primary hosting candidate; Cloudflare Workers remains a
  fully viable alternative, so the architecture stays portable.
- Python sync colocates with the app: one platform, no second provider.
- A residual, honestly-stated ambiguity remains: the definition clause is broader
  than its examples, and Vercel does not address private productivity tools.

## What would reverse this

Vercel Support answering that this use requires Pro; or Active-CPU usage
exceeding the Hobby guideline in practice.

## Lesson recorded

A restriction's enumerated examples constrain the reading of its broad clause.
Quoting the clause alone, without testing the examples against the actual facts,
produces a false negative.
