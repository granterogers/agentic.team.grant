# ADR-0012 — Google disabled the NotebookLM account; what replaces it

**Date:** 2026-09-05 · **Status:** open — the decision is Grant's
**Supersedes nothing. Forces a decision ADR-0003 anticipated.**

---

## What happened

Google disabled `agentic.team.grant@gmail.com` on 2026-09-04:

> It looks like this account was created or used with multiple other accounts to
> violate Google's policies. The account might have been created by a computer
> program or bot.

Scheduled for deletion 2027-07-31. Appeal available.

Verified rather than inferred: minting an access token from the stored master
token returns `403 BadAuthentication`. The credential is refused, not expired.
The same account owned the Cloud project behind `GEMINI_API_KEY`, which is why
that key had been returning "the bound service account is deleted or disabled".

## What it cost

Measured, not estimated:

| | |
|---|---|
| Projects in the system | 118 |
| Projects with a `notebook_ref` | **3** |
| Notebook sources recorded | **1** |
| Live jobs needing Notebook | **0** |
| Everything else | untouched |

Postgres holds the projects, the jobs, the ledger, the briefings, every
delivery, the staff and the preferences. §7 and ADR-0003 made Notebook a
replaceable adapter and said so in as many words: *"Postgres owns this, never
Notebook — a Notebook outage is a degraded mode, not amnesia about which
projects exist."* This is that decision paying out. Had the knowledge layer been
the system's memory, a Tuesday-morning account ban would have been the end of
the project.

Migration 0048 turns the integration off with the reason recorded, per §17.

## Why this is a decision and not just an outage

§13's Gate 2 was written with this risk in mind, and set the stopping rule:

> **If this gate proves too brittle, stop.** Do not build the rest of Team HQ
> around it. Research and test the simplest alternative knowledge layer first.

An account ban is stronger evidence than brittleness. The gate passed — the
automation worked — and the platform then refused the *manner* of use. No amount
of better engineering addresses that.

## The options

**A. Appeal, and wait.** Costs nothing, might work. It does not change the
underlying position: NotebookLM has no public API, and any programmatic use is
against the grain of the terms. Even a successful appeal leaves the system one
policy sweep from the same morning. Worth doing in parallel with anything else;
worth building on, no.

**B. Create another dedicated account.** Do not. This is precisely what the ban
names — accounts created by a program, used alongside others — and repeating it
invites the same outcome. It also risks contaminating Grant's real account,
which Google links by device, IP and recovery details.

**C. Use Grant's own account, manually.** NotebookLM works fine for a human. The
system would stop syncing and Grant would paste things in himself. Honest, zero
risk, and it gives up the automation that was the point.

**D. Move the knowledge layer to something with an API.** The adapter boundary
already exists, `notebook_ref` is nullable, and one source is all that would need
re-creating. Candidates worth a spike, in the order I would try them: pgvector
in the Postgres we already run (no new vendor, no new credential, and retrieval
is a query); then a hosted vector store if that proves insufficient.

## Recommendation

**D, with A running alongside because it is free.**

The system already owns a Postgres it trusts, backs up and tests. A knowledge
layer built there has no account to lose, no terms to fall foul of, and no
credential that a policy sweep can revoke. The 1 source and 3 notebook
references make the migration cost close to nothing — this is the cheapest this
decision will ever be.

What I would not do is spend another week making the NotebookLM automation more
robust. Robustness was never the problem.

## Not decided here

Which alternative, and whether to appeal. Both are Grant's. This ADR exists so
that the reasoning is on the record and the next session does not quietly
re-enable a dead integration.
