# ADR-0014 — The team attaches to projects; it does not own them

**Date:** 2026-09-06 · **Status:** accepted, with three corrections from Grant
the same day (marked ▸ below)
**Extends ADR-0013. Scopes what Team HQ becomes.**

---

## The tension Grant named

> It's a bugger because, essentially, we've got two things. We've got an
> agentic team that we're building, but we also need a sensible way for the
> project to be stored in such a way that the agentic team can have easy access
> to it. […] Project management is not the task. Project management is offloaded
> to a different tool. But the point is to have an agentic team that can interact
> with a preexisting project.

That is the whole problem stated correctly, and the second sentence is the one
that decides it. **The team is the product. Project management is not.** Every
design below follows from refusing to build a project manager by accident.

## Decision

**A project is a Postgres row that *points at* wherever the work really lives.
The team reads from everywhere, and writes to exactly one place per kind of
artifact — never the same artifact in two systems.**

Three parts.

### 1. A project is an attachment point, not a container

ADR-0013 made a project a row plus its documents. This extends it: a project
also has **attachments** — a NotebookLM notebook, a Notion database, an Obsidian
vault, a Drive folder — each with a role.

```
  projects
    └── project_attachments
          connector        notion
          external_ref     <database id>
          role             source        ← we READ this
          role             home          ← we WRITE here (at most one per kind)
          role             mirror        ← we copy here, one way, best effort
```

The role is the whole design. `source` is safe and cheap: pull, cache,
fingerprint, never write. `home` is where output goes, and there is **at most
one home per artifact kind per project** — one place documents land, one place
tasks land. `mirror` is a one-way copy for convenience, explicitly allowed to
drift and explicitly not authoritative.

### 2. Two-way sync is refused, and this is the important part

Grant asked for "intelligently synced, two-way project details… not duplicating
files". I want to be plain: **two-way sync between three systems is a
distributed-consistency problem, and it is bigger than the rest of this project
combined.** Notion, NotebookLM and Obsidian have different data models, no
shared identity, no vector clocks and no conflict semantics. The honest options
are a conflict UI nobody wants to use, a last-write-wins rule that silently eats
edits, or an operational-transform engine — which is a product, not a feature.

So: **many sources in, one home out.** In practice Grant loses very little —
he edits in Notion, the team reads Notion, and the team's output goes back to
Notion because Notion is the home. It looks bidirectional from the outside. What
it never does is let two systems both claim authorship of one artifact, which is
the only way "no duplicates" is achievable rather than aspirational.

Duplicate prevention is then structural rather than clever: `documents` already
has `(connector, external_parent_ref, external_ref)` unique, plus a content
fingerprint. The same file reaching us through Notion and through Obsidian is
two rows with one fingerprint, and the fingerprint is what deduplicates the
*content* while the refs keep both provenances honest.

### 3. Configuration moves to the front end, in that order

Today attachments would be rows someone writes by hand. Team HQ becoming
read-write is what turns that into "connect the dots", and the sequence matters:

1. **See** — the connections panel, built 2026-09-06.
2. **Attach** — pick a notebook or a Notion database and give it a role. Small:
   the connectors already list what is available.
3. **Create** — define a project in the front end rather than waiting for a sync
   to discover one. The row it writes already exists.
4. **Configure** — schedules, which staff attend which project, budgets.

Each step is useful alone, which is the argument for the order rather than a
big-bang settings page.

## And MCP, which is the piece that changes the shape

Grant asked to "loop in the ability for Claude to interface… an MCP connection
for both Claude and ChatGPT".

This is the highest-leverage item on the page and it inverts the problem. Rather
than the team pulling every tool's content inward so its agents can reason over
it, **an MCP server exposes what the team already knows** — projects, documents,
search, jobs, staff, decisions — to any MCP client. Claude and ChatGPT both
speak it. The interfaces stop being something to build one at a time.

It is also small, because everything it exposes exists: `app.search_documents`,
`hq_overview`, `documents`, `projects`, the routing decisions. An MCP server
over them is a thin, careful adapter — and it is careful, not trivial, because
it hands a general-purpose model a door into the system:

- **read-only first**, for the same reason Team HQ is;
- **the same fixed-shape rule** as the HQ API — named tools over reviewed
  projections, never "run this SQL";
- **one token per client**, revocable independently, so ChatGPT's access can be
  withdrawn without touching Claude's;
- and every call recorded, because §11 says every inference attempt is measured
  and a model reading the corpus through a tool is exactly that.

## What this is not

It is not project management. No Gantt charts, no task board, no notion of
"done". The team reads the project, contributes to it, and records what it did.
If Grant wants a task board he should keep using one and attach it.

## Consequences

### ▸ Grant's corrections

**1. Notion and NotebookLM are not symmetrical.** *"Notion doesn't really need
to push anything out. Notion just kind of stores stuff and we grab things from
Notion. Notebook generates things."* Sharper than this ADR had it, and it makes
the defaults obvious: Notion is a source and the home for **documents**;
NotebookLM is a source and the home for **artifacts**. Neither is the home for
the other's kind, which is why `artifact_kind` is a column on the attachment
rather than a property of the connector.

**2. Obsidian is not synced at all.** *"Don't bother syncing to Obsidian by
default. Just have it there at the front end as an option to push the current
database to Obsidian."* So it is a `mirror`, manual, one-way, on a button. Not
built yet, and correctly the last thing on the list.

**3. Read-only was the wrong default for MCP.** *"It's not really great if the
MCP has read-only access. It needs to be able to write as well."* Right, and it
was chosen by a bad analogy with Team HQ — a dashboard is for looking at; an MCP
client is a working surface, and a conversation that cannot leave anything
behind is one you transcribe by hand afterwards. Writing shipped the same day:
three verbs (add a document, enqueue notebook work, nothing else), scoped per
client, every call recorded. A client still cannot edit or delete, because
adding is recoverable by a human in one statement and the other two are not.

## Consequences

**Accepted:** one home per artifact kind is a real constraint, and there will be
a day when Grant wants a document to live authoritatively in two places. The
answer will be no, and the answer is what keeps the corpus trustworthy.

**Given up:** true bidirectional sync, deliberately and permanently.

**Next, in order of value:** the MCP server (large win, self-contained), then
attachments with roles, then Team HQ read-write.

**Not decided here:** any of it. This is a recommendation, and the sequencing is
Grant's to change.
