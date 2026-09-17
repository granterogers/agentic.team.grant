# ADR-0040 — An upstream deletion archives and hides; it never destroys

**Status:** accepted · **Date:** 2026-09-17 · **Issue:** #257

## The decision, in Grant's words

> *"Use archive-and-hide from normal retrieval/search by default, while
> preserving provenance/history and making restoration possible. An upstream
> deletion must not silently destroy institutional history, but deleted/stale
> material must not contaminate ordinary retrieval."*

This was the one product decision #257 reserved for him. It is decided, it is
recorded here, and it must not be asked again.

## Context

A dashboard project is attached to a Drive folder, a Notion database, a
NotebookLM notebook, a GitHub repository, an upload or a Gmail thread. Those
are places Grant and other people act on directly, so a file can vanish from
one of them at any time and for any of three completely different reasons:

1. he deliberately removed it and means it to be gone;
2. somebody else in a shared folder removed it, and he does not know;
3. it moved, was renamed, or the connector's listing failed.

The office cannot tell these apart at the moment it notices, and it never
will be able to. **Every policy has to be correct under all three.**

## What was decided, precisely

An upstream disappearance sets the document **archived**. That state:

- **keeps the row, the content, the fingerprint and every relation** — the
  provenance survives, so "what did we know, and when" is still answerable,
  and `relations_of` still derives the edges that named it;
- **removes it from ordinary retrieval and search** — the semantic and literal
  readers exclude archived documents, so a stale price list cannot be quoted
  back at Grant as current;
- **is reversible** — the document can be restored, and restoration is an
  ordinary product action rather than a migration.

A document is never DELETED because the connector stopped listing it.

## Why not the alternatives

**Delete on disappearance** loses institutional history for cases 2 and 3,
silently and irreversibly, and case 3 is a listing failure — we would be
destroying records because an API had a bad afternoon.

**Archive but keep searchable** fails the other way. #237's whole finding is
that the office's context arrives flat: a model handed a superseded document
alongside a current one uses both as memory. A deleted-upstream document that
still answers searches is a worse defect than not having it, because the answer
looks sourced.

## Consequences

- The retrieval path filters `state = 'archived'` — one place, not per caller,
  because a filter each reader reimplements is a filter one reader will forget.
- An answer that found nothing must not claim the records are empty when the
  only matching material is archived. #257's `consultedDomains` already draws
  that line and archived material widens it: the honest sentence is "there is
  nothing current on that", and where an archived document matches, saying so
  is more useful than silence.
- `app.discard_document` writes `state = 'rejected'`, which
  `documents_state_check` forbids — recorded in CLAUDE.md, never worked. The
  archive path must use `archived`, which the constraint permits, and the
  discard defect is fixed rather than copied.
