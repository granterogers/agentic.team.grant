# Parked: Obsidian vault sync

**Recorded:** 2026-09-03, at Grant's request · **Status:** parked, not scheduled
**Repository:** <https://github.com/granterogers/obsidian-vault>

> Grant: *"Here's the obsidian vault that we're gonna sync all the stuff to,
> which we'll use later. So save this for later."*

Captured verbatim so a later session does not have to reconstruct the intent.
**Nothing has been built, attached, or assumed.** The repository has not been
added to any session, and no Phase 1 work depends on it.

---

## Why this is parked rather than started

Master spec §2.19 is a strict sequential build gate: one phase at a time, proven
before the next begins. Phase 1 is the provider-independent core — ledger, job
engine, backups — and §13's instruction for it is explicit: *no channels, no
agents, no UI beyond what proves the core works.* A sync target is none of those
things, so it waits.

## Where it probably fits — a note, not a decision

Two readings, and they have different costs. Whoever picks this up should decide
deliberately rather than inherit an assumption:

**(a) A delivery surface.** Somewhere completed, quality-reviewed outputs get
written for Grant to read and edit in Obsidian. This is §6's *delivery policy*
concern and slots in beside Slack, Telegram and Team HQ. Low risk, low
ambition — the vault is an output mirror.

**(b) A second implementation of the knowledge adapter.** §7 already defines a
provider-independent contract:

```
list_projects() · get_project() · list_sources() · get_source()
add_source() · remove_source() · add_note() · query()
request_artifact() · get_artifact() · health() · capabilities()
```

A git-backed Markdown vault maps onto most of that cleanly, and — unlike
consumer Notebook automation — with **no undocumented private RPCs**, no session
that rotates out from under a worker, and no quota to design around. §7 calls
Notebook a *high-risk adapter*; git is about as boring and durable as a
dependency gets.

That matters more than it first appears, because **Gate 2 has an explicit stop
condition**:

> *"If this gate proves too brittle, stop. Do not build the rest of Team HQ
> around it. Research and test the simplest alternative knowledge layer first."*

This vault is a credible candidate for that alternative. Recording the
possibility now is worth something precisely because the moment it becomes
relevant is the moment Gate 2 is going badly and there is pressure to improvise.

**Not a recommendation to replace Notebook.** ADR-0003 stands: Notebook is the
knowledge and artifact layer, and it is not the inference engine. Obsidian being
a plausible fallback is not evidence that the primary has failed.

## What would need answering first

- Read-only mirror, or bidirectional? Bidirectional means conflict resolution,
  and Grant editing a note while a job writes to it is the ordinary case, not
  the edge case.
- Where does the sync run? `git push` needs the wire protocol only for SSH; over
  HTTPS it works from anywhere, so unlike `pg_dump` this is not forced into
  Actions (ADR-0007).
- Which writes earn a place? §7's write-back value filter applies unchanged:
  *do not write every intermediate output back.* A vault full of machine chatter
  is worse than an empty one.
- Naming and layout, so the vault stays navigable by a human — §7's
  `AI Team — Research Brief — [Topic] — YYYY-MM-DD` convention is the precedent.
- Does anything become authoritative there? **No.** §2.5: Postgres is
  authoritative for all operational state, and a git repository must not become
  a second source of truth for jobs, events or configuration.

## Credentials

None needed yet, and none requested. When this is picked up, a GitHub token
scoped to that one repository is the whole requirement — deliberately noted here
so it can be collected in a batch rather than in another one-at-a-time round
trip (`docs/credential-shopping-list.md`).
