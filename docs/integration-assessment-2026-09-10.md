# Integration assessment — Agentic Team HQ frontend

**Date:** 2026-09-10 · **Status:** for Grant's decision before implementation
**Scope:** the Master Frontend Build Prompt of 2026-09-10, §§1–34

This is the Phase 1–3 deliverable the brief asks for: understand the system,
say what exists, and propose an architecture *before* building. It is
deliberately blunt about the three places where the brief's assumptions do not
match this repository, because those are the decisions worth Grant's time.

---

## The three findings that change the plan

**1. There is no `main` branch.** The repository has three branches, all
`claude/*`, and six pull requests — every one of them closed without merging.
There is no trunk, so there is no answer to "what is the current state of this
product", and §34's continuity standard cannot be met by any amount of Issue
hygiene until there is one. This is the first thing to fix and it needs one
decision from Grant (below).

**2. There is no React, no Next.js, and no build step.** The brief reads as
though a component framework is present. The runtime dependencies of this
repository are `pg` and `teleproto`. The entire frontend is two hand-written
HTML files — `web/hq/index.html` (3,560 lines, all CSS and JS inline) and
`web/voice/index.html` — served as static files from Vercel Hobby. That was a
deliberate decision (ADR 0002, ADR 0011) taken to hold the £0/month constraint
of §26, and it has held.

It is also the constraint that makes §§14A, 17 and 18 undeliverable as written.
Shared-element transitions, a motion token system, drag physics and a PDF
gallery are achievable in vanilla JS, but not maintainably in one 3,560-line
file that already carries the whole application. **This is the central
architectural decision and it is set out in §13 below.**

**3. GitHub Actions are deliberately switched off.** Every schedule and push
trigger was removed on 2026-09-08 on Grant's explicit instruction — *"stop using
github actions completely please, find another way to do thing... for any
process"* — after 1,800 of the account's 2,000 monthly minutes had been spent by
a five-minute worker cron. §3 asks for CI on Actions. That conflicts with a
standing instruction and with §26. The recommendation is to leave the triggers
off and keep the existing arrangement, in which the full check suite runs before
every push in the session that makes the change. What is genuinely lost is the
independent second opinion, and that loss is already recorded in `ci.yml`.

---

## 1. Current architecture

A queue-driven agentic office on Supabase. Eight staff agents (Claire, Tom,
Emma, Daniel, Marcus, Ruby, Oliver, Grace) take jobs from a Postgres queue; a
Deno edge function (`worker`) drains it; channel adapters (Telegram, Slack,
voice, web) translate messages into `inbound_commands` rows and nothing else.

| Layer | Technology |
|---|---|
| Data + logic | Supabase Postgres, 168 plain-SQL migrations, `app.*` schema |
| Compute | Supabase Edge Functions (Deno): `worker`, `hq-api`, `voice`, `voice-token`, `mcp`, `telegram-webhook`, `slack-events`, `google-oauth` |
| Frontend | Two static HTML files on Vercel Hobby |
| Tooling | TypeScript 5.7, Node 22, tsx, vitest (859 tests), biome |
| Secrets | Supabase Vault, never in the repo (`npm run check:secrets` gates every push) |
| Long jobs | `scripts/` — 105 TypeScript entry points run from a session |

**Architectural invariant worth preserving:** §5 of the master spec — *channel
adapters may only translate, they may never decide*. Every surface writes to
`inbound_commands` and asks the canonical layer. That is why an instruction
typed in Telegram and one spoken on a call take the same path. Any new frontend
must obey it.

## 2. Existing agent architecture

Jobs carry `kind`, `state` (14 states, ADR 0008), `priority`, `project_id`,
`correlation_id`, `parent_job_id`. Handlers are registered in `src/office/pass.ts`
and matched on kind. Outputs land in `outputs` with a confidence/evidence/sources
envelope enforced by a quality gate. Approvals surface through `blockers` and
the `needs_me` view.

Priorities: 10 = instruction from Grant · 50 = office-decided · 100 = recurring
duty · 200 = a source arriving.

## 3. Existing frontend

`web/hq/index.html` — 14 views (overview, projects, staff, connections,
activity, output, trends, usage, cost, settings, routing, talk, setup, help),
a mobile sheet menu, a desktop rail, sparkline SVGs, a node-graph project view,
and the voice call surface. Restyled 2026-09-10: Jost + Inter, warm paper /
corporate-dark palette. Verified by three browser harnesses — `verify:hq`
(40 checks), `verify:ui` (36), `verify:talk` (34) — which drive a real Chromium
at phone, tablet and desktop sizes.

**Those harnesses are the most valuable thing here for §14A.** The
render→capture→critique loop the brief mandates already exists and already
catches real defects; it caught a sub-12px type regression during the restyle.

## 4. Existing backend / services

Nine edge functions, listed above. `worker` is kicked by an external cron
(not Actions). All are deployed from `scripts/deploy/*.ts`, which also probe
behaviour after deploying and fail the deploy when the probe fails.

## 5. Existing APIs

`hq-api` is a **whitelisted RPC gateway**, not a REST API: a `section` query
parameter selects one of ~14 read projections, and a POST `action` selects one
of ~16 named writes. Each maps to an `app.hq_*` Postgres function. A page cannot
send SQL or even a function name.

This is a better foundation for §11 than it first appears — the projections and
actions are already the API surface, already token-authenticated, and already
agent-reachable. What is missing is REST resource semantics, an OpenAPI
document, and coverage for documents, tasks and artifacts.

## 6. Database / schema

74 public tables. Relevant to this brief:

| Table | State |
|---|---|
| `projects` | slug, name, purpose, status, `is_fixture`, `notion_teamspace_name` |
| `project_aliases` | name resolution — "the wellness thing" resolves |
| `project_attachments` | connector, external_ref, role, artifact_kind |
| `documents` | title, **`content` (text)**, `content_chars`, connector, doc_type |
| `outputs` | body, confidence, evidence, sources, model |
| `jobs`, `job_state_transitions` | the queue |
| `blockers` / `needs_me` | approvals |
| `artifacts` | exists, lightly used |
| `staff`, `staff_tools`, `tool_permissions` | the team and what it may do |

**`documents` holds extracted text, not files.** There is no `file_ref`, no
`mime_type`, no `page_count`, no thumbnail. Nothing in the schema can represent
a PDF as an object, which is the gap §7 is entirely about.

## 7. Authentication

One bearer token (`hq.api_token`) in the Vault, compared with a constant-time
SHA-256 digest in every edge function. Single-user by design. No RLS-based user
model, no OAuth for the dashboard itself.

Adequate for §27's "primarily a private personal application", and it must not
be replaced with a second auth system.

## 8. Storage

**Supabase Storage is already in use and proven** — a backups bucket
(`src/backup/portable.ts`) and an avatar bucket
(`scripts/staff/generate-cartoon-avatars.ts`). So §7's document store needs no
new vendor, no new credential and no new cost: the free tier is 1 GB, and the
pattern for uploading, listing and fetching is already written.

## 9. Project / task / document models

Projects: strong. Documents: text only. **Tasks: absent from this system
entirely** — they exist only as pages in Notion, written there by
`office.notion_import`. There is no `tasks` table.

## 10. Existing integrations

Notion (read + write, API 2026-03-11, including file uploads), Google
NotebookLM, Google Calendar/Gmail, GitHub (read; write disabled), Slack,
Telegram, OpenRouter, OpenAI Realtime.

## 11. Reusable components

Reuse, do not rebuild: the queue and handler registry · `hq-api`'s gateway
pattern · the Vault · Supabase Storage · the three browser harnesses · the
project-resolution stack (`resolve_project_by_name`, aliases) · `app.office_health`
· the MCP server · the deploy-and-probe scripts.

## 12. Missing capabilities

1. A document **object** — file bytes, mime type, page count, thumbnail, cover.
2. PDF thumbnail generation.
3. A task system in this database.
4. Milestones and dates.
5. REST resource API + OpenAPI (§11).
6. Import/export package format (§13 of the brief).
7. Browser-capable agents and an approval-policy engine (§31A).
8. Search across entities (§24).
9. Any frontend capable of the motion and interaction quality §14A demands.

## 13. Proposed frontend architecture — **the decision**

The brief's visual standard cannot be reached inside `web/hq/index.html`. Three
honest options:

**Option 1 — Extend the single file.** Cheapest, no new dependencies, keeps
£0/month and keeps the harnesses working unchanged. Realistically caps out at a
better-looking version of what exists: no shared-element transitions worth the
name, no motion system, and a file heading past 6,000 lines. *Meets §14A: no.*

**Option 2 — A second static app, no framework.** A new `web/studio/` built as
ES modules with the View Transitions API (now baseline in Chrome, Edge, Safari
18+ and Firefox 141+), CSS `@property` and Web Animations for motion, and
`pdf.js` for rendering. No React, no bundler, no build step; still one Vercel
static deploy; still £0. The existing HQ page stays exactly as it is and is
retired only when the new one is better. *Meets §14A: plausibly, and it is
testable early.* Risk: hand-rolling state management for a document gallery is
real work, and View Transitions on iOS Safari need a fallback.

**Option 3 — Introduce React + Vite (+ Motion, dnd-kit, pdf.js).** The
conventional answer and what the brief's §15 list implies. Best ceiling for
§§17–18. Costs: a build step, a bundler, ~40 npm dependencies, a rewrite of the
three harnesses, and — the one that matters most — it moves the frontend
further from *"I want to reduce my dependence on Claude or another coding
interface for maintaining and extending the system."* Vercel Hobby still hosts
it free.

**Recommendation: Option 2, with Milestone 0 as the test.** Build the WOW
prototype §20 demands as a standalone static app with mock data. If the
prototype genuinely clears the hard gate, the framework was never needed. If it
cannot — and the honest failure mode is drag physics and orchestrated motion —
then Option 3 is justified by evidence rather than by fashion, and the prototype
work transfers as a design specification. This is the cheapest way to find out,
and §14A explicitly permits a mocked backend for that milestone.

## 14. Required backend changes

Ordered, and each is additive:

1. `documents` gains `file_ref`, `mime_type`, `bytes`, `page_count`,
   `thumbnail_ref`, `cover_ref`. Nothing existing breaks.
2. A `hq-files` edge function: signed upload, list, fetch, delete against a new
   Storage bucket.
3. Thumbnail generation — `pdf.js` in a Deno edge function, or in the browser at
   upload time. Needs a spike; see the Issue.
4. A `tasks` table with project, status, priority, dates, assignee (`staff_slug`),
   and links to documents and jobs.
5. `milestones`, or dates on projects.
6. REST resource routes over the existing `app.hq_*` layer, plus OpenAPI.
7. Search: `pg_trgm` is already installed and already used by project
   resolution; extend rather than add a search engine.

## 15. Integration boundaries

`Frontend → hq-api / hq-files → app.* functions → tables`. The frontend never
reaches PostgREST directly, never names a SQL function, and never touches agent
internals — which is §10 restated, and is how the current gateway already works.

## 16. Technical risks

| Risk | Severity | Mitigation |
|---|---|---|
| No `main` branch; six unmerged PRs | **High** | Decide the trunk before more work lands |
| PDF thumbnailing in Deno is unproven here | Medium | Spike it before committing; browser-side fallback |
| A second frontend becomes a second thing to maintain | Medium | Retire the old one on a date, not "eventually" |
| Supabase free tier: 500 MB DB, 1 GB storage | Medium | Store bytes in Storage, never in Postgres |
| Notion sync has duplicated every document | **Live defect** | Filed as an Issue; fix before it grows |
| Motion work degrading mobile performance | Medium | The harnesses already measure at phone size |

## 17. Potential breaking changes

None required. Every backend change above is additive. The existing HQ page,
the three harnesses, the nine edge functions and the 168 migrations are
untouched by the recommended path.

## 18. Recommended implementation sequence

0. **Repository trunk** — create `main`, set it default, land current work.
1. **GitHub as the record** — labels, milestones, templates, backlog. *(done)*
2. **Fix the live defect** — the duplicated Notion documents.
3. **Document objects** — schema, Storage bucket, `hq-files`, thumbnails.
4. **Milestone 0 prototype** — the WOW gate, mock data, Option 2.
5. **Human approval gate** — §14A. Nothing large proceeds without it.
6. Tasks · REST + OpenAPI · search · import/export · approval policy · browser agents.

## 19. Current GitHub repository-management maturity

Close to zero, and this is the least defensible part of the project. **0 Issues.
0 milestones. No custom labels. No Issue or PR templates. No `main` branch. Six
PRs, none merged. CI present but disabled.** Everything about the project's
state currently lives in commit messages, `docs/HANDOFF.md`, and chat — which is
exactly what §34 forbids.

Commit messages are, in fairness, unusually complete: each one states the
problem in Grant's words and the reasoning. That is a real asset, and it is not
a substitute for a backlog.

## 20. Recommended GitHub structure

- **Labels** — area (`frontend`, `backend`, `api`, `agents`, `integration`,
  `design`, `docs`, `testing`, `security`, `performance`), type (`bug`,
  `feature`, `enhancement`, `technical-debt`, `research`), state (`blocked`,
  `needs-decision`), priority (`P0`–`P2`).
- **Milestones** — `M0 Visual prototype`, `M1 Documents`, `M2 Tasks & agents`,
  `M3 API & MCP`, `v1.0`.
- **Templates** — bug, feature, technical task, PR.
- **Issues** — the backlog below, each with context, outcome and acceptance
  criteria.
- **CI** — unchanged, `workflow_dispatch` only, per §26 and Grant's instruction.
- **ADRs** — continue `docs/adr/`; the frontend technology decision becomes
  ADR 0015 once Grant chooses.

---

## The one decision needed before implementation

**What is the trunk?** The options are: promote the current working branch to
`main`, or start `main` from it and work through PRs from here. Everything in
§18 depends on the answer, and no amount of Issue creation substitutes for it.

The second, larger decision — Option 1, 2 or 3 in §13 — is answered by building
Milestone 0, not by discussing it further.
