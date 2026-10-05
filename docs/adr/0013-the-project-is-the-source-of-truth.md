# ADR-0013 — The project is the source of truth; knowledge tools are connectors

**Date:** 2026-09-06 · **Status:** accepted
**Decides the question ADR-0012 left open. Generalises ADR-0003.**
**Amended 4 October 2026 by ADR-0066:** detaching a connector still deletes nothing, but what it indexed now leaves active
retrieval until it is connected again; a Team HQ copy (an upload, an imported output) stays in use.

---

## The question Grant asked

> It shouldn't depend on Notebook, but it should definitely connect to one. I've
> been thinking about this — what should be the source of truth? What should be
> the actual project? Because I want to bring in Notion compatibility as well.

Three questions in one, and they have a single answer.

## Decision

**A project is a row in Postgres and the documents attached to it. Every
knowledge tool — NotebookLM, Notion, an upload, a URL — is a connector that
feeds documents into that row and can be disconnected without losing them.**

Concretely:

1. **Postgres is canonical.** A project exists because `public.projects` says
   so, not because a notebook or a Notion page exists. This was already true
   (ADR-0003, §7) and 2026-09-04 was the day it paid for itself: an account ban
   removed the knowledge tool and cost the system one source and nothing else.
2. **Documents are connector-agnostic.** One table, `public.documents`, with a
   `connector` column and the external reference that document came from.
   NotebookLM is one connector, not the shape of the schema.
3. **A connector is a §17 integration.** It can be turned off with a reason, its
   absence is a degraded mode, and nothing in the system asks it a question it
   cannot answer from Postgres.
4. **Retrieval is ours.** Full-text search over `documents.content`, in the
   Postgres we already back up. No provider, no quota, no credential, nothing to
   revoke. "Ask a question of my documents" is that search plus a model call,
   and the provider router already does the second half under its spend guards.
5. **Backblaze is backup, not store.** It holds `pg_dump` output. A store you
   read from and a store you restore from are different things, and conflating
   them is how a backup quietly becomes a dependency.

## Why not the other way round

The tempting alternative is to let the knowledge tool own the project: a
notebook (or a Notion database) is the project, and Postgres caches it. It reads
well and it is what most integrations do. It is also exactly the arrangement
that would have ended this project on a Tuesday morning. The ban did not corrupt
data or break an API — it revoked *permission to be a client*, which no amount
of retry logic, caching or better engineering addresses.

A weaker version of the same argument applies to Notion, which has a real API
and no ban exposure: an outage, a plan change, a workspace someone leaves, a
token nobody rotated. The cost of being wrong is asymmetric, and the cost of
being right is one column.

## What changes about NotebookLM specifically

**It stays off, and its automation is not coming back.** Not caution theatre:
NotebookLM has no public API, the automation therefore has to impersonate a
browser session, and impersonating a browser session is the thing Google banned
the account for. The appeal reversed the penalty, not the policy.

What replaces it, in Grant's own terms — *"it should definitely connect to
one"*:

- **Notion becomes the first-class connector.** It has an official API, OAuth,
  documented rate limits and no policy exposure, and it is where Grant already
  works. A Notion page or database becomes documents in a project the same way
  notebook sources did.
- **NotebookLM stays connectable by hand.** A source can be pasted or uploaded
  into a project and it is a document like any other. What is gone is the
  ten-minute unattended sync against an interface with no API, and only that.

The distinction worth keeping: **the system connects to a notebook; it is not
run from one.**

## What it looks like

```
              ┌──────────────── connectors (§17, each disableable) ─────────────┐
   Notion ────┤                                                                 │
   upload ────┤   list() · fetch(ref) · fingerprint                             │
   URL ───────┤                                                                 │
   NotebookLM ┘   (manual only — no API, so no unattended client)               │
                                    │
                                    ▼
                        public.documents  (connector, external_ref,
                                           content, fingerprint, tsvector)
                                    │
                                    ▼
                        public.projects   ← THE SOURCE OF TRUTH
                                    │
              ┌─────────────────────┼─────────────────────┐
              ▼                     ▼                     ▼
        jobs / staff          Team HQ (web)          pg_dump → B2
        briefings             Slack · Telegram        (backup, not store)
```

Grant's instinct — *"we define a project in the web front end, and that then
connects to other things"* — is exactly this diagram, and Team HQ becoming
read-write is the one piece not yet built. Today a project arrives by sync;
under this decision it can also simply be created, and connectors attached to
it afterwards. That is a Team HQ change, not a schema change: the row it would
write already exists.

## Consequences

**Accepted:**

- One rename and one new column now, so that the second connector is a row in a
  registry rather than a second schema.
- Full-text search is worse than a purpose-built RAG stack at synthesis. It is
  also free, deterministic, offline, unbannable and immediately available, and
  §9 says deterministic code first. `pgvector` 0.8.2 is available in this
  Supabase when full-text stops being enough — with the caveat ADR-0012 named:
  embeddings need a provider, and free ones are scarce.
- Manual entry is a step backwards from an unattended sync. It is the price of
  the only interface Google offers, and it is bounded by how much Grant actually
  pastes.

**Given up:** NotebookLM's own synthesis. We keep the corpus and rebuild the
question-answering from retrieval plus the router, which is the half we already
have.

**Not decided here:** whether Team HQ becomes read-write, and when Notion gets
built. Both are Grant's to schedule; neither is blocked by anything but time.
