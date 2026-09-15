# Project dashboard — design direction, 15 September 2026

**Grant's words, verbatim and uncondensed.** Persisted the moment it arrived,
before anything was done with it, per CLAUDE.md. Do not summarise this file, do
not tidy it, and do not implement from a paraphrase of it.

The screenshot he attached could not be committed as an image from the
authoring session. A detailed description of it is preserved below the brief,
and the original is in the conversation of 15 September 2026.

---

## The brief, as written

I want to clarify the design direction for the project dashboard. The attached
Railway screenshot captures the kind of interface I'm aiming for: spacious,
visual, interactive, modern, and immediately understandable.

This describes how the project dashboard itself should look and behave. It is
not a request for a separate Canvas tab, additional view, or disconnected
feature.

### What to take from the screenshot

Notice the large open workspace, subtle dotted grid, compact floating cards,
generous spacing, restrained colors, delicate borders, and unobtrusive
controls. Each item communicates its identity and status with very little text.
The workspace has room to breathe.

Bring that same clarity to our projects. I want to see my agents, their
connected third-party services, and the tasks and documents associated with
their work, understand how they relate, and interact with them directly.

Use the screenshot as a visual reference. Its deployment controls and
database-specific wording are not requirements for our product. It does not
show connection lines or open document panels; those are interactions I want
applied to our dashboard as described below.

### How I want the dashboard to work

1. Show the project's agents and connected services as compact, attractive
   items that I can move around and organize naturally.
2. Make meaningful relationships visible through clear connection lines, so I
   can understand which agents use which services and how their work connects.
3. Let me add services and connect them to agents through an intuitive visual
   flow.
4. Let me click an agent to inspect its work, a service to manage its
   connection, a task to edit it, or a document to open its contents.
5. Reveal details in context through a side panel or expanding view, so I keep
   my place in the project.
6. Keep tasks and documents accessible from the relevant agents or
   relationships without crowding the overview with every detail.
7. Show useful live states: working, connected, completed, or needs attention.
8. Support smooth movement around the workspace, appropriate zoom controls, and
   persistent arrangements so the dashboard stays how I organized it.

### The visual quality matters

I want a polished interface with beautiful, purposeful color and subtle
animation. Use the screenshot's dark background, fine grid, clean cards, and
delicate borders as the starting reference.

Keep text short and useful. Show names, status, and essential context; reveal
the rest when I interact. Give the project room to breathe instead of filling
the screen with oversized headings, explanatory paragraphs, decorative images,
or bulky panels.

Use tasteful accents to distinguish types, states, and selections. Movement
should feel fluid: natural dragging, clear selection, smooth opening of
documents and details, and subtle animation that communicates actual activity.
Keep status understandable without color alone and respect reduced-motion
preferences.

### Connect this to the actual project experience

Use existing project data and functionality. Items should open real tasks and
documents, statuses should reflect actual activity, and connections should
represent supported relationships.

Adding a service should lead through its actual setup and authorization
process. Drawing a connection must not falsely imply that access has been
granted or setup has succeeded.

Preserve the ability to edit individual tasks and documents. The dashboard
should make those capabilities easier to discover and reach.

Choose an implementation that fits the existing frontend. The screenshot is a
reference for appearance and interaction, not evidence of Railway's underlying
technology.

### What success looks like

I can open a project and immediately understand what is involved, how it
connects, and what is happening. I can add a service, connect it to an agent,
rearrange items, inspect a task, and open its document without losing context.

The dashboard should feel like a living, interactive map of the project, with
clarity and space at its core.

### Save this direction in GitHub

Review the existing project dashboard, layout, and related interaction issues.
Update whichever issues cover these requirements so this feedback is preserved
and available during implementation. Prefer updating existing issues over
creating duplicates.

Include the full design intent, the screenshot explanation, and the screenshot
itself if attachment is supported. If you cannot attach it, state that clearly
and preserve a sufficiently detailed visual description.

Explicitly record that this concerns the project dashboard itself, not a
separate canvas feature or additional view. Preserve existing requirements,
reconcile any conflicting wording with this clarification, add concrete
acceptance criteria, and cross-link related issues as needed.

Verify that the updates were saved, then report which issues you updated with
links. This request is to capture the design direction in GitHub; implementation
should follow the project's existing workflow.

---

## The screenshot, described

Railway's project canvas, `railway.com/project/…?environmentId=…`, dark theme,
roughly 1900 x 1060.

**The workspace.** Near-black background, approximately `#0d0d10`, covering the
entire area between a thin top bar and the browser chrome. A **fine dotted
grid** is laid over it — small, evenly spaced, very low contrast dots, dark grey
on near-black, present enough to give the plane a sense of extent and
completely unobtrusive. The great majority of the screen is empty. Two cards sit
in perhaps a tenth of it.

**The top bar.** One line, about 40px tall. A small circular product mark at the
far left, then a breadcrumb — a workspace avatar, `discerning-strength` with a
disclosure chevron, a slash, then `production` with its own chevron. Nothing
else until the right-hand side, where there are two small monochrome icons, a
compact pill reading `16 days or $2.13 left` in muted amber, and an `Agent`
button with a speech-bubble icon. No page title. No description. No hero.

**The floating toolbar.** Centred near the top of the canvas rather than docked
to the bar: a single dark rounded container holding `Apply 39 changes` in
green-tinted text, a `Details` button with a pale outline, a solid violet
`Deploy` button carrying its own keyboard hint `⇧+Enter` in a dimmer shade
inside the same button, and a vertical three-dot overflow. It floats above the
canvas with a soft shadow. It appears only because there is something to apply.

**The left rail.** Roughly 44px wide, five small monochrome glyphs stacked at
the top with generous vertical spacing, no labels, no active-state fill beyond a
faint highlight on the current one. It does not compete for attention.

**The bottom-left controls.** A vertical stack of small square buttons with
hairline borders, separated into groups: a grid/snap toggle, then zoom in, zoom
out and fit-to-view, then undo and redo, then a layers control. Each is roughly
28px, icon-only, low contrast until hovered. They sit in the corner and stay out
of the way.

**The cards — the most important part.** Two of them, each perhaps 270 x 130,
generously padded, with **hairline borders** rather than heavy strokes and a
subtle inner darkness that separates them from the grid.

The upper card is a Postgres service. It carries a coloured service glyph, the
name `Postgres` in plain medium weight, a small `New` chip in the top-right
corner, and one status line: a circular warning glyph followed by
`12 Variables and 24 Settings`. Its border is a soft green, indicating a
selected or newly-added state, and a **second, attached strip** hangs directly
beneath it inside the same green boundary, reading `postgres-volume` with a
small volume icon — a related resource shown as part of the same object rather
than as a separate card.

The lower card is a GitHub-sourced service. A GitHub glyph, the name
`ai-command-centre`, and a status row: a small green dot with the word `Online`
on the left, and on the right a compact amber chip showing a warning triangle
and the number `3`. Its border is a neutral hairline grey.

**What the cards demonstrate**, and this is the substance of the reference:
identity is a glyph plus a short name; state is a dot, a word and a count;
everything else is behind interaction. No paragraph, no description field, no
metrics strip, no buttons on the card face. Two lines of text per card carry the
whole meaning.

**Colour discipline.** The palette is near-black, several greys, and exactly
three accents used for meaning rather than decoration — green for healthy or
newly added, amber for attention and for the trial pill, violet for the single
primary action. Nothing is coloured to look attractive.

**What the screenshot does NOT show**, stated because Grant made the point
himself: there are no connection lines between the two cards, and no side panel
or document view is open. Those are behaviours he wants in ours; they are not
visible here.

**What is Railway's and not ours.** `Apply 39 changes`, `Deploy`, the
environment breadcrumb, the trial-credit pill, `Variables and Settings`,
volumes, and the deployment model generally. The reference is the *look and the
interaction feel*: the open plane, the dotted grid, the small dense cards, the
restraint, the unobtrusive controls, and the amount of empty space.
