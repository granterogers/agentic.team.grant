# ADR-0012 — Google disabled the NotebookLM account; what replaces it

**Date:** 2026-09-05 · **Status:** superseded by [ADR-0013](0013-the-project-is-the-source-of-truth.md) on 2026-09-06
**Outcome:** the account was reinstated (migration 0049) and option **D** was taken anyway — Postgres owns the knowledge layer, and knowledge tools become connectors. NotebookLM's unattended sync is not coming back; the reinstatement reversed the penalty, not the policy.
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

## Two findings that make this smaller than it looks

**1. We already hold the content.** Migration 0015 — "the notebook boundary" —
caches every source's text in `notebook_sources.content`. The one source we had
is 69,121 characters and it is still sitting in Postgres. NotebookLM was never
the store; it was retrieval and question-answering *over documents we already
keep*. Losing it loses a service, not a corpus.

**2. The dedicated account was load-bearing for exactly one thing.** Going
through what it touched:

| | Used that account? | State |
|---|---|---|
| Inference (OpenRouter, Groq) | no | unaffected |
| Slack, Telegram, Team HQ | no | unaffected |
| Worker, ledger, jobs, undo, learning | no | unaffected |
| Backups (B2 + GitHub Actions) | no | unaffected |
| **NotebookLM** | **yes** | **gone** |
| `GEMINI_API_KEY` | yes | gone, and never used |
| Phase 9 Calendar / Gmail / Drive | its OAuth client only | recreate on Grant's own account |
| Chirp 3 TTS | would have | use Grant's own account |

The pattern is worth naming: **the only thing lost is the only thing being done
without permission.** Calendar, Gmail, Drive and Cloud Text-to-Speech all have
real APIs with OAuth consent, and using them on Grant's own account is the
intended path, not a policy risk — there is no ban exposure in an application
reading your own calendar with your consent. NotebookLM has no API, which is
precisely why it needed a fabricated account, which is precisely why that
account was banned.

**So the architecture does not need a dedicated Google account.** It needed one
to do the single unsupported thing.

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

**D. Build the knowledge layer in the Postgres we already run.** The adapter
boundary exists, `notebook_ref` is nullable, and the content is already local.
In the order I would actually try it:

  1. **Full-text search first** — `tsvector`, with `pg_trgm` and `unaccent`,
     both available and neither installed yet. No provider, no quota, no
     credential, deterministic, and free forever. §9's "deterministic code
     first" points here, and for a corpus of project documents it is often
     simply good enough. It also cannot be banned.
  2. **pgvector when full-text is not enough** — `vector` 0.8.2 is available in
     this Supabase. One catch worth naming rather than discovering: vectors need
     an embedding provider, and free embeddings are scarce (neither OpenRouter
     nor Groq offers them). That means Gemini embeddings on Grant's own account,
     or a Cloudflare Workers AI free tier — a provider dependency that full-text
     does not have. A reason to try FTS first, not a reason to avoid pgvector.
  3. **Synthesis is already built.** "Ask a question of my documents" is
     retrieval plus a model call. NotebookLM did both halves; we need only the
     first, because the provider router with its spend guards already does the
     second.

## Recommendation

**D, starting with full-text search, and A alongside because it is free.**

The system already owns a Postgres it trusts, backs up and tests, and the
documents are already in it. A knowledge layer built there has no account to
lose, no terms to fall foul of, and no credential a policy sweep can revoke.
One source and three notebook references make this the cheapest this decision
will ever be.

**Phase 9 is not cancelled by this, only re-based.** Calendar, Gmail and Drive
were always going to read Grant's own data, so a dedicated account was never the
right vehicle for them — it has no calendar worth reading. The OAuth client
needs recreating in a project he owns, and then the phase proceeds as designed,
on the supported path.

What I would not do is spend another week making the NotebookLM automation more
robust. Robustness was never the problem.

## Not decided here

Which alternative, and whether to appeal. Both are Grant's. This ADR exists so
that the reasoning is on the record and the next session does not quietly
re-enable a dead integration.
