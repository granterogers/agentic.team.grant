# Project Dashboard — Information Architecture & UX

**Received:** 2026-09-10, from Grant, verbatim.
**Status:** ⭐ CANONICAL for the project dashboard. The target conceptual
architecture and the target product direction.
**Companion:** `docs/spec/frontend-build-prompt-2026-09-10.md` (the frontend
requirements). Where the two overlap, this one is more specific and wins.
**Tracked as:** Issues #25–#30 and their children.

> Preserved in full because it is a requirements document, not a chat message.
> An earlier reconstruction of this document existed here for part of one day,
> because the original was compacted out of the session before it reached disk.
> Grant re-sent it. **This file is now his words**; nothing below is a
> paraphrase. If you find yourself reconstructing a requirement rather than
> quoting it, stop and ask him for it again.

---

Use the following as the target conceptual architecture for the Project
Dashboard.

This is a functional and information-architecture specification, not a
requirement to reproduce the ASCII literally. Interpret the ASCII diagrams as
visual representations of hierarchy, relationships, navigation, and intended
workflow.

## CORE CONCEPT

`Project` is the highest-level container.

Each Project acts as a complete project operating environment containing:

* Dashboard / overview
* Documents and project knowledge
* Tasks / to-do lists
* Contacts
* External project sources and integrations
* Agentic Team
* Agent-generated work
* Project activity/history
* Project settings

The Agentic Team is a first-class part of each Project rather than a separate
application.

## PROJECT HIERARCHY

```
PROJECT
│
├── OVERVIEW / DASHBOARD
│   ├── Project summary
│   ├── Current status
│   ├── Current priorities
│   ├── Recent activity
│   ├── Upcoming deadlines
│   └── Quick actions
│
├── AGENTIC TEAM
│   │
│   ├── Team Board
│   │   ├── Chief of Staff
│   │   ├── Research Agent
│   │   ├── Development Agent
│   │   ├── QA / Critic Agent
│   │   └── Project-specific agents
│   │
│   ├── Team Chat
│   │   ├── Ask one agent
│   │   ├── Ask selected agents
│   │   └── Ask entire team
│   │
│   ├── Active Jobs
│   │   ├── Running
│   │   ├── Waiting / blocked
│   │   └── Completed
│   │
│   └── Agent Outputs
│       ├── Reports
│       ├── Research
│       ├── Plans
│       ├── Recommendations
│       └── Generated files
│             │
│             └── IMPORT TO PROJECT
│
├── DOCUMENTS / KNOWLEDGE
│   │
│   ├── All Documents
│   │
│   ├── Collections / Folders
│   │   ├── Research
│   │   ├── Planning
│   │   ├── Reference
│   │   ├── Meetings
│   │   └── Archive
│   │
│   ├── Document Types
│   │   ├── Native documents / notes
│   │   ├── Word / DOCX
│   │   ├── PDF
│   │   ├── Spreadsheets
│   │   ├── Images
│   │   ├── Audio
│   │   └── Video
│   │
│   └── Metadata
│       ├── Tags
│       ├── Labels
│       ├── Category
│       ├── Creator
│       ├── Date
│       ├── Related task
│       └── Related agent
│
├── TASKS
│   ├── To-do
│   ├── In progress
│   ├── Waiting / blocked
│   ├── Completed
│   ├── Assigned to human
│   ├── Assigned to agent
│   └── Milestones
│
├── CONTACTS
│   ├── People
│   ├── Companies
│   ├── Collaborators
│   ├── Suppliers
│   └── Contact notes / history
│
├── LINKS & SOURCES
│   ├── NotebookLM / Google Notebook
│   ├── Google Drive
│   ├── GitHub
│   ├── Websites
│   ├── External applications
│   ├── APIs
│   └── Other project resources
│
└── PROJECT SETTINGS
    ├── Team / permissions
    ├── Integrations
    ├── Agent configuration
    ├── Automations
    ├── Labels / categories
    └── Archive / export
```

## UNIVERSAL PROJECT ASSET MODEL

Do not design Documents purely as a conventional filesystem.

Use a flexible underlying Project Asset concept.

An asset may be:

* Native document
* DOCX
* PDF
* Spreadsheet
* Image
* Audio
* Video
* Agent report
* Research output
* Meeting recording
* External resource

Assets should support:

* Rename
* Move
* Categorize
* Tag
* Label
* Search
* Filter
* Preview
* Download/export where appropriate
* Link to tasks
* Link to contacts
* Link to agents
* Link to sources
* Record provenance / origin
* Multiple logical collections without unnecessary duplication

Folders/collections may exist for familiar navigation, but categorization
should not depend solely on physical folder location.

## AGENTIC TEAM WORKFLOW

Agents must be deeply integrated into Projects.

An agent can:

1. Receive questions from the user.
2. Receive project documents/assets as context.
3. Receive tasks.
4. Work independently or collaborate with other agents.
5. Produce research, reports, plans, files and recommendations.
6. Return outputs to the Agentic Team workspace.
7. Allow those outputs to be imported into the Project with minimal friction.

Example:

```
AGENT OUTPUT
      │
      ▼
Preview / Discuss
      │
      ▼
ADD TO PROJECT
      │
      ├── Choose collection
      ├── Add tags
      ├── Relate to task
      ├── Relate to source
      └── Preserve agent provenance
      │
      ▼
PROJECT DOCUMENT / ASSET
```

The reverse workflow must also exist:

```
PROJECT DOCUMENT
      │
      ▼
SEND TO AGENT
      │
      ├── Review
      ├── Summarize
      ├── Research
      ├── Critique
      ├── Extract tasks
      ├── Compare
      └── Custom instruction
      │
      ▼
AGENT WORK
      │
      ▼
NEW OUTPUT
```

Preserve the relationship between the source document, agent job and resulting
output.

## CORE DATA RELATIONSHIP

Conceptually:

```
                         PROJECT
                            │
        ┌───────────┬───────┼───────┬───────────┐
        │           │       │       │           │
        ▼           ▼       ▼       ▼           ▼
    DOCUMENTS     TASKS   PEOPLE   SOURCES     AGENTS
        │           │       │       │           │
        └───────────┴───────┼───────┴───────────┘
                            │
                  RELATIONAL PROJECT GRAPH
```

These objects should NOT be isolated silos.

Everything should be capable of relating to everything else where appropriate.

Examples:

* Task → Document
* Task → Agent
* Task → Contact
* Document → Agent
* Document → Source
* Agent → Job
* Agent → Document
* Agent → Task
* Contact → Document
* Contact → Task
* Source → Document
* Job → Input documents
* Job → Output documents

Think of the Project internally as a relational project graph, even if the user
interface presents a simple and intuitive folder/dashboard metaphor.

## DASHBOARD DIRECTION

The Project Dashboard should provide an immediate operational overview rather
than simply displaying a collection of files.

Conceptually:

```
┌────────────────────────────────────────────────────────────────────┐
│ PROJECT NAME                                      Project Settings │
│ Short project description                                         │
├──────────────┬─────────────────────────────────────────────────────┤
│              │                                                     │
│ Overview     │   CURRENT FOCUS        PROJECT STATUS               │
│              │                                                     │
│ AI Team      │   ┌───────────────┐    ┌──────────────────┐         │
│              │   │ Main priority │    │ Progress / health│         │
│ Documents    │   └───────────────┘    └──────────────────┘         │
│              │                                                     │
│ Tasks        │   AGENTIC TEAM                                     │
│              │                                                     │
│ Contacts     │   [Chief] [Research] [Dev] [QA] [...]              │
│              │                                                     │
│ Sources      │   ┌───────────────────────────────────────────┐     │
│              │   │ Ask your project team...                 │     │
│ Activity     │   └───────────────────────────────────────────┘     │
│              │                                                     │
│              │   ACTIVE WORK             RECENT DOCUMENTS         │
│              │                                                     │
│              │   Running agent jobs       Reports                  │
│              │   Current tasks            Research                 │
│              │   Blockers                 Audio/video/files        │
│              │                                                     │
│              │   TASKS                   EXTERNAL SOURCES          │
│              │   Open / Today / Blocked   NotebookLM               │
│              │                            GitHub                   │
│              │                            Google Drive             │
│              │                                                     │
└──────────────┴─────────────────────────────────────────────────────┘
```

Do NOT reproduce this as a crude literal layout. Use it to understand the
desired information hierarchy and then design a polished modern interface
around it.

## UX PRINCIPLES

The finished system should feel like:

**Project Management + Knowledge Base + File Library + Agentic Workforce**

rather than simply another task manager or Notion clone.

Prioritize:

* Extremely low friction
* Strong visual hierarchy
* Drag/drop where useful
* Fast search
* Easy categorization
* Excellent document preview
* Clear agent status
* Clear provenance of AI-generated material
* Minimal navigation depth
* Contextual actions
* Desktop and mobile responsiveness
* Simple surface UI over a powerful relational model

Before implementing major architectural changes, inspect the existing
application and data model and determine how this architecture can be
integrated without unnecessarily rebuilding working functionality.

Treat this specification as the target product direction, while preserving
existing functionality that remains compatible with it.
