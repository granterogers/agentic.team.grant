# Master Frontend Build Prompt — Agentic Team HQ

**Received:** 2026-09-10, from Grant, verbatim. **Version 3 — Autonomy.**
**Status:** ⭐ CANONICAL for all frontend work. Supersedes earlier frontend
direction where they conflict.
**Companion:** `docs/spec/project-dashboard-ia-2026-09-10.md` (the project
dashboard IA). Where the two overlap, the IA document is more specific and wins.
**Assessment against this repository:** `docs/integration-assessment-2026-09-10.md`
**Tracked as:** GitHub milestones M0 → v1.0

> Preserved in full because it is a requirements document, not a chat message.
> Where this repository cannot meet a clause — §3's CI, §15's framework list —
> the conflict is recorded in the assessment and as a GitHub Issue, never
> silently resolved.
>
> **This file previously held a condensed rendering of v2.** Grant supplied v3
> as a document on 2026-09-10; it is reproduced below in his words, with only
> the markup converted. v3 adds the autonomy-first line to the Mission, the
> "avoidable manual configuration is a design failure" clause to §31, and §31A
> in full. Do not condense it again — a summary of a requirements document is a
> paraphrase somebody will later mistake for the requirement.

---

# MASTER BUILD PROMPT — AGENTIC TEAM HQ

## Mission

Transform this existing agentic AI repository into a **world-class visual
Agentic Team HQ**: the human-facing control plane for my AI team, projects,
documents, tasks, workflows and generated artifacts.

This is **not** a greenfield application. This is **not** a Notion clone. This
is **not** another generic project-management dashboard.

The repository already contains an agentic architecture. Understand that
architecture first, then build a beautiful, highly interactive frontend around
it, extending the backend only where genuinely necessary.

The experience should combine:

**Agentic AI control centre + beautiful personal project HQ + visual document
library + task/project management.**

The result should feel like a premium native application or sophisticated
interactive digital product rather than an AI-generated SaaS dashboard.

---

**Autonomy-first requirement:** the frontend must be designed as the control
plane for agents that can operate APIs, CLIs and authorized browser sessions
with minimal human intervention. Manual setup should be the exception, not the
default.

## 1. First: Understand the Existing Repository

Before making substantial changes, inspect the repository thoroughly.

Read and inspect:

- README files

- `AGENTS.md`

- handover documentation

- architecture documentation

- package manifests

- database schemas/migrations

- APIs

- authentication

- agent definitions

- orchestration

- tools

- integrations

- queues/jobs

- existing frontend

- tests

- CI/CD

- deployment configuration

- environment-variable documentation

- existing GitHub Issues, labels, milestones, Projects, Discussions and templates where available

Determine:

- What already exists

- What is working

- What is incomplete

- What should be reused

- What should be extended

- What must not be duplicated

- What architectural constraints already exist

- What work is already represented in GitHub and what is not

Do **not** create unnecessary parallel systems for authentication, users,
projects, tasks, documents, storage, APIs, agent orchestration or databases.

Reuse existing infrastructure whenever technically appropriate. Preserve
backwards compatibility and existing functionality. Treat the repository as
production-sensitive.

---

## 2. Produce an Integration Assessment First

Before substantial implementation, produce a concise assessment containing:

1. Current architecture

2. Existing agent architecture

3. Existing frontend

4. Existing backend/services

5. Existing APIs

6. Database/schema

7. Authentication

8. Storage

9. Project/task/document models

10. Existing integrations

11. Reusable components

12. Missing capabilities

13. Proposed frontend architecture

14. Required backend changes

15. Integration boundaries

16. Technical risks

17. Potential breaking changes

18. Recommended implementation sequence

19. Current GitHub repository-management maturity

20. Recommended GitHub structure for the work ahead

Do not blindly start coding before understanding the system.

---

## 3. GitHub Must Become the Operational Source of Truth

I want to make substantially better use of GitHub.

Do not treat GitHub merely as somewhere to push code. Use the repository as the
durable operational record of the project so another developer or AI coding
agent can understand the state of the project without relying on chat history.

Where permissions and tooling allow, actively populate and maintain the
appropriate GitHub features rather than merely suggesting that I do so manually.

### GitHub Issues

Use GitHub Issues for actionable development work, including:

- Bugs

- Problems discovered during development

- Features

- Enhancements

- Technical debt

- Refactors

- UX/UI problems

- Performance work

- Security work

- Integration work

- Documentation gaps

- Research/spikes where a decision is required

- Deferred work discovered while implementing something else

Do not bury important future work only in chat, TODO comments or handover prose.

When meaningful work is discovered but is outside the current implementation
scope, create or update an Issue.

Issues should be useful to a future developer. Include, where appropriate:

- Clear title

- Context/problem

- Desired outcome

- Acceptance criteria

- Relevant technical notes

- Dependencies/blockers

- Links to related issues/PRs

- Appropriate labels

- Milestone/project association where relevant

Avoid creating noisy duplicate or trivial issues.

Before creating a new Issue, check whether an appropriate Issue already exists
and update/link it instead where sensible.

### Labels

Establish and maintain a coherent label taxonomy.

Potential categories include:

- `bug`

- `feature`

- `enhancement`

- `technical-debt`

- `documentation`

- `security`

- `performance`

- `frontend`

- `backend`

- `api`

- `agents`

- `integration`

- `ux`

- `design`

- `testing`

- `research`

- `blocked`

- priority labels

- status labels where useful

Do not create unnecessary label clutter. Reuse GitHub defaults where they are
adequate.

### Milestones

Use milestones for meaningful development phases/releases where useful, such as:

- Visual prototype

- MVP

- Agent integration

- Public/private beta

- v1.0

Associate Issues and PRs with milestones so progress is visible.

### GitHub Projects

If GitHub Projects is available and appropriate, create/use a project board to
provide a high-level operational view of development.

Useful states may include:

**Backlog → Ready → In Progress → Review/QA → Blocked → Done**

Do not duplicate information unnecessarily between Issues and the project board;
Issues should remain the underlying work items.

### Pull Requests

Use PRs as meaningful units of reviewable change.

PRs should:

- Explain what changed

- Explain why

- Link/close relevant Issues

- Identify important architectural decisions

- Include testing performed

- Mention visual QA where UI changed

- Include screenshots where useful

- Identify migrations/configuration changes

- Highlight known limitations or follow-up work

Prefer small, coherent, reviewable changes over enormous unrelated PRs.

### Issue and PR Templates

Create professional templates where useful so future humans and agents create
consistent Issues and PRs.

Consider templates for:

- Bug reports

- Feature requests

- Technical tasks

- Pull requests

Keep templates concise enough that they are actually useful.

### GitHub Actions / CI

Audit existing CI before changing it.

Where valuable, use GitHub Actions for automated checks such as:

- Build

- Type checking

- Linting

- Unit tests

- Integration tests

- Security/dependency checks

- Migration validation

- Other deterministic QA

Do not add expensive, redundant or fragile CI merely to appear comprehensive.

### Releases and Changelog

When the project reaches meaningful release points, use GitHub Releases/tags
where appropriate.

Maintain a clear changelog or equivalent release history if useful.

### Architecture Decisions

For significant architectural decisions, preserve the reasoning in the
repository.

Use lightweight ADRs or another appropriate mechanism when a decision is
important enough that a future agent could otherwise revisit or accidentally
reverse it.

### Documentation and Handover

Maintain repository documentation continuously.

The repository should contain enough information that a new coding agent can
understand:

- What the product is

- Architecture

- Current status

- How to run it

- How to test it

- How to deploy it

- Required environment variables, without secrets

- Major architectural decisions

- Known limitations

- Current priorities

- Outstanding Issues

- What changed recently

Maintain/update the existing handover document as development progresses.

Do not use the handover document as a substitute for GitHub Issues. The handover
should summarize state; Issues should track actionable work.

### GitHub Automation Principle

Where safe and authorized, prefer using GitHub APIs/CLI/tools directly to create
and maintain Issues, labels, milestones, Projects, PR metadata and other
repository structures.

Prefer:

**automate it → record it in GitHub → link related work → keep it current**

rather than giving me repetitive manual GitHub instructions.

Never expose secrets, tokens or credentials in Issues, PRs, logs, documentation
or commits.

---

## 4. Product Concept

The application is the **operating interface for my AI team and projects**.

The main experience should allow me to understand:

- My projects

- Important documents

- Tasks

- Current priorities

- Agent activity

- Jobs/workflows

- Agent outputs

- Generated artifacts

- Recommendations

- Pending decisions

- Approvals

- Recent activity

- Project progress

Eventually I should be able to create projects, upload project material, assign
work to agents, trigger workflows, review outputs, approve/reject actions,
manage tasks, navigate project knowledge and inspect agent activity/history.

Not everything needs to ship in the first MVP. The architecture should
anticipate these capabilities.

---

## 5. Home — Project Portfolio

The primary home experience should provide a beautiful overview of my projects.

Projects should appear as large, attractive visual objects/cards containing
appropriate information such as:

- Cover artwork

- Project name

- Description

- Status

- Progress

- Open tasks

- Next important date

- Recent activity

Do not make the home screen feel like a database.

---

## 6. Project Dashboard

Opening a project should reveal a structured, beautiful project environment.

Potential modules include:

- Overview

- Current focus

- Documents

- Tasks

- Milestones

- Important dates

- Notes

- Research

- Links

- Decisions

- Agent activity

- Generated artifacts

- Recommendations

- History

Modules should be optional. Do not overwhelm every project with every possible
module.

---

## 7. Documents Are a First-Class Visual Experience

This is extremely important.

I frequently use AI to transform ordinary information into beautifully designed
PDFs. I want those PDFs to become part of the visual experience.

Do **not** primarily show `financial-plan.pdf`. Instead show the actual
attractive first page/cover as a large document card.

Support PDF, DOCX, images, links, markdown/text and other practical formats.

For PDFs:

- Automatically generate a high-quality thumbnail from page 1

- Allow custom covers

- Provide beautiful gallery/grid presentation

- Allow smooth opening into the document viewer

- Preserve metadata and relationships with projects/tasks/agents

Documents should feel like objects inside a beautiful digital project studio
rather than generic file attachments.

---

## 8. Task System

Provide or integrate a proper task system.

Tasks should support where appropriate:

- Title

- Description

- Status

- Priority

- Due date

- Start date

- Project

- Agent/assignee

- Tags

- Subtasks

- Recurrence

- Completion

- Notes

- Related documents

- Related workflows

Useful views include Today, Upcoming, Project, Kanban, Calendar and Completed.

Investigate integration with external task-management systems rather than
unnecessarily rebuilding sophisticated functionality that already exists.

---

## 9. Agent Activity

The frontend should make the agentic backend understandable.

Where supported by the existing architecture, show:

- Agent identity

- Current work

- Assigned tasks

- Jobs in progress

- Completed work

- Generated artifacts

- Recommendations

- Errors

- Human approvals required

- Activity/history

An activity item should potentially answer:

**Who did what, for which project, why, when, what happened, and what was
produced?**

Avoid exposing raw internal implementation details unnecessarily. The goal is
transparency and control.

---

## 10. Architectural Principle

Prefer:

**Frontend → API/service layer → agent orchestration/tools/data**

Avoid:

**Frontend → internal agent implementation**

The frontend should not become tightly coupled to specific agent
implementations.

---

## 11. API-First — Critical Requirement

Everything reasonably possible through the UI should also be possible
programmatically.

This is non-negotiable.

AI systems such as ChatGPT, Claude and other agents should eventually be able to
manage the platform without manual UI interaction.

The system should support programmatic operations such as:

- Create/update/archive project

- Upload document

- Create document

- Generate/assign cover

- Create/update/complete task

- Create milestone

- Add note

- Add link

- Add project metadata

- Search projects/documents/tasks

- Retrieve project state

- Trigger supported workflows

- Retrieve agent activity

- Submit/resolve approvals

- Bulk import project material

Important functionality must not exist exclusively inside frontend state.

Where practical:

**UI action = API operation = agent-accessible operation**

Provide clear API documentation. Prefer REST unless the existing architecture or
another approach provides a compelling reason otherwise.

---

## 12. MCP / AI Access

Investigate providing an MCP interface over appropriate platform capabilities.

MCP should complement—not replace—the underlying API/service architecture.

The long-term experience should support instructions such as:

> “Create a new project using these documents.”

An AI should potentially be able to create the project, upload/import material,
categorize it, generate document records and thumbnails, extract metadata,
create tasks/milestones, populate the overview, assign work and return a link to
the completed dashboard.

---

## 13. Import / Export / Portability

I currently have project information in places such as:

- NotebookLM / Google Notebook

- Google Drive

- Google Docs

- PDFs

- Word documents

- GitHub

- other systems

Create a neutral project import/export format, for example:

```
project-package/
    project.json
    documents/
    covers/
    images/
    attachments/
```

The system should eventually support import adapters for Google Drive, Google
Docs, NotebookLM exports, Notion, GitHub, Dropbox, OneDrive and local folders.

Avoid vendor lock-in. A complete project should also be exportable.

---

## 14. Non-Negotiable Visual Standard

Do **not** produce a typical AI-generated dashboard.

Avoid:

- Generic Tailwind appearance

- Default component-library aesthetics

- Endless rectangular cards

- Repetitive grids

- Giant headings

- Excessive text

- Random gradients

- Generic sidebar + cards + tables

- Cramped enterprise UI

- Tiny typography

- Black-and-white Notion aesthetics

- Decorative effects without purpose

Do not simply install a component library, change the border radius and call the
interface designed.

The target is a **premium interactive digital product**.

It should feel beautiful, tactile, fluid, calm, spacious, modern, responsive,
alive and highly polished.

The reaction should be:

> “Wow — this feels expensive.”

---

## 14A. Visual Excellence Protocol — Mandatory Quality Gate

The visual experience is a primary product requirement, not final-stage polish.
Functional completeness does not compensate for mediocre presentation.

### Milestone 0: WOW Prototype

Before production integration, backend expansion, or broad CRUD work, build a
production-quality interactive visual prototype using realistic mock data. It
must demonstrate the actual intended rendering, motion and interaction stack.

The prototype must include at minimum:

- Portfolio/home experience with at least three visually distinct projects

- A richly composed project dashboard

- Beautiful PDF/document covers using realistic artwork

- Agent presence/activity visualization

- Tasks and progress visualization

- Drag/reorder interaction where useful

- Project-to-project navigation

- Project opening transition

- Document-card-to-viewer shared-element style transition

- Loading, success, error and empty-state motion

- Desktop and mobile treatments

The backend may be mocked for this milestone. The purpose is to prove the
experience before spending substantial effort on infrastructure.

### Hard WOW Gate

Do not proceed beyond Milestone 0 until the prototype passes this question:

> If all underlying data were fake, would this interface still immediately feel unusually beautiful, sophisticated, tactile and memorable?

If the answer is merely “clean”, “professional”, “modern”, “nice”, or “good for
an AI-generated app”, it FAILS. Iterate.

The target is not visual novelty for its own sake. It is exceptional product
design with clarity and restraint.

### Reference Board Before Coding

Before implementing the prototype, research and document 15–20 current
high-quality visual references. For each useful reference, identify the specific
principle worth borrowing, such as:

- navigation transition

- card physicality

- typography

- spatial composition

- document presentation

- depth/lighting

- motion choreography

- drag behaviour

- micro-interaction

- status visualization

- agent visualization

Do not simply list brand names or mood adjectives. Record concrete transferable
interaction/design principles. Do not copy proprietary designs.

From this research create a concise visual specification covering typography,
spacing, density, surfaces, depth, iconography, imagery, colour, motion and
interaction.

### No Generic-AI UI Rule

Actively detect and reject common AI-generated UI patterns. A screen should be
reconsidered if it relies primarily on:

- a left sidebar plus uniform card grid

- interchangeable rounded rectangles

- large generic hero text

- excessive pills/badges

- arbitrary purple/blue gradients

- glassmorphism everywhere

- generic stock icons

- decorative charts with little meaning

- repeated card components with identical visual weight

- excessive explanatory copy where visual hierarchy should communicate meaning

Component libraries may be used for primitives and accessibility, but their
default visual language must not define the product.

### Deliberate Art Direction

Choose and document a distinctive art direction before implementation. It should
define a coherent visual world for Agentic Team HQ rather than assembling
individually attractive components.

Use custom-designed compositions and, where appropriate, original graphical
assets rather than relying exclusively on generic UI primitives.

### Technology Freedom

Use the best rendering technology for each interaction. Do not force every
visual element through the DOM merely because the application uses React.
Evaluate DOM/CSS, SVG, Canvas, Rive, PixiJS, Three.js/WebGL/WebGPU and other
appropriate technologies.

Advanced graphics must remain purposeful, maintainable and performant. Avoid
gratuitous 3D.

### Motion Must Be Designed, Not Added

Create reusable motion primitives/tokens and choreograph transitions
intentionally. Motion should communicate hierarchy, continuity, causality and
state.

For complex sequences, prefer a timeline/animation architecture that can be
inspected and tuned rather than scattered ad-hoc transitions.

### Mandatory Render → Capture → Critique → Iterate Loop

Never evaluate visual quality from source code alone.

For every major prototype screen/state:

1. Run the actual application.

2. Render it in a real browser.

3. Capture screenshots at representative desktop and mobile sizes.

4. Inspect the screenshots visually.

5. Exercise key animations/interactions in-browser.

6. Critique composition, hierarchy, spacing, typography, depth, colour, imagery and interaction quality.

7. Compare against the approved visual direction/reference principles.

8. Fix deficiencies.

9. Capture again.

10. Repeat until the quality gate passes.

Use browser automation and available visual/browser tools rather than asking me
to manually inspect routine iterations.

### Visual QA Checklist

Explicitly review:

- Does the screen have a strong composition at first glance?

- Is there an obvious focal hierarchy?

- Does it feel bespoke rather than template-derived?

- Are document covers visually prominent enough?

- Is typography intentionally designed?

- Does whitespace feel deliberate?

- Do surfaces have believable depth without visual clutter?

- Does movement feel physical and responsive?

- Are transitions continuous rather than abrupt page swaps?

- Are hover, press, drag and completion states satisfying?

- Is information density appropriate?

- Does the interface remain beautiful with realistic amounts of data?

- Does mobile feel intentionally composed rather than compressed?

- Does reduced-motion mode remain elegant?

- Is performance smooth during interaction?

### Quality Escalation Rule

After two unsuccessful visual iterations, do not continue making small cosmetic
tweaks. Reassess the composition, interaction model, references or rendering
technology. A weak concept should be replaced rather than endlessly decorated.

### Visual Regression Evidence

For significant UI PRs, retain useful screenshot evidence or automated
visual-regression coverage where practical. PR descriptions should state what
was visually verified.

### User Approval Gate

Do not interpret passing automated tests as approval of the visual direction.
Once the Milestone 0 prototype is genuinely ready, present the working prototype
and representative captures for explicit human approval before large-scale
production integration.

## 15. Research the Visual Technology Before Choosing It

Do not automatically assume conventional React components + CSS are sufficient.

Before frontend implementation, investigate the current state of technologies
capable of producing exceptional interactive experiences.

Evaluate appropriate current alternatives to technologies such as:

- Motion / Framer Motion

- GSAP

- React Spring

- dnd-kit

- Motion One

- Three.js

- React Three Fiber

- WebGL

- WebGPU

- PixiJS

- Rive

- Lottie

- Spline

- View Transitions API

- advanced CSS/browser animation APIs

- high-quality visualization systems

This list is illustrative, not prescriptive.

For serious candidates consider visual capability, interaction quality, physics,
drag/drop, performance, mobile performance, accessibility, browser support,
bundle size, maintainability, licensing, React/Next.js compatibility and
reliability when developed using AI coding agents.

Choose technologies because they improve the product—not because they are
fashionable.

---

## 16. Consider Hybrid Rendering

Investigate whether the optimal experience combines React/HTML for text,
documents, forms, accessibility and application structure with selective
GPU-accelerated graphics for rich visual interactions, high-value animation,
depth, special transitions and visualizations.

A potential architecture might resemble:

**React + Motion/GSAP + selective Rive/Pixi/WebGL/WebGPU**

Do not turn the entire application into a 3D environment simply because it is
technically possible.

Advanced graphics should have purpose.

---

## 17. Interaction Quality

Explore:

- Fluid drag/drop

- Physics-based movement

- Springs

- Momentum

- Smooth layout transitions

- Shared-element transitions

- Project opening/closing

- Document expansion

- Gesture interaction

- Contextual menus

- Beautiful loading transitions

- Micro-interactions

- Animated status changes

- Layering

- Depth

- Subtle parallax where appropriate

Objects should have a sense of **physicality**.

For example, clicking a PDF card could smoothly expand that same visual object
into the document viewer instead of abruptly navigating to another page.

---

## 18. Motion Design System

Create a coherent motion language.

Define:

- Duration ranges

- Easing

- Spring characteristics

- Hover behaviour

- Drag behaviour

- Entrance/exit behaviour

- Modal behaviour

- Navigation transitions

- Shared-element transitions

- Reduced-motion alternatives

Do not randomly animate individual components. Motion should feel coherent
throughout the product.

---

## 19. Art Direction Research

Before designing the UI, research exceptional contemporary interfaces and
interaction design.

Investigate relevant work from sources/products such as:

- Awwwards

- Godly

- Mobbin

- Linear

- Raycast

- Arc

- Apple

- premium productivity software

- high-end creative studios

- award-winning interactive websites

Do not copy designs.

Extract principles concerning composition, typography, motion, depth,
navigation, information density, interaction and visual hierarchy.

Produce a concise **Visual & Interaction Direction** before implementation.

---

## 20. Prototype the “Wow” Experience First

This is a critical development gate.

Before spending significant effort building backend CRUD functionality, create a
**high-fidelity interactive prototype** using realistic mock data.

Prototype:

1. Project portfolio/home

2. Opening a project

3. Project dashboard

4. PDF/document gallery

5. Dragging/rearranging content where useful

6. Opening a PDF

7. Completing a task

8. Agent activity

9. Navigation between these states

Use actual production-intended animation/interaction technology—not static
mockups.

Then evaluate:

> Does this genuinely feel like a premium interactive product, or does it still look like an AI-generated dashboard?

If it still feels generic, **STOP**.

Do not compensate by adding more gradients, shadows or animations. Reconsider
art direction, composition, interaction model, typography, technology, motion
and information hierarchy.

Do not proceed to large-scale implementation until the core experience is
convincing.

---

## 21. Responsive Design

Desktop/web is the primary experience.

Mobile must be intentionally designed rather than merely shrinking the desktop
interface.

Mobile should prioritize:

- Project overview

- Documents

- Tasks

- Agent status

- Quick actions

- Upload

- Search

A PWA is acceptable initially. Do not make native iOS development a requirement
for the first version.

---

## 22. Performance Is Part of the Design

Target smooth interaction on modern hardware and, where practical, 60fps
interaction.

Use GPU-friendly transforms, lazy loading, optimized thumbnails, sensible
caching, asynchronous processing and pagination/virtualization where
appropriate.

Avoid layout thrashing, excessive re-renders, giant JavaScript bundles,
gratuitous WebGL, animation that harms usability and effects that destroy mobile
performance.

Advanced effects should degrade gracefully.

---

## 23. Accessibility

Premium interaction must remain usable.

Support:

- `prefers-reduced-motion`

- Keyboard navigation

- Touch

- Accessible semantics

- Appropriate contrast

- Screen readers where practical

---

## 24. Search

Provide fast search across appropriate entities:

- Projects

- Documents

- Tasks

- Notes

- Tags

- Links

- Agent outputs

Architect the system so semantic/AI search can be introduced without redesigning
everything.

---

## 25. Open-Source First

Before implementing substantial functionality, search for mature existing
open-source components/projects.

I do not want large amounts of AI coding credits spent rebuilding solved
problems.

Investigate existing project managers, task systems, document managers, PDF
viewers, gallery systems, dashboard frameworks, animation libraries, agent
interfaces and MCP implementations.

Preference order:

**integrate → adapt → extend → build from scratch**

Check licenses. Do not introduce enormous dependencies merely to solve trivial
problems.

---

## 26. Cost

Target approximately **£0/month for personal use**.

Prefer:

- Open source

- Generous free tiers

- Existing repository infrastructure

- Free database/storage allowances

- Free deployment tiers

Do not introduce paid dependencies without a compelling reason. If recommending
something paid, identify the cost and a free alternative.

---

## 27. Authentication, Security & Privacy

This is initially primarily a private personal application.

Nevertheless maintain proper authentication, authorization, private files,
database security/RLS where appropriate, API authentication, secrets management
and auditability.

Reuse the repository’s existing security architecture where appropriate. Do not
unnecessarily create another authentication system.

---

## 28. Quality Assurance

Do not assume something works because it compiles.

Test:

- Existing functionality before changes

- Existing functionality after changes

- API operations

- Project creation

- File upload

- PDF thumbnail generation

- Tasks

- Agent interactions

- Bulk import

- Search

- Authentication

- Desktop

- Mobile

- Empty states

- Large projects

- Malformed files

- Failed uploads

- API failures

- Network interruption

- Refresh/restart behaviour

Perform visual QA at multiple viewport sizes.

Look specifically for clipping, overflow, broken cards, cramped typography,
inconsistent spacing, poor contrast, broken animations, mobile failures,
loading-state problems and interaction jank.

Where useful, use browser automation/screenshots to verify the actual rendered
interface.

When QA uncovers a genuine defect that is not fixed immediately, capture it as a
GitHub Issue rather than allowing it to disappear into chat or logs.

---

## 29. Non-Destructive Development

This repository is already under active development.

Before significant changes:

- Understand dependencies

- Run existing tests

- Inspect CI

- Establish the current baseline

- Identify breaking-change risks

- Preserve rollback capability

Work incrementally.

Do not perform broad rewrites merely for architectural elegance.

Keep changes logically separated and reviewable.

Maintain/update the repository’s handover documentation as development
progresses.

---

## 30. Technology

Do not blindly impose a new stack.

First inspect what this repository already uses.

Where possible, extend the existing stack.

Potential technologies may include TypeScript, React, Next.js, PostgreSQL,
Supabase, object storage, REST APIs and MCP. These are preferences, not
immutable requirements.

Choose based on existing architecture, simplicity, reliability, performance,
security, maintainability, cost, AI-agent compatibility, deployment and
developer experience.

---

## 31. Minimize My Intervention

Treat avoidable requests for manual configuration as a design failure: first
investigate whether the same outcome can be achieved through existing
credentials, repository tooling, an API, CLI, SDK, connector or authorized
browser session.

Automate wherever practical.

Prefer:

**API → CLI → automated configuration → manual UI**

in that order.

Do not repeatedly ask me to perform steps that can safely be automated.

Do not ask me for information that can be discovered from the repository,
existing configuration, documentation, APIs, CLI tools or environment.

Never expose secrets in chat, logs or committed files.

If GitHub operations can safely be performed through available GitHub tooling,
perform them rather than asking me to manually create Issues, labels,
milestones, project items or similar repository metadata.

---

## 31A. Autonomy-First Operation & Browser-Capable Agents

This frontend is the human control surface for an agentic system that should
operate as autonomously as safely and technically possible.

**Do not design workflows around repeated manual setup.** Prefer, in order:

**existing authenticated integration → official API → CLI → browser automation →
concise human approval only when genuinely unavoidable.**

### CLI / API First

When a setup or operational task can be completed using a CLI, API, SDK,
infrastructure-as-code mechanism or existing authenticated connector, the agent
should do it programmatically rather than instructing me to click through
administrative screens.

Examples include creating configuration, registering integrations, configuring
webhooks, creating repository metadata, deploying services, running migrations,
managing non-secret environment configuration, testing endpoints and inspecting
service state.

The frontend should surface the resulting state and any failures clearly rather
than making me perform the underlying steps myself.

### Browser-Capable Agents

The architecture must anticipate agents that can launch and control browser
sessions for authorized web workflows where APIs or CLIs are unavailable or
insufficient.

Browser-capable agents should be able, subject to authorization and site rules,
to:

- Open websites and web applications

- Navigate authenticated sessions

- Fill forms

- Read dashboards and retrieve information

- Upload/download permitted files

- Configure integrations

- Create or rotate API credentials when the service permits this through its normal authenticated UI

- Perform administrative setup that would otherwise require repetitive manual clicking

- Carry out approved publishing workflows, including social-media workflows, where technically and legally permitted

Do not assume every external service exposes a suitable API. Browser automation
should be a first-class fallback capability rather than an afterthought.

### Frontend Browser-Session Experience

The frontend should be capable of presenting browser-agent activity in a clear,
trustworthy way. Investigate UI patterns for:

- Active browser sessions

- Current site/domain

- Current objective

- Recent actions

- Live or recent screenshot/preview where appropriate

- Success/failure state

- Artifacts or information gathered

- Paused sessions requiring human input

- Ability to cancel/stop a browser task

I should be able to understand what an agent is doing without watching every
click.

### Credentials, Secrets & Sessions

Design for secure credential and session handling. The frontend should reference
credentials/secrets through a secure backend or vault abstraction rather than
displaying or storing raw secrets in normal UI state.

Where appropriate, support durable authorized sessions so I do not repeatedly
log into the same service.

Never place secrets in:

- source control

- GitHub Issues/PRs

- normal application logs

- agent transcripts intended for broad retention

- browser-visible debugging output

Do not attempt to bypass MFA, CAPTCHA, security challenges, account protections
or website restrictions. When a service requires unavoidable human
authentication or confirmation, pause at the smallest possible intervention
point and present one clear action to me.

### Approval Policies Instead of Constant Interruptions

Do not interrupt me for every external action.

Design an approval-policy system capable of distinguishing, for example:

- **Automatically allowed:** read-only research, data gathering, safe configuration inspection, reversible internal operations

- **Allowed under standing authorization:** routine actions I have explicitly delegated

- **Approval required:** consequential external publishing, purchases, destructive changes, sensitive permission changes or actions outside established policy

The precise backend policy engine can be developed separately, but the frontend
architecture and UX must anticipate it from the beginning.

### External Publishing & Social Workflows

The system should eventually support agents that can prepare and, under
configured authorization, publish content through services such as Instagram and
other external platforms.

The frontend should therefore anticipate:

- Draft content

- Media/assets

- Target account/channel

- Preview

- Scheduled/pending state

- Approval state

- Published state

- Failure/retry information

- Link to resulting external content where available

Prefer official publishing APIs when practical; use authorized browser workflows
only where appropriate.

### Autonomy UX Goal

The desired experience is:

> I give the AI team an objective. The team discovers what it can, uses existing credentials/integrations, operates APIs/CLIs/browser sessions, performs setup and execution, and returns results. I am interrupted only when a genuinely necessary decision, approval or authentication challenge requires me.

The frontend must make this level of autonomy **visible, controllable and
trustworthy** without turning me into the operator for every individual step.

## 32. MVP

Keep the first production implementation focused.

The MVP should prove:

**Agentic Team HQ → Project → beautiful documents + actionable tasks + visible
agent activity**

Minimum target:

- Existing authentication integration

- Project portfolio

- Project dashboard

- PDF upload

- Automatic PDF cover generation

- Beautiful document gallery

- PDF viewer

- Tasks

- Basic agent activity/status

- Search

- API access

- Bulk project import

- Responsive design

- Light/dark mode

- Premium motion/interaction system

Everything else can follow.

Represent MVP work properly in GitHub Issues/milestones rather than relying
solely on an informal checklist.

---

## 33. Implementation Process

### Phase 1 — Repository Audit

Understand the existing system completely enough to extend it safely. Audit
existing GitHub repository structure and project tracking at the same time.

### Phase 2 — Feasibility & Research

Research architecture, reusable components, open-source solutions, visual
technologies, animation/graphics technology, integration options and
cost/free-tier constraints.

Verify assumptions rather than guessing.

Capture significant future work, discovered defects and deferred improvements in
GitHub Issues.

### Phase 3 — Proposed Architecture

Present:

- Integration assessment

- Proposed architecture

- Data flow

- API strategy

- Frontend technology

- Visual technology

- Reuse strategy

- Risks

- MVP boundary

- GitHub Issues/milestones/project structure for implementation

### Phase 4 — Visual Direction

Create the visual and interaction direction.

### Phase 5 — High-Fidelity Interactive Prototype

Build the core experience using realistic data.

Do not yet build every feature.

Track prototype work and discovered follow-ups appropriately in GitHub.

### Phase 6 — Quality Gate

Evaluate the prototype technically and visually.

If it looks generic, improve it before proceeding.

### Phase 7 — Production Integration

Integrate the approved experience into the actual agentic system.

Use Issues and PRs to make implementation state explicit and traceable.

### Phase 8 — QA

Perform functional, integration, responsive, performance and visual testing.

Create Issues for unresolved defects or improvements.

### Phase 9 — Documentation & Repository Handover

Update architecture, API and handover documentation so another coding agent can
continue the project without relying on conversation history.

Ensure GitHub itself accurately reflects:

- Completed work

- Current work

- Backlog

- Bugs

- Planned features

- Milestones

- Dependencies

- Important decisions

- Relevant PRs

- Current release/state

---

## 34. Repository Continuity Standard

At any meaningful stopping point, another competent coding agent should be able
to clone/open the repository and determine, primarily from the repository and
GitHub metadata:

1. What this product is

2. How it works

3. How to run it

4. How to test it

5. What has already been implemented

6. What is currently being worked on

7. What is broken

8. What features are planned

9. What is blocked

10. What should be worked on next

11. Why important architectural decisions were made

12. Where the relevant Issues, PRs and documentation are

**Chat history must not be a required dependency for project continuity.**

---

# Final Success Criteria

The project succeeds when I can give an AI agent a collection of documents and
instructions such as:

> “Create this project in my Agentic Team HQ, organize these documents, identify the actions required and assign appropriate work to the team.”

The underlying agentic system can perform that work programmatically.

When I open the application I see a **beautiful, sophisticated, highly
interactive visual representation of the project** containing attractive
document/PDF covers, current priorities, tasks, progress, agent activity,
generated work and decisions requiring my attention.

I should be able to understand what is happening almost immediately.

The application should feel less like **a database, file manager, admin panel or
generic AI-generated SaaS dashboard** and more like **a beautifully designed
operating system for my projects and AI team**.

The GitHub repository should simultaneously function as a **professional,
durable development record**, with Issues, PRs, labels, milestones, project
tracking, CI and documentation used appropriately so that development can move
between human developers and AI coding agents without losing context.

Above all:

**Understand the existing repository first. Research before building. Reuse
before reinventing. Prototype the experience before building the machinery
underneath it. Preserve existing functionality. Make the API first-class. Use
GitHub as the operational source of truth. Minimize manual intervention. And do
not accept mediocre visual design simply because it is functional.**
