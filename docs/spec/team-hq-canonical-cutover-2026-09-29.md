# TEAM HQ — CANONICAL INTERFACE CUTOVER

*Grant's brief, 29 September 2026, stored verbatim (CLAUDE.md: never condense a
requirements document).*

---

Repository:

`granterogers/agentic.team.grant`

Current canonical main:

`d77285f0`

Current live frontend:

`dpl_AnQWPdpGsF4vqvr1jL5ZFuGJ4rqj`

The current production deployment is technically healthy, but manual testing has immediately exposed a fundamental product problem:

**The application is still presenting/routing me into the old interface.**

I do NOT want to continue product testing against the legacy interface.

The newer project interface that was developed as the Basecamp-inspired experience must now become the canonical Agentic Team / Team HQ experience.

There is also a naming requirement:

**Remove "Basecamp" from the user-facing product.**

Basecamp was design inspiration during development. It is not the name of this product or feature and I do not want users seeing Basecamp terminology.

The product terminology should be:

- Agentic Team = product
- Team HQ = main application/workspace
- Projects = project workspaces
- Project Chat / Team Chat = project conversation where appropriate

Do not introduce a replacement third-party-inspired name.

---

# OBJECTIVE

Make the newer Team HQ project experience the default/canonical UI throughout the product.

After this work, a normal user should not accidentally encounter the old Studio/dashboard experience.

The expected journey is approximately:

LOGIN
→ TEAM HQ
→ PROJECT
→ PROJECT WORKSPACE

The newer project workspace contains the modules/features already developed:

- project Chat;
- To-dos;
- Calendar;
- Docs & Files;
- Recent Activity;
- Sources;
- Contacts;
- project tools/modules;
- voice note;
- Talk to Team / voice functionality;
- relevant counters and project controls.

Do NOT rebuild these features.

The objective is to expose the existing newer interface consistently and retire the legacy interface from normal navigation.

---

# PHASE 1 — ROUTING / SURFACE INVENTORY

Before changing anything, map every user-facing entry point.

Inspect:

- `/`
- `/studio`
- `/basecamp`
- project routes;
- login redirects;
- post-authentication redirects;
- project links;
- project cards;
- navigation links;
- dashboard links;
- deep links;
- email/notification links if applicable;
- Telegram/Slack links back into Team HQ if applicable;
- document/task/project links;
- browser history/navigation behaviour;
- mobile navigation.

Determine exactly why production still presents the old interface.

Produce a concise routing matrix:

| Entry point | Current destination | Desired destination |
|---|---|---|

Do not perform another repository-wide architecture audit.

This is specifically about UI routing and product naming.

---

# PHASE 2 — DEFINE THE CANONICAL EXPERIENCE

The newer Team HQ experience becomes canonical.

Normal users should no longer need to know that there were historically two frontends.

Make:

`/`

land on the appropriate Team HQ home/project portfolio after authentication.

A project selected from Team HQ should open the newer project workspace.

Navigation throughout the application should remain within the newer experience.

Determine a clean canonical URL scheme.

Preferred public terminology should NOT contain `basecamp`.

For example:

`/`
`/projects`
`/projects/<project>`

or an equally clean existing scheme if changing URLs creates unnecessary risk.

Do not mechanically choose this exact URL structure if the current router makes another native Team HQ structure safer.

The important invariants are:

1. no normal user needs `/basecamp`;
2. no normal navigation sends the user to legacy Studio;
3. existing useful deep links do not simply break;
4. old routes can redirect to their new canonical equivalents where practical.

---

# PHASE 3 — REMOVE "BASECAMP" FROM USER-FACING PRODUCT TERMINOLOGY

Search the entire repository for:

- `Basecamp`
- `basecamp`
- `BASECAMP`

Classify every occurrence.

Separate them into:

### A. USER-FACING

Examples:

- page text;
- headings;
- navigation;
- buttons;
- labels;
- tooltips;
- URLs;
- browser titles;
- accessibility labels;
- onboarding;
- current documentation;
- current setup instructions;
- generated messages;
- API-visible labels that users see.

These should be renamed.

### B. INTERNAL IMPLEMENTATION

Examples might include:

- `bc/` source directories;
- internal function names;
- test filenames;
- historical migration names/comments;
- ADR history;
- old integration reports;
- historical branch documentation.

Do NOT blindly rename these.

Internal identifiers may remain temporarily if renaming them provides no user benefit and increases regression risk.

However, record them so we know exactly where the word remains.

### C. HISTORICAL DOCUMENTATION

Do not falsify history.

A historical document saying that the interface was inspired by Basecamp can remain historical if appropriate.

But current product documentation should describe the interface as Team HQ, not Basecamp.

---

# PHASE 4 — LEGACY INTERFACE

Determine what the old Studio/dashboard still provides that the new Team HQ does not.

Do NOT simply delete it first.

Create a parity matrix:

| Capability | Legacy UI | Team HQ | Action |
|---|---|---|---|

The important question is:

> If normal navigation stops exposing the legacy interface today, does Grant lose access to any operational capability he actually needs?

If Team HQ already provides the capability, route exclusively to Team HQ.

If something genuinely important exists only in legacy Studio:

- identify it;
- determine whether it needs exposing in Team HQ;
- make the smallest appropriate integration.

Do not keep the entire legacy UI canonical merely because one obscure control has not moved.

Legacy Studio may remain temporarily available behind a non-prominent internal/debug route if technically useful.

It should NOT remain part of the normal product journey.

---

# PHASE 5 — ROUTE COMPATIBILITY

Preserve useful existing links.

Old URLs should preferably redirect rather than 404.

Examples:

old `/basecamp/...`
→ equivalent canonical Team HQ/project route

old Studio project links
→ equivalent canonical project workspace where possible.

Be careful with:

- project identity;
- conversation provenance;
- selected project;
- chat dock context;
- document links;
- task links.

Do not regress the project provenance work already completed.

---

# PHASE 6 — TEST THE ACTUAL USER JOURNEY

Add behavioural tests for the canonical journey.

At minimum:

### Authentication

Login
→ Team HQ.

### Root

`/`
→ Team HQ rather than legacy Studio.

### Projects

Team HQ
→ select project
→ new project workspace.

### Project navigation

Move between projects
→ remain in Team HQ.

### Chat

Open Project Chat/dock
→ correct project provenance.

### Existing URLs

Old supported URL
→ redirect/resolve to appropriate new surface.

### Browser refresh

Refresh project URL
→ same project remains selected.

### Mobile

Repeat essential routing/navigation checks at a phone viewport.

---

# PHASE 7 — BRANDING TEST

Add a user-facing branding/static check.

The test should inspect the currently shipped user-facing frontend and fail if forbidden visible terminology is introduced.

At minimum detect visible:

`Basecamp`

Do not make the test so naive that historical documentation or internal `bc` implementation identifiers cause failures.

The purpose is to prevent the third-party product name from reappearing in the Agentic Team UI.

---

# PHASE 8 — VISUAL QA

Because this changes which interface is canonical, perform actual browser QA.

Desktop and phone.

Inspect:

- Team HQ landing page;
- project portfolio;
- project workspace;
- Chat;
- To-dos;
- Calendar;
- Docs & Files;
- Sources;
- Contacts if currently implemented;
- navigation;
- dock;
- project switching.

Look specifically for legacy terminology or visual artifacts.

Also inspect the previously mentioned faint "The team" heading.

Do not automatically redesign it.

Determine whether the faint appearance is reproducible in a stable state.

If it is clearly a simple contrast/readability defect in the canonical interface, fix it.

If it was merely a captured transition state, leave it alone.

---

# PHASE 9 — REGRESSION

Run the relevant complete regression.

At minimum:

- lint;
- typecheck;
- unit tests;
- static checks;
- Team HQ/Basecamp-derived behavioural suites;
- routing tests;
- project provenance tests;
- dock tests;
- voice-note project-context tests;
- branding check;
- desktop smoke;
- phone smoke.

Existing test filenames may still contain `basecamp` internally.

Do not rename hundreds of internal tests solely for cosmetic reasons during this cutover.

No test traffic should reach Grant's real Telegram or Slack destinations.

---

# PHASE 10 — DEPLOY

If everything is green:

promote to main and deploy the canonical frontend.

Prefer the bounded page deployment method already successfully used if the changed files permit it.

Do NOT unnecessarily:

- redeploy the worker;
- redeploy voice;
- redeploy hq-api;
- modify secrets;
- modify SSO;
- modify environment variables;
- apply database migrations.

If broader deployment is genuinely required, explain why before doing it.

---

# PRODUCTION ACCEPTANCE

After deployment, verify against the actual live application:

`https://ai-team-hq.vercel.app`

Without sending real external test traffic, confirm:

1. root opens Team HQ;
2. legacy UI is no longer the normal landing experience;
3. projects display;
4. opening a project uses the newer project workspace;
5. switching projects remains in the newer UI;
6. project Chat opens;
7. project provenance remains correct;
8. old supported URLs resolve appropriately;
9. browser refresh preserves the intended location;
10. mobile route works;
11. no visible "Basecamp" terminology remains in normal product surfaces;
12. no console/page errors.

---

# DO NOT OVER-CLEAN INTERNALS

This instruction is important.

I want the PRODUCT to stop saying Basecamp.

I do not want a risky repository-wide rename merely to remove every historical/internal occurrence of the string.

If directories such as:

`web/studio/bc/`

or tests such as:

`verify:basecamp-*`

are internal and renaming them provides no user-facing benefit, leave them for a later cleanup.

Likewise do not rewrite historical migrations or ADRs merely to erase the development history.

Instead give me a final inventory:

- user-facing occurrences: ZERO;
- current documentation occurrences: ideally ZERO unless context genuinely requires mentioning design history;
- internal implementation occurrences: count/list;
- historical occurrences: count/list.

---

# FINAL REPORT

Report:

## Root cause

Why was the old interface still being shown?

## Canonical routing

Show the before/after routing table.

## Legacy interface

What remains accessible and why?

## Team HQ

Confirm the newer project experience is now canonical.

## Branding

Report remaining `Basecamp/basecamp` occurrences classified as:

- user-facing;
- current documentation;
- internal;
- historical.

The required user-facing count is:

ZERO.

## Tests

Give exact totals/results.

## Git

- starting main;
- implementation commits;
- final main.

## Deployment

- deployment ID;
- production URL;
- rollback point;
- exactly which components changed.

Finally answer:

> Is Team HQ now the default interface throughout the normal product journey?

and:

> Can a normal user encounter the word "Basecamp" anywhere in the current product UI?

Expected answers:

YES.

NO.

If either answer is not true, do not declare the cutover complete.

Then STOP.

Do not start another development workstream.
