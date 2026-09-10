# Visual and interaction direction — Agentic Team HQ

**For:** M0 (Issue #12) · **Derives from:** `docs/design/references.md`
**Binding standard:** `docs/spec/frontend-build-prompt-2026-09-10.md` §§14, 14A, 17–23

This is the specification the prototype is built against and critiqued against.
Where a number appears it is the number, not a suggestion — "roughly 30px" is
how a design becomes a template.

---

## The art direction, in one paragraph

**A quiet studio in which the work is the only thing with colour.** The room is
warm paper or warm dark; the furniture — navigation, panels, labels — is
near-neutral and recedes. Every bit of chroma on screen belongs to something
Grant made or something his team produced: a document cover, a project's
artwork, an agent's mark. The page is composed asymmetrically, like a spread
rather than a grid, and things behave like objects: they lift when grasped,
they expand into themselves, they settle rather than stop.

**What it is not:** a control panel, a database with rounded corners, or a
gradient. If a screen could carry any other product's name without changing,
it has failed.

## Colour

Grant: *"Don't use the corporate colors. Use a different color scheme. You can
have two different color schemes, a light and a dark."*

The chrome is deliberately almost colourless so that content can carry hue.

### Light — "Paper"

| Token | Value | Use |
|---|---|---|
| `--ground` | `#FAF8F4` | the page |
| `--surface` | `#FFFFFF` | raised objects |
| `--sunken` | `#F2EFE9` | wells, inputs, empty slots |
| `--ink` | `#191813` | primary text |
| `--ink-2` | `#6B675C` | secondary text |
| `--ink-3` | `#9C9789` | labels, metadata |
| `--edge` | `#E6E1D7` | hairlines |
| `--accent` | `#1F5F4B` | the single interactive colour |
| `--accent-wash` | `oklch(from #1F5F4B l c h / 0.08)` | selected, hover |

### Dark — "Studio"

| Token | Value | Use |
|---|---|---|
| `--ground` | `#14140F` | the page |
| `--surface` | `#1D1D17` | raised objects |
| `--sunken` | `#100F0B` | wells — darker than ground, not lighter |
| `--ink` | `#F0EDE4` | primary text |
| `--ink-2` | `#A5A091` | secondary |
| `--ink-3` | `#726D5F` | labels |
| `--edge` | `#2C2B23` | hairlines |
| `--accent` | `#5FBF96` | lifted for contrast |
| `--accent-wash` | `oklch(from #5FBF96 l c h / 0.14)` | selected, hover |

Both grounds are warm (hue ~85–95 in oklch) at very low chroma. The dark theme
is a warm dark, not a blue-black — blue-black is the single most common tell of
a template.

### Status — semantic, never decorative

`--good #2F7355 / #4BBD8C` · `--warn #A2620A / #E0A45C` · `--bad #A8342C / #F0796E`

Status appears on lamps and text only. The accent appears on controls only.
They never trade places: a green "done" lamp and a green primary button in the
same view is how a palette stops meaning anything.

### Project colour

Each project carries one hue used **only** on its cover art and its 3px spine.
Six, evenly spaced in oklch at fixed L and C so none dominates:

`oklch(0.62 0.13 25)` rust · `oklch(0.62 0.13 85)` amber ·
`oklch(0.62 0.13 145)` moss · `oklch(0.62 0.13 205)` slate-blue ·
`oklch(0.62 0.13 285)` iris · `oklch(0.62 0.13 340)` plum

## Typography

Two families, both real choices with fallbacks that share metrics.

| Role | Face | Fallback |
|---|---|---|
| Display — page titles, project names, numbers | **Fraunces** *(soft, optical-size axis)* | `Georgia, 'Times New Roman', serif` |
| Text — body, labels, UI | **Inter Tight** | `-apple-system, 'Segoe UI', sans-serif` |

> Note: §14's anti-pattern list names Inter and Fraunces as overused. They are
> chosen here anyway, and the reason is specific: **Fraunces' optical-size and
> softness axes** let one family be a warm editorial display face at 40px and a
> neutral one at 15px, which no other free variable serif does; and **Inter
> Tight** is the tight-tracking cut, not stock Inter. If the prototype reads as
> generic, this pairing is the first thing to change — that is exactly what the
> escalation rule in §14A is for, and it is recorded here so the decision is
> revisited deliberately rather than defended.

### Ramp — six steps, wide gaps

| Step | Size / line | Face | Use |
|---|---|---|---|
| Display | 44 / 1.02, −0.02em | Fraunces 400 | one per page, never two |
| Title | 27 / 1.15, −0.015em | Fraunces 400 | section and project names |
| Lead | 17 / 1.5 | Inter Tight 400 | the sentence under a title |
| Body | 15.5 / 1.55 | Inter Tight 400 | everything |
| Meta | 13 / 1.45 | Inter Tight 400, `--ink-2` | captions, timestamps |
| Label | 12 / 1.3, 0.09em, uppercase | Inter Tight 600, `--ink-3` | field names only |

**Floors, enforced by `verify:ui`:** nothing below 12px · inputs ≥16px or iOS
Safari zooms on focus · touch targets ≥44px.

Numerals are tabular everywhere. A figure that changes width as it ticks is a
figure that jitters.

## Space

An 8px base with a deliberately non-linear scale, because equal steps produce
the even, weightless spacing that reads as generated:

`4 · 8 · 12 · 20 · 32 · 52 · 84`

Gaps *between* groups always come from a step above the gaps *within* them.
A card's internal padding is 20; the gap between cards is 32; the gap between
sections is 52.

**Measure:** prose caps at 62ch, never full width.

**Composition:** the primary grid is asymmetric — `minmax(0, 1.618fr)` and
`minmax(0, 1fr)` — not two equal columns. A symmetric split says the two things
matter equally, which is almost never true.

## Surfaces and depth

Depth comes from **one hairline and one very soft shadow**, never from a stack.

```
--lift-0: none                                   /* flush: rows, list items */
--lift-1: 0 1px 2px rgb(25 24 19 / .05)          /* cards at rest           */
--lift-2: 0 2px 4px rgb(25 24 19 / .05),
          0 8px 24px -12px rgb(25 24 19 / .18)   /* hover, dragging         */
--lift-3: 0 8px 16px rgb(25 24 19 / .09),
          0 32px 64px -24px rgb(25 24 19 / .28)  /* the open document       */
```

Radii: `6` controls · `10` cards · `14` sheets · `999` pills.
**One object, one surface.** No card inside a card — if content needs
separation, use space or a hairline.

Document covers get a paper edge rather than a border: a 1px inset highlight on
the top edge and the `--lift-1` shadow below. That is what makes a rendered page
read as paper instead of as an image in a box.

## Motion

Springs, not durations. Three tokens, and everything uses one of them.

| Token | Spring | Use |
|---|---|---|
| `--spring-snap` | stiffness 520, damping 34 | press, toggle, check — under 150ms felt |
| `--spring-move` | stiffness 260, damping 28 | layout shifts, reorder, drawer |
| `--spring-carry` | stiffness 180, damping 26 | shared-element transitions |

Rules:
- **Interruptible.** A second gesture mid-animation retargets; it never queues.
- **Transform and opacity only.** Anything animating `width`, `top` or
  `box-shadow` on a list is a performance bug.
- **Enter from where it came from.** Nothing fades in from nowhere.
- **Reduced motion is a real design, not an off switch:** transitions become
  a 90ms opacity cross-fade, the shared element still moves (it carries meaning),
  and the pulse becomes a static dot.

### Choreography that must exist in M0

1. **Project → dashboard.** The cover art is the shared element; it grows and
   moves to the cover slot. Title and metadata cross-fade over it, staggered 40ms.
2. **Document card → viewer.** The rendered page is the shared element and
   scales into place; the surrounding grid dims to 40% and does not move.
3. **Task complete.** Checkbox fills on `--spring-snap`, the row desaturates
   over 200ms, then the list closes the gap on `--spring-move`. Optimistic —
   never waits on the network.
4. **Drag.** Lift to `--lift-2` with a 1.5° tilt in the direction of travel;
   the gap collapses behind on `--spring-move`.
5. **Arrival.** Skeletons match the final composition exactly, so nothing moves
   when data lands.

## Agent presence

Eight agents, each a 28px mark with their initial in their own hue. Presence is
**ambient**: a strip at the edge, faces going quiet or active. Never a modal,
never a toast, never a feed you must read.

An activity line is: `[mark] [name] [verb] [object] · [when]` — actor first,
scannable down the column without reading (reference 19).

**Anything waiting on Grant appears in one fixed place** on every screen, and
that place is empty when nothing is waiting (reference 20).

## Technology

Chosen against §15, and by what keeps the £0/month and no-build-step
constraints intact. This is the Option 2 of the integration assessment.

| Need | Choice | Why not the obvious alternative |
|---|---|---|
| Structure | ES modules, no bundler | Preserves the constraint. Revisit only with evidence. |
| Shared elements | **View Transitions API** | Baseline in Chrome, Edge, Safari 18+, Firefox 141+. ~15 lines versus a framework. |
| Springs | **Web Animations API** + a ~40-line spring-to-keyframes helper | Motion One and GSAP are both good; neither is worth a dependency for three tokens. |
| Drag | **Pointer Events** + transform | dnd-kit is React-only. |
| PDF | **pdf.js** from a CDN, page 1 to canvas | The only real option; Issue #10 decides where it runs. |
| Charts | Inline SVG | Already how the sparklines work. |

**Fallback, stated in advance:** where View Transitions are unsupported, the
transition degrades to the reduced-motion cross-fade. Same code path, no
branching.

**The escalation trigger, written down now so it is honest later:** if two full
visual iterations fail the WOW gate and the diagnosis is *motion or drag feels
mechanical*, that is the evidence for React + Motion, and this document becomes
its specification rather than being defended.

## How this gets judged

For every screen, at 1440×900 and 390×844, in both themes:

- Is there one obvious focal point, or does everything weigh the same?
- Could this screen carry another product's name unchanged?
- Are the document covers the most prominent thing on a documents view?
- Does any card contain another card?
- Does anything animate a property other than transform or opacity?
- Is prose wider than 62ch anywhere?
- Does the loading state match the loaded composition?
- With realistic data — 33 documents, 24 tasks, 8 agents — is it still calm?

And the gate itself: **if the data were fake, would this still feel unusually
beautiful, sophisticated, tactile and memorable?** "Clean" is a fail.
