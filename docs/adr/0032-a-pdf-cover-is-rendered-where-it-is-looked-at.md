# ADR-0032 — A PDF cover is rendered where it is looked at, and never stored

**Status:** Accepted · 2026-09-16 · Issue #10

## Context

§7 of the master spec requires a high-quality cover from page 1 of every PDF.
Issue #10 posed it as a placement question with three candidates and said the
answer was not obvious:

1. a **Deno edge function** rendering with `pdf.js` — unproven here, no native
   canvas, CPU and memory limits;
2. the **browser at upload time** — proven technology, no server cost, but only
   covers files uploaded through the UI, not through the API or by an agent;
3. **a script run from a session** — a proven pattern in this repository, and
   not automatic.

The Issue said the choice determines whether an agent uploading a document via
the API gets a cover, *"which is the whole point of §11 and §12"*.

## Decision

**None of the three. A cover is rendered in the browser at DISPLAY time and is
never stored anywhere.**

`web/studio/pdf.js` loads a self-hosted `pdf.js` (`web/studio/vendor/pdf.mjs`,
330KB, lazily — most sessions never open a PDF), renders page 1 to a canvas at
twice the requested width, and caches the result in a `Map` keyed by URL.

## Why this dissolves the question rather than answering it

The three candidates all assume a cover is an **artefact**: something produced
once, put somewhere, and fetched later. Every difficulty in #10 follows from
that assumption — who generates it, where it is stored, what happens to files
that arrive by a route with no browser attached, and what backfills the ones
that already exist.

A cover rendered at display time is not an artefact. It is a **view**, and the
awkward cases stop existing:

- **An agent uploading through the API needs no cover**, because an agent does
  not look at one. The first person to open the gallery renders it, from the
  real file, with no backfill and no queue.
- **There is nothing to keep in step.** `public.documents` has no thumbnail,
  cover or preview column, and a stored cover is a copy — 0303 and 0304 are in
  `CLAUDE.md` for exactly this: the copy is the one that rots.
- **Nothing to migrate.** A change to how a cover is drawn takes effect on the
  next page load rather than needing 86 documents re-rendered.
- **No storage cost** against the 1GB free tier, and no CPU on a server that
  bills for it.

It is the same argument as *"do not store a fact you can already read"*
(migration 0310), applied to pixels.

## What this costs, stated

- **The first paint is the expensive one.** 330KB of library, once per session,
  and a render per document. Mitigated by the lazy import and the per-URL cache
  — scrolling a gallery of twelve past the viewport twice costs twelve renders,
  not twenty-four — and by the fact that the fallback is not a broken image.
- **A surface with no browser gets no cover.** Telegram, Slack and the voice
  call show a title and a provenance line, which is what a person wants in a
  chat message anyway.
- **The cache is memory, not storage**, deliberately: these are large, and a
  page reload is a fine moment to forget them.

## Why option 1 was not tested, and what is known about it

The vendored `pdf.js` reaches for `OffscreenCanvas` in 11 places and
`document.createElement("canvas")` in 7 — rendering a page means rasterising
it, and the library has no path that does not. So the edge option turns on
whether Supabase's Deno runtime provides a canvas.

**That was not tested**, and it is worth being exact about why rather than
implying it was: once the cover became a view, there was nothing for a server
to produce. Testing it would have been measuring a route to somewhere nobody is
going. If a future requirement genuinely needs a cover as a file — an emailed
digest with inline images, say — that test is the first step and this ADR is
not an argument against it.

Option 3 (a script) is the one this repository would have reached for out of
habit, and it fails Grant's standing goal directly: *"a capability that exists
only as a script an agent runs is a capability Grant does not have."*

## Degrading

A PDF that will not parse, a file that 404s, a browser with no worker: all land
on the drawn page from `page.js`, which is what was there before #23 and is a
perfectly good cover. **Nothing about a failure is a broken image.**

## Consequences

- §7's requirement is met for every surface that has a browser, which is the
  only surface that shows covers.
- `documents` gains no column, `storage` gains no bucket, and no duty exists to
  backfill anything.
- Swapping the rendering strategy later is a change to one file with no data
  migration behind it, which is the property that made this reversible enough
  to decide without Grant.
