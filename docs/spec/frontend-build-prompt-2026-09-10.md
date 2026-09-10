# Master Frontend Build Prompt — Agentic Team HQ

**Received:** 2026-09-10, from Grant, verbatim.
**Status:** ⭐ CANONICAL for all frontend work. Supersedes earlier frontend
direction where they conflict.
**Assessment against this repository:** `docs/integration-assessment-2026-09-10.md`
**Tracked as:** GitHub milestones M0 → v1.0

> Preserved in full because it is a requirements document, not a chat message.
> Where this repository cannot meet a clause — §3's CI, §15's framework list —
> the conflict is recorded in the assessment and as a GitHub Issue, never
> silently resolved.

---

## Mission

Transform this existing agentic AI repository into a world-class visual Agentic
Team HQ: the human-facing control plane for my AI team, projects, documents,
tasks, workflows and generated artifacts.

This is not a greenfield application. This is not a Notion clone. This is not
another generic project-management dashboard.

The repository already contains an agentic architecture. Understand that
architecture first, then build a beautiful, highly interactive frontend around
it, extending the backend only where genuinely necessary.

The experience should combine: **agentic AI control centre + beautiful personal
project HQ + visual document library + task/project management.**

The result should feel like a premium native application or sophisticated
interactive digital product rather than an AI-generated SaaS dashboard.

**Autonomy-first requirement:** the frontend must be designed as the control
plane for agents that can operate APIs, CLIs and authorized browser sessions
with minimal human intervention. Manual setup should be the exception, not the
default.

## 1. Understand the existing repository first

Inspect thoroughly before substantial changes: READMEs, AGENTS.md, handover and
architecture docs, package manifests, schemas/migrations, APIs, authentication,
agent definitions, orchestration, tools, integrations, queues/jobs, existing
frontend, tests, CI/CD, deployment config, environment-variable documentation,
and existing GitHub Issues, labels, milestones, Projects, Discussions and
templates.

Determine what exists, what works, what is incomplete, what to reuse, what to
extend, what must not be duplicated, what architectural constraints exist, and
what work is already represented in GitHub.

Do not create parallel systems for authentication, users, projects, tasks,
documents, storage, APIs, agent orchestration or databases. Reuse existing
infrastructure. Preserve backwards compatibility. Treat the repository as
production-sensitive.

## 2. Produce an integration assessment first

Twenty sections: current architecture · existing agent architecture · existing
frontend · existing backend/services · existing APIs · database/schema ·
authentication · storage · project/task/document models · existing integrations
· reusable components · missing capabilities · proposed frontend architecture ·
required backend changes · integration boundaries · technical risks · potential
breaking changes · recommended implementation sequence · current GitHub
repository-management maturity · recommended GitHub structure.

**Do not blindly start coding before understanding the system.**

## 3. GitHub must become the operational source of truth

Not merely somewhere to push code — the durable operational record, so another
developer or AI agent can understand project state without chat history.

Where permissions and tooling allow, **actively populate and maintain** GitHub
features rather than suggesting Grant do so manually.

**Issues** for actionable work: bugs, problems found during development,
features, enhancements, technical debt, refactors, UX/UI problems, performance,
security, integration, documentation gaps, research spikes, and deferred work
discovered while implementing something else. Do not bury important future work
in chat, TODO comments or handover prose. Check for an existing Issue before
creating one. Include: clear title, context/problem, desired outcome, acceptance
criteria, technical notes, dependencies/blockers, links, labels, milestone.

**Labels** — a coherent taxonomy, no clutter, reuse GitHub defaults where
adequate. **Milestones** for meaningful phases. **Projects** board if available.
**PRs** as reviewable units: what changed, why, linked Issues, architectural
decisions, testing performed, visual QA, screenshots, migrations/config, known
limitations. Prefer small coherent PRs. **Templates** for bugs, features,
technical tasks, PRs. **Actions/CI** — audit before changing; do not add
expensive, redundant or fragile CI. **Releases/changelog** at meaningful points.
**ADRs** for significant decisions. **Documentation** maintained continuously so
a new agent can understand product, architecture, status, how to run/test/deploy,
required environment variables (no secrets), decisions, limitations, priorities,
outstanding Issues and recent changes.

**Automation principle:** automate it → record it in GitHub → link related work →
keep it current. Never expose secrets in Issues, PRs, logs, docs or commits.

## 4. Product concept

The operating interface for the AI team and projects. Must show: projects,
important documents, tasks, current priorities, agent activity, jobs/workflows,
agent outputs, generated artifacts, recommendations, pending decisions,
approvals, recent activity, project progress.

Eventually: create projects, upload material, assign work to agents, trigger
workflows, review outputs, approve/reject, manage tasks, navigate project
knowledge, inspect agent history. Not all in the first MVP, but the architecture
should anticipate it.

## 5. Home — project portfolio

Projects as large, attractive visual objects: cover artwork, name, description,
status, progress, open tasks, next important date, recent activity. **Do not
make the home screen feel like a database.**

## 6. Project dashboard

Structured, beautiful project environment. Possible modules: overview, current
focus, documents, tasks, milestones, important dates, notes, research, links,
decisions, agent activity, generated artifacts, recommendations, history.
Modules are optional — do not overwhelm every project with every module.

## 7. Documents are a first-class visual experience

**Extremely important.** Grant frequently uses AI to turn ordinary information
into beautifully designed PDFs, and wants those PDFs to be part of the visual
experience.

Do not primarily show `financial-plan.pdf`. Show the actual attractive first
page/cover as a large document card.

Support PDF, DOCX, images, links, markdown/text. For PDFs: automatically
generate a high-quality thumbnail from page 1; allow custom covers; beautiful
gallery/grid; smooth opening into the viewer; preserve metadata and
relationships with projects/tasks/agents.

Documents should feel like objects in a beautiful digital project studio, not
generic file attachments.

## 8. Task system

Title, description, status, priority, due date, start date, project,
agent/assignee, tags, subtasks, recurrence, completion, notes, related
documents, related workflows. Views: Today, Upcoming, Project, Kanban, Calendar,
Completed. Investigate integrating an external system rather than rebuilding
sophisticated functionality that exists.

## 9. Agent activity

Make the agentic backend understandable: agent identity, current work, assigned
tasks, jobs in progress, completed work, generated artifacts, recommendations,
errors, human approvals required, activity/history.

An activity item should answer: **who did what, for which project, why, when,
what happened, and what was produced?** Avoid exposing raw internal
implementation detail unnecessarily — the goal is transparency and control.

## 10. Architectural principle

Prefer `Frontend → API/service layer → agent orchestration/tools/data`.
Avoid `Frontend → internal agent implementation`. The frontend must not become
tightly coupled to specific agent implementations.

## 11. API-first — critical, non-negotiable

Everything reasonably possible through the UI must also be possible
programmatically. ChatGPT, Claude and other agents should eventually manage the
platform without manual UI interaction.

Support: create/update/archive project · upload document · create document ·
generate/assign cover · create/update/complete task · create milestone · add
note · add link · add metadata · search · retrieve project state · trigger
workflows · retrieve agent activity · submit/resolve approvals · bulk import.

Important functionality must not exist exclusively inside frontend state.
Where practical: **UI action = API operation = agent-accessible operation.**
Provide clear API documentation. Prefer REST unless the existing architecture
gives a compelling reason otherwise.

## 12. MCP / AI access

Investigate an MCP interface over platform capabilities, complementing rather
than replacing the API. Long term: *"Create a new project using these
documents"* should cause an AI to create the project, upload and categorize
material, generate document records and thumbnails, extract metadata, create
tasks and milestones, populate the overview, assign work, and return a link.

## 13. Import / export / portability

Material currently lives in NotebookLM/Google Notebook, Google Drive, Google
Docs, PDFs, Word documents, GitHub and elsewhere. Create a neutral package
format:

```
project-package/
    project.json
    documents/
    covers/
    images/
    attachments/
```

Import adapters eventually for Google Drive, Google Docs, NotebookLM exports,
Notion, GitHub, Dropbox, OneDrive, local folders. Avoid vendor lock-in; a
complete project must be exportable.

## 14. Non-negotiable visual standard

**Avoid:** generic Tailwind appearance · default component-library aesthetics ·
endless rectangular cards · repetitive grids · giant headings · excessive text ·
random gradients · generic sidebar + cards + tables · cramped enterprise UI ·
tiny typography · black-and-white Notion aesthetics · decorative effects without
purpose.

Do not install a component library, change the border radius and call it
designed. The target is a premium interactive digital product: beautiful,
tactile, fluid, calm, spacious, modern, responsive, alive, highly polished.

The reaction should be: **"Wow — this feels expensive."**

## 14A. Visual Excellence Protocol — mandatory quality gate

Visual experience is a primary product requirement, not final-stage polish.
Functional completeness does not compensate for mediocre presentation.

**Milestone 0: WOW prototype.** Before production integration, backend expansion
or broad CRUD work, build a production-quality interactive visual prototype
using realistic mock data, demonstrating the actual intended rendering, motion
and interaction stack. Minimum: portfolio home with ≥3 visually distinct
projects · richly composed project dashboard · beautiful PDF/document covers
with realistic artwork · agent presence/activity visualization · tasks and
progress · drag/reorder where useful · project-to-project navigation · project
opening transition · document-card-to-viewer shared-element transition ·
loading, success, error and empty-state motion · desktop and mobile treatments.
The backend may be mocked.

**Hard WOW gate.** Do not proceed past Milestone 0 until:

> If all underlying data were fake, would this interface still immediately feel
> unusually beautiful, sophisticated, tactile and memorable?

"Clean", "professional", "modern", "nice" or "good for an AI-generated app"
**FAILS**. Iterate. The target is exceptional product design with clarity and
restraint, not novelty.

**Reference board before coding.** Research and document 15–20 current
high-quality visual references. For each, identify the specific transferable
principle: navigation transition · card physicality · typography · spatial
composition · document presentation · depth/lighting · motion choreography ·
drag behaviour · micro-interaction · status visualization · agent
visualization. **Do not list brand names or mood adjectives.** Do not copy
proprietary designs. From this produce a concise visual specification covering
typography, spacing, density, surfaces, depth, iconography, imagery, colour,
motion and interaction.

**No generic-AI UI rule.** Reconsider any screen relying primarily on: left
sidebar + uniform card grid · interchangeable rounded rectangles · large generic
hero text · excessive pills/badges · arbitrary purple/blue gradients ·
glassmorphism everywhere · generic stock icons · decorative charts with little
meaning · repeated cards of identical visual weight · excessive explanatory copy
where hierarchy should communicate. Component libraries may supply primitives
and accessibility; their default visual language must not define the product.

**Deliberate art direction.** Choose and document a distinctive art direction
before implementation — a coherent visual world, not assembled attractive
components. Use custom compositions and original graphical assets where
appropriate.

**Technology freedom.** Use the best rendering technology per interaction. Do
not force everything through the DOM. Evaluate DOM/CSS, SVG, Canvas, Rive,
PixiJS, Three.js/WebGL/WebGPU. Advanced graphics must remain purposeful,
maintainable and performant. Avoid gratuitous 3D.

**Motion must be designed, not added.** Reusable motion primitives/tokens,
intentionally choreographed. Motion communicates hierarchy, continuity,
causality and state. For complex sequences prefer an inspectable timeline
architecture over scattered ad-hoc transitions.

**Mandatory render → capture → critique → iterate loop.** Never evaluate visual
quality from source code alone. For every major screen/state: run the app ·
render in a real browser · capture desktop and mobile screenshots · inspect them
· exercise key animations · critique composition, hierarchy, spacing,
typography, depth, colour, imagery, interaction · compare against the approved
direction · fix · capture again · repeat until the gate passes. Use browser
automation rather than asking Grant to inspect routine iterations.

**Visual QA checklist.** Strong composition at first glance? Obvious focal
hierarchy? Bespoke rather than template-derived? Document covers prominent
enough? Typography intentional? Whitespace deliberate? Believable depth without
clutter? Movement physical and responsive? Transitions continuous rather than
abrupt? Hover/press/drag/completion states satisfying? Density appropriate?
Still beautiful with realistic amounts of data? Mobile intentionally composed
rather than compressed? Reduced-motion still elegant? Performance smooth?

**Quality escalation rule.** After two unsuccessful visual iterations, stop
making cosmetic tweaks. Reassess composition, interaction model, references or
rendering technology. Replace a weak concept rather than endlessly decorating it.

**Visual regression evidence.** Retain screenshot evidence or automated visual
regression coverage for significant UI PRs. State what was visually verified.

**User approval gate.** Passing automated tests is not approval of visual
direction. Present the working prototype and captures for **explicit human
approval** before large-scale production integration.

## 15. Research the visual technology before choosing it

Do not assume conventional React + CSS suffices. Evaluate current alternatives:
Motion/Framer Motion · GSAP · React Spring · dnd-kit · Motion One · Three.js ·
React Three Fiber · WebGL · WebGPU · PixiJS · Rive · Lottie · Spline · View
Transitions API · advanced CSS/browser animation APIs · visualization systems.
Illustrative, not prescriptive.

Consider: visual capability, interaction quality, physics, drag/drop,
performance, mobile performance, accessibility, browser support, bundle size,
maintainability, licensing, framework compatibility, and reliability when
developed by AI coding agents. Choose because it improves the product, not
because it is fashionable.

## 16. Consider hybrid rendering

React/HTML for text, documents, forms, accessibility and structure; selective
GPU-accelerated graphics for rich interaction, high-value animation, depth,
special transitions and visualizations. Do not turn the whole application into a
3D environment because it is possible.

## 17. Interaction quality

Fluid drag/drop · physics-based movement · springs · momentum · smooth layout
transitions · shared-element transitions · project opening/closing · document
expansion · gestures · contextual menus · beautiful loading transitions ·
micro-interactions · animated status changes · layering · depth · subtle
parallax where appropriate.

Objects should have physicality. Clicking a PDF card should smoothly expand that
same visual object into the viewer rather than abruptly navigating.

## 18. Motion design system

Define duration ranges · easing · spring characteristics · hover · drag ·
entrance/exit · modal · navigation transitions · shared-element transitions ·
reduced-motion alternatives. Motion must feel coherent throughout, not randomly
applied per component.

## 19. Art direction research

Research exceptional contemporary interfaces — Awwwards, Godly, Mobbin, Linear,
Raycast, Arc, Apple, premium productivity software, high-end creative studios,
award-winning interactive websites. **Do not copy designs.** Extract principles:
composition, typography, motion, depth, navigation, information density,
interaction, visual hierarchy. Produce a concise Visual & Interaction Direction
before implementation.

## 20. Prototype the "wow" experience first

Critical gate. Before significant backend CRUD work, build a high-fidelity
interactive prototype on realistic mock data covering: portfolio/home · opening
a project · project dashboard · PDF/document gallery · dragging/rearranging ·
opening a PDF · completing a task · agent activity · navigation between these.

Use the actual production-intended animation technology, not static mockups.
Then evaluate honestly. **If it still feels generic, STOP.** Do not compensate
with more gradients, shadows or animations — reconsider art direction,
composition, interaction model, typography, technology, motion and hierarchy.

## 21. Responsive design

Desktop/web primary. Mobile intentionally designed, not a shrunken desktop.
Mobile prioritizes: project overview · documents · tasks · agent status · quick
actions · upload · search. A PWA is acceptable initially; native iOS is not
required for v1.

## 22. Performance is part of the design

Smooth interaction on modern hardware, 60fps where practical. GPU-friendly
transforms, lazy loading, optimized thumbnails, sensible caching, async
processing, pagination/virtualization. Avoid layout thrashing, excessive
re-renders, giant bundles, gratuitous WebGL, animation that harms usability,
effects that destroy mobile performance. Advanced effects degrade gracefully.

## 23. Accessibility

`prefers-reduced-motion` · keyboard navigation · touch · accessible semantics ·
appropriate contrast · screen readers where practical.

## 24. Search

Fast search across projects, documents, tasks, notes, tags, links, agent
outputs. Architect so semantic/AI search can be introduced without a redesign.

## 25. Open-source first

Search for mature existing components before implementing substantial
functionality. Do not spend AI coding credits rebuilding solved problems.
Preference order: **integrate → adapt → extend → build from scratch.** Check
licenses. Do not introduce enormous dependencies for trivial problems.

## 26. Cost

Target ~£0/month for personal use. Prefer open source, generous free tiers,
existing repository infrastructure, free database/storage allowances, free
deployment tiers. Do not introduce paid dependencies without a compelling
reason; if recommending something paid, identify the cost and a free
alternative.

## 27. Authentication, security and privacy

Primarily a private personal application, but maintain proper authentication,
authorization, private files, database security/RLS where appropriate, API
authentication, secrets management and auditability. Reuse the existing security
architecture — do not create another authentication system.

## 28. Quality assurance

Do not assume something works because it compiles. Test existing functionality
before and after changes · API operations · project creation · file upload ·
PDF thumbnail generation · tasks · agent interactions · bulk import · search ·
authentication · desktop · mobile · empty states · large projects · malformed
files · failed uploads · API failures · network interruption · refresh/restart.

Visual QA at multiple viewport sizes: clipping, overflow, broken cards, cramped
typography, inconsistent spacing, poor contrast, broken animations, mobile
failures, loading-state problems, interaction jank. Use browser automation and
screenshots. **When QA uncovers a genuine defect not fixed immediately, capture
it as a GitHub Issue.**

## 29. Non-destructive development

Before significant changes: understand dependencies · run existing tests ·
inspect CI · establish the baseline · identify breaking-change risks · preserve
rollback capability. Work incrementally. Do not perform broad rewrites for
architectural elegance. Keep changes logically separated and reviewable.
Maintain handover documentation as development progresses.

## 30. Technology

Do not blindly impose a new stack. Inspect what the repository uses and extend
it where possible. Potential: TypeScript, React, Next.js, PostgreSQL, Supabase,
object storage, REST APIs, MCP — preferences, not immutable requirements. Choose
on existing architecture, simplicity, reliability, performance, security,
maintainability, cost, AI-agent compatibility, deployment and developer
experience.

## 31. Minimize Grant's intervention

Treat avoidable requests for manual configuration as a **design failure**. First
investigate whether the outcome is achievable through existing credentials,
repository tooling, an API, CLI, SDK, connector or authorized browser session.

Prefer **API → CLI → automated configuration → manual UI**, in that order.

Do not repeatedly ask Grant to perform steps that can safely be automated. Do
not ask for information discoverable from the repository, configuration,
documentation, APIs, CLI tools or environment. Never expose secrets. If GitHub
operations can be performed through available tooling, perform them rather than
asking him to create Issues, labels, milestones or project items by hand.

## 31A. Autonomy-first operation and browser-capable agents

The frontend is the human control surface for a system that should operate as
autonomously as safely and technically possible. Do not design workflows around
repeated manual setup. Prefer: **existing authenticated integration → official
API → CLI → browser automation → concise human approval only when genuinely
unavoidable.**

**CLI/API first.** When a task can be completed programmatically — creating
configuration, registering integrations, configuring webhooks, creating
repository metadata, deploying services, running migrations, managing non-secret
environment configuration, testing endpoints, inspecting service state — do it,
rather than instructing Grant to click through admin screens. Surface resulting
state and failures clearly.

**Browser-capable agents.** Anticipate agents that launch and control browser
sessions for authorized web workflows where APIs are unavailable or
insufficient: open websites · navigate authenticated sessions · fill forms ·
read dashboards · upload/download permitted files · configure integrations ·
create or rotate API credentials through a service's normal authenticated UI ·
perform administrative setup · carry out approved publishing workflows including
social media, where technically and legally permitted. Browser automation is a
first-class fallback, not an afterthought.

**Frontend browser-session experience.** Present browser-agent activity
trustworthily: active sessions · current site/domain · current objective ·
recent actions · live or recent screenshot · success/failure · artifacts
gathered · paused sessions needing input · ability to cancel. Grant should
understand what an agent is doing without watching every click.

**Credentials, secrets and sessions.** Reference credentials through a secure
backend or vault abstraction; never display or store raw secrets in UI state.
Support durable authorized sessions. Never place secrets in source control,
Issues/PRs, application logs, retained agent transcripts, or browser-visible
debugging output. **Do not attempt to bypass MFA, CAPTCHA, security challenges,
account protections or website restrictions.** Where human authentication is
unavoidable, pause at the smallest possible intervention point and present one
clear action.

**Approval policies instead of constant interruptions.** Distinguish:
automatically allowed (read-only research, data gathering, safe configuration
inspection, reversible internal operations) · allowed under standing
authorization (routine delegated actions) · approval required (consequential
external publishing, purchases, destructive changes, sensitive permission
changes, actions outside policy). The frontend architecture and UX must
anticipate this from the beginning.

**External publishing and social workflows.** Anticipate draft content · media
assets · target account/channel · preview · scheduled/pending state · approval
state · published state · failure/retry · link to resulting external content.
Prefer official publishing APIs; use authorized browser workflows only where
appropriate.

**Autonomy UX goal:** *"I give the AI team an objective. The team discovers what
it can, uses existing credentials/integrations, operates APIs/CLIs/browser
sessions, performs setup and execution, and returns results. I am interrupted
only when a genuinely necessary decision, approval or authentication challenge
requires me."*

## 32. MVP

Prove: **Agentic Team HQ → Project → beautiful documents + actionable tasks +
visible agent activity.**

Minimum: existing authentication integration · project portfolio · project
dashboard · PDF upload · automatic PDF cover generation · beautiful document
gallery · PDF viewer · tasks · basic agent activity/status · search · API access
· bulk project import · responsive design · light/dark mode · premium
motion/interaction system.

Represent MVP work in GitHub Issues and milestones, not an informal checklist.

## 33. Implementation process

1. **Repository audit** — understand enough to extend safely; audit GitHub too.
2. **Feasibility and research** — architecture, reusable components, open
   source, visual technologies, integrations, cost. Verify rather than guess.
   Capture future work, defects and deferrals as Issues.
3. **Proposed architecture** — assessment, architecture, data flow, API
   strategy, frontend technology, visual technology, reuse strategy, risks, MVP
   boundary, GitHub structure.
4. **Visual direction.**
5. **High-fidelity interactive prototype** — core experience, realistic data,
   not every feature. Track in GitHub.
6. **Quality gate** — evaluate technically and visually; improve if generic.
7. **Production integration** — Issues and PRs make state traceable.
8. **QA** — functional, integration, responsive, performance, visual. Issues for
   unresolved defects.
9. **Documentation and repository handover** — so another agent can continue
   without conversation history. GitHub must accurately reflect completed work,
   current work, backlog, bugs, planned features, milestones, dependencies,
   decisions, PRs and current state.

## 34. Repository continuity standard

At any meaningful stopping point, another competent coding agent should be able
to open the repository and determine, primarily from the repository and GitHub
metadata: what the product is · how it works · how to run it · how to test it ·
what is implemented · what is being worked on · what is broken · what is planned
· what is blocked · what to work on next · why important architectural decisions
were made · where the relevant Issues, PRs and documentation are.

**Chat history must not be a required dependency for project continuity.**

## Final success criteria

Grant can give an AI agent a collection of documents and an instruction such as:

> *"Create this project in my Agentic Team HQ, organize these documents,
> identify the actions required and assign appropriate work to the team."*

The agentic system performs that work programmatically. Opening the application
shows a beautiful, sophisticated, highly interactive visual representation of
the project: attractive document/PDF covers, current priorities, tasks,
progress, agent activity, generated work, and decisions requiring attention.
He should understand what is happening almost immediately.

It should feel less like a database, file manager, admin panel or generic AI
SaaS dashboard, and more like **a beautifully designed operating system for his
projects and AI team.**

The GitHub repository should simultaneously function as a professional, durable
development record so development can move between human developers and AI
coding agents without losing context.

**Above all:** understand the existing repository first · research before
building · reuse before reinventing · prototype the experience before building
the machinery underneath it · preserve existing functionality · make the API
first-class · use GitHub as the operational source of truth · minimize manual
intervention · and do not accept mediocre visual design simply because it is
functional.
