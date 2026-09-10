# Reference board — Agentic Team HQ

**For:** M0, the visual prototype (Issue #12)
**Standard:** `docs/spec/frontend-build-prompt-2026-09-10.md` §14A, §19

Each entry names **one transferable principle** and what it would do here.
Brand names are the address, not the point — the principle is the point, and
none of these designs is copied. Where a claim is about how something behaves
rather than how it looks, that is because behaviour is the part worth stealing.

---

## Navigation and continuity

**1 · Linear — the command palette as the real navigation.**
The menu exists for discovery; the palette is how anyone who uses the product
daily actually moves. *Here:* Grant is a single daily user. A palette reached
with one key that resolves projects, documents, tasks and staff by fuzzy name is
worth more than any sidebar refinement — and `app.resolve_project_by_name`
already does the hard half.

**2 · Arc — the sidebar as a place, not a menu.**
Navigation carries state (what's open, what's pinned) rather than only
destinations, so returning to a section returns you to where you were.
*Here:* a project you were reading should reopen where you left it, not at the
top.

**3 · macOS Finder column view — depth without page loads.**
Selecting in one column reveals the next; the previous stays visible so you
never lose your place. *Here:* project → module → document could be lateral
reveal rather than three full navigations, which is what makes a document
library feel browsable instead of like a filing system.

**4 · iOS parent-child push — the shared element carries identity.**
Tapping a thing expands *that thing*; the object you touched is the object you
land in. *Here:* §17 names this exactly — a PDF card expands into the viewer.
The View Transitions API does it in ~15 lines with no framework.

## Cards and physicality

**5 · Apple TV poster shelves — the artwork is the interface.**
Titles are secondary; you navigate by recognising covers. Selection lifts the
poster slightly and parallaxes its layers. *Here:* the single most important
principle for §7. Grant makes beautiful PDFs and wants to *see* them. The cover
is the object; the filename is a caption.

**6 · Things 3 — a card that is a single physical object.**
No inner borders, no nested boxes; one surface, one shadow, hierarchy from type
and space. *Here:* the current dashboard's cards have headers, hints, bodies and
inner tiles — four boxes deep. That is the "endless rectangular cards" §14
forbids.

**7 · Notion's own database cards — what NOT to do.**
Uniform grey rectangles of identical visual weight, cover images cropped
without art direction. Grant's verdict: *"too bland and boring... it just
doesn't feel that good."* *Here:* the diagnostic — if every card carries the
same weight, nothing is being said about importance.

**8 · Trello card lift on drag.**
The card tilts slightly, gains shadow, and the gap it left collapses smoothly.
Cheap, and it makes dragging feel like moving an object. *Here:* §17's drag
requirement, achievable with transform and one spring.

## Documents

**9 · Apple Books / Preview — the page IS the thumbnail.**
Rendered page 1 at high resolution with a real paper edge and shadow, not a
generic file glyph. *Here:* Issue #10 is the spike for exactly this. The
difference between "a document manager" and "a studio".

**10 · Are.na — a mixed grid that stays calm.**
Images, text, PDFs and links in one grid, unified by consistent margins and a
restrained palette, so heterogeneous content does not read as clutter.
*Here:* Grant's material is a Zoom transcript, three PDFs, a .docx, a WhatsApp
audio and a questionnaire. They must sit together without a type-badge circus.

**11 · Readwise Reader — provenance as quiet metadata.**
Where a document came from is one small line, always in the same place, never
competing. *Here:* supplied-by-Grant versus authored-by-the-team (#20) needs to
be visible and must not become a badge.

## Typography and composition

**12 · Stripe Docs — one strong type ramp doing all the work.**
Few sizes, wide gaps between them, and no decoration substituting for
hierarchy. *Here:* the 2026-09-10 restyle moved base to 15.5px and numbers to
30px and that alone changed how the page reads. Go further: fewer, more
distinct steps.

**13 · Editorial layout — asymmetry as the default.**
A wide column and a narrow one, deliberately unequal, instead of a symmetric
grid. *Here:* §14A's "repetitive grids" failure. A project dashboard has a
primary thing and secondary things; the layout should say so before the
labels do.

**14 · Swiss poster tradition — the ground is a colour, not white-by-default.**
A chosen paper tone that everything else is tuned against. *Here:* the warm
`#FBFAF7` in Direction A did more for the feel than the accent colour did.

## Motion

**15 · Rauno Freiberg's interaction studies — motion as physics, not duration.**
Springs with mass and damping rather than easing curves and milliseconds;
interruptible, so a second gesture during an animation is handled rather than
queued. *Here:* the motion token system §18 requires. Web Animations plus a
small spring helper gets most of it with no library.

**16 · Family / Vercel-style optimistic state — the change happens, then reconciles.**
Ticking a task moves it immediately; the network catches up. Failure animates
back with an explanation. *Here:* completing a task must never wait on a round
trip to Supabase.

**17 · Skeletons that match the real layout exactly.**
Loading state is the final composition in grey, so nothing shifts when data
arrives. *Here:* the current page shows nothing and then everything, which reads
as a jump.

## Agent presence

**18 · Figma multiplayer cursors — presence is ambient, never modal.**
You always know who else is here; it never interrupts. *Here:* eight staff
agents working. Their presence should be felt at the edge of the page, not
reported in a feed you have to read.

**19 · Linear's issue activity — one line per event, actor first.**
Avatar, verb, object, time. Scannable in a column without reading.
*Here:* §9's "who did what, for which project, why, when, what was produced" is
that shape exactly.

**20 · Aircraft cockpit annunciators — status has a fixed home.**
A warning always appears in the same place, so a glance to that place is enough
and its absence is information too. *Here:* "waiting on you" should have one
permanent location. `needs_me` already exists; it needs somewhere consistent.

---

## What this adds up to

Five decisions, taken from the above rather than from taste:

1. **Content carries colour; chrome stays quiet.** Project cover art and
   document covers are the colour on the page. Navigation, panels and type are
   near-neutral. This is what stops it reading as a template (7, 10, 14) and it
   is also why per-project accent colours belong on the content, not the frame.
2. **Documents are shown, not listed.** Rendered page 1, real size, paper edge.
   Everything in §7 follows from committing to this (5, 9).
3. **One object, one surface.** No card inside a card. Hierarchy from type scale
   and space (6, 12, 13).
4. **The thing you touch is the thing you get.** Shared-element transitions for
   project → dashboard and document → viewer (4, 8).
5. **Presence is ambient; status has a fixed home.** Agents felt at the edge;
   anything needing Grant always in the same place (18, 20).

The next document is `docs/design/direction.md`: the type ramp, spacing scale,
surface and depth rules, colour, and motion tokens that these five decisions
imply.
