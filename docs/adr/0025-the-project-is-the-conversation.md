# ADR-0025 — The project is the conversation, and there is no conversations table

**Date:** 2026-09-13
**Status:** Accepted
**Context:** #192, #191, migrations 0334–0337

## Decision

`app.conversation_history(project_id, limit, before)` DERIVES one project's
conversation by unioning `inbound_commands` (what Grant said) with `outputs`
(what the office answered, reached through `jobs`).

**There is no `conversations` table and no `conversation_messages` join table.**
The only new stored fact is `inbound_commands.project_id`.

## Why

The obvious build is a conversations table with a message join. CLAUDE.md says
not to: *"Do not store a fact you can already read."*

`public.relations` is the cautionary tale in this repository — the typed edge
table the IA document calls the point of the whole model, which **never held a
single row**, while `documents.produced_by_job`, `mirrors_document_id`,
`produced_by`, `document_collections` and four columns on `tasks` held those
same facts all along. 0310's answer was to derive what columns hold and store
only what no column expresses.

Applied here: **a conversation is a project's conversation.** #26 puts one Chat
tab in each project and the IA document puts conversation inside the project, so
conversation and project are one-to-one today. A conversations table would hold
exactly one row per project, duplicate `projects`, and add a key every reader
must carry — for nothing.

The body text, the author, the confidence, the evidence and the sources all stay
in the tables that already own them. Nothing is written twice, so nothing can
rot out of agreement — which is 0303 and 0304's lesson, six migrations back.

## What was genuinely missing, and is now stored

`inbound_commands` had no `project_id`. It has `job_id`, and a job has a
project — but **57 of 251 commands have no job at all** (callbacks, and messages
that failed before enqueue), so more than a fifth of everything Grant has ever
said could not be attributed anywhere. That is the one fact no column expressed.

## When to reverse this

The day a project needs **several named threads** — a thread per topic, or a
private thread with one agent alongside the project's main one. Then a
`conversations` table earns its place and `conversation_history` gains a
parameter.

Building it before that would be `relations` again: an abstraction with nothing
in it that every later reader still has to join through.

**The signal is a product requirement for more than one thread per project, not
a feeling that the model looks thin.** It looks thin because the data was
already there.

## Consequences, including one that bit immediately

Three migrations, because adding a fact to a system that already decides the
same thing elsewhere is never one change:

- **0335** added the column and the reader.
- **0336** made `enqueue_inbound` write its resolved project back to the
  command. Without it the two disagreed and **one exchange split across two
  conversations** — Grant's question filed under the column's default, the
  office's answer under the job's project, neither obviously wrong alone.
- **0337** made `enqueue_inbound` *read* the column, below the context project
  and above the "most recently updated active project" guess. 0335 and 0336
  between them had left it **write-only**: a surface that knew which project it
  was sending from had that knowledge thrown away. A column nothing reads is
  0298's `web.search` with the sign flipped — a claim in the schema that no code
  honours, and the studio sending from a project page (#193, #26) would have
  been silently misfiled from the day it shipped.

`verify:history` found 0337 by printing where the job actually landed. The
earlier check asserted only that the command and the job *agreed*, and passed
while both pointed at the wrong project. **Agreement is not correctness** —
assert the value, not the equality.

## Alternatives rejected

- **A `conversations` table now** — one row per project, duplicating `projects`.
- **A `conversation_messages` join** — membership is already implied by
  `project_id` on one side and `jobs.project_id` on the other.
- **Denormalising message bodies into one table** — two copies of every word the
  office has written, and the copy is the one that rots.
- **Routing every unattributed message to the Unnamed project** — measured
  first: 193 of 194 enqueued commands reach the fallback, so this would have
  moved substantially all of Grant's Telegram traffic out of the project he is
  working on. Where work is *routed* is a different decision from where a
  conversation *groups*; ADR-0024 was the latter.
