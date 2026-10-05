# ADR-0066 — A disconnected source leaves active retrieval; a Team HQ copy stays

**Status:** accepted by Grant, 4 October 2026. BUILT and proved on the isolated replica (migration 0896,
`scripts/isolated/detach-retrieval.ts`); NOT applied to production while the platform is unhealthy.
**Amends ADR-0013** (it stays accepted; this narrows one consequence of it) · **Date:** 4 October 2026

## Context

ADR-0013 made Postgres the source of truth and a knowledge tool a connector, and said detaching a connector "closes a route
and never loses the corpus". The retrieval readers took the second half further than it was written: everything a connector
had fed stayed in every answer for ever, whether or not the connector was still connected. A person who disconnects a Notion
database or a Drive folder reasonably expects the office to stop answering from it, and the Settings sentence ("the documents it
already gave stay") was true of the data and misleading about the behaviour.

## Decision

Grant, in his words: **disconnected externally indexed content leaves active retrieval; an explicitly imported Team HQ copy
remains durable and retrievable.**

1. **Two kinds of document, told apart by what the schema already records.** `origin = 'source'` is indexed from a connector
   (the schema requires a connector for it). `origin = 'yours'` is something a person gave Team HQ, and `origin = 'made'` is
   something the office wrote, which includes an output a person explicitly imported (`app.import_output` files it as made,
   connector `upload`, no parent). The last two are Team HQ copies: durable, never tied to a connection.
2. **A source document is in play only while a route that feeds it is open.** It is OUT only when it is positively known to be
   disconnected: some attachment in its project names its connector (and its parent, where it has one) and none of them is enabled.
   A source no attachment names is left alone: not being able to attribute a document is not a reason to hide it.
3. **Nothing is deleted.** The row, its text and its passages stay exactly as they were. Re-attaching (the undo the detach
   offers) brings everything back with no copy and no re-index, because nothing moved. The predicate is evaluated at read time.
4. **Archive is unchanged** (ADR-0040): an archived document, of either kind, leaves ordinary retrieval.
5. **One predicate.** `app.source_connected` and `app.document_in_play` are what every retrieval reader asks:
   `app.search_documents`, `app.best_chunks` (so the passage reader cannot disagree with search), `app.project_knowledge` (the
   coverage count no longer claims a disconnected source's documents) and the project brief the specialists are given
   (`src/agents/perform.ts`). A reader added later has one thing to call.
6. **The sentence the person sees says what changes.** The confirmation reads: what it indexed stops being used in answers
   until you connect it again; nothing is deleted; anything you uploaded or imported into Team HQ stays.

## What this does not do

- It does not delete, move or copy anything, and it does not change what a connector may write into Team HQ.
- It does not hide a source from the Sources list; a disconnected source's documents are still listed where documents are listed.
  Whether the list should mark them as inactive is a separate presentation question.
- A person who WANTS a source's content kept in answers after disconnecting imports it first. That is the explicit act that makes it
  a Team HQ copy; there is deliberately no "disconnect but keep answering from it".

## Proof

`scripts/isolated/detach-retrieval.ts` (replica, no model calls): five documents carry one marker word, one indexed from a
notebook, one from a second connector, one no attachment names, an upload and an imported output. Detaching the notebook removes
exactly the notebook's document from search, passages, the real retrieval path and the coverage count, and nothing else; nothing is
deleted; two open routes of one connector keep a parentless document and closing both removes it; re-attaching restores it; an
archived copy still leaves; another office detaching the same notebook id moves nothing of ours; and a sabotaged predicate makes a
detached source reappear, so the checks can fail.
