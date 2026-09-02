# ADR-0003 — Notebook is the knowledge layer, not the inference engine

**Status:** Accepted · **Date:** 2026-09-02
**Supersedes:** "Google AI Pro is a functional prerequisite".

## Context

Phase 0 research concluded Google AI Pro (~$20/mo) was **mandatory**, reasoning
that the free tier's 50 chats/day could not support eight agents polling every
ten minutes.

Grant rejected the conclusion and identified the error precisely: *"NotebookLM is
primarily our project knowledge/artifact layer, NOT the inference engine for the
agentic team."*

The mandatory verdict was derived from an architecture in which **agents converse
with Notebook in order to reason**. That architecture was never specified, and it
is wrong. It would also be slow, expensive in latency, and would put a
private-API dependency on the critical path of every thought the team has.

## Decision

**Notebook is the project knowledge and artifact layer. Agents do not reason
through it.**

Notebook chat quota is consumed only by *asking Notebook questions* — never by
reading source material. Therefore:

1. Pull each source's text **once** via fulltext/guide retrieval; cache in
   Postgres, fingerprinted.
2. Agents reason over the cached text using the normal inference provider —
   **zero Notebook quota**.
3. Reserve Notebook chats for genuine cross-source synthesis, where Notebook's
   own grounding beats ours.

Realistic usage becomes roughly **5–15 chats/day against a 50/day limit**.

**Google AI Pro is reclassified: OPTIONAL, deferred, usage-dependent.**

## Consequences

- **~$20/month removed** from the mandatory cost base.
- Reasoning no longer depends on an undocumented private API being healthy —
  a resilience gain, independent of cost.
- Cached source text in Postgres is durable, queryable, and survives Notebook
  outages, reinforcing the §7 knowledge-fallback requirement.
- The remaining real ceiling is **50 sources per notebook**. The free tier allows
  100 notebooks, so a large project can be split behind the adapter.
- Deep Research at 10/month is effectively unavailable — the team uses its own
  web research instead.

## What would reverse this

A project approaching **50 sources** where splitting across notebooks proves
unacceptably awkward; or Notebook-native Deep Research demonstrably outperforming
ours on real tasks.

## Lesson recorded

Before pricing a constraint, check that the architecture producing the load is
the architecture actually specified. The quota arithmetic was correct; the
system it described was not the one being built.
