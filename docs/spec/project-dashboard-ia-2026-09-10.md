# Project Dashboard — Information Architecture & UX

Status: **target architecture**. Source: Grant, 10 September 2026, in the Claude Code
session that built the M0 studio prototype.

> **Provenance note — read this before treating any line below as his words.**
> Grant sent a long specification titled *PROJECT DASHBOARD — INFORMATION
> ARCHITECTURE & UX* containing a project hierarchy tree, a Universal Project
> Asset model, agentic team workflow diagrams, a core data relationship graph,
> an ASCII dashboard sketch and a set of UX principles. That message arrived
> mid-turn and the conversation was compacted before it was written to the
> session transcript on disk, so the **verbatim text is not recoverable**. What
> follows is a faithful reconstruction from the compaction summary and from the
> message immediately preceding it, which *is* verbatim (§0).
>
> Treat §0 as authoritative and everything after it as a good-faith
> reconstruction to be corrected the next time Grant restates it. Do not delete
> this note; replace the reconstruction with the original if it resurfaces.

---

## 0. Verbatim requirement (the message before the specification)

> "I also want a tab to chat with the team in a text way.. it would aso be great
> that each item (Docs, contacts, todo, etc) has a little button to 'talk to the
> team about this' and I can send a message that takes the item as context and I
> Can send incturctions, ask for details, etc.. / I need all the files, et
> cproduced by the team to have its own workspaced. / so there should be a
> dedciate dashboard per project as its own tab where the teams inputs and
> outputs can esaily be seen and coordinated, etc"

Four requirements, and they are the acceptance criteria for this document:

1. **A text chat tab.** Voice already exists; text is not a downgrade of it, it
   is the mode you use when you cannot talk, when you want a record, or when
   the thing you are sending is a document rather than a sentence.
2. **"Talk to the team about this" on every item.** Every document, contact,
   task and module carries a small action that opens the chat with that item
   already attached as context. The point is that you never have to describe
   the thing you are looking at.
3. **A workspace for what the team produced.** Files the team made are not the
   same as files you uploaded, and burying them in the same shelf loses the
   only fact that matters about them — that something is waiting for you to
   look at it.
4. **A per-project tab where the team's inputs and outputs are coordinated.**
   Not an activity log. A place where a request, the work, and the artifact it
   produced are one row.

---

## 1. Project hierarchy

The project is the top tier. Everything else hangs off it. Connections to
Notion, NotebookLM, Drive and the rest are *optional attachments to a project*,
never the source of one.

```
Portfolio
└── Project                     ← the only top-level object
    ├── Overview                  purpose, status, next date, current focus
    ├── Board                     the arranged dashboard (panels, per project)
    ├── Assets                    every file, note, link, image — see §2
    │   ├── Yours                   uploaded or written by Grant
    │   ├── Sources                 pulled from a connector, read-only mirrors
    │   └── Made                    produced by the team — the workspace, §4
    ├── Tasks                     open work, human or agent assigned
    ├── People                    contacts, per project, with own labels/fields
    ├── Team                      which agents work here, and on what
    ├── Chat                      the text thread, with item context
    ├── Sources                   connector links (Notion, NotebookLM, Drive…)
    └── Activity                  what happened, who did it, what came out
```

Two rules that follow from this and are easy to get wrong:

- **People are a subset of a project, not a merged address book.** Grant said
  this explicitly: *"remember people is a subset of each project.. not merged"*.
- **A module is not a level of the hierarchy.** Modules (as in the six modules
  of the Legacy Coaching Course) are a *collection* of assets and tasks — see
  §2 — not a new container type. Projects that have no modules must not show a
  module shell.

---

## 2. Universal Project Asset

One model for every artifact, whatever its shape. A PDF, a Google Doc, an
audio note, a link, a written note and an image differ in how they are
*rendered*, not in what they *are*.

```
Asset
  id
  project_id            required — an asset always belongs to exactly one project
  kind                  pdf | doc | image | audio | link | note | dataset
  title
  body / file / url     whichever the kind uses
  origin                yours | source | made
  provenance            who or what produced it, when, from what
    ├── actor           grant | agent slug | connector name
    ├── at
    ├── derived_from[]  other asset ids
    └── prompt/job      the request that produced it, when origin = made
  tags[]                free, user-defined
  collections[]         named groupings — "Module 2", "For the 16 Sep interviews"
  relations[]           typed edges to tasks, contacts, agents, other assets
  state                 draft | review | approved | archived
  cover                 generated from page 1, or supplied
```

Consequences worth stating because they are the reason for the model:

- **Provenance is not metadata trivia.** It is what makes the Made workspace
  possible (§4) and what lets an activity row say *who did what, for which
  project, why, when, and what was produced*.
- **Collections replace folders.** An asset can be in "Module 2" and in "For
  the interviews" at once; a folder tree forces a false choice.
- **Mirrors are not copies.** An asset pulled from Notion keeps a pointer to
  the original (`documents.mirrors_document_id` already does this in the
  database) rather than becoming a second source of truth.

---

## 3. Agentic team workflow

The loop the interface has to make legible:

```
  You                        The team                     The project
   │                            │                              │
   ├─ ask (voice or chat) ─────►│                              │
   │                            ├─ picks up as a job           │
   │                            ├─ reads project assets ──────►│
   │                            ├─ works                       │
   │                            ├─ produces an asset ─────────►│  origin = made
   │                            │                              │  state  = review
   │◄─ "Oliver made X" ─────────┤                              │
   ├─ approve / revise / drop ─►│                              │
   │                            └─ on approve ────────────────►│  state = approved
   │                                                           │  joins the project
```

The important property: **an agent producing something does not silently mutate
the project**. It lands in the Made workspace in `review`, and a human action
moves it into the project proper. That is what "coordinated" means in Grant's
sentence — not a feed, a queue with two ends.

A request should carry its context. When "talk to the team about this" is used
from a document, the job gets that asset id; from a contact, that contact; from
a task, that task. The agent should not have to guess what "this" was.

---

## 4. The Made workspace

Everything the team produced, in one place, per project.

- **Inputs** — what the team was given or asked: the request, its context item,
  who took it, when.
- **Outputs** — what came back: the artifact, its provenance, its state.
- **Pairing** — a row shows request → work → artifact together. An output with
  no visible request is a coordination failure, not a feature.
- **Actions per output** — Open, Approve (moves it into the project), Revise
  (reopens the request with a note), Discard.
- **Nothing waiting is a real state.** An empty workspace should say the team
  is idle on this project, not show an empty table.

---

## 5. Core data relationship graph

```
        ┌──────────┐
        │ Project  │
        └────┬─────┘
             │ 1:n to everything below
   ┌─────────┼──────────┬────────────┬─────────────┐
   ▼         ▼          ▼            ▼             ▼
 Asset     Task      Contact       Agent        Source
   │         │          │            │             │
   │         │          │            │             └─ mirrors ─► Asset
   │         │          │            └─ produced ──► Asset
   │         │          │            └─ assigned ──► Task
   │         │          └─ mentioned in ──► Asset
   │         │          └─ owner of ──────► Task
   │         └─ attached ──► Asset
   │         └─ blocked by ─► Task
   └─ derived from ─► Asset
   └─ in collection ─► Collection
```

Every edge above is one a person actually asks for:
*which documents came out of this task*, *who is this document about*,
*what did Emma produce here*, *what is this mirroring*.

---

## 6. Dashboard direction

```
┌──────────────────────────────────────────────────────────────────────┐
│  ▓▓▓ cover artwork ▓▓▓                                               │
│  Legacy Coaching Course                              [faces] [Talk]  │
│  Six modules built from the interview corpus.                        │
│                                                                      │
│  Board │ Team │ Chat │ People                          + Add panel   │
├──────────────────────────────────────────────────────────────────────┤
│ ┌──────────────────────────────┐  ┌───────────────────────────────┐  │
│ │ Modules              ⠿ − + × │  │ Tasks                 ⠿ − + × │  │
│ │ ┌────┐ ┌────┐ ┌────┐         │  │ ☐ Conduct first five…      💬 │  │
│ │ │ 1  │ │ 2  │ │ 3  │         │  │ ☐ Prepare interview…       💬 │  │
│ │ └────┘ └────┘ └────┘         │  │ ☑ Success Identity Quiz       │  │
│ └──────────────────────────────┘  └───────────────────────────────┘  │
│ ┌──────────────────────────────┐  ┌───────────────────────────────┐  │
│ │ Documents            ⠿ − + × │  │ People                ⠿ − + × │  │
│ │ ┌────┐┌────┐┌────┐┌────┐     │  │ ● Ben Hartley              💬 │  │
│ │ │page││page││page││page│  💬 │  │ ● Priya Raman              💬 │  │
│ │ └────┘└────┘└────┘└────┘     │  └───────────────────────────────┘  │
│ └──────────────────────────────┘                                     │
└──────────────────────────────────────────────────────────────────────┘
   💬 = "Talk to the team about this" — opens Chat with the item attached
```

The panels are draggable, snap to a 24px grid and to each other's edges, are
per project, and are remembered. This already exists (`web/studio/panels.js`).

---

## 7. UX principles

1. **The project is the unit.** Every screen answers "which project?" before it
   answers anything else.
2. **Never show an empty shell.** A project with no modules shows no Modules
   panel. Emptiness is expressed in words, once, not as an empty grid.
3. **The item you touched is the item you land in.** Shared-element transitions,
   not page loads.
4. **Context travels.** Any action started from an item carries that item.
5. **Nothing the team makes changes the project without a person.** Review, then
   approve.
6. **Every UI action is an API action.** §11 of the master build prompt — this
   is non-negotiable and the IA must not introduce state that lives only in the
   frontend.
7. **Mobile is not a narrowed desktop.** The board collapses to a single column
   in the order the panels were arranged.
8. **Appearance is the user's.** Palette, texture and layout are settings, not
   opinions baked into components.

---

## 8. Integration instruction (from the specification)

> "Before implementing major architectural changes, inspect the existing
> application and data model and determine how this architecture can be
> integrated without unnecessarily rebuilding working functionality."

What already exists and must be reused rather than replaced:

| Concept here | What already exists |
|---|---|
| Asset | `documents` table, incl. `mirrors_document_id` (migration 0169) |
| Provenance `origin = made` | staff job outputs; `build_steps` (migration 0170) |
| Agent | `CREW` / the staff definitions and their avatars |
| Project | the existing projects model — the source of truth, per Grant |
| Source | the connector rows (Notion, NotebookLM) |
| Board | `web/studio/panels.js` |
| People | `web/studio/people.js`, per-project contacts with user-defined labels |
| Chat | the voice stack (`app.voice_state`, `app.voice_lookup`) — text shares it |

---

## 9. Tracking

Implementation work for this document is tracked in GitHub Issues, not here.
This file is the target; the issues are the path.
